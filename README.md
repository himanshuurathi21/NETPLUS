# NetPlus AI
### Network Fault Diagnosis, Root Cause Analyzer & Wi-Fi Site Survey
#### Data Communication Project (3 Credits / 30 Marks)

---

## What is this?

This application scans your **real network** - WiFi signal strength, ping latency,
packet loss, DNS, traceroute path - then analyzes the data to identify the fault
and its **ROOT CAUSE** (with OSI layer, severity, confidence % and a fix).

It supports 3 modes: **WiFi Hotspot**, **LAN Cable**, and **Mobile Internet (4G/5G)**.
It also includes a Simulation Lab with 15 pre-built scenarios for demos and viva preparation.

**Wi-Fi Site Survey (Tab 3):** capture GPS-located survey points with live WiFi details,
real internet speed tests (download/upload/ping/jitter), save/edit/delete survey history,
visualize the coverage on a map and heatmap (with optional floor-plan image), signal timeline,
and export everything to CSV / Excel / JSON / PDF / **KML** under `Surveys/<project>/`.

---

## How to Run (2 steps)

```
Step 1:  double-click start.bat   (or in cmd: node server.js)
Step 2:  Your browser opens automatically (or go to http://127.0.0.1:3000)
```

Requirement: Node.js (v16+) only - **no npm install, no external packages**. To run the test scripts (`test_engine.js`, `test_survey.js`) use Node.js v18+ (they use the global `fetch`); the app itself works on v16+.

### What you will see

- **Tab 1 - Live Scan:** Click "Run Full Diagnostics" → real commands execute →
  topology diagram, signal gauge, traceroute graph, fault panel (root cause),
  complete detailed evidence. Plus: **Scan History** (auto-saved, compare two scans,
  fault-stats pie chart), **Fix Actions** (DHCP renew / DNS flush), **Diagnosis PDF**,
  copy evidence, topology PNG, gateway vendor (OUI lookup).
- **Tab 2 - Simulation Lab:** Select a connection type (WiFi/LAN/Mobile) → pick one of
  15 scenarios → run. Each scenario shows a different diagnosis result.
- **Tab 3 - Survey & Mapping:** "Scan & Measure" → live WiFi details + internet speed
  test + GPS position → "Save Survey Point" → history table (search/filter/sort),
  colored map, signal heatmap (optionally over a floor-plan image), signal timeline,
  compare selected points, HTML survey report, and export to CSV/XLSX/JSON/PDF/KML.
- **Tab 4 - Report:** The complete diagnosis report is shown inside the app
  (summary + findings + all evidence + neighbors + traceroute) - with a Print button,
  "Save to File" and **Save Diagnosis PDF**.
- **Tab 5 - Theory:** OSI mapping, RSSI concept, engine rules, viva questions.

Extra: **English / Hindi** language toggle and **Light / Dark** theme toggle in the top bar.

---

## Real Diagnostics (Live Scan)

| Command | Real Data |
|---|---|
| `netsh wlan show interfaces` | Signal %, SSID, channel, auth, radio type, rates |
| `netsh wlan show networks mode=bssid` | Signal scan of neighboring networks |
| `netsh interface show interface` | Link up/down status |
| `ipconfig /all` | IP, gateway, subnet, DHCP, MAC, APIPA detection |
| `ping` gateway / 8.8.8.8 / 1.1.1.1 | Real RTT, loss %, jitter (computed) |
| `nslookup google.com` + 8.8.8.8 + 1.1.1.1 | Real DNS server, lookup time + per-server DNS latency |
| `tracert -d -h 15 8.8.8.8` | Real hop-by-hop path + per-hop latency/loss |
| `arp -a` | ARP table, gateway MAC (+ **vendor via OUI lookup**) |
| `route print 0.0.0.0` | Default gateway (fallback) |
| `ping -f -l 1472` gateway | **MTU discovery** |
| `ping -6 ::1` / IPv6 ping | **IPv6 stack test** |
| `ipconfig /flushdns`, `/release`, `/renew` | **Fix Actions** from the UI |

---

## Architecture

```
Browser UI (index.html + js/)
    │  HTTP/JSON
    ▼
server.js (Node.js - core modules only)
    │  execFile (Windows commands)
    ▼
Real Network Diagnostics
```

| File | Role |
|---|---|
| `server.js` | Command runner + parsing + static file server + survey CRUD/export + speedtest + scan history + fix actions + report/PDF/KML API |
| `js/analyzer.js` | **Root Cause Engine** - signature extraction + rules + confidence % |
| `js/scenarios.js` | 15 simulation scenarios (LAN 5 / WiFi 5 / Mobile 5) |
| `js/survey.js` | Wi-Fi Survey client - GPS, speed test, history, map, heatmap, floor plan, timeline, export, HTML report |
| `js/app.js` | UI logic + Canvas topology/gauge/traceroute + history UI + i18n (EN/HI) + themes + report builder |
| `css/style.css` | Dark theme UI + light theme |
| `config.json` | Settings: port, bind host, ping count, DNS servers, history limit |
| `start.bat` | One-click launcher |
| `Surveys/` | Auto-generated survey exports (CSV / XLSX / JSON / PDF / KML), one folder per project |
| `reports/` | Auto-generated diagnosis reports (HTML + PDF) |
| `data/` | Runtime data: `surveys.json`, `history.json` |
| `test_engine.js` | Engine test script (all scenarios + live scan test) |
| `test_survey.js` | Survey API test (CRUD, speedtest, all export formats, actions) |
| `structur.txt` | Project roadmap & documentation |

---

## Diagnosis Engine (How root cause is found)

1. **Data collection** - diagnostic JSON from real commands
2. **Signature extraction** - loss %, jitter, signal %, APIPA, DNS status, hop loss
3. **Rule matching** - each signature has rules, weighted for a confidence score
4. **OSI layer mapping** - each root cause is mapped to a layer (L1 Physical to L7 Application)
5. **Ranking + severity** - Critical/High/Medium/Low/Healthy + health score %

### Key rules (analyzer.js)

- APIPA 169.254 IP + no gateway → **DHCP server unreachable** (L3)
- 100% gateway loss → **Physical link down** (L1)
- Internet fails + gateway OK → **ISP / WAN issue** (L3)
- Ping OK + DNS fails → **DNS misconfiguration** (L7)
- Signal < 25% → **Critical weak signal / range** (L2)
- Signal OK + jitter > 60 ms (WiFi) → **Interference / channel congestion** (L2)
- Traceroute: 100% loss at hop N → **Fault on that router/link** (L3)
- 20-40% loss + high RTT → **Congestion** (L3)
- 40-90% gateway loss → **Duplex mismatch / bad cable** (L2)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Server does not start | Check: `node --version` (v16+ required) |
| Signal % is missing | Run `netsh wlan show interfaces` manually to verify |
| Scan is slow (~25s) | Normal - pings + DNS tests + traceroute run sequentially |
| Ethernet disconnected | Connect the LAN cable or use WiFi (both are reported) |
| Mobile RSRP | Not available directly from a PC - Mobile mode is simulation-based (attach a phone hotspot over WiFi for a real signal) |
| Port busy | Change `port` in config.json |
| Server should be LAN-accessible | Change `bindHost` in config.json to `0.0.0.0` (default is localhost-only for safety) |
| Data not showing | Try a different browser, or hard refresh (Ctrl+Shift+R) |
| Tests fail with any symptom? | Test scripts need Node 18+ (fetch). Otherwise check `data/surveys.json` is readable |

---

## Viva Preparation

- Read the Theory tab and `docs/theory.txt`
- Signal 84% = adapter RSSI (dBm) mapped by Windows to a 0-100 scale - not compared to any device
- Demo sequence: Live Scan first, then Simulation Lab, then save the report
- To run the project: only `node server.js`