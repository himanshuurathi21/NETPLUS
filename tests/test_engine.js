const fs = require('fs');
global.window = global;
eval(fs.readFileSync('js/analyzer.js', 'utf8'));
eval(fs.readFileSync('js/scenarios.js', 'utf8'));
let pass = 0, fail = 0;
const modes = ['lan', 'wifi', 'mobile'];
for (const m of modes) {
  for (const s of NetFaultScenarios.getScenarios(m)) {
    const sc = NetFaultScenarios.getScenario(m, s.id);
    const data = sc.generate();
    const a = NetFaultAnalyzer.analyze(data);
    const top = a.findings[0];
    const ok = a.findings.length > 0 && a.healthScore >= 0 && a.healthScore <= 100 && a.status;
    ok ? pass++ : fail++;
    console.log(`${m}/${s.id} -> [${a.status}] health=${a.healthScore}% layer=${a.osiLayer ? a.osiLayer.name : '-'} | top: ${top.title}`);
  }
}

  // DNS failure regression: ping OK but nslookup failed -> DNS Resolution Failure must fire
  {
    const dnsData = {
      mode: 'lan',
      wifi: { available: false, connected: false, data: null },
      connectivity: {
        hasGateway: true, gatewayReachable: true, internetReachable: true,
        pings: {
          gateway: { sent: 5, received: 5, lost: 0, lossPct: 0, avg: 2, jitter: 1 },
          internet: { sent: 5, received: 5, lost: 0, lossPct: 0, avg: 45, jitter: 8 },
          alt: { sent: 5, received: 5, lost: 0, lossPct: 0, avg: 40, jitter: 7 }
        },
        activeIface: { name: 'Ethernet', ipv4: '192.168.1.5', subnet: '255.255.255.0', gateway: '192.168.1.1', dhcp: true, dhcpServer: '192.168.1.1', mac: 'AA:BB:CC:DD:EE:FF', apipa: false }
      },
      dns: { server: 'dns', address: '8.8.8.8', status: 'failed', lookupMs: 4000 },
      trace: { hops: [] },
      neighbors: [],
      interfaces: [{ name: 'Ethernet', adminState: 'Enabled', state: 'Connected', type: 'Dedicated' }]
    };
    const a = NetFaultAnalyzer.analyze(dnsData);
    const ok = a.findings.some(f => f.title === 'DNS Resolution Failure');
    ok ? pass++ : fail++;
    console.log(`engine/dns -> [${a.status}] health=${a.healthScore}% | DNS rule fired: ${ok}`);
  }
(async () => {
  try {
    if (typeof fetch !== 'function') throw new Error('fetch not available (Node 18+ is required for the live-scan test)');
    const r = await fetch('http://localhost:3000/api/scan');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'scan failed');
    const a = NetFaultAnalyzer.analyze(j.data);
    const wifiData = j.data.wifi && j.data.wifi.data;
    console.log(`LIVE SCAN -> [${a.status}] health=${a.healthScore}% signal=${wifiData ? wifiData.signalPct + '%' : 'n/a'} layer=${a.osiLayer.name}`);
    for (const f of a.findings) console.log(`   ${f.severity} (${Math.round(f.confidence)}%): ${f.title} - ${f.rootCause}`);
  } catch (e) {
    console.log('LIVE SCAN SKIPPED: ' + e.message);
    console.log('  (start the server with `node server.js` to include the live scan test)');
  } finally {
    console.log(`RESULT: pass=${pass} fail=${fail}`);
    process.exitCode = fail ? 1 : 0;
  }
})();
