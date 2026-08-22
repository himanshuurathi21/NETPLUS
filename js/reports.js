/*
 * NetPlus AI - Reports tab logic.
 * Lists only Survey & Mapping scans and generates a professional PDF report
 * covering: branding, executive/readiness verdict, coverage statistics,
 * detailed per-location reliability table + detail blocks, automated
 * findings & recommendations, and an embedded coverage heatmap.
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const QUALITY = [
    { min: 75, label: 'Excellent', color: '#40b05a' },
    { min: 50, label: 'Good', color: '#8bc34a' },
    { min: 25, label: 'Fair', color: '#ffb300' },
    { min: 0, label: 'Poor', color: '#e53935' }
  ];
  function qualityOf(pct) {
    const v = typeof pct === 'number' ? pct : -1;
    for (const q of QUALITY) if (v >= q.min) return { label: q.label, color: q.color };
    return { label: 'N/A', color: '#9e9e9e' };
  }
  function gradeColor(g) {
    if (g === 'Fail') return [0.85, 0.2, 0.2];
    if (g === 'Warn') return [0.85, 0.6, 0.1];
    return [0.2, 0.7, 0.3];
  }

  // --- data state ---
  let surveys = [];
  let filtered = [];
  let selected = new Set();

  // --- branding (persisted) ---
  function readBranding() {
    try { return JSON.parse(localStorage.getItem('npa-report-branding') || '{}'); }
    catch (e) { return {}; }
  }
  function saveBranding(b) {
    try { localStorage.setItem('npa-report-branding', JSON.stringify(b)); } catch (e) {}
  }
  function collectBranding() {
    const b = {
      client: $('#repClient').value.trim(),
      site: $('#repSite').value.trim(),
      preparedBy: $('#repPreparedBy').value.trim(),
      reportId: $('#repReportId').value.trim()
    };
    if (!b.reportId) b.reportId = 'NP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9000 + 1000);
    saveBranding(b);
    return b;
  }

  // ---------- grading & analysis ----------
  function gradeLocation(s) {
    const reasons = [];
    let level = 0; // 0 pass, 1 warn, 2 fail
    const sig = typeof s.signalPct === 'number' ? s.signalPct : null;
    const loss = typeof s.packetLoss === 'number' ? s.packetLoss : null;
    const jit = typeof s.jitter === 'number' ? s.jitter : null;
    const sec = ((s.security || '') + ' ' + (s.standard || ''));

    if (sig != null && sig < 25) { level = 2; reasons.push('Critical weak signal (' + sig + '%) - install or relocate an access point / repeater'); }
    else if (sig != null && sig < 50) { if (level < 1) level = 1; reasons.push('Weak signal (' + sig + '%) - reposition access point or reduce obstructions'); }

    if (loss != null && loss > 5) { level = 2; reasons.push('High packet loss (' + loss + '%) - inspect switch, cabling or backhaul link'); }
    else if (loss != null && loss > 2) { if (level < 1) level = 1; reasons.push('Elevated packet loss (' + loss + '%) - monitor link quality'); }

    if (jit != null && jit > 40) { if (level < 1) level = 1; reasons.push('High jitter (' + jit + ' ms) - likely interference / congestion, prefer 5 GHz'); }

    if (/open/i.test(sec) || /WEP/i.test(sec)) { level = 2; reasons.push('Insecure wireless (open/WEP) - upgrade to WPA2/WPA3'); }
    else if (/\bWPA\b(?!2|3)/i.test(sec)) { if (level < 1) level = 1; reasons.push('Legacy WPA detected - upgrade to WPA2/WPA3 for compliance'); }

    if (s.networkType === 'Wi-Fi' && s.band === '2.4 GHz' && sig != null && sig < 50) {
      if (level < 1) level = 1; reasons.push('2.4 GHz only with weak signal - move capable clients to 5 GHz');
    }
    if (!(typeof s.lat === 'number' && typeof s.lng === 'number')) {
      if (level < 1) level = 1; reasons.push('No GPS captured - add coordinates for accurate site mapping');
    }

    const grade = level === 2 ? 'Fail' : level === 1 ? 'Warn' : 'Pass';
    if (!reasons.length) reasons.push('Signal and link quality within acceptable limits');
    return { grade: grade, reasons: reasons };
  }

  function coverageStats(sel) {
    const q = { Excellent: 0, Good: 0, Fair: 0, Poor: 0 };
    let dead = 0;
    const pings = [], jits = [], losses = [];
    let worst = null;
    sel.forEach(s => {
      const label = qualityOf(s.signalPct).label;
      if (label in q) q[label]++;
      if (typeof s.signalPct === 'number' && s.signalPct < 25) dead++;
      if (typeof s.ping === 'number') pings.push(s.ping);
      if (typeof s.jitter === 'number') jits.push(s.jitter);
      if (typeof s.packetLoss === 'number') losses.push(s.packetLoss);
      if (worst == null || (typeof s.signalPct === 'number' && (worst.signalPct == null || s.signalPct < worst.signalPct))) worst = s;
    });
    const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
    let gps = null;
    const pts = sel.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number');
    if (pts.length > 1) {
      const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
      gps = { count: pts.length, latSpan: Math.max.apply(null, lats) - Math.min.apply(null, lats), lngSpan: Math.max.apply(null, lngs) - Math.min.apply(null, lngs) };
    }
    return { q: q, dead: dead, avgPing: avg(pings), avgJit: avg(jits), avgLoss: avg(losses), worst: worst, gps: gps };
  }

  // ---------- heatmap painting (mirrors survey.js, uses selected set) ----------
  function heatColor(t) {
    const stops = [[0.0, [226, 62, 62]], [0.35, [236, 138, 46]], [0.6, [241, 205, 74]], [0.82, [96, 219, 141]], [1.0, [64, 255, 165]]];
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) { if (t >= stops[i][0] && t <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; } }
    const span = (hi[0] - lo[0]) || 1, f = Math.min(1, Math.max(0, (t - lo[0]) / span));
    return [Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f), Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f), Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f)];
  }
  function drawHeatmapCanvas(W, H, sel) {
    const pts = sel.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number');
    if (pts.length < 1) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const pad = 60;
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    const minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    const minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    const latSpan = maxLat - minLat, lngSpan = maxLng - minLng;
    const X = (p) => lngSpan > 0 ? pad + (p.lng - minLng) / lngSpan * (W - 2 * pad) : W / 2;
    const Y = (p) => latSpan > 0 ? pad + (1 - (p.lat - minLat) / latSpan) * (H - 2 * pad) : H / 2;
    const grid = new Float32Array(W * H);
    const R = 110, sigma = R / 3;
    pts.forEach(p => {
      const cx = Math.round(X(p)), cy = Math.round(Y(p));
      const strength = (typeof p.signalPct === 'number' ? p.signalPct : 0) / 100;
      const x0 = Math.max(0, cx - R), x1 = Math.min(W - 1, cx + R), y0 = Math.max(0, cy - R), y1 = Math.min(H - 1, cy + R);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx, dy = yy - cy, d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        grid[yy * W + xx] += strength * Math.exp(-d2 / (2 * sigma * sigma));
      }
    });
    let max = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < grid.length; i++) {
      const t = max > 0 ? grid[i] / max : 0;
      const col = heatColor(t);
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    pts.forEach(p => {
      const x = Math.round(X(p)), y = Math.round(Y(p));
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    });
    return c;
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // ---------- PDF assembly ----------
  function buildPdf(sel, branding) {
    const doc = new PdfBuilder();
    const W = 841.89, MARGIN = 42;

    doc.text('NetPlus AI - Network Survey Report', { size: 18, bold: true, color: [0.13, 0.27, 0.55] });
    doc.text('Wi-Fi Site Survey & Signal Coverage Assessment', { size: 11, color: [0.4, 0.4, 0.5], gap: 2 });
    doc.hr({ color: [0.13, 0.27, 0.55], w: 1.2 });

    doc.text('Client / Company : ' + (branding.client || '—'), { size: 10, gap: 1 });
    doc.text('Site Name        : ' + (branding.site || '—'), { size: 10, gap: 1 });
    doc.text('Prepared By      : ' + (branding.preparedBy || '—'), { size: 10, gap: 1 });
    doc.text('Report ID        : ' + (branding.reportId || '—'), { size: 10, gap: 1 });
    doc.text('Generated        : ' + new Date().toLocaleString(), { size: 10, gap: 6 });

    const grades = sel.map(gradeLocation);
    const worstLevel = grades.reduce((m, g) => Math.max(m, g.grade === 'Fail' ? 2 : g.grade === 'Warn' ? 1 : 0), 0);
    const siteGrade = worstLevel === 2 ? 'Fail' : worstLevel === 1 ? 'Warn' : 'Pass';
    const passed = grades.filter(g => g.grade === 'Pass').length;
    const warned = grades.filter(g => g.grade === 'Warn').length;
    const failed = grades.filter(g => g.grade === 'Fail').length;

    doc.text('Executive Summary', { size: 13, bold: true });
    doc.hr({ color: [0.8, 0.8, 0.8] });
    doc.text('Overall Site Readiness : ' + siteGrade, { size: 13, bold: true, color: gradeColor(siteGrade), gap: 2 });
    doc.text('Locations assessed : ' + sel.length + '   |   Passed : ' + passed + '   |   Warning : ' + warned + '   |   Failed : ' + failed, { size: 10, gap: 2 });
    doc.text('This assessment is based on local Wi-Fi / LAN reliability (signal, packet loss, jitter, security) and not on internet throughput.', { size: 9, color: [0.45, 0.45, 0.5], gap: 6 });

    const cs = coverageStats(sel);
    doc.text('Coverage Statistics', { size: 13, bold: true });
    doc.hr({ color: [0.8, 0.8, 0.8] });
    const statRows = [
      ['Total scanned locations', String(sel.length)],
      ['Excellent (75%+)', String(cs.q.Excellent)],
      ['Good (50-74%)', String(cs.q.Good)],
      ['Fair (25-49%)', String(cs.q.Fair)],
      ['Poor (<25%)', String(cs.q.Poor)],
      ['Dead zones (signal <25%)', String(cs.dead)],
      ['Average ping (ms)', cs.avgPing != null ? String(cs.avgPing) : '—'],
      ['Average jitter (ms)', cs.avgJit != null ? String(cs.avgJit) : '—'],
      ['Average packet loss (%)', cs.avgLoss != null ? String(cs.avgLoss) : '—'],
      ['Worst location', cs.worst ? ((cs.worst.locationName || 'Unnamed') + ' (' + (typeof cs.worst.signalPct === 'number' ? cs.worst.signalPct + '%' : 'n/a') + ')') : '—'],
      ['GPS-mapped points', cs.gps ? (cs.gps.count + ' (lat span ' + cs.gps.latSpan.toFixed(4) + ', lng span ' + cs.gps.lngSpan.toFixed(4) + ')') : '0']
    ];
    doc.table([{ title: 'Metric', frac: 2.2 }, { title: 'Value', frac: 1 }], statRows, {});
    doc.spacer(6);

    doc.text('Detailed Scan Report', { size: 13, bold: true });
    doc.hr({ color: [0.8, 0.8, 0.8] });
    const columns = [
      { title: 'Sr', frac: 0.4 },
      { title: 'Location', frac: 1.8 },
      { title: 'Date & Time', frac: 1.6 },
      { title: 'Net Type', frac: 1.0 },
      { title: 'Band', frac: 0.7 },
      { title: 'Ch', frac: 0.6 },
      { title: 'Security', frac: 1.1 },
      { title: 'Signal', frac: 0.8, align: 'right' },
      { title: 'Quality', frac: 1.0 },
      { title: 'Ping', frac: 0.7, align: 'right' },
      { title: 'Loss%', frac: 0.7, align: 'right' },
      { title: 'Verdict', frac: 0.9 }
    ];
    const rows = sel.map((s, i) => [
      String(i + 1),
      s.locationName || 'Unnamed',
      s.timestamp ? new Date(s.timestamp).toLocaleString() : '-',
      s.networkType || 'Unknown',
      s.band || '-',
      s.channel || '-',
      (s.security || '-'),
      typeof s.signalPct === 'number' ? s.signalPct + '%' : '-',
      qualityOf(s.signalPct).label,
      typeof s.ping === 'number' ? String(s.ping) : '-',
      typeof s.packetLoss === 'number' ? String(s.packetLoss) : '-',
      grades[i].grade
    ]);
    doc.table(columns, rows, { maxLines: 3 });
    doc.spacer(8);

    doc.text('Per-Location Details', { size: 13, bold: true });
    doc.hr({ color: [0.8, 0.8, 0.8] });
    sel.forEach((s, i) => {
      doc.text((i + 1) + '. ' + (s.locationName || 'Unnamed') + '   [' + grades[i].grade + ']', { size: 11, bold: true, color: gradeColor(grades[i].grade), gap: 2 });
      const lines = [
        'SSID: ' + (s.ssid || 'n/a') + '   BSSID: ' + (s.bssid || '-') + '   Band: ' + (s.band || '-') + '   Channel: ' + (s.channel || '-'),
        'Security: ' + (s.security || '-') + '   Link Tx/Rx: ' + (typeof s.linkTx === 'number' ? s.linkTx : '-') + '/' + (typeof s.linkRx === 'number' ? s.linkRx : '-') + ' Mbps',
        'Ping: ' + (typeof s.ping === 'number' ? s.ping + ' ms' : '-') + '   Jitter: ' + (typeof s.jitter === 'number' ? s.jitter + ' ms' : '-') + '   Packet loss: ' + (typeof s.packetLoss === 'number' ? s.packetLoss + '%' : '-'),
        'Internet throughput (informational): Down ' + (typeof s.download === 'number' ? s.download.toFixed(1) : '-') + ' / Up ' + (typeof s.upload === 'number' ? s.upload.toFixed(1) : '-') + ' Mbps',
        'Distance (est.): ' + (typeof s.distanceM === 'number' ? s.distanceM.toFixed(1) : '-') + ' m   GPS: ' + ((typeof s.lat === 'number' && typeof s.lng === 'number') ? s.lat + ', ' + s.lng : 'n/a'),
        'Notes: ' + (s.notes || '-')
      ];
      lines.forEach(l => doc.text(l, { size: 9, gap: 1 }));
      doc.spacer(5);
    });

    doc.text('Findings & Recommendations', { size: 13, bold: true });
    doc.hr({ color: [0.8, 0.8, 0.8] });
    let anyRec = false;
    sel.forEach((s, i) => {
      const g = grades[i];
      if (g.reasons.length) {
        anyRec = true;
        doc.text((s.locationName || 'Unnamed') + ':', { size: 10, bold: true, gap: 1 });
        g.reasons.forEach(r => doc.text('   - ' + r, { size: 9.5, gap: 1 }));
        doc.spacer(3);
      }
    });
    if (!anyRec) doc.text('No critical issues detected across the selected locations.', { size: 10, gap: 2 });

    const cv = drawHeatmapCanvas(520, 320, sel);
    if (cv) {
      doc.spacer(8);
      doc.text('Coverage Heatmap', { size: 13, bold: true });
      doc.hr({ color: [0.8, 0.8, 0.8] });
      const avail = W - MARGIN * 2;
      const h = 320 * (avail / 520);
      const bytes = b64ToBytes(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
      doc.image(bytes, MARGIN, h, avail, h, cv.width, cv.height);
      doc.text('Figure: Signal strength heatmap across surveyed GPS points (red = weak, green = strong).', { size: 9, color: [0.45, 0.45, 0.5] });
    }

    const pdf = doc.build();
    return new Blob([PdfBuilder.toBytes(pdf)], { type: 'application/pdf' });
  }

  // ---------- UI rendering ----------
  function load() {
    fetch('/api/surveys').then(r => r.json()).then(d => {
      surveys = Array.isArray(d) ? d : (d.surveys || []);
      const net = new Set(surveys.map(s => s.networkType || 'Unknown'));
      const sel = $('#repNetFilter');
      sel.innerHTML = '<option value="">All network types</option>' + Array.from(net).map(t => '<option value="' + t + '">' + t + '</option>').join('');
      filtered = surveys.slice();
      render();
    }).catch(err => {
      $('#repList').innerHTML = '<div class="muted">Failed to load surveys: ' + err.message + '</div>';
    });

    const b = readBranding();
    if (b.client) $('#repClient').value = b.client;
    if (b.site) $('#repSite').value = b.site;
    if (b.preparedBy) $('#repPreparedBy').value = b.preparedBy;
    if (b.reportId) $('#repReportId').value = b.reportId;
  }

  function applyFilters() {
    const q = $('#repSearch').value.trim().toLowerCase();
    const net = $('#repNetFilter').value;
    const date = $('#repDateFilter').value;
    const qual = $('#repQualFilter').value;
    let cutoff = null;
    if (date === 'today') cutoff = new Date().toISOString().slice(0, 10);
    else if (date === '7' || date === '30') {
      const d = new Date(); d.setDate(d.getDate() - parseInt(date, 10));
      cutoff = d.toISOString().slice(0, 10);
    }
    filtered = surveys.filter(s => {
      if (net && (s.networkType || 'Unknown') !== net) return false;
      if (cutoff) { const d = (s.timestamp || '').slice(0, 10); if (date === 'today' ? d !== cutoff : d < cutoff) return false; }
      if (qual && qualityOf(s.signalPct).label !== qual) return false;
      if (q) {
        const hay = ((s.locationName || '') + ' ' + (s.ssid || '') + ' ' + (s.networkType || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    render();
  }

  function rowHtml(s, idx) {
    const q = qualityOf(s.signalPct);
    const sel = selected.has(s._id) ? ' checked' : '';
    return '<label class="hist-row' + (sel ? ' sel' : '') + '">' +
      '<input type="checkbox" class="rep-chk" data-id="' + s._id + '"' + sel + '>' +
      '<span class="hist-dot" style="background:' + q.color + '"></span>' +
      '<span class="hist-main"><strong>' + (s.locationName || 'Unnamed') + '</strong>' +
      '<small>' + (s.ssid || 'n/a') + ' &middot; ' + (s.networkType || 'Unknown') + ' &middot; ' + (s.band || '') + '</small></span>' +
      '<span class="hist-meta"><span class="chip" style="background:' + q.color + '22;color:' + q.color + ';border-color:' + q.color + '55">' + q.label + '</span>' +
      '<small>' + (typeof s.signalPct === 'number' ? s.signalPct + '%' : '—') + ' &middot; ' + (s.timestamp ? new Date(s.timestamp).toLocaleDateString() : '') + '</small></span>' +
      '</label>';
  }

  function render() {
    const list = $('#repList');
    if (!filtered.length) { list.innerHTML = '<div class="muted">No survey scans match the filters.</div>'; }
    else {
      list.innerHTML = filtered.map((s, i) => rowHtml(s, i)).join('');
      list.querySelectorAll('.rep-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const id = chk.getAttribute('data-id');
          if (chk.checked) selected.add(id); else selected.delete(id);
          chk.closest('.hist-row').classList.toggle('sel', chk.checked);
          updateCount();
        });
      });
    }
    updateCount();
  }

  function updateCount() {
    $('#repCount').textContent = selected.size + ' of ' + filtered.length + ' selected';
    $('#btnGenerateReport').disabled = selected.size === 0;
  }

  function selectAllVisible() {
    filtered.forEach(s => selected.add(s._id));
    render();
  }
  function deselectAll() {
    selected.clear();
    render();
  }

  function generate() {
    if (!selected.size) return;
    const branding = collectBranding();
    const sel = surveys.filter(s => selected.has(s._id));
    const btn = $('#btnGenerateReport');
    btn.disabled = true; btn.textContent = 'Generating…';
    setTimeout(() => {
      try {
        const blob = buildPdf(sel, branding);
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        showReportModal(blob, 'netplus-report-' + ts + '.pdf');
      } catch (e) {
        alert('Report generation failed: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Generate PDF';
        updateCount();
      }
    }, 30);
  }

  function showReportModal(blob, filename) {
    const url = URL.createObjectURL(blob);
    $('#repPreviewFrame').src = url;
    const dl = $('#repDownload');
    dl.href = url; dl.download = filename;
    dl.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 4000);
    const sh = $('#repShare');
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'application/pdf' })] })) {
      sh.style.display = '';
      sh.onclick = () => {
        const f = new File([blob], filename, { type: 'application/pdf' });
        navigator.share({ files: [f], title: 'NetPlus AI Survey Report' }).catch(() => {});
      };
    } else { sh.style.display = 'none'; }
    openModal('reportModal');
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.style.display = 'flex';
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.style.display = 'none';
  }

  function bind() {
    $('#repSearch').addEventListener('input', applyFilters);
    $('#repNetFilter').addEventListener('change', applyFilters);
    $('#repDateFilter').addEventListener('change', applyFilters);
    $('#repQualFilter').addEventListener('change', applyFilters);
    $('#btnSelectAll').addEventListener('click', selectAllVisible);
    $('#btnDeselect').addEventListener('click', deselectAll);
    $('#btnGenerateReport').addEventListener('click', generate);
    const modal = document.getElementById('reportModal');
    if (modal) {
      modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.getAttribute('data-close'))));
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal('reportModal'); });
    }
    ['repClient', 'repSite', 'repPreparedBy', 'repReportId'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        const b = readBranding();
        b.client = $('#repClient').value.trim();
        b.site = $('#repSite').value.trim();
        b.preparedBy = $('#repPreparedBy').value.trim();
        b.reportId = $('#repReportId').value.trim();
        saveBranding(b);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); load(); });
  else { bind(); load(); }
})();
