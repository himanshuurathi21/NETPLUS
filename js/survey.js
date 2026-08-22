(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fmt = (v, d) => isNum(v) ? (d == null ? String(v) : v.toFixed(d)) : '--';
  const sigTxt = (v) => isNum(v) ? v + '%' : '--';
  const trunc = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n - 2) + '..' : t; };
  const nowIso = () => new Date().toISOString();

  const QUALITY = [
    { key: 'excellent', label: 'Excellent', color: '#34d399' },
    { key: 'good', label: 'Good', color: '#fbbf24' },
    { key: 'fair', label: 'Fair', color: '#fb923c' },
    { key: 'poor', label: 'Poor', color: '#f87171' }
  ];
  const NA = { key: 'na', label: 'N/A', color: '#8b98a9' };

  let surveys = [];
  let current = null;
  let selected = new Set();
  let filterQ = 'all';
  let searchText = '';
  let sortKey = 'timestamp';
  let sortDir = -1;
  let busy = false;
  let mapPts = [];
  let floorPlanImg = null;

  function qualityOf(pct) {
    const v = isNum(pct) ? pct : -1;
    if (v >= 75) return QUALITY[0];
    if (v >= 50) return QUALITY[1];
    if (v >= 25) return QUALITY[2];
    return v < 0 ? NA : QUALITY[3];
  }

  function api(path, opts) {
    return fetch(path, opts)
      .then(r => r.json().catch(() => ({ ok: false, error: 'Invalid server response (' + r.status + ')' })))
      .catch(e => ({ ok: false, error: e.message || 'Network error' }));
  }

  function setStatus(msg) { $('surveyStatus').textContent = msg; }

  function kvRow(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  function qualityChip(q) {
    return '<span class="quality-chip" style="color:' + q.color + ';background:' + q.color + '1f;border:1px solid ' + q.color + '55">' + q.label + '</span>';
  }

  /* ---------------- GPS ---------------- */
  function getLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null, source: null, error: 'Geolocation not supported by this browser' });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6, source: 'gps', error: null }),
        (err) => resolve({ lat: null, lng: null, source: null, error: (err && err.message) || 'GPS position unavailable' }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  /* ---------------- speed test ---------------- */
  async function downloadTest(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error('bad response');
      const reader = res.body.getReader();
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
      }
      const ms = performance.now() - t0;
      if (ms <= 0 || bytes <= 0) return null;
      return Math.round(bytes * 8 / 1e6 / (ms / 1000) * 100) / 100;
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadTest(url, bytes, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    const t0 = performance.now();
    try {
      const payload = new Uint8Array(bytes);
      for (let i = 0; i < bytes; i++) payload[i] = (i * 31) % 251;
      const res = await fetch(url, { method: 'POST', body: payload, signal: ctrl.signal });
      const ms = performance.now() - t0;
      let mbps = ms > 0 ? bytes * 8 / 1e6 / (ms / 1000) : 0;
      try {
        const j = await res.json();
        if (j && isNum(j.mbps)) mbps = j.mbps;
      } catch (e) { /* keep client timing */ }
      return Math.round(mbps * 100) / 100;
    } finally {
      clearTimeout(timer);
    }
  }

  async function runSpeedTest(hasInternet) {
    const result = { download: null, upload: null, source: 'offline' };
    if (!hasInternet) return result;
    try {
      result.download = await downloadTest('https://speed.cloudflare.com/__down?bytes=5000000', 20000);
    } catch (e) { result.download = null; }
    if (result.download == null) {
      try {
        result.download = await downloadTest('/api/speedtest/data?bytes=8388608', 20000);
        result.source = 'local';
      } catch (e) { result.download = null; }
    } else {
      result.source = 'cloudflare';
    }
    try {
      result.upload = await uploadTest('https://speed.cloudflare.com/__up', 3000000, 20000);
    } catch (e) { result.upload = null; }
    if (result.upload == null) {
      try { result.upload = await uploadTest('/api/speedtest/upload', 3000000, 20000); }
      catch (e) { result.upload = null; }
    }
    return result;
  }

  /* ---------------- map network data to survey fields ---------------- */
  function mapWifi(data) {
    const conn = data.connectivity || {};
    const wifi = data.wifi || {};
    const w = wifi.data || null;
    const act = conn.activeIface || null;
    const p = conn.pings || {};
    const internet = p.internet || null;
    const rssi = (w && isNum(w.signalPct)) ? Math.round(-50 - (100 - w.signalPct) * 0.4) : null;
    const eth = (data.interfaces || []).find(i => /ethernet|lan|wired/i.test(i.name));
    const lanUp = !!(eth && eth.state && /connected|up/i.test(eth.state));
    const lanLink = (data.lan || []).find(l => /ethernet|lan|wired/i.test(l.name));
    const wifiUp = !!(wifi.connected || (w && w.state && /connected/i.test(w.state)));
    return {
      ssid: w ? w.ssid : null,
      bssid: w ? (w.bssid || null) : null,
      band: w ? (w.band || null) : null,
      channel: w ? (w.channel || null) : null,
      rssiDbm: rssi,
      signalPct: w && isNum(w.signalPct) ? w.signalPct : null,
      linkTx: w && w.txRate ? (parseFloat(w.txRate) || null) : null,
      linkRx: w && w.rxRate ? (parseFloat(w.rxRate) || null) : null,
      standard: w ? (w.radio_type || null) : null,
      security: w ? String((w.authentication || '') + (w.cipher ? ' / ' + w.cipher : '')).trim() : null,
      distanceM: rssi == null ? null : Math.round(Math.pow(10, (-40 - rssi) / 25) * 10) / 10,
      networkType: wifiUp ? 'WiFi' : (lanUp ? 'Ethernet' : 'Unknown'),
      lanStatus: lanUp ? 'Connected' : 'Disconnected',
      lanLinkSpeed: lanLink ? lanLink.linkSpeed : null,
      gateway: conn.gateway || null,
      ip: act ? act.ipv4 : null,
      ping: internet && isNum(internet.avg) ? internet.avg : null,
      jitter: internet && isNum(internet.jitter) ? internet.jitter : null,
      packetLoss: internet && isNum(internet.lossPct) ? internet.lossPct : null
    };
  }

  /* ---------------- capture flow ---------------- */
  async function capture() {
    if (busy) return;
    busy = true;
    const btn = $('btnSurveyScan');
    btn.disabled = true;
    $('btnSurveySave').disabled = true;
    try {
      setStatus('Scanning network...');
      const netRes = await api('/api/network');
      if (!netRes.ok) throw new Error(netRes.error || 'Network scan failed');
      const hasNet = !!(netRes.data.connectivity && netRes.data.connectivity.internetReachable);
      setStatus('Measuring internet speed...');
      const speed = await runSpeedTest(hasNet);
      setStatus('Getting GPS position...');
      const gps = await getLocation();
      const info = mapWifi(netRes.data);
      current = Object.assign({}, info, {
        quality: qualityOf(info.signalPct).label,
        download: speed.download,
        upload: speed.upload,
        speedSource: speed.source,
        lat: gps.lat,
        lng: gps.lng,
        gpsSource: gps.source,
        gpsError: gps.error,
        timestamp: nowIso()
      });
      renderCapture(current);
      setStatus('Scan done in ' + (netRes.data.scanDurationMs / 1000).toFixed(1) + 's - enter a location name and save.');
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  async function saveCurrent() {
    if (!current || busy) return;
    const loc = $('surveyLocName').value.trim();
    if (!loc) { $('surveyLocName').focus(); return; }
    const latIn = $('surveyLat');
    const lngIn = $('surveyLng');
    const mlat = latIn ? parseFloat(latIn.value) : NaN;
    const mlng = lngIn ? parseFloat(lngIn.value) : NaN;
    const payload = Object.assign({}, current, {
      locationName: loc,
      notes: $('surveyNotes').value.trim(),
      lat: isNum(current.lat) ? current.lat : (isNum(mlat) ? mlat : null),
      lng: isNum(current.lng) ? current.lng : (isNum(mlng) ? mlng : null)
    });
    const r = await api('/api/surveys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.ok) {
      setStatus('Survey point saved: ' + r.survey.id);
      current = null;
      $('btnSurveySave').disabled = true;
      $('surveyLocName').value = '';
      $('surveyNotes').value = '';
      await loadSurveys();
    } else {
      setStatus('Save error: ' + (r.error || 'unknown'));
    }
  }

  /* ---------------- render capture ---------------- */
  function renderCapture(c) {
    const q = qualityOf(c.signalPct);
    $('surveyWifiTable').innerHTML =
      kvRow('SSID', esc(c.ssid || '--')) +
      kvRow('BSSID (MAC)', esc(c.bssid || '--')) +
      kvRow('Band', esc(c.band || '--')) +
      kvRow('Channel', esc(c.channel || '--')) +
      kvRow('RSSI', isNum(c.rssiDbm) ? fmt(c.rssiDbm, 0) + ' dBm (estimated)' : '--') +
      kvRow('Signal', sigTxt(c.signalPct)) +
      kvRow('Quality', qualityChip(q)) +
      kvRow('Link Speed', 'TX ' + fmt(c.linkTx, 0) + ' / RX ' + fmt(c.linkRx, 0) + ' Mbps') +
      kvRow('Standard', esc(c.standard || '--')) +
      kvRow('Security', esc(c.security || '--')) +
      kvRow('Distance (est.)', fmt(c.distanceM, 1) + ' m') +
      kvRow('Network Type', esc(c.networkType || '--')) +
      kvRow('LAN', esc(c.lanStatus || '--') + (c.lanLinkSpeed ? ' @ ' + esc(c.lanLinkSpeed) : '')) +
      kvRow('Gateway / IP', esc(c.gateway || '--') + ' / ' + esc(c.ip || '--'));
    $('surveySpeedTable').innerHTML =
      kvRow('Download', fmt(c.download, 1) + ' Mbps') +
      kvRow('Upload', fmt(c.upload, 1) + ' Mbps') +
      kvRow('Ping', fmt(c.ping, 0) + ' ms') +
      kvRow('Jitter', fmt(c.jitter, 1) + ' ms') +
      kvRow('Packet Loss', fmt(c.packetLoss, 0) + '%') +
      kvRow('Speed Source', esc(c.speedSource || '--'));
    renderGps(c);
    $('surveyQualityBox').innerHTML =
      '<span class="quality-big" style="color:' + q.color + ';border:1px solid ' + q.color + '66;background:' + q.color + '14">' + q.label + '</span>' +
      '<div class="row-sub">Signal ' + sigTxt(c.signalPct) + ' &bull; RSSI ' + (isNum(c.rssiDbm) ? fmt(c.rssiDbm, 0) + ' dBm' : '--') + '</div>';
    $('btnSurveySave').disabled = false;
  }

  function renderGps(c) {
    const el = $('surveyGpsBox');
    if (isNum(c.lat) && isNum(c.lng)) {
      el.innerHTML = '<div class="gps-ok">GPS position: <b>' + c.lat + ', ' + c.lng + '</b></div><div class="row-sub">auto-detected</div>';
    } else {
      el.innerHTML = '<div class="gps-warn">' + esc(c.gpsError || 'GPS unavailable') + ' - enter coordinates manually:</div>' +
        '<div class="gps-manual">' +
        '<label class="modal-label" style="margin:0">Lat</label><input id="surveyLat" class="input" type="number" step="any" placeholder="e.g. 28.6139">' +
        '<label class="modal-label" style="margin:0">Lng</label><input id="surveyLng" class="input" type="number" step="any" placeholder="e.g. 77.2090">' +
        '</div>';
    }
  }

  /* ---------------- data loading ---------------- */
  async function loadSurveys() {
    const r = await api('/api/surveys');
    if (!r.ok) {
      setStatus('Cannot load surveys: ' + (r.error || 'server offline'));
      return;
    }
    surveys = (r.surveys || []).filter(s => s && s.id);
    selected = new Set(Array.from(selected).filter(id => surveys.some(s => s.id === id)));
    renderHistory();
    renderMap();
    renderHeatmap();
    renderTimeline();
    renderCompare();
    renderStats();
  }

  function renderStats() {
    const n = surveys.length;
    let sig = 0, down = 0, c1 = 0, c2 = 0;
    surveys.forEach(s => {
      if (isNum(s.signalPct)) { sig += s.signalPct; c1++; }
      if (isNum(s.download)) { down += s.download; c2++; }
    });
    $('surveyStats').textContent = n + ' points | avg signal ' + (c1 ? (sig / c1).toFixed(0) : '-') + '% | avg download ' + (c2 ? (down / c2).toFixed(1) : '-') + ' Mbps';
  }

  /* ---------------- history ---------------- */
  function sortVal(s, k) {
    if (k === 'timestamp') return new Date(s.timestamp || 0).getTime();
    if (k === 'signalPct' || k === 'download' || k === 'ping') return isNum(s[k]) ? s[k] : (k === 'ping' ? Infinity : -Infinity);
    return String(s[k] || '').toLowerCase();
  }

  function filteredSurveys() {
    let list = surveys.slice();
    if (filterQ !== 'all') list = list.filter(s => qualityOf(s.signalPct).key === filterQ);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(s => [s.locationName, s.ssid, s.bssid, s.notes, s.id].join(' ').toLowerCase().indexOf(q) !== -1);
    }
    list.sort((a, b) => {
      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      if (va < vb) return -sortDir;
      if (va > vb) return sortDir;
      return 0;
    });
    return list;
  }

  function historyRow(s) {
    const q = qualityOf(s.signalPct);
    const barCls = isNum(s.signalPct) ? (s.signalPct >= 50 ? 'sig-good' : s.signalPct >= 25 ? 'sig-mid' : 'sig-bad') : '';
    return '<tr data-id="' + esc(s.id) + '">' +
      '<td><input type="checkbox" class="sel-cb" data-id="' + esc(s.id) + '"' + (selected.has(s.id) ? ' checked' : '') + '></td>' +
      '<td><b>' + esc(s.locationName || 'Unnamed') + '</b><div class="row-sub">' + esc(s.id) + '</div></td>' +
      '<td>' + esc(s.ssid || '--') + '</td>' +
      '<td>' + esc(s.band || '--') + '<div class="row-sub">ch ' + esc(s.channel || '-') + '</div></td>' +
      '<td>' + sigTxt(s.signalPct) + (barCls ? '<div class="sig-bar ' + barCls + '"><i style="width:' + Math.max(0, Math.min(100, s.signalPct)) + '%"></i></div>' : '') + '</td>' +
      '<td>' + qualityChip(q) + '</td>' +
      '<td>' + fmt(s.download, 1) + ' / ' + fmt(s.upload, 1) + ' Mbps</td>' +
      '<td>' + fmt(s.ping, 0) + ' ms</td>' +
      '<td class="row-sub">' + (s.timestamp ? new Date(s.timestamp).toLocaleString() : '--') + '</td>' +
      '<td class="row-actions">' +
      '<button class="act-btn" data-act="view">View</button>' +
      '<button class="act-btn" data-act="edit">Edit</button>' +
      '<button class="act-btn danger-btn" data-act="del">Del</button>' +
      '</td></tr>';
  }

  function renderHistory() {
    const list = filteredSurveys();
    const tbody = $('surveyHistoryTable').querySelector('tbody');
    tbody.innerHTML = list.length ? list.map(historyRow).join('') :
      '<tr><td colspan="10" style="color:#7d93ad;text-align:center;padding:18px">No survey points yet - run a scan, enter a location name and save.</td></tr>';
    $('surveyHistCount').textContent = list.length + ' of ' + surveys.length + ' points';
    document.querySelectorAll('#surveyHistoryTable th.sortable').forEach(th => {
      const arrow = th.querySelector('.srt');
      arrow.textContent = th.dataset.key === sortKey ? (sortDir === 1 ? ' \u25B2' : ' \u25BC') : '';
    });
  }

  /* ---------------- map & heatmap ---------------- */
  function makeMapper(pts, W, H) {
    const pad = 60;
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    const minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    const minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    const latSpan = maxLat - minLat, lngSpan = maxLng - minLng;
    return {
      x: (p) => lngSpan > 0 ? pad + (p.lng - minLng) / lngSpan * (W - 2 * pad) : W / 2,
      y: (p) => latSpan > 0 ? pad + (1 - (p.lat - minLat) / latSpan) * (H - 2 * pad) : H / 2
    };
  }

  function renderMap() {
    const canvas = $('surveyMapCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (floorPlanImg) {
      const s = Math.min(W / floorPlanImg.width, H / floorPlanImg.height);
      const dw = floorPlanImg.width * s, dh = floorPlanImg.height * s;
      ctx.drawImage(floorPlanImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.strokeStyle = 'rgba(34,211,238,0.06)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy <= H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    const pts = surveys.filter(s => isNum(s.lat) && isNum(s.lng));
    mapPts = [];
    if (!pts.length) {
      ctx.fillStyle = '#7d93ad';
      ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('No GPS points yet - save a survey point first', W / 2, H / 2);
      return;
    }
    const P = pts.length === 1 ? { x: () => W / 2, y: () => H / 2 } : makeMapper(pts, W, H);
    pts.forEach(p => {
      const x = Math.round(P.x(p)), y = Math.round(P.y(p));
      const q = qualityOf(p.signalPct);
      mapPts.push({ x, y, s: p });
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fillStyle = q.color + '22'; ctx.fill();
      ctx.strokeStyle = q.color; ctx.lineWidth = 2.5;
      ctx.shadowColor = q.color; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = q.color; ctx.fill();
      ctx.fillStyle = '#e6f4ff';
      ctx.font = '11px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText(trunc(p.locationName || 'Point', 16), x, y + 30);
    });
  }

  function renderHeatmap() {
    const canvas = $('surveyHeatCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const pts = surveys.filter(s => isNum(s.lat) && isNum(s.lng));
    if (!pts.length) {
      ctx.fillStyle = '#7d93ad';
      ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('No GPS points yet - the heatmap needs survey locations', W / 2, H / 2);
      return;
    }
    const P = pts.length === 1 ? { x: () => W / 2, y: () => H / 2 } : makeMapper(pts, W, H);
    const img = ctx.createImageData(W, H);
    const grid = new Float32Array(W * H);
    const R = 110, sigma = R / 3;
    pts.forEach(p => {
      const cx = Math.round(P.x(p)), cy = Math.round(P.y(p));
      const strength = (isNum(p.signalPct) ? p.signalPct : 0) / 100;
      const x0 = Math.max(0, cx - R), x1 = Math.min(W - 1, cx + R);
      const y0 = Math.max(0, cy - R), y1 = Math.min(H - 1, cy + R);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - cx, dy = yy - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          grid[yy * W + xx] += strength * Math.exp(-d2 / (2 * sigma * sigma));
        }
      }
    });
    let max = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
    for (let i = 0; i < grid.length; i++) {
      const t = max > 0 ? grid[i] / max : 0;
      const c = heatColor(t);
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    pts.forEach(p => {
      const x = Math.round(P.x(p)), y = Math.round(P.y(p));
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });
  }

  function heatColor(t) {
    const stops = [
      [0.0, [19, 27, 51]], [0.12, [226, 62, 62]], [0.35, [236, 138, 46]],
      [0.6, [241, 205, 74]], [0.82, [96, 219, 141]], [1.0, [64, 255, 165]]
    ];
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const span = (hi[0] - lo[0]) || 1;
    const f = Math.min(1, Math.max(0, (t - lo[0]) / span));
    return [
      Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f),
      Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f),
      Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f)
    ];
  }

  /* ---------------- signal timeline ---------------- */
  function renderTimeline() {
    const canvas = $('surveyTimelineCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const pts = surveys
      .filter(s => isNum(s.signalPct) && s.timestamp)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (!pts.length) {
      ctx.fillStyle = '#7d93ad'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('No survey points with signal data yet', W / 2, H / 2);
      return;
    }
    const padL = 46, padB = 28, padT = 16;
    const chartW = W - padL - 14, chartH = H - padT - padB;
    ctx.strokeStyle = '#26334d'; ctx.setLineDash([4, 5]);
    for (let g = 0; g <= 4; g++) {
      const y = padT + chartH - (chartH * g / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.font = '10px Consolas'; ctx.textAlign = 'right';
      ctx.fillText(String(g * 25) + '%', padL - 6, y + 3);
    }
    ctx.setLineDash([]);
    const t0 = new Date(pts[0].timestamp).getTime();
    const t1 = new Date(pts[pts.length - 1].timestamp).getTime();
    const span = (t1 - t0) || 1;
    const X = (p) => padL + (pts.length === 1 ? chartW / 2 : (new Date(p.timestamp).getTime() - t0) / span * chartW);
    const Y = (p) => padT + chartH - (p.signalPct / 100) * chartH;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(p), y = Y(p); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.stroke();
    pts.forEach(p => {
      const x = X(p), y = Y(p);
      const q = qualityOf(p.signalPct);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = q.color; ctx.fill();
      ctx.strokeStyle = '#0a0f1e'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.fillStyle = '#8b98a9'; ctx.font = '10px Consolas'; ctx.textAlign = 'left';
    ctx.fillText(new Date(t0).toLocaleTimeString(), padL, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText(new Date(t1).toLocaleTimeString(), W - 8, H - 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b98a9'; ctx.font = 'bold 12px Segoe UI';
    ctx.fillText('Signal % over time (' + pts.length + ' points)', W / 2, 12);
  }

  /* ---------------- comparison ---------------- */
  function renderCompare() {
    const card = $('compareCard');
    const sel = surveys.filter(s => selected.has(s.id));
    if (!sel.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const num = (k) => sel.map(s => isNum(s[k]) ? s[k] : (k === 'ping' ? Infinity : -Infinity));
    const maxDown = Math.max.apply(null, num('download'));
    const maxUp = Math.max.apply(null, num('upload'));
    const maxPing = Math.max.apply(null, num('ping'));
    const minPing = Math.min.apply(null, num('ping'));
    const rows = sel.map(s => {
      const q = qualityOf(s.signalPct);
      const d = s.download, u = s.upload, pg = s.ping;
      const bestD = isNum(d) && d === maxDown, bestU = isNum(u) && u === maxUp, bestP = isNum(pg) && pg === minPing;
      return '<tr>' +
        '<td><b>' + esc(s.locationName || 'Unnamed') + '</b><div class="row-sub">' + esc(s.ssid || '') + '</div></td>' +
        '<td><span style="color:' + q.color + '">' + sigTxt(s.signalPct) + '</span> (' + (isNum(s.rssiDbm) ? fmt(s.rssiDbm, 0) + ' dBm' : '--') + ')</td>' +
        '<td' + (bestD ? ' class="best"' : '') + '>' + fmt(d, 1) + compareBar(d, maxDown) + '</td>' +
        '<td' + (bestU ? ' class="best"' : '') + '>' + fmt(u, 1) + compareBar(u, maxUp) + '</td>' +
        '<td' + (bestP ? ' class="best"' : '') + '>' + fmt(pg, 0) + compareBar(pg, maxPing, true) + '</td>' +
        '<td class="row-sub">' + (s.timestamp ? new Date(s.timestamp).toLocaleString() : '--') + '</td>' +
        '</tr>';
    }).join('');
    $('compareBody').innerHTML = rows;
  }

  function compareBar(v, max, invert) {
    if (!isNum(v) || !isNum(max) || max <= 0) return '';
    const pct = invert ? (1 - Math.min(1, v / max)) * 100 : Math.min(100, v / max * 100);
    return '<span class="compare-bar" style="width:' + Math.max(2, pct) + '%"></span>';
  }

  /* ---------------- modal ---------------- */
  function showModal(title, bodyHtml, actions) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    const wrap = $('modalActions');
    wrap.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : (a.danger ? 'btn-ghost danger-btn' : 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      wrap.appendChild(b);
    });
    $('modalOverlay').style.display = 'flex';
  }

  function closeModal() { $('modalOverlay').style.display = 'none'; }

  function showDetails(s) {
    const q = qualityOf(s.signalPct);
    const rows = [
      ['Survey ID', s.id],
      ['Location', s.locationName || '-'],
      ['SSID', s.ssid || '-'],
      ['BSSID', s.bssid || '-'],
      ['Band / Channel', (s.band || '-') + ' / ' + (s.channel || '-')],
      ['RSSI', isNum(s.rssiDbm) ? fmt(s.rssiDbm, 0) + ' dBm (estimated)' : '--'],
      ['Signal', sigTxt(s.signalPct)],
      ['Quality', q.label],
      ['Link Speed', 'TX ' + fmt(s.linkTx, 0) + ' / RX ' + fmt(s.linkRx, 0) + ' Mbps'],
      ['Standard', s.standard || '-'],
      ['Security', s.security || '-'],
      ['Distance (est.)', fmt(s.distanceM, 1) + ' m'],
      ['Network Type', s.networkType || '-'],
      ['LAN', (s.lanStatus || '-') + (s.lanLinkSpeed ? ' @ ' + s.lanLinkSpeed : '')],
      ['Download', fmt(s.download, 1) + ' Mbps'],
      ['Upload', fmt(s.upload, 1) + ' Mbps'],
      ['Ping', fmt(s.ping, 0) + ' ms'],
      ['Jitter', fmt(s.jitter, 1) + ' ms'],
      ['Packet Loss', fmt(s.packetLoss, 0) + '%'],
      ['GPS', (isNum(s.lat) && isNum(s.lng)) ? s.lat + ', ' + s.lng : 'not available'],
      ['Gateway / IP', (s.gateway || '-') + ' / ' + (s.ip || '-')],
      ['Timestamp', s.timestamp ? new Date(s.timestamp).toLocaleString() : '-'],
      ['Notes', s.notes || '-']
    ];
    showModal('Survey Details - ' + (s.locationName || s.id),
      '<table class="kv-table">' + rows.map(r => kvRow(r[0], esc(String(r[1])))).join('') + '</table>',
      [{ label: 'Close', primary: true, onClick: closeModal }]);
  }

  function showEdit(s) {
    showModal('Edit Survey Point',
      '<label class="modal-label">Location Name</label>' +
      '<input id="editLoc" class="input" style="width:100%" value="' + esc(s.locationName || '') + '">' +
      '<label class="modal-label">Notes</label>' +
      '<input id="editNotes" class="input" style="width:100%" value="' + esc(s.notes || '') + '">' +
      '<div class="modal-grid">' +
      '<div><label class="modal-label">Latitude</label><input id="editLat" class="input" type="number" step="any" style="width:100%" value="' + (isNum(s.lat) ? s.lat : '') + '"></div>' +
      '<div><label class="modal-label">Longitude</label><input id="editLng" class="input" type="number" step="any" style="width:100%" value="' + (isNum(s.lng) ? s.lng : '') + '"></div>' +
      '</div>',
      [
        { label: 'Cancel', onClick: closeModal },
        { label: 'Save Changes', primary: true, onClick: () => saveEdit(s) }
      ]);
  }

  async function saveEdit(s) {
    const latIn = $('editLat'), lngIn = $('editLng');
    const latVal = latIn && latIn.value !== '' ? parseFloat(latIn.value) : NaN;
    const lngVal = lngIn && lngIn.value !== '' ? parseFloat(lngIn.value) : NaN;
    const patch = {
      locationName: $('editLoc').value.trim() || s.locationName,
      notes: $('editNotes').value.trim(),
      lat: isFinite(latVal) ? latVal : s.lat,
      lng: isFinite(lngVal) ? lngVal : s.lng
    };
    const r = await api('/api/surveys/' + encodeURIComponent(s.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (r.ok) {
      closeModal();
      setStatus('Survey point updated');
      await loadSurveys();
    } else {
      setStatus('Update error: ' + (r.error || 'unknown'));
    }
  }

  function confirmDelete(s) {
    showModal('Delete Survey Point',
      'Delete "' + esc(s.locationName || s.id) + '"? This cannot be undone.',
      [
        { label: 'Cancel', onClick: closeModal },
        { label: 'Delete', danger: true, onClick: async () => {
          const r = await api('/api/surveys/' + encodeURIComponent(s.id), { method: 'DELETE' });
          if (r.ok) {
            closeModal();
            setStatus('Survey point deleted');
            await loadSurveys();
          } else {
            setStatus('Delete error: ' + (r.error || 'unknown'));
          }
        } }
      ]);
  }

  /* ---------------- export ---------------- */
  async function doExport(format, btn) {
    btn.disabled = true;
    try {
      const r = await api('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          folder: $('exportFolder').value.trim() || undefined,
          ids: selected.size ? Array.from(selected) : undefined
        })
      });
      $('exportStatus').textContent = r.ok
        ? 'Saved ' + r.files.length + ' file(s) to: ' + r.folder
        : 'Export error: ' + (r.error || 'unknown');
    } finally {
btn.disabled = false;
    }
  }

  /* ---------------- events ---------------- */
  function bind() {
    $('btnSurveyScan').addEventListener('click', capture);
    $('btnSurveySave').addEventListener('click', saveCurrent);
    $('surveyLocName').addEventListener('input', () => {
      $('btnSurveySave').disabled = !(current && $('surveyLocName').value.trim());
    });
    $('surveyLocName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCurrent(); });
    $('histSearch').addEventListener('input', (e) => { searchText = e.target.value; renderHistory(); });
    $('histFilter').addEventListener('change', (e) => { filterQ = e.target.value; renderHistory(); });
    $('btnCompare').addEventListener('click', () => {
      renderCompare();
      if (selected.size) $('compareCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    document.querySelectorAll('#surveyHistoryTable th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        if (!k) return;
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = (k === 'locationName' || k === 'ssid') ? 1 : -1; }
        renderHistory();
      });
    });
    $('surveyHistoryTable').addEventListener('click', (ev) => {
      const cb = ev.target.closest('.sel-cb');
      if (cb) {
        const id = cb.dataset.id;
        if (cb.checked) selected.add(id); else selected.delete(id);
        renderCompare();
        return;
      }
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const tr = ev.target.closest('tr');
      if (!tr || !tr.dataset.id) return;
      const s = surveys.find(x => x.id === tr.dataset.id);
      if (!s) return;
      if (btn.dataset.act === 'view') showDetails(s);
      else if (btn.dataset.act === 'edit') showEdit(s);
      else if (btn.dataset.act === 'del') confirmDelete(s);
    });
    document.querySelectorAll('[data-export]').forEach(btn => {
      btn.addEventListener('click', () => doExport(btn.dataset.export, btn));
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });
    const mapCanvas = $('surveyMapCanvas');
    mapCanvas.addEventListener('mousemove', (ev) => {
      const rect = mapCanvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (mapCanvas.width / rect.width);
      const y = (ev.clientY - rect.top) * (mapCanvas.height / rect.height);
      let best = null, bd = 16;
      mapPts.forEach(pt => {
        const d = Math.hypot(pt.x - x, pt.y - y);
        if (d < bd) { bd = d; best = pt; }
      });
      const pop = $('mapPopup');
      if (!best) { pop.style.display = 'none'; return; }
      const s = best.s, q = qualityOf(s.signalPct);
      const scl = rect.width / mapCanvas.width;
      pop.style.display = 'block';
      pop.style.left = Math.max(4, Math.min(best.x * scl + 16, rect.width - 232)) + 'px';
      pop.style.top = Math.max(4, best.y * scl - 46) + 'px';
      pop.innerHTML = '<b>' + esc(s.locationName || 'Point') + '</b><br>' +
        'Signal: ' + sigTxt(s.signalPct) + ' (' + (isNum(s.rssiDbm) ? fmt(s.rssiDbm, 0) + ' dBm' : '--') + ') - ' + q.label + '<br>' +
        'Internet: ' + fmt(s.download, 1) + ' / ' + fmt(s.upload, 1) + ' Mbps<br>' +
        'Ping: ' + fmt(s.ping, 0) + ' ms<br>' +
        '<span class="row-sub">' + (s.timestamp ? new Date(s.timestamp).toLocaleString() : '') + '</span>';
    });
    mapCanvas.addEventListener('mouseleave', () => { $('mapPopup').style.display = 'none'; });
    $('floorPlanInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => { floorPlanImg = img; renderMap(); setStatus('Floor plan loaded - points plot over it'); };
        img.onerror = () => setStatus('Floor plan image could not be loaded');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    $('btnFloorClear').addEventListener('click', () => {
      floorPlanImg = null;
      $('floorPlanInput').value = '';
      renderMap();
      setStatus('Floor plan removed');
    });
  }

  bind();
  loadSurveys();
})(window);
