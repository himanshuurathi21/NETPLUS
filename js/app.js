(function () {
  'use strict';

  let lastResult = null;
  let simMode = 'wifi';
  let simSelected = null;

  const $ = (id) => document.getElementById(id);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ---------------- Tabs ---------------- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ---------------- Home dashboard quick-actions + stats ---------------- */
  document.querySelectorAll('.js-goto[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
      $('tab-' + t).classList.add('active');
    });
  });

  function renderHomeStats() {
    const total = $('homeTotalScans'), last = $('homeLastScan'), health = $('homeInternet');
    if (!total || !last || !health) return;
    fetch('/api/history').then(r => r.json()).then(j => {
      const list = (j.list || []).filter(h => h && h.data);
      total.textContent = list.length;
      const top = list[0];
      if (top) {
        last.textContent = top.timestamp ? new Date(top.timestamp).toLocaleString() : '—';
        health.textContent = top.data.connectivity && top.data.connectivity.internetReachable ? 'Internet reachable' : 'Internet not reachable';
        health.className = top.data.connectivity && top.data.connectivity.internetReachable ? 'stat-val ok' : 'stat-val warn';
      } else {
        last.textContent = 'No scans yet';
        health.textContent = '—';
      }
    }).catch(() => {
      last.textContent = 'Server offline - run node server.js';
      health.textContent = '—';
    });
  }

  /* ---------------- Theme toggle ---------------- */
  const I18N = {
    'tab-live': 'Live Scan', 'tab-sim': 'Simulation Lab', 'tab-survey': 'Survey & Mapping', 'tab-history': 'History',
    'btn-scan': 'Run Full Diagnostics', 'btn-cancel': 'Cancel Scan', 'btn-copy-evidence': 'Copy Evidence', 'btn-evidence-txt': 'Evidence .txt', 'btn-topo-png': 'Topology PNG',
    'fix-actions': 'Fix Actions', 'btn-dhcp': 'Renew DHCP (release/renew)', 'btn-flush': 'Flush DNS Cache', 'fix-note': 'Runs real Windows commands on this PC - results open in a popup.',
    'scan-history': 'All Saved Scans', 'fault-stats': 'Fault Statistics (all saved scans)',
    'btn-hist-compare': 'Compare Selected', 'btn-hist-clear': 'Clear History', 'btn-hist-refresh': 'Refresh', 'act-load': 'Load',
    'h-time': 'Time', 'h-mode': 'Mode', 'h-ssid': 'SSID / Signal', 'h-gateway': 'Gateway', 'h-internet': 'Internet', 'h-rtt': 'Avg RTT', 'h-actions': 'Actions',
    'hist-empty': 'No saved scans yet - run a full scan and it will appear here.', 'hist-count': 'saved scans',
    'reachable': 'Reachable', 'not-reachable': 'NOT reachable',
    'btn-survey-scan': 'Scan & Measure', 'btn-survey-save': 'Save Survey Point',
    's-wifi': 'Wi-Fi Details', 's-speed': 'Internet Performance', 's-gps': 'GPS Location', 's-quality': 'Signal Quality', 's-history': 'Survey History', 's-map': 'Survey Map', 's-heat': 'Signal Heatmap', 's-export': 'Export Survey Data', 's-floor': 'Floor Plan Background', 's-timeline': 'Signal Timeline (all points over time)', 'btn-floor-clear': 'Remove Floor Plan',
    'tab-home': 'Home',
    'home-title': 'Welcome to NetPlus AI',
    'home-tagline': 'One-click network fault diagnosis, root-cause analysis and Wi-Fi site survey - built for Data Communication projects.',
    'home-cta-scan': 'Run Full Diagnostics',
    'home-cta-sim': 'Try a Simulation',
    'home-stats-title': 'At a glance',
    'home-stat-scans': 'Saved scans',
    'home-stat-last': 'Last scan',
    'home-stat-net': 'Internet',
    'home-steps-title': 'How it works',
    'home-step1-t': '1. Scan',
    'home-step1-d': 'Run real diagnostics - ping, DNS, traceroute and more via the Windows command line.',
    'home-step2-t': '2. Diagnose',
    'home-step2-d': 'The AI engine maps every fault to its OSI layer root cause with confidence scores.',
    'home-step3-t': '3. Fix',
    'home-step3-d': 'Apply one-click fixes, compare scans, and export survey data.',
    'home-explore-title': 'Explore the tools',
    'home-feat-live-d': 'Real network scan with topology, signal, root-cause and history.',
    'home-feat-sim-d': '15 guided scenarios across WiFi, LAN and mobile faults.',
    'home-feat-survey-d': 'Measure, map and export site survey data with heatmaps.',
    'home-feat-history-d': 'Browse all previous scans, compare results and view fault statistics.'
  };
  const t = (k) => (I18N[k] != null ? I18N[k] : k);
  function applyTheme() {
    const th = localStorage.getItem('npa-theme') || 'light';
    document.body.classList.toggle('light', th === 'light');
    document.body.classList.toggle('dark', th === 'dark');
    $('btnTheme').textContent = th === 'light' ? '☀️' : '🌙';
  }
  $('btnTheme').addEventListener('click', () => { const th = (localStorage.getItem('npa-theme') || 'light') === 'light' ? 'dark' : 'light'; localStorage.setItem('npa-theme', th); applyTheme(); });
  applyTheme(); renderHomeStats();

  /* ---------------- Modal helpers ---------------- */
  function openModal(title, bodyHtml, actions) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    const wrap = $('modalActions');
    wrap.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : 'btn-ghost';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      wrap.appendChild(b);
    });
    $('modalOverlay').style.display = 'flex';
  }
  function closeAppModal() { $('modalOverlay').style.display = 'none'; }
  $('modalClose').addEventListener('click', closeAppModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeAppModal(); });

  /* ---------------- Copy evidence + topology PNG ---------------- */
  $('btnCopyEvidence').addEventListener('click', () => {
    if (!lastResult) { $('scanStatus').textContent = 'Run a scan first'; return; }
    navigator.clipboard.writeText(buildEvidence(lastResult.data)).then(() => {
      $('scanStatus').textContent = 'Evidence copied to clipboard';
    }).catch(() => { $('scanStatus').textContent = 'Copy failed - select the evidence text manually'; });
  });
  $('btnEvidenceTxt').addEventListener('click', () => {
    if (!lastResult) { $('scanStatus').textContent = 'Run a scan first'; return; }
    const blob = new Blob([buildEvidence(lastResult.data)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'evidence_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    $('scanStatus').textContent = 'Evidence downloaded as .txt';
  });
  $('btnTopoPng').addEventListener('click', () => {
    const c = $('topologyCanvas');
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'topology_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
    a.click();
    $('scanStatus').textContent = 'Topology image downloaded';
  });

  /* ---------------- Fix actions ---------------- */
  function runFixAction(action) {
    fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    }).then(r => r.json()).then(j => {
      if (!j.ok) { openModal('Action Error', esc(j.error || 'Failed'), [{ label: 'Close', primary: true, onClick: closeAppModal }]); return; }
      const rows = j.outputs.map(o =>
        '<div style="margin:8px 0"><b>' + esc(o.cmd) + '</b><pre style="background:#f6f8fa;padding:8px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto">' + esc(o.out || '(no output)') + '</pre></div>'
      ).join('');
      openModal(j.label, rows, [{ label: 'Close', primary: true, onClick: closeAppModal }]);
    }).catch(e => openModal('Action Error', esc(e.message), [{ label: 'Close', primary: true, onClick: closeAppModal }]));
  }
  $('btnDhcpRenew').addEventListener('click', () => {
    openModal('Confirm Action', 'Renew DHCP runs <b>ipconfig /release</b> and <b>ipconfig /renew</b>. Your network will disconnect briefly and reconnect. Continue?', [
      { label: 'Cancel', onClick: closeAppModal },
      { label: 'Run DHCP Renew', primary: true, onClick: () => { closeAppModal(); runFixAction('dhcp-renew'); } }
    ]);
  });
  $('btnFlushDns').addEventListener('click', () => {
    openModal('Confirm Action', 'Run <b>ipconfig /flushdns</b> to clear the DNS resolver cache?', [
      { label: 'Cancel', onClick: closeAppModal },
      { label: 'Flush DNS', primary: true, onClick: () => { closeAppModal(); runFixAction('flush-dns'); } }
    ]);
  });

  /* ---------------- History tab ---------------- */
  const PIE_COLORS = ['#f87171', '#fbbf24', '#fb923c', '#34d399', '#22d3ee', '#b39dfa', '#f472b6', '#67e8f9', '#94a3b8'];
  let histList = [];
  let histSelected = new Set();
  let histSortKey = 'timestamp';
  let histSortDir = -1;
  let histSearchText = '';

  function loadHistory() {
    return fetch('/api/history').then(r => r.json()).then(j => {
      if (!j.ok) return;
      histList = j.list || [];
      histSelected = new Set();
      renderHistoryTableLive();
      renderStatsPieLive();
      renderRecentOnLive();
    }).catch(() => {});
  }

  function filteredHistList() {
    let list = histList.slice();
    if (histSearchText) {
      const q = histSearchText.toLowerCase();
      list = list.filter(h => [h.ssid, h.gateway, h.mode, h.id].join(' ').toLowerCase().indexOf(q) !== -1);
    }
    list.sort((a, b) => {
      let va, vb;
      if (histSortKey === 'timestamp') { va = new Date(a.timestamp || 0).getTime(); vb = new Date(b.timestamp || 0).getTime(); }
      else if (histSortKey === 'inetAvg') { va = a.inetAvg != null ? a.inetAvg : Infinity; vb = b.inetAvg != null ? b.inetAvg : Infinity; }
      else if (histSortKey === 'signalPct') { va = a.signalPct != null ? a.signalPct : -1; vb = b.signalPct != null ? b.signalPct : -1; }
      else { va = String(a[histSortKey] || '').toLowerCase(); vb = String(b[histSortKey] || '').toLowerCase(); }
      if (va < vb) return -histSortDir;
      if (va > vb) return histSortDir;
      return 0;
    });
    return list;
  }

  function renderHistoryTableLive() {
    const tb = $('historyBodyLive');
    if (!tb) return;
    const list = filteredHistList();
    tb.innerHTML = list.length ? list.map(h =>
      '<tr data-id="' + esc(h.id) + '">' +
      '<td><input type="checkbox" class="hist-cb" data-id="' + esc(h.id) + '"' + (histSelected.has(h.id) ? ' checked' : '') + '></td>' +
      '<td class="row-sub">' + (h.timestamp ? new Date(h.timestamp).toLocaleString() : '--') + '</td>' +
      '<td>' + esc(h.mode || 'wifi') + '</td>' +
      '<td>' + esc(h.ssid || '--') + ' / ' + (h.signalPct != null ? h.signalPct + '%' : '--') + '</td>' +
      '<td>' + esc(h.gateway || '--') + '</td>' +
       (h._src === 'survey'
          ? '<td>' + (typeof h._survey.download === 'number' ? h._survey.download.toFixed(1) + ' Mbps' : '—') + '</td>'
          : '<td>' + (h.internetReachable ? '<span style="color:var(--success)">' + t('reachable') + '</span>' : '<span style="color:var(--danger)">' + t('not-reachable') + '</span>') + '</td>') +
      '<td>' + (h.inetAvg != null ? h.inetAvg + ' ms' : '--') + '</td>' +
      '<td class="row-sub">' + esc(h.topFault || '--') + '</td>' +
      '<td class="row-actions">' +
      '<button class="act-btn" data-act="load">' + t('act-load') + '</button> ' +
      '<button class="act-btn danger-btn" data-act="del">Del</button>' +
      '</td></tr>'
    ).join('') : '<tr><td colspan="9" style="text-align:center;color:#7d93ad;padding:16px">' + t('hist-empty') + '</td></tr>';
    const countEl = $('histCountLive');
    if (countEl) countEl.textContent = list.length + ' of ' + histList.length + ' ' + t('hist-count');
    const histCountChip = $('histCount');
    if (histCountChip) histCountChip.textContent = histList.length + ' saved scans';
  }

  function renderRecentOnLive() {
    const box = $('liveRecentBox');
    if (!box) return;
    if (!histList.length) { box.className = 'placeholder'; box.textContent = 'No scans yet. Run a scan to see it appear here.'; return; }
    const recent = histList.slice(0, 5);
    box.className = '';
    box.innerHTML = '<table class="mini-table"><thead><tr><th>Time</th><th>Mode</th><th>SSID / Signal</th><th>Internet</th><th>Top Fault</th></tr></thead><tbody>' +
      recent.map(h =>
        '<tr><td class="row-sub">' + (h.timestamp ? new Date(h.timestamp).toLocaleString() : '--') + '</td>' +
        '<td>' + esc(h.mode || 'wifi') + '</td>' +
        '<td>' + esc(h.ssid || '--') + ' / ' + (h.signalPct != null ? h.signalPct + '%' : '--') + '</td>' +
        '<td>' + (h.internetReachable ? '<span style="color:var(--success)">OK</span>' : '<span style="color:var(--danger)">Down</span>') + '</td>' +
        '<td class="row-sub">' + esc(h.topFault || '--') + '</td></tr>'
      ).join('') +
      '</tbody></table><div class="row-sub" style="margin-top:8px"><a href="#" onclick="document.querySelector(\'[data-tab=history]\').click();return false" style="color:var(--accent)">View all ' + histList.length + ' scans in History tab &rarr;</a></div>';
  }

  function renderStatsPieLive() {
    const canvas = $('statsCanvasLive');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!histList.length) {
      ctx.fillStyle = '#7d93ad'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('No data yet - run scans first', W / 2, H / 2);
      const leg = $('statsLegendLive'); if (leg) leg.textContent = '';
      return;
    }
    const counts = {};
    const liveItems = histList.filter(h => h._src !== 'survey');
    Promise.all(liveItems.map(h =>
      fetch('/api/history/' + encodeURIComponent(h.id)).then(r => r.json()).then(j => {
        if (!j.ok) return;
        const a = NetFaultAnalyzer.analyze(j.data);
        const top = a.findings[0];
        const key = (top && top.severity !== 'Healthy') ? top.title : 'Healthy';
        counts[key] = (counts[key] || 0) + 1;
      })
    )).then(() => drawPieLive(counts));
  }

  function drawPieLive(counts) {
    const canvas = $('statsCanvasLive');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);
    if (!total) { ctx.fillStyle = '#7d93ad'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('No faults recorded yet', W / 2, H / 2); const leg = $('statsLegendLive'); if (leg) leg.textContent = ''; return; }
    const cx = 130, cy = H / 2, r = 105;
    let ang = -Math.PI / 2;
    const legend = [];
    entries.forEach((e, i) => {
      const frac = e[1] / total;
      const col = PIE_COLORS[i % PIE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, ang, ang + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = '#0a0f1e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ang += frac * Math.PI * 2;
      legend.push('<span style="color:' + col + '">&#9632;</span> ' + esc(e[0]) + ' - <b>' + e[1] + '</b> (' + Math.round(frac * 100) + '%)');
    });
    const leg = $('statsLegendLive'); if (leg) leg.innerHTML = legend.join('<br>');
  }

  function loadHistoryScan(id) {
    fetch('/api/history/' + encodeURIComponent(id)).then(r => r.json()).then(j => {
      if (!j.ok) { $('scanStatus').textContent = 'History load failed'; return; }
      const data = j.data;
      const analysis = NetFaultAnalyzer.analyze(data);
      lastResult = { data, analysis, source: 'history', ts: new Date(), historyId: id };
      renderLive(data, analysis);
      $('scanStatus').textContent = 'Loaded scan from history: ' + new Date(data.timestamp || Date.now()).toLocaleString();
      const w = data.wifi && data.wifi.data;
      drawGauge($('signalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : 'No WiFi');
      renderSignalMeta($('signalMeta'), data);
      drawTrace($('traceCanvas'), data, 'Traceroute to 8.8.8.8 - from history');
      document.querySelector('[data-tab="live"]').click();
      showHistDetail(data, analysis);
    }).catch(e => { $('scanStatus').textContent = 'History load error: ' + e.message; });
  }

  function showHistDetail(data, analysis) {
    const box = $('histDetailBox');
    if (!box) return;
    const conn = data.connectivity || {};
    const w = data.wifi && data.wifi.data;
    const active = conn.activeIface || null;
    box.className = '';
    box.innerHTML = '<table class="kv-table"><tbody>' +
      '<tr><td>Scan Time</td><td>' + (data.timestamp ? new Date(data.timestamp).toLocaleString() : '--') + '</td></tr>' +
      '<tr><td>Mode</td><td>' + esc(data.mode || 'wifi') + '</td></tr>' +
      '<tr><td>Interface</td><td>' + (active ? esc(active.name) + ' (' + esc(active.ipv4) + ')' : 'none') + '</td></tr>' +
      '<tr><td>Gateway</td><td>' + esc(conn.gateway || 'none') + '</td></tr>' +
      '<tr><td>WiFi SSID</td><td>' + (w ? esc(w.ssid) + ' (' + w.signalPct + '%)' : 'n/a') + '</td></tr>' +
      '<tr><td>Internet</td><td>' + (conn.internetReachable ? '<span style="color:var(--success)">Reachable</span>' : '<span style="color:var(--danger)">NOT reachable</span>') + '</td></tr>' +
      '<tr><td>DNS</td><td>' + (data.dns && data.dns.server ? esc(data.dns.server) + ' (' + data.dns.lookupMs + 'ms)' : 'FAILED') + '</td></tr>' +
      '<tr><td>Health Score</td><td>' + analysis.healthScore + '%</td></tr>' +
      '<tr><td>Status</td><td>' + analysis.status + '</td></tr>' +
      '<tr><td>Top Fault</td><td>' + esc((analysis.findings[0] || {}).title || 'None') + '</td></tr>' +
      '<tr><td>Scan Duration</td><td>' + (data.scanDurationMs ? (data.scanDurationMs / 1000).toFixed(1) + 's' : '--') + '</td></tr>' +
      '</tbody></table>';
  }

  function deleteHistoryScan(id) {
    fetch('/api/history/' + encodeURIComponent(id), { method: 'DELETE' }).then(r => r.json()).then(j => {
      if (j.ok) { loadHistory(); $('scanStatus').textContent = 'Scan deleted from history'; }
    });
  }

  function showSurveyHistDetail(s) {
    const box = $('histDetailBox');
    if (!box) return;
    const v = typeof s.signalPct === 'number' ? s.signalPct : -1;
    const q = v >= 75 ? 'Excellent' : v >= 50 ? 'Good' : v >= 25 ? 'Fair' : (v < 0 ? 'N/A' : 'Poor');
    box.className = '';
    box.innerHTML = '<table class="kv-table"><tbody>' +
      '<tr><td>Scan Time</td><td>' + (s.timestamp ? new Date(s.timestamp).toLocaleString() : '--') + '</td></tr>' +
      '<tr><td>Source</td><td>Survey &amp; Mapping</td></tr>' +
      '<tr><td>Location</td><td>' + esc(s.locationName || 'Unnamed') + '</td></tr>' +
      '<tr><td>SSID</td><td>' + esc(s.ssid || 'n/a') + '</td></tr>' +
      '<tr><td>Network Type</td><td>' + esc(s.networkType || 'Unknown') + '</td></tr>' +
      '<tr><td>Signal</td><td>' + (typeof s.signalPct === 'number' ? s.signalPct + '%' : 'n/a') + ' (' + q + ')</td></tr>' +
      '<tr><td>Download / Upload</td><td>' + (typeof s.download === 'number' ? s.download.toFixed(1) : '--') + ' / ' + (typeof s.upload === 'number' ? s.upload.toFixed(1) : '--') + ' Mbps</td></tr>' +
      '<tr><td>Ping / Jitter</td><td>' + (typeof s.ping === 'number' ? s.ping + ' ms' : '--') + ' / ' + (typeof s.jitter === 'number' ? s.jitter + ' ms' : '--') + '</td></tr>' +
      '<tr><td>GPS</td><td>' + (typeof s.lat === 'number' && typeof s.lng === 'number' ? s.lat + ', ' + s.lng : 'n/a') + '</td></tr>' +
      '<tr><td>Gateway / IP</td><td>' + esc(s.gateway || '--') + ' / ' + esc(s.ip || '--') + '</td></tr>' +
      '</tbody></table>';
  }

  function deleteSurveyFromHistory(id) {
    fetch('/api/surveys/' + encodeURIComponent(id), { method: 'DELETE' }).then(r => r.json()).then(j => {
      if (j.ok) { loadHistory(); $('scanStatus').textContent = 'Survey point deleted from history'; }
    });
  }

  function enrichHistWithFaults() {
    return Promise.all(histList.map(h => {
      if (h._src === 'survey') { h.topFault = '—'; return Promise.resolve(); }
      return fetch('/api/history/' + encodeURIComponent(h.id)).then(r => r.json()).then(j => {
        if (!j.ok) { h.topFault = '--'; return; }
        const a = NetFaultAnalyzer.analyze(j.data);
        const top = a.findings[0];
        h.topFault = (top && top.severity !== 'Healthy') ? top.title : 'Healthy';
      }).catch(() => { h.topFault = '--'; });
    }));
  }

  const origLoadHistory = loadHistory;
  loadHistory = function() {
    return Promise.all([
      fetch('/api/history').then(r => r.json()).catch(() => ({ ok: false })),
      fetch('/api/surveys').then(r => r.json()).catch(() => ({ ok: false }))
    ]).then(([hj, sj]) => {
      // Live Scan results (carry full diagnostics + fault analysis)
      const live = (hj.ok && hj.list) ? hj.list.map(h => Object.assign({}, h, { _src: 'live' })) : [];
      // Survey & Mapping results (carry location info, no fault analysis)
      const surv = (sj.ok && sj.surveys)
        ? sj.surveys.filter(s => s && s.id).map(s => ({
            _src: 'survey', id: s.id, timestamp: s.timestamp,
            mode: s.networkType || 'survey', ssid: s.ssid, signalPct: s.signalPct,
            gateway: s.gateway || null,
            internetReachable: typeof s.download === 'number',
            inetAvg: typeof s.ping === 'number' ? s.ping : null,
            inetLoss: typeof s.packetLoss === 'number' ? s.packetLoss : null,
            scanDurationMs: null, topFault: '—', _survey: s
          }))
        : [];
      // History shows ALL scans: Live Scan + Survey & Mapping
      histList = live.concat(surv);
      histSelected = new Set();
      return enrichHistWithFaults();
    }).then(() => {
      renderHistoryTableLive();
      renderStatsPieLive();
      renderRecentOnLive();
    }).catch(() => {});
  };

  if ($('historyTableLive')) {
    $('historyTableLive').addEventListener('click', (ev) => {
      const cb = ev.target.closest('.hist-cb');
      if (cb) {
        const id = cb.dataset.id;
        if (cb.checked) {
          if (histSelected.size >= 2) { cb.checked = false; $('scanStatus').textContent = 'Select max 2 scans for comparison'; return; }
          histSelected.add(id);
        } else { histSelected.delete(id); }
        renderHistoryTableLive();
        return;
      }
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const tr = ev.target.closest('tr');
      if (tr && tr.dataset.id) {
        const item = histList.find(x => x.id === tr.dataset.id);
        if (btn.dataset.act === 'load') {
          if (item && item._src === 'survey') showSurveyHistDetail(item._survey);
          else loadHistoryScan(tr.dataset.id);
        } else if (btn.dataset.act === 'del') {
          if (item && item._src === 'survey') deleteSurveyFromHistory(item.id);
          else deleteHistoryScan(tr.dataset.id);
        }
      }
    });
  }

  if ($('btnHistCompare')) {
    $('btnHistCompare').addEventListener('click', () => {
      const ids = Array.from(histSelected).filter(id => {
        const it = histList.find(x => x.id === id);
        return it && it._src !== 'survey';
      });
      if (ids.length !== 2) { $('scanStatus').textContent = 'Select exactly 2 Live Scan results to compare'; return; }
      Promise.all(ids.map(id => fetch('/api/history/' + encodeURIComponent(id)).then(r => r.json())))
        .then(res => {
          if (!res[0].ok || !res[1].ok) { $('scanStatus').textContent = 'Compare failed'; return; }
          const a = res[0].data, b = res[1].data;
          const pa = a.connectivity && a.connectivity.pings, pb = b.connectivity && b.connectivity.pings;
          const wa = a.wifi && a.wifi.data, wb = b.wifi && b.wifi.data;
          const rows = [
            ['Timestamp', a.timestamp ? new Date(a.timestamp).toLocaleString() : '-', b.timestamp ? new Date(b.timestamp).toLocaleString() : '-', 0],
            ['Signal %', wa ? wa.signalPct : '--', wb ? wb.signalPct : '--', 1],
            ['Gateway RTT (ms)', pa && pa.gateway ? pa.gateway.avg : '--', pb && pb.gateway ? pb.gateway.avg : '--', 2],
            ['Internet RTT (ms)', pa && pa.internet ? pa.internet.avg : '--', pb && pb.internet ? pb.internet.avg : '--', 2],
            ['Internet loss %', pa && pa.internet ? pa.internet.lossPct : '--', pb && pb.internet ? pb.internet.lossPct : '--', 2],
            ['DNS time (ms)', a.dns && a.dns.lookupMs, b.dns && b.dns.lookupMs, 2],
            ['Scan duration (s)', a.scanDurationMs ? (a.scanDurationMs / 1000).toFixed(1) : '-', b.scanDurationMs ? (b.scanDurationMs / 1000).toFixed(1) : '-', 2],
            ['Top fault', (NetFaultAnalyzer.analyze(a).findings[0] || {}).title, (NetFaultAnalyzer.analyze(b).findings[0] || {}).title, 0]
          ];
          $('histCompareBoxLive').innerHTML = '<div class="row-sub" style="margin:10px 0 6px">Comparison - scan 1 vs scan 2 (green = improved, red = worse)</div>' +
            '<table class="mini-table"><thead><tr><th>Metric</th><th>Scan 1</th><th>Scan 2</th><th>Delta</th></tr></thead><tbody>' +
            rows.map(r => {
              const va = r[1], vb = r[2];
              let delta = '--', cls = 'delta-same';
              if (typeof va === 'number' && typeof vb === 'number') {
                const d = Math.round((vb - va) * 10) / 10;
                if (r[3] === 1) { delta = d + ' pts'; cls = d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : 'delta-same'; }
                else if (r[3] === 2) { delta = d; cls = d < 0 ? 'delta-up' : d > 0 ? 'delta-down' : 'delta-same'; }
              }
              return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td><td>' + esc(String(r[2])) + '</td><td class="' + cls + '">' + delta + '</td></tr>';
            }).join('') + '</tbody></table>';
          $('histCompareBoxLive').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });
  }

  if ($('btnHistClear')) {
    $('btnHistClear').addEventListener('click', () => {
      fetch('/api/history', { method: 'DELETE' }).then(r => r.json()).then(j => {
        if (j.ok) { histList = []; histSelected = new Set(); renderHistoryTableLive(); renderStatsPieLive(); renderRecentOnLive(); $('scanStatus').textContent = 'Scan history cleared'; }
      });
    });
  }

  if ($('btnHistRefresh')) {
    $('btnHistRefresh').addEventListener('click', () => { loadHistory(); });
  }

  if ($('histSearchLive')) {
    $('histSearchLive').addEventListener('input', (e) => { histSearchText = e.target.value; renderHistoryTableLive(); });
  }

  document.querySelectorAll('#historyTableLive th.sortable-hist').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (!k) return;
      if (histSortKey === k) histSortDir *= -1;
      else { histSortKey = k; histSortDir = -1; }
      renderHistoryTableLive();
    });
  });

  /* ---------------- Server check ---------------- */
  (async function init() {
    const chip = $('connChip');
    try {
      const r = await fetch('/api/health');
      if (r.ok) { chip.textContent = 'Server Online'; chip.classList.add('ok'); }
      else throw new Error('bad');
    } catch (e) {
      chip.textContent = 'Server Offline - run node server.js';
      chip.classList.add('err');
    }
  })();

  /* ---------------- Live Scan ---------------- */
  const SCAN_STEPS = [
    'Reading WiFi adapter (netsh wlan)...',
    'Scanning neighbor networks...',
    'Reading interfaces + IP config...',
    'Pinging gateway...',
    'Pinging 8.8.8.8 / 1.1.1.1...',
    'DNS lookup (nslookup)...',
    'Traceroute to 8.8.8.8...',
    'Analyzing root cause...'
  ];

  let scanAbort = null;
  async function runLiveScan() {
    const btn = $('btnScan');
    const cancelBtn = $('btnScanCancel');
    const prog = $('scanProgress');
    const status = $('scanStatus');
    if (scanAbort) { status.textContent = 'A scan is already running'; return; }
    scanAbort = new AbortController();
    btn.disabled = true;
    cancelBtn.style.display = 'inline-block';
    prog.className = 'scan-progress';
    prog.innerHTML = '<div class="fill"></div>';
    const fill = prog.querySelector('.fill');
    const timer = setInterval(() => {
      const p = Math.min(88, (fill.style.width ? parseFloat(fill.style.width) : 0) + 2 + Math.random() * 4);
      fill.style.width = p + '%';
      status.textContent = SCAN_STEPS[Math.min(SCAN_STEPS.length - 1, Math.floor(p / 88 * SCAN_STEPS.length))];
    }, 320);
    try {
      const res = await fetch('/api/scan', { signal: scanAbort.signal });
      const json = await res.json();
      clearInterval(timer);
      if (!json.ok) throw new Error(json.error || 'scan failed');
      fill.style.width = '100%';
      prog.classList.add('done');
      status.textContent = 'Scan complete in ' + (json.data.scanDurationMs / 1000).toFixed(1) + 's';
      const analysis = NetFaultAnalyzer.analyze(json.data);
      lastResult = { data: json.data, analysis, source: 'live', ts: new Date() };
      renderLive(json.data, analysis);
      loadHistory();
      $('connChip').textContent = 'Server Online'; $('connChip').className = 'status-chip ok';
    } catch (e) {
      clearInterval(timer);
      if (scanAbort.signal.aborted) {
        prog.classList.add('fail');
        fill.style.width = '100%';
        status.textContent = 'Scan cancelled - nothing saved to history';
      } else {
        prog.classList.add('fail');
        fill.style.width = '100%';
        status.textContent = 'Error: ' + e.message;
        $('connChip').textContent = 'Server Offline - run node server.js';
        $('connChip').className = 'status-chip err';
      }
    } finally {
      btn.disabled = false;
      cancelBtn.style.display = 'none';
      scanAbort = null;
    }
  }
  $('btnScan').addEventListener('click', runLiveScan);
  $('btnScanCancel').addEventListener('click', () => { if (scanAbort) scanAbort.abort(); });

  /* ---------------- Simulation ---------------- */
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simMode = btn.dataset.mode;
      simSelected = null;
      renderScenarioList();
    });
  });

  function renderScenarioList() {
    const list = $('scenarioList');
    list.innerHTML = '';
    NetFaultScenarios.getScenarios(simMode).forEach(s => {
      const card = document.createElement('div');
      card.className = 'scenario-card' + (simSelected === s.id ? ' active' : '');
      card.innerHTML = '<div class="sc-name">' + s.name + '</div>' +
        '<div class="sc-desc">' + s.desc + '</div>' +
        '<span class="sc-tag">' + s.tag + '</span>';
      card.addEventListener('click', () => {
        simSelected = s.id;
        renderScenarioList();
      });
      list.appendChild(card);
    });
  }
  renderScenarioList();

  function runSimulation() {
    if (!simSelected) {
      $('simFaultPanel').innerHTML = '<div class="placeholder">Please select a scenario first.</div>';
      return;
    }
    const sc = NetFaultScenarios.getScenario(simMode, simSelected);
    const data = sc.generate();
    const analysis = NetFaultAnalyzer.analyze(data);
    lastResult = { data, analysis, source: 'sim', ts: new Date(), scenario: sc.name };
    renderSim(data, analysis);
    $('scanStatus').textContent = 'Simulation: ' + sc.name + ' (' + sc.tag + ')';
  }
  $('btnSimRun').addEventListener('click', runSimulation);

  /* ---------------- Shared renderers ---------------- */
  function statusColor(status) {
    return { 'Critical': '#f85149', 'High': '#f85149', 'Medium': '#d29922', 'Low': '#d29922', 'Healthy': '#3fb950' }[status] || '#8b98a9';
  }

  function renderFaults(panelEl, osiEl, analysis) {
    osiEl.textContent = 'OSI Layer: ' + (analysis.osiLayer ? analysis.osiLayer.label : '--') +
      '  |  Health: ' + analysis.healthScore + '%  |  Status: ' + analysis.status;
    osiEl.className = 'osi-indicator sev-' + analysis.status;
    panelEl.innerHTML = '';
    analysis.findings.forEach(f => {
      const card = document.createElement('div');
      card.className = 'fault-card sev-' + f.severity;
      card.innerHTML =
        '<div class="fc-head"><span class="fc-title">' + esc(f.title) + '</span>' +
        '<span class="fc-sev">' + f.severity + '</span></div>' +
        '<div class="fc-cause"><b>Root Cause:</b> ' + esc(f.rootCause) + '</div>' +
        '<div class="fc-conf">Confidence: <b>' + Math.round(f.confidence) + '%</b>' +
        '<div class="conf-bar"><i style="width:' + Math.round(f.confidence) + '%"></i></div></div>' +
        '<div class="fc-evidence">Evidence: ' + esc(f.evidence) + '</div>' +
        '<div class="fc-fix">' + esc(f.fix) + '</div>' +
        '<div class="fc-layer">' + (f.layer ? f.layer.label : '') + '</div>';
      panelEl.appendChild(card);
    });
  }

  function buildTopoNodes(data) {
    const conn = data.connectivity || {};
    const trace = data.trace || { hops: [] };
    const active = conn.activeIface || null;
    const modeLabel = { wifi: 'PC', lan: 'PC', mobile: 'Phone' }[data.mode || 'wifi'] || 'PC';
    const modeType = { wifi: 'pc', lan: 'pc', mobile: 'phone' }[data.mode || 'wifi'] || 'pc';
    const nodes = [];
    nodes.push({ label: modeLabel, sub: active ? active.ipv4 : 'no IP', color: active && active.ipv4 ? 'good' : 'bad', type: modeType });
    const gwCol = conn.gatewayReachable === false ? 'bad' : (conn.hasGateway ? 'good' : 'bad');
    nodes.push({ label: 'Gateway', sub: conn.gateway || 'none', color: gwCol, type: 'router' });
    const hops = trace.hops.slice(0, 5);
    hops.forEach(h => {
      const col = h.lossPct === 100 ? 'bad' : (h.lossPct > 0 ? 'warn' : 'good');
      nodes.push({ label: 'H' + h.hop, sub: h.ip, color: col, loss: h.lossPct, type: 'hop' });
    });
    nodes.push({ label: 'Internet', sub: '8.8.8.8', color: conn.internetReachable === false ? 'bad' : 'good', type: 'internet' });
    return nodes;
  }

  function drawNodeIcon(ctx, type, x, y, r, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (type === 'pc' || type === 'phone') {
      const w = r * 1.1, h = r * 0.85;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(x - w / 2.6, y + h / 2 + 3);
      ctx.lineTo(x + w / 2.6, y + h / 2 + 3);
      ctx.stroke();
      if (type === 'phone') {
        ctx.fillStyle = color;
        ctx.fillRect(x - 1.5, y - h / 4, 3, 6);
      }
    } else if (type === 'router') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r * 0.6, y + Math.sin(ang) * r * 0.6);
        ctx.lineTo(x + Math.cos(ang) * r * 0.9, y + Math.sin(ang) * r * 0.9);
        ctx.stroke();
      }
    } else if (type === 'internet') {
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y, r * 0.5, 0, Math.PI * 2);
      ctx.arc(x + r * 0.2, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
      ctx.arc(x + r * 0.35, y + r * 0.1, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTopology(canvas, data) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const nodes = buildTopoNodes(data);
    const colors = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', unknown: '#8b98a9' };
    const N = nodes.length;
    const startX = 58, endX = W - 58;
    const spacing = N > 1 ? (endX - startX) / (N - 1) : 0;
    const r = N > 1 ? Math.max(13, Math.min(30, spacing * 0.36)) : 30;
    const labelSize = Math.max(10, Math.min(12, spacing * 0.2));
    const showSub = spacing >= 54;
    const showLoss = spacing >= 52;
    const xPos = [];
    for (let i = 0; i < N; i++) {
      xPos.push(N === 1 ? W / 2 : startX + spacing * i);
    }
    const yMid = H / 2;
    for (let i = 0; i < N - 1; i++) {
      const c = nodes[i + 1].color;
      ctx.beginPath();
      ctx.moveTo(xPos[i] + r + 4, yMid);
      ctx.lineTo(xPos[i + 1] - r - 4, yMid);
      ctx.strokeStyle = c === 'bad' ? 'rgba(248,113,113,0.9)' : (c === 'warn' ? 'rgba(251,191,36,0.6)' : 'rgba(34,211,238,0.55)');
      ctx.lineWidth = c === 'bad' ? 3 : 2;
      ctx.setLineDash(c === 'bad' ? [7, 5] : []);
      ctx.shadowColor = c === 'bad' ? '#f87171' : 'transparent';
      ctx.shadowBlur = c === 'bad' ? 10 : 0;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
    nodes.forEach((n, i) => {
      const x = xPos[i];
      const isEnd = i === 0 || i === N - 1;
      const nr = isEnd ? r + 6 : r;
      const color = colors[n.color] || colors.unknown;
      ctx.beginPath();
      ctx.arc(x, yMid, nr, 0, Math.PI * 2);
      const grd = ctx.createRadialGradient(x, yMid, 2, x, yMid, nr);
      grd.addColorStop(0, color + '33');
      grd.addColorStop(1, color + '0d');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = n.color === 'bad' ? 16 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      drawNodeIcon(ctx, n.type, x, yMid, nr - 7, color);
      ctx.fillStyle = '#e8eef7';
      ctx.font = 'bold ' + labelSize + 'px Segoe UI';
      ctx.textAlign = 'center';
      const label = (n.label.length > 9 && spacing < 70) ? n.label.slice(0, 8) + '..' : n.label;
      ctx.fillText(label, x, yMid - nr - 8);
      if (showSub) {
        ctx.font = (spacing < 70 ? 9 : 10) + 'px Consolas';
        ctx.fillStyle = '#8b98a9';
        ctx.fillText(shortIp(n.sub), x, yMid + nr + 16);
      }
      if (n.loss && showLoss) {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 10px Consolas';
        ctx.fillText('loss ' + n.loss + '%', x, yMid + nr + 30);
      }
    });
  }

  function shortIp(ip) {
    if (!ip) return '--';
    if (ip.length > 13) return ip.slice(0, 12) + '..';
    return ip;
  }

  function drawGauge(canvas, pct, metaText) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H - 34, r = Math.min(W / 2 - 40, 88);
    if (pct === null || typeof pct !== 'number') {
      ctx.fillStyle = '#8b98a9';
      ctx.font = 'bold 16px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('Wired Connection - Signal N/A', cx, cy - r / 2);
      if (metaText) {
        ctx.font = '12px Consolas';
        ctx.fillText(metaText, cx, cy - r / 2 + 24);
      }
      return;
    }
    const color = pct >= 75 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.strokeStyle = 'rgba(10,14,23,0.95)';
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI * (1 - pct / 100));
    ctx.strokeStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let t = 0; t <= 10; t++) {
      const ang = Math.PI + Math.PI * t / 10;
      const r1 = r + 13, r2 = t % 5 === 0 ? r + 19 : r + 16;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy - Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy - Math.sin(ang) * r2);
      ctx.strokeStyle = t % 5 === 0 ? '#4b5a75' : '#33415e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const angN = Math.PI + Math.PI * pct / 100;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angN) * (r - 26), cy - Math.sin(angN) * (r - 26));
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#e8eef7';
    ctx.font = 'bold 36px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(pct + '%', cx, cy - 20);
    ctx.fillStyle = color;
    ctx.font = 'bold 12px Segoe UI';
    ctx.fillText('SIGNAL STRENGTH', cx, cy + 14);
    if (metaText) {
      ctx.fillStyle = '#8b98a9';
      ctx.font = '11.5px Consolas';
      ctx.fillText(metaText, cx, cy + 28);
    }
    ctx.fillStyle = '#4b5a75';
    ctx.font = '10px Consolas';
    ctx.textAlign = 'left';
    ctx.fillText('0%', cx - r - 12, cy + 4);
    ctx.textAlign = 'right';
    ctx.fillText('100%', cx + r + 12, cy + 4);
  }

  function drawTrace(canvas, data, title) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const hops = (data.trace && data.trace.hops) || [];
    ctx.fillStyle = '#8b98a9';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText(title || 'Traceroute - latency per hop (ms)', 10, 18);
    if (!hops.length) {
      ctx.fillStyle = '#8b98a9';
      ctx.textAlign = 'center';
      ctx.font = '13px Segoe UI';
      ctx.fillText('No route available', W / 2, H / 2);
      return;
    }
    const padL = 44, padB = 30, padT = 34;
    const chartW = W - padL - 14;
    const chartH = H - padT - padB;
    const maxV = Math.max(100, ...hops.map(h => Math.max(...h.times.filter(t => t !== null), 0)));
    const barW = Math.min(42, (chartW / hops.length) * 0.55);
    const gap = hops.length > 1 ? (chartW - barW) / (hops.length - 1) : 0;
    const maxY = Math.ceil(maxV / 50) * 50;
    ctx.strokeStyle = '#26334d';
    ctx.setLineDash([4, 5]);
    for (let g = 0; g <= 4; g++) {
      const y = padT + chartH - (chartH * g / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - 10, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Consolas';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxY * g / 4)), padL - 6, y + 3);
    }
    ctx.setLineDash([]);
    hops.forEach((h, i) => {
      const x = padL + i * gap;
      const samples = h.times.filter(t => t !== null);
      if (samples.length) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const bh = Math.max(5, chartH * avg / maxY);
        const base = padT + chartH - bh;
        const col = h.lossPct >= 100 ? '#f87171' : h.lossPct > 0 ? '#fbbf24' : '#22d3ee';
        const grd = ctx.createLinearGradient(0, base, 0, padT + chartH);
        grd.addColorStop(0, col);
        grd.addColorStop(1, col + '55');
        ctx.fillStyle = grd;
        ctx.beginPath();
        const rad = Math.min(6, barW / 2);
        roundRectPath(ctx, x, base, barW, bh, rad);
        ctx.fill();
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        ctx.fillStyle = col;
        ctx.fillRect(x, base, barW, 2);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e8eef7';
        ctx.font = 'bold 11px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(avg)), x + barW / 2, base - 6);
      } else {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 15px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText('X', x + barW / 2, padT + chartH / 2);
      }
      ctx.fillStyle = h.lossPct >= 100 ? '#f87171' : h.lossPct > 0 ? '#fbbf24' : '#8b98a9';
      ctx.font = 'bold 10px Consolas';
      ctx.fillText(h.lossPct + '%', x + barW / 2, padT + chartH + 12);
      ctx.fillStyle = '#8b98a9';
      ctx.font = '10px Consolas';
      ctx.fillText('h' + h.hop, x + barW / 2, padT + chartH + 24);
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderNeighbors(tableEl, data) {
    const tbody = tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    const list = (data.neighbors || []).slice(0, 8);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#8b98a9">No neighboring networks found</td></tr>';
      return;
    }
    list.forEach(n => {
      const cls = n.signalPct >= 50 ? 'sig-good' : n.signalPct >= 25 ? 'sig-mid' : 'sig-bad';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(n.ssid || 'hidden') + '</td>' +
        '<td>' + esc(n.channel) + '</td>' +
        '<td>' + n.signalPct + '%<span class="sig-bar ' + cls + '"><i style="width:' + n.signalPct + '%"></i></span></td>' +
        '<td>' + esc(n.auth || '-') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function buildEvidence(data) {
    const conn = data.connectivity || {};
    const active = conn.activeIface || null;
    const w = data.wifi && data.wifi.data;
    const lines = [];
    lines.push('Scan time : ' + (data.timestamp ? new Date(data.timestamp).toLocaleString() : '-'));
    lines.push('Mode      : ' + (data.mode || 'wifi'));
    lines.push('');
    lines.push('-- ACTIVE INTERFACE --');
    lines.push('Interface : ' + (active ? active.name : 'none') + (active ? ' (' + active.ipv4 + ')' : ''));
    lines.push('Subnet    : ' + (active ? active.subnet || '-' : 'n/a'));
    lines.push('Gateway   : ' + (conn.gateway || 'none') + (conn.gatewayArp ? ' [ARP ' + conn.gatewayArp.mac + (conn.gatewayArp.vendor ? ' | ' + conn.gatewayArp.vendor + ']' : ']') : ''));
    lines.push('DHCP      : ' + (active ? (active.dhcp ? 'Enabled, server ' + (active.dhcpServer || '-') : 'Disabled') : 'n/a') + (active && active.apipa ? ' -> APIPA 169.254!' : ''));
    lines.push('MAC       : ' + (active ? active.mac || '-' : 'n/a'));
    lines.push('');
    lines.push('-- WIFI --');
    lines.push('WiFi      : ' + (w ? w.ssid + ' | signal ' + (w.signalPct == null ? '-' : w.signalPct + '%') + ' | ch ' + (w.channel || '-') + ' | ' + (w.radioType || '-') + ' | ' + (w.auth || '-') + ' | Rx ' + (w.rxRate || '-') + ' / Tx ' + (w.txRate || '-') + ' Mbps' : 'not connected / not available'));
    const pgs = ['gateway', 'internet', 'alt'];
    const pgNames = { gateway: 'gateway', internet: '8.8.8.8', alt: '1.1.1.1' };
    lines.push('');
    lines.push('-- PING RESULTS --');
    pgs.forEach(k => {
      const p = conn.pings && conn.pings[k];
      if (!p) { lines.push('Ping ' + pgNames[k] + ' : n/a'); return; }
      lines.push('Ping ' + pgNames[k] + ' : sent ' + p.sent + ' | recv ' + p.received + ' | loss ' + p.lossPct + '% | min ' + (p.min === null ? '-' : p.min + 'ms') + ' | avg ' + (p.avg === null ? '-' : p.avg + 'ms') + ' | max ' + (p.max === null ? '-' : p.max + 'ms') + ' | jitter ' + p.jitter + 'ms');
    });
    lines.push('');
    lines.push('-- DNS --');
    lines.push('DNS       : ' + (data.dns && data.dns.server ? data.dns.server + ' (' + data.dns.address + ') in ' + data.dns.lookupMs + 'ms' : 'FAILED'));
    if (data.dns && Array.isArray(data.dns.tests)) {
      data.dns.tests.forEach(t => lines.push('DNS test  : ' + t.server + ' = ' + t.ms + 'ms ' + (t.ok ? 'OK' : 'FAIL')));
    }
    lines.push('-- MTU / IPv6 --');
    lines.push('MTU       : ' + (data.mtu && data.mtu.mtu ? data.mtu.mtu + ' bytes (payload ' + data.mtu.payload + ')' : 'n/a'));
    lines.push('IPv6      : ' + (data.ipv6 ? ((data.ipv6.enabled ? 'Enabled' : 'Disabled') + ', loopback ' + (data.ipv6.loopbackOk ? 'OK' : 'FAIL') + ', internet ' + (data.ipv6.internetOk ? 'OK' : 'n/a')) : 'n/a'));
    lines.push('');
    lines.push('-- INTERFACES --');
    (data.interfaces || []).forEach(i => lines.push('  ' + i.name + ' : admin=' + i.adminState + ', state=' + i.state));
    if (!(data.interfaces || []).length) lines.push('  (none reported)');
    lines.push('');
    lines.push('-- ARP TABLE (' + ((data.arp || []).length) + ' entries) --');
    (data.arp || []).slice(0, 10).forEach(e => lines.push('  ' + e.ip + '  ' + e.mac + '  ' + e.type));
    if (!(data.arp || []).length) lines.push('  (empty)');
    lines.push('');
    lines.push('-- NEIGHBOR NETWORKS (' + ((data.neighbors || []).length) + ') --');
    (data.neighbors || []).slice(0, 10).forEach(n => lines.push('  ' + n.ssid + ' | ch ' + n.channel + ' | ' + n.signalPct + '% | ' + n.radioType + ' | ' + n.auth));
    lines.push('');
    lines.push('-- TRACEROUTE (' + ((data.trace && data.trace.hops) || []).length + ' hops) --');
    ((data.trace && data.trace.hops) || []).forEach(h => lines.push('  hop ' + h.hop + ' : ' + h.ip + ' | times ' + (h.times || []).map(t => t === null ? '*' : t + 'ms').join(', ') + ' | loss ' + h.lossPct + '%'));
    return lines.join('\n');
  }

  function renderSignalMeta(el, data) {
    const w = data.wifi && data.wifi.data;
    if (!w) {
      el.textContent = 'WiFi not connected (wired/cellular mode)';
      return;
    }
    const dbm = typeof w.signalPct === 'number' ? NetFaultAnalyzer.pctToDbm(w.signalPct) : 'n/a';
    el.textContent = w.ssid + ' | RSSI ' + dbm + ' | Channel ' + (w.channel || '-') + ' | ' + (w.radioType || '-') + ' | ' + (w.auth || '-');
  }

  function renderLive(data, analysis) {
    if (data.meta && data.meta.liveUnavailable) {
      $('osiIndicator').textContent = 'Live scan not available on this server';
      $('osiIndicator').className = 'osi-indicator sev-Low';
      $('faultPanel').innerHTML = '<div class="placeholder">' + esc(data.meta.reason || 'Live network scan requires Windows. This hosted instance runs on Linux.') + '</div>';
      drawTopology($('topologyCanvas'), data);
      drawGauge($('signalCanvas'), null, 'No signal (server OS)');
      $('signalMeta').textContent = 'Live scan unavailable on this server';
      const nt = $('neighborTable').querySelector('tbody');
      if (nt) nt.innerHTML = '<tr><td colspan="4" style="color:#7d93ad;text-align:center;padding:14px">Not available on this server OS.</td></tr>';
      drawTrace($('traceCanvas'), data, 'Traceroute (unavailable)');
      $('evidenceBox').textContent = 'Live scan is only available when NetPlus AI runs on Windows.\nRun the app locally on Windows for full network diagnostics.';
      return;
    }
    renderFaults($('faultPanel'), $('osiIndicator'), analysis);
    drawTopology($('topologyCanvas'), data);
    const w = data.wifi && data.wifi.data;
    drawGauge($('signalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : (data.mode === 'lan' ? 'Wired link' : 'No WiFi'));
    renderSignalMeta($('signalMeta'), data);
    renderNeighbors($('neighborTable'), data);
    drawTrace($('traceCanvas'), data, 'Traceroute to 8.8.8.8 - real');
    $('evidenceBox').textContent = buildEvidence(data);
  }

  function renderSim(data, analysis) {
    renderFaults($('simFaultPanel'), $('simOsiIndicator'), analysis);
    drawTopology($('simTopoCanvas'), data);
    const w = data.wifi && data.wifi.data;
    const label = data.meta && data.meta.signalLabel;
    drawGauge($('simSignalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : 'No wireless');
    $('simSignalMeta').textContent = label || (w ? 'Simulated signal: ' + w.signalPct + '%' : 'Wireless not connected');
    drawTrace($('simTraceCanvas'), data, 'Traceroute - simulated');
  }

  loadHistory();
})();
