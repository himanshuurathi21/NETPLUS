/* Layout / overlap checker for the report PDF. Builds a realistic report-like
 * document with the SAME structure pdf.js produces for NetPlus reports and
 * asserts that no two text bounding boxes overlap (no text spill/overlap). */
global.window = global;
require('../js/pdf.js');

function sampleRow(i) {
  return [
    String(i + 1),
    "Main Floor East Wing (near 'Server Room') with a very long descriptive location name that should wrap",
    "8/23/2026, 3:45:30 PM",
    "Wi-Fi",
    "2.4 GHz",
    "11",
    "WPA2-Enterprise",
    (20 + (i % 70)) + '%',
    (i % 4 === 0 ? 'Poor' : i % 3 === 0 ? 'Fair' : 'Good'),
    String(2 + i),
    String(i % 6),
    (i % 3 === 0 ? 'Fail' : 'Pass')
  ];
}

const doc = new PdfBuilder();
doc.text('NetPlus AI - Network Survey Report', { size: 18, bold: true });
doc.text('Wi-Fi Site Survey & Signal Coverage Assessment for a large industrial campus with many access points', { size: 11, gap: 2 });
doc.hr({ color: [0.13, 0.27, 0.55], w: 1.2 });
doc.text('Client / Company : Acme Industrial Ltd & Sons (Warehouse Division)', { size: 10, gap: 1 });
doc.text('Site Name        : Plant B - North Wing', { size: 10, gap: 1 });
doc.text('Prepared By      : R. Sharma', { size: 10, gap: 1 });
doc.text('Report ID        : NP-20260823-4821', { size: 10, gap: 6 });

doc.text('Executive Summary', { size: 13, bold: true });
doc.hr({ color: [0.8, 0.8, 0.8] });
doc.text('Overall Site Readiness : Warn', { size: 13, bold: true, color: [0.85, 0.6, 0.1], gap: 2 });
doc.text('Locations assessed : 15   |   Passed : 9   |   Warning : 4   |   Failed : 2', { size: 10, gap: 2 });
doc.text('This assessment is based on local Wi-Fi / LAN reliability (signal, packet loss, jitter, security) and not on internet throughput.', { size: 9, gap: 6 });

const statRows = [
  ['Total scanned locations', '15'],
  ['Excellent (75%+)', '3'],
  ['Good (50-74%)', '6'],
  ['Fair (25-49%)', '4'],
  ['Poor (<25%)', '2'],
  ['Dead zones (signal <25%)', '2'],
  ['Average ping (ms)', '12.4'],
  ['Average jitter (ms)', '8.1'],
  ['Average packet loss (%)', '1.2'],
  ['Worst location', 'Boiler Room (18%)'],
  ['GPS-mapped points', '12 (lat span 0.0123, lng span 0.0098)']
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
const rows = [];
for (let i = 0; i < 15; i++) rows.push(sampleRow(i));
doc.table(columns, rows, { maxLines: 3 });
doc.spacer(8);

doc.text('Per-Location Details', { size: 13, bold: true });
doc.hr({ color: [0.8, 0.8, 0.8] });
for (let i = 0; i < 15; i++) {
  doc.text((i + 1) + '. Location ' + i + '   [Pass]', { size: 11, bold: true, gap: 2 });
  doc.text('SSID: CorpNet_5G   BSSID: AA:BB:CC:DD:EE:FF   Band: 5 GHz   Channel: 36', { size: 9, gap: 1 });
  doc.text('Security: WPA2-Enterprise   Link Tx/Rx: 866/780 Mbps', { size: 9, gap: 1 });
  doc.text('Ping: 4 ms   Jitter: 2 ms   Packet loss: 0%', { size: 9, gap: 1 });
  doc.text('Internet throughput (informational): Down 312.4 / Up 148.2 Mbps', { size: 9, gap: 1 });
  doc.text('Distance (est.): 12.3 m   GPS: 28.6134, 77.2090', { size: 9, gap: 1 });
  doc.text('Notes: None', { size: 9, gap: 5 });
}

doc.text('Findings & Recommendations', { size: 13, bold: true });
doc.hr({ color: [0.8, 0.8, 0.8] });
for (let i = 0; i < 15; i++) {
  doc.text('Location ' + i + ':', { size: 10, bold: true, gap: 1 });
  doc.text('   - Critical weak signal (18%) - install or relocate an access point / repeater', { size: 9.5, gap: 1 });
  doc.text('   - High packet loss (3%) - inspect switch, cabling or backhaul link', { size: 9.5, gap: 3 });
}

// ---- extract text boxes from every page ----
function extractBoxes(page) {
  const boxes = [];
  const re = /\/F[12] ([0-9.]+) Tf (-?[0-9.]+) (-?[0-9.]+) Td \((.*?)\) Tj/;
  for (const op of page.ops) {
    const work = op.replace(/\\\(/g, '(').replace(/\\\)/g, ')');
    const m = re.exec(work);
    if (m) {
      const size = parseFloat(m[1]);
      const x = parseFloat(m[2]);
      const y = parseFloat(m[3]);
      const text = m[4];
      const w = PdfBuilder._textWidth(text, size);
      boxes.push({ x: x, y: y, w: w, h: size, text: text, size: size });
    }
  }
  return boxes;
}

function overlaps(a, b) {
  const ax0 = a.x, ax1 = a.x + a.w, ay0 = a.y - 0.72 * a.h, ay1 = a.y;
  const bx0 = b.x, bx1 = b.x + b.w, by0 = b.y - 0.72 * b.h, by1 = b.y;
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

let pageNo = 0, total = 0, bad = 0;
for (const page of doc.pages) {
  pageNo++;
  const boxes = extractBoxes(page);
  total += boxes.length;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) {
        bad++;
        if (bad <= 20) console.error('OVERLAP p' + pageNo + ':\n  A [' + boxes[i].text + '] @(' + boxes[i].x.toFixed(1) + ',' + boxes[i].y.toFixed(1) + ') w=' + boxes[i].w.toFixed(1) + '\n  B [' + boxes[j].text + '] @(' + boxes[j].x.toFixed(1) + ',' + boxes[j].y.toFixed(1) + ') w=' + boxes[j].w.toFixed(1));
      }
    }
  }
}
console.log('pages=' + pageNo + ' textBoxes=' + total + ' overlaps=' + bad);
const fs = require('fs');
try {
  const out = 'C:\\Users\\HP\\AppData\\Local\\Temp\\opencode\\sample_report.pdf';
  fs.writeFileSync(out, PdfBuilder.toBytes(doc.build()));
  console.log('sample PDF written -> ' + out);
} catch (e) { /* ignore */ }
if (bad > 0) { console.error('FAIL: ' + bad + ' overlapping text boxes'); process.exit(1); }
console.log('LAYOUT OK: no overlapping text boxes');
