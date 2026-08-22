const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const { performance } = require('perf_hooks');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SURVEYS_DIR = process.env.EXPORT_DIR ? path.resolve(process.env.EXPORT_DIR) : path.join(ROOT, 'Surveys');
const SURVEYS_FILE = path.join(DATA_DIR, 'surveys.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const CONFIG_DEFAULTS = { port: 3000, bindHost: '127.0.0.1', pingCount: 5, pingTimeoutMs: 2000, traceMaxHops: 15, historyLimit: 25, dnsServers: ['8.8.8.8', '1.1.1.1'] };
function loadConfig() {
  try { return Object.assign({}, CONFIG_DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch (e) { return CONFIG_DEFAULTS; }
}
const CFG = loadConfig();
const PORT = process.env.PORT ? (parseInt(process.env.PORT, 10) || CFG.port) : CFG.port;
const BIND = process.env.HOST || '0.0.0.0';
const IS_WIN = process.platform === 'win32';
const HISTORY_LIMIT = Math.max(1, CFG.historyLimit || 9999);

// Make sure storage directories exist (Render uses /data which may not pre-exist).
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(SURVEYS_DIR, { recursive: true }); } catch (e) {}

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: timeoutMs || 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || '') + '\n' + (stderr || '');
      resolve({ ok: !err, out, code: err ? err.code : 0 });
    });
  });
}

// Cross-platform OS command builders (live scan works on both Windows and Linux).
function pingArgs(host) {
  return IS_WIN
    ? ['-n', String(CFG.pingCount), '-w', String(CFG.pingTimeoutMs), host]
    : ['-c', String(CFG.pingCount), '-w', String(Math.max(1, Math.ceil(CFG.pingTimeoutMs / 1000))), host];
}
function traceCmd(host) {
  return IS_WIN
    ? { cmd: 'tracert', args: ['-d', '-h', String(CFG.traceMaxHops), '-w', '1000', host] }
    : { cmd: 'traceroute', args: ['-m', String(CFG.traceMaxHops), '-w', '1', host] };
}

function parseWlanInterfaces(out) {
  const result = { available: false, connected: false, data: null };
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().replace(/\s+/g, ' ').toLowerCase().replace(/\s/g, '_');
    const val = line.slice(idx + 1).trim();
    if (!current) {
      current = {};
    }
    current[key] = val;
  }
  if (current && current.ssid) {
    result.available = true;
    result.data = current;
    result.connected = /connected/i.test(current.state || '');
    const sigM = current.signal ? current.signal.match(/(\d+)/) : null;
    const sigVal = sigM ? parseInt(sigM[1], 10) : NaN;
    current.signalPct = isFinite(sigVal) ? sigVal : null;
    Object.keys(current).forEach(k => {
      if (/receive_rate/.test(k)) { const m = String(current[k]).match(/(\d+)/); if (m) result.data.rxRate = m[1]; }
      if (/transmit_rate/.test(k)) { const m = String(current[k]).match(/(\d+)/); if (m) result.data.txRate = m[1]; }
    });
    current.radioType = current.radio_type || null;
    current.auth = current.authentication || null;
  }
  return result;
}

function parseNeighbors(out) {
  const neighbors = [];
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    const ssidMatch = line.match(/^SSID\s*\d+\s*:\s*(.*)$/);
    if (ssidMatch) {
      current = { ssid: ssidMatch[1].trim(), bssid: '', signalPct: 0, channel: '', radioType: '', auth: '' };
      neighbors.push(current);
      continue;
    }
    if (!current) continue;
    const bssid = line.match(/^BSSID\s*\d*\s*:\s*(.*)$/);
    if (bssid) { current.bssid = bssid[1].trim(); continue; }
    const sig = line.match(/^Signal\s*:\s*(\d+)%/);
    if (sig) { current.signalPct = parseInt(sig[1], 10); continue; }
    const ch = line.match(/^Channel\s*:\s*(\d+)/);
    if (ch) { current.channel = ch[1]; continue; }
    const rt = line.match(/^Radio type\s*:\s*(.*)$/);
    if (rt) { current.radioType = rt[1].trim(); continue; }
    const at = line.match(/^Authentication\s*:\s*(.*)$/);
    if (at) { current.auth = at[1].trim(); }
  }
  return neighbors;
}

function parseInterfaces(out) {
  const interfaces = [];
  const lines = out.split(/\r?\n/);
  for (const raw of lines) {
    if (/Admin State/i.test(raw)) continue;
    const m = raw.trim().match(/^(\S+)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(.+)$/);
    if (m) interfaces.push({ name: m[4].trim(), adminState: m[1], state: m[2], type: m[3] });
  }
  return interfaces;
}

function parseIpconfig(out) {
  const adapters = [];
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const section = line.match(/^(.+?) adapter (.+?):$/);
    if (section) {
      current = { adapterType: section[1].trim(), name: section[2].trim(), mediaState: null, description: '', mac: '', dhcp: null, ipv4: null, subnet: null, gateway: null, dhcpServer: null, apipa: false };
      adapters.push(current);
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([^:]+?)\s*\.\s*:\s*(.*)$/) || line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim();
    if (/media state/i.test(key)) current.mediaState = val;
    else if (/description/i.test(key)) current.description = val;
    else if (/physical address/i.test(key)) current.mac = val;
    else if (/dhcp enabled/i.test(key)) current.dhcp = /yes/i.test(val);
    else if (/ipv4/i.test(key)) { current.ipv4 = val.replace(/\(Preferred\)/i, '').trim(); current.apipa = /^169\.254\./.test(current.ipv4); }
    else if (/subnet mask/i.test(key)) current.subnet = val;
    else if (/default gateway/i.test(key)) { if (val && !/^\s*$/.test(val)) current.gateway = val.split(/\s+/)[0]; }
    else if (/dhcp server/i.test(key)) current.dhcpServer = val;
  }
  return adapters;
}

function parsePing(out) {
  const times = [];
  const tm = out.matchAll(/time[=<](\d+)ms/gi);
  for (const m of tm) times.push(parseInt(m[1], 10));
  const unreachable = (out.match(/Destination host unreachable/gi) || []).length;
  const timeouts = (out.match(/Request timed out/gi) || []).length;
  const sentM = out.match(/Sent = (\d+)/i);
  const recvM = out.match(/Received = (\d+)/i);
  const lostM = out.match(/Lost = (\d+)/i);
  const minM = out.match(/Minimum = (\d+)ms/i);
  const maxM = out.match(/Maximum = (\d+)ms/i);
  const avgM = out.match(/Average = (\d+)ms/i);
  const sent = sentM ? parseInt(sentM[1], 10) : times.length + timeouts + unreachable;
  const received = recvM ? parseInt(recvM[1], 10) : times.length;
  const lost = lostM ? parseInt(lostM[1], 10) : (sent - received);
  let jitter = 0;
  if (times.length >= 2) {
    jitter = Math.max(...times) - Math.min(...times);
  }
  return {
    sent, received, lost,
    lossPct: sent > 0 ? Math.round((lost / sent) * 100) : 100,
    unreachable, timeouts,
    min: minM ? parseInt(minM[1], 10) : (times.length ? Math.min(...times) : null),
    max: maxM ? parseInt(maxM[1], 10) : (times.length ? Math.max(...times) : null),
    avg: avgM ? parseInt(avgM[1], 10) : (times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null),
    jitter: Math.round(jitter * 10) / 10,
    times
  };
}

function parseNslookup(out) {
  let server = null, address = null;
  for (const raw of out.split(/\r?\n/)) {
    const s = raw.match(/^\s*Server:\s*(.+)$/);
    if (s) { server = s[1].trim(); continue; }
    const a = raw.match(/^\s*Address:\s*([0-9a-fA-F.:]+)/);
    if (a && server && !address) address = a[1].trim();
  }
  const failedRegex = /(^\s*\*\*\*|request timed out|no response from server|non.?existent domain|can't find|server failure|query refused|refused)/i;
  const status = failedRegex.test(out) ? 'failed' : 'ok';
  return { server, address, status };
}

function parseTracert(out) {
  const hops = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const hop = parseInt(m[1], 10);
    const rest = m[2];
    const times = [];
    const tm = rest.matchAll(/(\d+)\s*ms|\*/g);
    for (const t of tm) times.push(t[0] === '*' ? null : parseInt(t[0], 10));
    const ipM = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const samples = times.filter(t => t !== null).length;
    hops.push({
      hop,
      times,
      lossPct: times.length > 0 ? Math.round(((times.length - samples) / times.length) * 100) : 100,
      ip: ipM ? ipM[1] : 'Request timed out'
    });
  }
  return { hops };
}

function parseArp(out) {
  const entries = [];
  for (const raw of out.split(/\r?\n/)) {
    const m = raw.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F\-]{17})\s+(\w+)$/);
    if (m) entries.push({ ip: m[1], mac: m[2], type: m[3] });
  }
  return entries;
}

function inferBand(iface) {
  if (iface.band) return String(iface.band).trim();
  const ch = parseInt(iface.channel, 10);
  if (!ch) return null;
  if (ch >= 1 && ch <= 14) return '2.4 GHz';
  if (ch >= 32 && ch <= 177) return '5 GHz';
  return '6 GHz';
}

function getLanSpeed() {
  return runCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object Name,InterfaceDescription,LinkSpeed,MacAddress | ConvertTo-Json -Compress'], 12000)
    .then(r => {
      try {
        const parsed = JSON.parse(r.out);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map(x => ({ name: x.Name, description: x.InterfaceDescription || '', linkSpeed: x.LinkSpeed || null, mac: x.MacAddress || null }));
      } catch (e) { return []; }
    });
}

const OUI_VENDORS = {
  '00:1A:2B': 'TP-Link', 'D8:07:B6': 'TP-Link', '50:C7:BF': 'TP-Link', '14:CC:20': 'TP-Link', 'BC:76:5E': 'TP-Link', 'F8:1A:67': 'TP-Link', '68:7F:74': 'TP-Link', 'CC:32:E5': 'TP-Link', 'A0:F3:C1': 'TP-Link', 'C8:3A:35': 'TP-Link', 'F0:9F:C2': 'TP-Link', 'C0:06:C3': 'TP-Link', 'B0:95:75': 'TP-Link', 'A8:2B:B5': 'TP-Link', '9C:D2:1E': 'TP-Link',
  '50:64:2B': 'D-Link', '00:24:01': 'D-Link', '00:1B:11': 'D-Link', '58:6A:B1': 'D-Link', '28:10:7B': 'D-Link', 'F0:7D:68': 'D-Link', '1C:5A:6B': 'D-Link', 'C8:BE:19': 'D-Link', '28:12:2B': 'D-Link', 'B0:C5:54': 'D-Link', '98:FE:94': 'D-Link',
  '00:1B:63': 'Cisco', '00:1A:A1': 'Cisco', 'F8:5E:3C': 'Cisco', '00:0C:41': 'Cisco', 'A4:4C:11': 'Cisco', '3C:CE:73': 'Cisco', '44:D3:CA': 'Cisco', '00:1F:CA': 'Cisco', '58:38:79': 'Cisco',
  '00:13:02': 'Intel', '3C:97:0E': 'Intel', 'A4:1F:72': 'Intel', 'F4:8E:38': 'Intel', '54:B2:03': 'Intel', '68:05:CA': 'Intel', '00:1F:29': 'Intel', '8C:16:45': 'Intel', 'B4:8B:19': 'Intel', '48:2C:A0': 'Intel', 'A8:66:7F': 'Intel',
  'EC:8E:B5': 'Asus', '10:BF:48': 'Asus', '78:02:F8': 'Asus', '04:D9:F5': 'Asus', '58:11:22': 'Asus', '2C:56:DC': 'Asus', '60:45:CB': 'Asus', 'C8:7B:23': 'Asus', '44:6D:57': 'Asus',
  'D8:32:E3': 'Netgear', '20:4E:7F': 'Netgear', '84:1B:5E': 'Netgear', 'A0:63:91': 'Netgear', 'C0:3F:0E': 'Netgear', '74:C2:46': 'Netgear', '98:DA:C4': 'Netgear', 'F4:F2:6D': 'Netgear', 'B4:39:09': 'Netgear', '54:F4:55': 'Netgear',
  'F4:5C:89': 'Realtek', '52:54:00': 'VirtualBox', '00:50:56': 'VMware', '00:0C:29': 'VMware', '3C:A6:F6': 'Xiaomi', 'F8:A5:2D': 'Xiaomi', '54:9F:13': 'Xiaomi', '64:4B:F0': 'Xiaomi', '08:11:96': 'Huawei', 'C4:0B:CB': 'Huawei', 'F4:96:34': 'Huawei', 'E0:2E:0A': 'Samsung', 'A0:CE:C8': 'Samsung', '44:8A:5B': 'Samsung', 'C0:EE:FB': 'Samsung', 'B0:5A:DA': 'Samsung', '00:0E:8F': 'Motorola', '5C:49:79': 'Jio', 'A0:40:A0': 'Apple', 'A8:5C:2C': 'Apple', '7C:C3:A1': 'Apple', '3C:22:FB': 'Apple', 'F8:FF:C2': 'Apple', 'AC:BC:32': 'Apple', 'BC:92:6B': 'Apple', '00:26:BB': 'Apple', 'C4:2C:03': 'Apple'
};
function vendorFor(mac) {
  if (!mac) return null;
  const clean = String(mac).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (clean.length < 6) return 'Unknown';
  for (const prefix of Object.keys(OUI_VENDORS)) {
    if (clean.startsWith(prefix.replace(/[^0-9A-F]/g, ''))) return OUI_VENDORS[prefix];
  }
  return 'Unknown';
}

async function detectMtu(gateway) {
  if (!gateway) return { payload: null, mtu: null, note: 'no gateway' };
  const probes = [1472, 1400, 1300, 1200, 1000, 800, 500];
  let payload = null;
  for (const size of probes) {
    const r = await runCmd('ping', ['-f', '-l', String(size), '-n', '1', '-w', '1500', gateway], 8000);
    const out = r.out || '';
    if (/Reply from/i.test(out) && !/fragment/i.test(out)) { payload = size; break; }
  }
  return { payload, mtu: payload !== null ? payload + 28 : null, note: payload === null ? 'packets fragmented - MTU lower than 500 (or gateway unreachable)' : null };
}

async function ipv6Test() {
  const loop = await runCmd('ping', ['-n', '2', '-w', '1500', '::1'], 6000);
  const loopOk = /Reply from ::1/i.test(loop.out || '');
  const inet = await runCmd('ping', ['-n', '3', '-w', '2000', '2606:4700:4700::1111'], 12000);
  const inetOk = /Reply from/i.test(inet.out || '') && /2606:4700/i.test(inet.out || '');
  return { enabled: loopOk, loopbackOk: loopOk, internetOk: inetOk };
}

async function dnsLatencyTests(servers) {
  const unique = [...new Set((servers || []).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const s of unique) {
    const t0 = performance.now();
    const r = await runCmd('nslookup', ['google.com', s], 6000);
    const out = r.out || '';
    results.push({
      server: s,
      ms: Math.round(performance.now() - t0),
      ok: !/timed out|Non-existent|can't find|no response/i.test(out) && /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(out)
    });
  }
  return results;
}

function isIpv4(ip) {
  return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

function pickActiveIface(ipconfig, routeGateway) {
  const VIRTUAL = /virtual|vmware|virtualbox|hyper-v|vethernet|isatap|loopback|bluetooth|tap-|tunnel|6to4|teredo|ppp/i;
  const candidates = ipconfig.filter(a => a.ipv4 && !a.apipa && !VIRTUAL.test(a.name));
  const active = candidates.find(a => a.gateway) || candidates[0] || ipconfig.find(a => a.ipv4 && !a.apipa) || ipconfig.find(a => a.ipv4);
  const gateway = (active && active.gateway && isIpv4(active.gateway)) ? active.gateway : (isIpv4(routeGateway) ? routeGateway : null);
  return { active, gateway };
}

async function runNetworkScan() {
  const t0 = performance.now();
  const [wlan, nets, ifs, ipc, arp] = await Promise.all([
    runCmd('netsh', ['wlan', 'show', 'interfaces'], 8000),
    runCmd('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 8000),
    runCmd('netsh', ['interface', 'show', 'interface'], 8000),
    runCmd('ipconfig', ['/all'], 8000),
    runCmd('arp', ['-a'], 8000)
  ]);
  const wifi = parseWlanInterfaces(wlan.out);
  if (wifi && wifi.data) wifi.data.band = inferBand(wifi.data);
  const neighbors = parseNeighbors(nets.out);
  const interfaces = parseInterfaces(ifs.out);
  const ipconfig = parseIpconfig(ipc.out);
  const arpList = parseArp(arp.out);
  const route = await runCmd('route', ['print', '0.0.0.0'], 8000);
  let routeGateway = null;
  for (const raw of route.out.split(/\r?\n/)) {
    const m = raw.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) { routeGateway = m[1]; break; }
  }
  const { active, gateway } = pickActiveIface(ipconfig, routeGateway);
  const hosts = [
    { key: 'gateway', host: gateway },
    { key: 'internet', host: '8.8.8.8' },
    { key: 'alt', host: '1.1.1.1' }
  ].filter(h => h.host);
  const pings = {};
  await Promise.all(hosts.map(async (h) => {
    const r = await runCmd('ping', pingArgs(h.host), 15000);
    pings[h.key] = parsePing(r.out);
  }));
  const dnsT0 = performance.now();
  const nsl = await runCmd('nslookup', ['google.com'], 8000);
  const dns = parseNslookup(nsl.out);
  dns.lookupMs = Math.round(performance.now() - dnsT0);
  const lan = await getLanSpeed();
  const gatewayArp = gateway ? (arpList.find(e => e.ip === gateway) || null) : null; if (gatewayArp) gatewayArp.vendor = vendorFor(gatewayArp.mac);
  const activeIface = active ? {
    name: active.name, ipv4: active.ipv4, subnet: active.subnet, gateway: active.gateway,
    dhcp: active.dhcp, dhcpServer: active.dhcpServer, mac: active.mac, apipa: active.apipa
  } : null;
  return {
    timestamp: new Date().toISOString(),
    mode: wifi.connected ? 'wifi' : 'lan',
    wifi, neighbors, interfaces, ipconfig, arp: arpList, lan, dns,
    connectivity: {
      gateway, gatewayArp, hasGateway: !!gateway,
      internetReachable: !!(pings.internet && pings.internet.received > 0),
      gatewayReachable: !!(pings.gateway && pings.gateway.received > 0),
      pings, activeIface
    },
    scanDurationMs: Math.round(performance.now() - t0)
  };
}

function readSurveys() {
  try {
    const arr = JSON.parse(fs.readFileSync(SURVEYS_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function backupFile(file) {
  try {
    const base = path.basename(file).replace(/\.json$/, '');
    const dir = path.join(path.dirname(file), 'backup');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    fs.copyFileSync(file, path.join(dir, base + '_' + stamp + '.json'));
    const keep = fs.readdirSync(dir).filter(f => f.startsWith(base + '_')).sort();
    while (keep.length > 10) fs.unlinkSync(path.join(dir, keep.shift()));
  } catch (e) { /* backup is best-effort */ }
}

function writeSurveys(list) {
  backupFile(SURVEYS_FILE);
  const dir = path.dirname(SURVEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SURVEYS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function readHistory() {
  try { const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
}
function writeHistory(list) {
  backupFile(HISTORY_FILE);
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
}
function historySummary(d) {
  const w = d.wifi && d.wifi.data;
  const pg = d.connectivity && d.connectivity.pings;
  return {
    id: d.id || null, timestamp: d.timestamp || null,
    mode: d.mode || 'wifi',
    ssid: w ? w.ssid : null, signalPct: w ? w.signalPct : null,
    gateway: (d.connectivity && d.connectivity.gateway) || null,
    internetReachable: !!(d.connectivity && d.connectivity.internetReachable),
    gatewayReachable: !!(d.connectivity && d.connectivity.gatewayReachable),
    gwAvg: pg && pg.gateway ? pg.gateway.avg : null,
    inetAvg: pg && pg.internet ? pg.internet.avg : null,
    inetLoss: pg && pg.internet ? pg.internet.lossPct : null,
    scanDurationMs: d.scanDurationMs || null
  };
}

function newSurveyId() {
  return 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 25 * 1024 * 1024) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const SURVEY_HEADERS = ['ID', 'Location', 'SSID', 'BSSID', 'Band', 'Channel', 'RSSI (dBm)', 'Signal (%)', 'Quality', 'TX (Mbps)', 'RX (Mbps)', 'Standard', 'Security', 'Download (Mbps)', 'Upload (Mbps)', 'Ping (ms)', 'Jitter (ms)', 'Packet Loss (%)', 'Latitude', 'Longitude', 'Network Type', 'LAN Link Speed', 'Distance (m)', 'Timestamp', 'Notes'];

function surveyRow(s) {
  return [s.id, s.locationName, s.ssid, s.bssid, s.band, s.channel, s.rssiDbm, s.signalPct, s.quality, s.linkTx, s.linkRx, s.standard, s.security, s.download, s.upload, s.ping, s.jitter, s.packetLoss, s.lat, s.lng, s.networkType, s.lanLinkSpeed, s.distanceM, s.timestamp, s.notes];
}

function toCsv(surveys) {
  const esc = v => {
    const t = v == null ? '' : String(v);
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = [SURVEY_HEADERS.map(esc).join(',')];
  surveys.forEach(s => lines.push(surveyRow(s).map(esc).join(',')));
  return '\ufeff' + lines.join('\r\n');
}

function crc32(buf) {
  if (!crc32.table) {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    crc32.table = t;
  }
  const t = crc32.table;
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

function xmlEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toXlsx(surveys) {
  const rows = [SURVEY_HEADERS].concat(surveys.map(surveyRow));
  const widths = [];
  rows.forEach(r => r.forEach((v, i) => {
    const len = String(v == null ? '' : v).length;
    widths[i] = Math.max(widths[i] || 0, Math.min(len, 40));
  }));
  const colsXml = '<cols>' + widths.map((w, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(8, w + 2) + '" customWidth="1"/>').join('') + '</cols>';
  const rowsXml = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      const style = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
      return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    }).join('');
    return '<row r="' + (ri + 1) + '">' + cells + '</row>';
  }).join('');
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    colsXml + '<sheetData>' + rowsXml + '</sheetData></worksheet>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Survey" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') }
  ]);
}

function toKml(surveys) {
  const places = surveys.filter(s => s.lat != null && s.lng != null).map(s =>
    '  <Placemark>\n' +
    '    <name>' + xmlEsc(s.locationName || s.id) + '</name>\n' +
    '    <description>' + xmlEsc('SSID ' + (s.ssid || '') + ' | Signal ' + (s.signalPct != null ? s.signalPct + '%' : '') + ' | Down ' + (s.download != null ? s.download : '') + ' Mbps | Ping ' + (s.ping != null ? s.ping : '') + ' ms') + '</description>\n' +
    '    <Point><coordinates>' + s.lng + ',' + s.lat + ',0</coordinates></Point>\n' +
    '  </Placemark>'
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>NetPlus Wi-Fi Survey</name>\n' + places + '\n</Document>\n</kml>\n';
}

function clipCell(s, maxChars) {
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (t.length > maxChars) t = t.slice(0, Math.max(2, maxChars - 1)) + '~';
  return t;
}

async function exportSurveys(format, folderName, ids) {
  let surveys = readSurveys();
  if (Array.isArray(ids) && ids.length) surveys = surveys.filter(s => ids.indexOf(s.id) !== -1);
  if (!surveys.length) return { ok: false, error: 'No survey points to export' };
  const folder = String(folderName || '').replace(/[^\w -]/g, '').trim() || 'Survey_' + new Date().toISOString().slice(0, 10);
  const dir = path.join(SURVEYS_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const files = [];
  const save = (ext, buf) => {
    const f = path.join(dir, 'Survey_' + stamp + '.' + ext);
    fs.writeFileSync(f, buf);
    files.push(f);
  };
  switch (format) {
    case 'csv': save('csv', toCsv(surveys)); break;
    case 'xlsx': save('xlsx', toXlsx(surveys)); break;
    case 'json': save('json', JSON.stringify({ exportedAt: new Date().toISOString(), count: surveys.length, surveys }, null, 2)); break;
    case 'kml': save('kml', toKml(surveys)); break;
    default: return { ok: false, error: 'Unsupported format: ' + format };
  }
  return { ok: true, folder: dir, files };
}

async function runFullScan(signal) {
  const isCancelled = () => signal && signal.cancelled;
  const scan = {
    timestamp: new Date().toISOString(),
    phase1: { startedAt: performance.now() },
    wifi: null,
    neighbors: [],
    interfaces: [],
    ipconfig: [],
    arp: [],
    routeGateway: null
  };

  const [wlan, nets, ifs, ipc, arp] = await Promise.all([
    runCmd('netsh', ['wlan', 'show', 'interfaces'], 8000),
    runCmd('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 8000),
    runCmd('netsh', ['interface', 'show', 'interface'], 8000),
    runCmd('ipconfig', ['/all'], 8000),
    runCmd('arp', ['-a'], 8000)
  ]);

  scan.wifi = parseWlanInterfaces(wlan.out);
  if (scan.wifi && scan.wifi.data) scan.wifi.data.band = inferBand(scan.wifi.data);
  scan.neighbors = parseNeighbors(nets.out);
  scan.interfaces = parseInterfaces(ifs.out);
  scan.ipconfig = parseIpconfig(ipc.out);
  scan.arp = parseArp(arp.out);
  if (isCancelled()) return null;

  const route = await runCmd('route', ['print', '0.0.0.0'], 8000);
  for (const raw of route.out.split(/\r?\n/)) {
    const m = raw.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) { scan.routeGateway = m[1]; break; }
  }
  if (isCancelled()) return null;

  const VIRTUAL_IFACE = /virtual|vmware|virtualbox|hyper-v|vethernet|isatap|loopback|bluetooth|tap-|tunnel|6to4|teredo|ppp/i;
  const candidates = scan.ipconfig.filter(a => a.ipv4 && !a.apipa && !VIRTUAL_IFACE.test(a.name));
  const active = candidates.find(a => a.gateway) || candidates[0] || scan.ipconfig.find(a => a.ipv4 && !a.apipa) || scan.ipconfig.find(a => a.ipv4);
  const gateway = (active && active.gateway && isIpv4(active.gateway)) ? active.gateway : (isIpv4(scan.routeGateway) ? scan.routeGateway : null);

  const hosts = [
    { key: 'gateway', host: gateway },
    { key: 'internet', host: '8.8.8.8' },
    { key: 'alt', host: '1.1.1.1' }
  ].filter(h => h.host);

  const pingResults = {};
  await Promise.all(hosts.map(async (h) => {
    const t0 = performance.now();
    const r = await runCmd('ping', pingArgs(h.host), 15000);
    const p = parsePing(r.out);
    p.durationMs = Math.round(performance.now() - t0);
    pingResults[h.key] = p;
  }));
  if (isCancelled()) return null;

  const dnsT0 = performance.now();
  const nsl = await runCmd('nslookup', ['google.com'], 8000);
  const dnsLookupMs = Math.round(performance.now() - dnsT0);
  const dns = parseNslookup(nsl.out);
  dns.lookupMs = dnsLookupMs; dns.tests = await dnsLatencyTests([dns.server].concat(CFG.dnsServers));
  if (isCancelled()) return null;

  const mtu = await detectMtu(gateway);
  const ipv6 = await ipv6Test();
  if (isCancelled()) return null;
  const tc = traceCmd('8.8.8.8');
  const tr = await runCmd(tc.cmd, tc.args, 60000);
  let trace = { hops: [] };
  try { trace = parseTracert(tr.out); } catch (e) { trace = { hops: [], error: String((e && e.message) || e) }; }

  const gatewayArp = gateway ? (scan.arp.find(e => e.ip === gateway) || null) : null; if (gatewayArp) gatewayArp.vendor = vendorFor(gatewayArp.mac);

  const activeIface = active || null;

  const result = {
    timestamp: scan.timestamp,
    mode: scan.wifi && scan.wifi.connected ? 'wifi' : 'lan',
    connectivity: {
      gateway,
      gatewayArp,
      hasGateway: !!gateway,
      internetReachable: !!(pingResults.internet && pingResults.internet.received > 0),
      gatewayReachable: !!(pingResults.gateway && pingResults.gateway.received > 0),
      pings: pingResults,
      activeIface: activeIface ? {
        name: activeIface.name,
        ipv4: activeIface.ipv4,
        subnet: activeIface.subnet,
        gateway: activeIface.gateway,
        dhcp: activeIface.dhcp,
        dhcpServer: activeIface.dhcpServer,
        mac: activeIface.mac,
        apipa: activeIface.apipa
      } : null
    },
    wifi: scan.wifi,
    neighbors: scan.neighbors,
    interfaces: scan.interfaces,
    arp: scan.arp,
    dns,
    mtu,
    ipv6,
    trace,
    scanDurationMs: Math.round(performance.now() - scan.phase1.startedAt)
  };
  return result;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://speed.cloudflare.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");
}

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return LOCAL_HOSTNAMES.indexOf(o.hostname) !== -1 && String(o.port || '') === String(PORT);
  } catch (e) { return false; }
}

function isStaticAllowed(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) return true;
  if (/^\/[A-Za-z0-9_\-]+\.(png|ico)$/.test(pathname)) return true;
  return false;
}

let scanInProgress = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  sendSecurityHeaders(res);

  const isApiPath = pathname.startsWith('/api/');
  if (isApiPath && req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Cross-site request blocked');
    return;
  }
  if (isApiPath && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !isSameOrigin(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, name: 'netplus-ai', version: '1.0.0' }));
    return;
  }

  if (pathname === '/api/scan' && req.method === 'GET') {
    if (scanInProgress) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'A scan is already running' }));
      return;
    }
    scanInProgress = true;
    const scanSignal = { cancelled: false };
    res.on('close', () => { scanSignal.cancelled = true; });
    try {
      const data = await runFullScan(scanSignal);
      if (!data || res.destroyed) return;
      data.id = newSurveyId();
      const hist = readHistory();
      hist.unshift({ id: data.id, data });
      if (hist.length > HISTORY_LIMIT) hist.length = HISTORY_LIMIT;
      writeHistory(hist);
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, data }));
    } catch (e) {
      if (res.destroyed) return;
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    } finally {
      scanInProgress = false;
    }
    return;
  }

  if (pathname === '/api/network' && req.method === 'GET') {
    try {
      const data = await runNetworkScan();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  if (pathname === '/api/speedtest/data' && req.method === 'GET') {
    const bytes = Math.min(Math.max(parseInt(url.searchParams.get('bytes') || '8388608', 10) || 8388608, 524288), 67108864);
    const buf = Buffer.alloc(bytes);
    const pattern = Buffer.from('NetPlusAISpeedTest0123456789abcdefghijklmnopqrstuvwxyz!@#', 'latin1');
    for (let i = 0; i < bytes; i += pattern.length) pattern.copy(buf, i);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes });
    res.end(buf);
    return;
  }

  if (pathname === '/api/speedtest/upload' && req.method === 'POST') {
    const t0 = performance.now();
    let size = 0;
    let tooBig = false;
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
        return;
      }
      const ms = Math.max(1, performance.now() - t0);
      const mbps = Math.round(size * 8 / 1e6 / (ms / 1000) * 100) / 100;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, bytes: size, ms: Math.round(ms * 10) / 10, mbps }));
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(tooBig ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: tooBig ? 'Payload too large' : 'Upload aborted' }));
      }
    });
    return;
  }

  if (pathname === '/api/surveys' && req.method === 'GET') {
    const list = readSurveys().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, surveys: list }));
    return;
  }

  if (pathname === '/api/surveys' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const survey = Object.assign({}, body);
      if (!survey.id) survey.id = newSurveyId();
      if (!survey.timestamp) survey.timestamp = new Date().toISOString();
      const list = readSurveys();
      list.unshift(survey);
      writeSurveys(list);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, survey }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  const surveyMatch = pathname.match(/^\/api\/surveys\/([A-Za-z0-9_-]{1,64})$/);
  if (surveyMatch) {
    const id = surveyMatch[1];
    if (req.method === 'PUT') {
      try {
        const body = await readJsonBody(req);
        const list = readSurveys();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Survey point not found' }));
          return;
        }
        list[idx] = Object.assign({}, list[idx], body, { id });
        writeSurveys(list);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, survey: list[idx] }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
      return;
    }
    if (req.method === 'DELETE') {
      writeSurveys(readSurveys().filter(s => s.id !== id));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  if (pathname === '/api/export' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const result = await exportSurveys(String(body.format || '').toLowerCase(), body.folder, body.ids);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  

  if (pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, list: readHistory().map(h => historySummary(h.data)) }));
    return;
  }
  if (pathname === '/api/history' && req.method === 'DELETE') {
    writeHistory([]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const historyMatch = pathname.match(/^\/api\/history\/([A-Za-z0-9_-]{1,64})$/);
  if (historyMatch && req.method === 'GET') {
    const item = readHistory().find(h => h.id === historyMatch[1]);
    if (!item) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'Scan not found' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, data: item.data }));
    return;
  }
  if (historyMatch && req.method === 'DELETE') {
    const before = readHistory();
    const after = before.filter(h => h.id !== historyMatch[1]);
    if (after.length === before.length) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'Scan not found' })); return; }
    writeHistory(after);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (pathname === '/api/action' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const actions = {
        'dhcp-renew': { label: 'DHCP renew (release + renew)', steps: [['ipconfig', ['/release']], ['ipconfig', ['/renew']]] },
        'flush-dns': { label: 'DNS cache flush', steps: [['ipconfig', ['/flushdns']]] }
      };
      const a = actions[String(body.action || '')];
      if (!a) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'Unknown action' })); return; }
      if (!IS_WIN) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, action: body.action, label: a.label, note: 'OS network commands (ipconfig / netsh) are only available on Windows hosts. Run the server on Windows for live DHCP/DNS actions, or use the Survey & Mapping feature for reports.' }));
        return;
      }
      const outputs = [];
      for (const [cmd, args] of a.steps) {
        const r = await runCmd(cmd, args, 25000);
        outputs.push({ cmd: cmd + ' ' + args.join(' '), ok: r.ok, out: (r.out || '').trim().slice(0, 800) });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: body.action, label: a.label, outputs }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  if (!isStaticAllowed(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, BIND, () => {
  console.log('');
  console.log('==========================================');
  console.log('  NetPlus AI - Network Diagnosis & Wi-Fi Survey');
  console.log(`  Server running: http://localhost:${PORT}`);
  console.log('==========================================');
  console.log('');
  if (IS_WIN) exec('start "" http://' + BIND + ':' + PORT, { windowsHide: true, shell: 'cmd' }, () => {});
});

process.on('uncaughtException', (e) => {
  console.error('Uncaught:', e && e.message);
});
