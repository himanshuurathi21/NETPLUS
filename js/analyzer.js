(function (global) {
  'use strict';

  const SEV_ORDER = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Healthy': 0 };
  const LAYERS = {
    1: { name: 'Physical', label: 'Layer 1 - Physical' },
    2: { name: 'Data Link', label: 'Layer 2 - Data Link' },
    3: { name: 'Network', label: 'Layer 3 - Network' },
    4: { name: 'Transport', label: 'Layer 4 - Transport' },
    7: { name: 'Application', label: 'Layer 7 - Application' }
  };

  function sig(data, key) {
    return data && data.wifi && data.wifi.data ? data.wifi.data[key] : null;
  }

  function ping(data, key) {
    const p = data && data.connectivity && data.connectivity.pings ? data.connectivity.pings[key] : null;
    return p || null;
  }

  function sigEvidence(data, wifiSignal) {
    const label = data.meta && data.meta.signalLabel ? ' [' + data.meta.signalLabel + ']' : '';
    return 'Signal = ' + wifiSignal + '% (' + pctToDbm(wifiSignal) + ')' + label;
  }

  function analyze(data) {
    const findings = [];
    const mode = data.mode || 'wifi';
    const wifiConnected = !!(data.wifi && data.wifi.connected);
    const wifiSignal = sig(data, 'signalPct');
    const hasWiFi = !!(data.wifi && data.wifi.available);

    const pGateway = ping(data, 'gateway');
    const pInternet = ping(data, 'internet');
    const pAlt = ping(data, 'alt');
    const activeIface = data.connectivity && data.connectivity.activeIface;
    const dns = data.dns || {};
    const trace = data.trace || { hops: [] };
    const conn = data.connectivity || {};

    if (mode === 'mobile' && !conn.hasGateway && !wifiConnected && !(activeIface && activeIface.ipv4)) {
      findings.push({
        title: 'Cellular Outage / No Service',
        rootCause: 'No cellular network is available - the cell tower is down or there is a SIM/network registration issue',
        layerNum: 1, layer: LAYERS[1], severity: 'Critical', confidence: 90,
        evidence: 'No data session, no carrier gateway reachable',
        fix: 'Toggle airplane mode, re-insert the SIM card, and check the carrier network status'
      });
      return finalize(data, findings);
    }

    if (!hasWiFi && wifiConnected === false && !conn.hasGateway && !(activeIface && activeIface.ipv4)) {
      findings.push({
        title: 'No Network Interface Active',
        rootCause: 'No active network interface found - the WiFi adapter is off or the LAN cable is disconnected',
        layerNum: 2, layer: LAYERS[2], severity: 'Critical', confidence: 92,
        evidence: 'ipconfig: no IPv4 address assigned, no default gateway',
        fix: 'Enable the WiFi adapter or connect the LAN cable, then reboot and try again'
      });
      return finalize(data, findings);
    }

    if (activeIface && activeIface.apipa) {
      findings.push({
        title: 'DHCP Server Unreachable (APIPA)',
        rootCause: 'Could not obtain an IP address from the DHCP server - the system auto-assigned APIPA 169.254.x.x',
        layerNum: 3, layer: LAYERS[3], severity: 'Critical', confidence: 95,
        evidence: 'IPv4 = ' + activeIface.ipv4 + ' (169.254 APIPA range), no gateway',
        fix: 'Restart the router/AP, check the DHCP service, or assign a static IP and test'
      });
      return finalize(data, findings);
    }

    if (hasWiFi && !wifiConnected && !(activeIface && activeIface.ipv4)) {
      findings.push({
        title: 'WiFi Connection Failed',
        rootCause: 'The WiFi adapter is active but not connecting to the network - wrong password/authentication or AP range issue',
        layerNum: 2, layer: LAYERS[2], severity: 'High', confidence: 82,
        evidence: 'netsh wlan: state != connected',
        fix: 'Verify the password, forget the network and reconnect, or check the WPA2 configuration on the router'
      });
      return finalize(data, findings);
    }

    if (wifiConnected && typeof wifiSignal === 'number') {
      if (wifiSignal < 25) {
        findings.push({
          title: 'Critical Weak Signal',
          rootCause: 'WiFi signal is too weak (<25%) - router is too far away or there is an antenna/RF issue',
          layerNum: 2, layer: LAYERS[2], severity: 'Critical', confidence: 90,
          evidence: sigEvidence(data, wifiSignal),
          fix: 'Move closer to the router, establish line-of-sight, or add a WiFi extender/AP'
        });
      } else if (wifiSignal < 50) {
        findings.push({
          title: 'Weak Signal',
          rootCause: 'WiFi signal is weak (25-50%) - latency and packet loss may increase due to range or interference',
          layerNum: 2, layer: LAYERS[2], severity: 'Medium', confidence: 88,
          evidence: sigEvidence(data, wifiSignal),
          fix: 'Adjust the router position, remove walls/obstacles, or use a better antenna'
        });
      }
    }

    const jitterInternet = pInternet ? pInternet.jitter : 0;
    const jitterAlt = pAlt ? pAlt.jitter : 0;
    const jitterMax = Math.max(jitterInternet, jitterAlt);

    if (mode === 'wifi' && wifiConnected && typeof wifiSignal === 'number' && wifiSignal >= 50 && jitterMax > 60) {
      findings.push({
        title: 'WiFi Interference / Channel Congestion',
        rootCause: 'Signal is strong but jitter is very high - co-channel interference or WiFi channel congestion (802.11 CSMA/CA)',
        layerNum: 2, layer: LAYERS[2], severity: 'High', confidence: Math.min(92, 60 + jitterMax * 0.5),
        evidence: sigEvidence(data, wifiSignal) + ', Jitter = ' + jitterMax + ' ms (RTT variation)',
        fix: 'Change the router channel (try 1/6/11), use the 5 GHz band, or move away from neighboring APs'
      });
    }

    if (pGateway && pGateway.lossPct >= 90) {
      findings.push({
        title: 'Gateway Link Down',
        rootCause: pGateway.lossPct + '% packet loss to the default gateway - the physical link or the router interface is down',
        layerNum: 1, layer: LAYERS[1], severity: 'Critical', confidence: 94,
        evidence: 'ping ' + conn.gateway + ': loss = ' + pGateway.lossPct + '%, received = ' + pGateway.received + '/' + pGateway.sent,
        fix: 'Check the cable/port, restart the router, or toggle the interface up/down'
      });
    } else if (pGateway && pGateway.lossPct >= 40) {
      findings.push({
        title: 'Gateway Unstable (High Loss)',
        rootCause: '40%+ packets are dropped to the gateway - bad cable, duplex mismatch, or router overload',
        layerNum: 2, layer: LAYERS[2], severity: 'High', confidence: 85,
        evidence: 'ping ' + conn.gateway + ': loss = ' + pGateway.lossPct + '%, jitter = ' + pGateway.jitter + ' ms',
        fix: 'Replace the Ethernet cable, update the NIC drivers, and check duplex/auto-negotiation'
      });
    }

    if (conn.gatewayReachable === true && conn.internetReachable === false) {
      findings.push({
        title: 'Internet Unreachable (ISP / WAN Issue)',
        rootCause: 'Gateway is reachable locally but the internet (8.8.8.8) is unreachable - ISP link is down or the router WAN/PPPoE config is wrong',
        layerNum: 3, layer: LAYERS[3], severity: 'Critical', confidence: 90,
        evidence: 'Gateway ping OK, ping 8.8.8.8 = 100% loss',
        fix: 'Check the router WAN status, contact the ISP, and restart the modem (30s power cycle)'
      });
    }

    if (pInternet && pInternet.lossPct > 0 && pInternet.lossPct <= 40 && pInternet.avg > 150) {
      findings.push({
        title: 'Network Congestion',
        rootCause: 'Moderate loss + high RTT - the link is congested and its buffers are overflowing',
        layerNum: 3, layer: LAYERS[3], severity: 'Medium', confidence: Math.min(88, 55 + pInternet.lossPct),
        evidence: 'loss = ' + pInternet.lossPct + '%, avg RTT = ' + pInternet.avg + ' ms',
        fix: 'Retry during off-peak hours, stop bandwidth-heavy apps, or upgrade the bandwidth plan'
      });
    }

    if (pInternet && pInternet.lossPct > 40 && pInternet.lossPct < 90) {
      findings.push({
        title: 'Severe Link Degradation',
        rootCause: '40%+ packet loss on the internet path - severe congestion, interference, or an ISP line issue',
        layerNum: 3, layer: LAYERS[3], severity: 'High', confidence: 85,
        evidence: 'loss = ' + pInternet.lossPct + '%, jitter = ' + pInternet.jitter + ' ms',
        fix: 'Get an ISP line test done, and eliminate WiFi interference (test with a wired connection)'
      });
    }

    const avgBoth = [pInternet && pInternet.avg, pAlt && pAlt.avg].filter(v => typeof v === 'number');
    const lowLoss = (pInternet ? pInternet.lossPct : 0) <= 10 && (pAlt ? pAlt.lossPct : 0) <= 10;
    if (avgBoth.length === 2 && avgBoth[0] > 200 && avgBoth[1] > 200 && lowLoss) {
      findings.push({
        title: 'High Latency Path',
        rootCause: 'RTT is 200ms+ on both paths - high-latency link (satellite/geographical distance or carrier congestion)',
        layerNum: 3, layer: LAYERS[3], severity: 'Medium', confidence: 75,
        evidence: '8.8.8.8 avg = ' + avgBoth[0] + ' ms, 1.1.1.1 avg = ' + avgBoth[1] + ' ms',
        fix: 'Choose a better latency path for real-time apps, or ask the ISP about the route'
      });
    }

    const dnsOk = !!(dns.server && dns.address && dns.status !== 'failed');
    const pingOk = pInternet && pInternet.received > 0;
    if (pingOk && !dnsOk) {
      findings.push({
        title: 'DNS Resolution Failure',
        rootCause: 'Ping (IP) works but DNS is not resolving - DNS server misconfiguration or the DNS server is down',
        layerNum: 7, layer: LAYERS[7], severity: 'Critical', confidence: 93,
        evidence: 'ping 8.8.8.8 = OK, nslookup google.com = failed',
        fix: 'Set DNS to 8.8.8.8 / 1.1.1.1, check router DNS passthrough, or flush the DNS cache (ipconfig /flushdns)'
      });
    } else if (pingOk && dnsOk && dns.lookupMs > 500) {
      findings.push({
        title: 'Slow DNS Resolution',
        rootCause: 'DNS lookup takes 500ms+ - slow/overloaded DNS server or a long query path',
        layerNum: 7, layer: LAYERS[7], severity: 'Low', confidence: 70,
        evidence: 'nslookup google.com = ' + dns.lookupMs + ' ms via ' + dns.server,
        fix: 'Use a faster DNS (1.1.1.1/8.8.8.8) and clear the router DNS cache'
      });
    }

    const badHops = trace.hops.filter(h => h.lossPct === 100);
    if (badHops.length > 0) {
      const firstBad = badHops[0];
      const hasLaterGood = trace.hops.some(h => h.hop > firstBad.hop && h.lossPct === 0 && h.ip && h.ip !== 'Request timed out');
      if (!hasLaterGood) {
        findings.push({
          title: 'Router / Link Down at Hop ' + firstBad.hop,
          rootCause: '100% loss at hop ' + firstBad.hop + ' in the traceroute - fault on that router/link (fault location identified)',
          layerNum: 3, layer: LAYERS[3], severity: 'High', confidence: 87,
          evidence: 'tracert: hop ' + firstBad.hop + ' = 100% loss (' + firstBad.ip + ')',
          fix: 'Check the router/operator at that hop - link down, BGP/routing issue'
        });
      } else {
        findings.push({
          title: 'ICMP Filtering at Hop ' + firstBad.hop,
          rootCause: 'Hop ' + firstBad.hop + ' blocks ICMP but the path is alive - this is a firewall/security policy, not a fault',
          layerNum: 3, layer: LAYERS[3], severity: 'Low', confidence: 60,
          evidence: 'tracert: hop ' + firstBad.hop + ' loss, but later hops are responsive',
          fix: 'No action needed - the path is healthy, the device is blocking ICMP'
        });
      }
    }

    const eth = (data.interfaces || []).find(i => /ethernet|lan|wired/i.test(i.name) && i.state && /disconnect/i.test(i.state));
    if (eth && wifiConnected) {
      findings.push({
        title: 'LAN Cable Not Connected',
        rootCause: 'The Ethernet cable is not connected (wired interface down) - using the WiFi fallback',
        layerNum: 1, layer: LAYERS[1], severity: 'Low', confidence: 80,
        evidence: 'netsh interface: Ethernet = Disconnected',
        fix: 'Connect the LAN cable if a wired connection is needed, otherwise ignore - the WiFi is healthy'
      });
    }

    const sameChannelCrowd = (data.neighbors || []).filter(n => n.channel && n.channel === String(sig(data, 'channel')) && n.signalPct > 40);
    if (sameChannelCrowd.length >= 2) {
      findings.push({
        title: 'Channel Overlap with Neighbors',
        rootCause: sameChannelCrowd.length + ' strong neighboring APs are on the same channel as this WiFi - co-channel interference risk',
        layerNum: 2, layer: LAYERS[2], severity: 'Low', confidence: 65,
        evidence: 'Neighbors on channel ' + sig(data, 'channel') + ': ' + sameChannelCrowd.map(n => n.ssid + ' (' + n.signalPct + '%)').join(', '),
        fix: 'Change the router channel (1, 6, 11 - non-overlapping)'
      });
    }

    if (findings.length === 0) {
      findings.push({
        title: 'No Fault Detected',
        rootCause: 'All diagnostics are normal - the network is healthy',
        layerNum: 2, layer: LAYERS[2], severity: 'Healthy', confidence: 90,
        evidence: 'Signal OK, gateway OK, internet OK, DNS OK, jitter normal',
        fix: 'No action required'
      });
    }

    return finalize(data, findings);
  }

  function finalize(data, findings) {
    findings.sort((a, b) => (SEV_ORDER[b.severity] || 0) - (SEV_ORDER[a.severity] || 0) || (b.confidence - a.confidence));
    const top = findings[0];
    let health = 100;
    const HEALTH_W = { 'Critical': 35, 'High': 20, 'Medium': 10, 'Low': 5, 'Healthy': 0 };
    for (const f of findings) {
      const w = HEALTH_W[f.severity] || 0;
      if (w <= 0) continue;
      const already = 100 - health;
      health -= Math.min(w, Math.max(0, 45 - already));
    }
    health = Math.max(0, health);
    const worst = findings.find(f => (SEV_ORDER[f.severity] || 0) >= 2);
    const status = worst ? worst.severity : 'Healthy';
    const osiLayer = status === 'Healthy' ? null : (top && top.layer ? top.layer : LAYERS[2]);
    return {
      findings,
      osiLayer,
      healthScore: health,
      status,
      generatedAt: new Date().toISOString()
    };
  }

  function pctToDbm(pct) {
    const dbm = -50 - (100 - pct) * 0.4;
    return Math.round(dbm) + ' dBm (approx)';
  }

  global.NetFaultAnalyzer = { analyze, pctToDbm, SEV_ORDER };
})(window);