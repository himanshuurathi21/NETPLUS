/* Node validation for pdf.js - no external packages. */
global.window = global;
require('../js/pdf.js');
const W = 520, H = 320;

const doc = new PdfBuilder();
doc.text('NetPlus AI - Network Survey Report', { size: 18, bold: true });
doc.text('Wi-Fi Site Survey & Signal Coverage Assessment', { size: 11, color: [0.4, 0.4, 0.5], gap: 2 });
doc.hr({ color: [0.13, 0.27, 0.55], w: 1.2 });
doc.text('Client / Company : Acme Industrial Ltd', { size: 10, gap: 1 });
doc.text('Site Name        : Plant B', { size: 10, gap: 1 });

// long wrapping text that previously overlapped
for (let i = 0; i < 40; i++) {
  doc.text('Location ' + i + ' - a fairly long note that must wrap cleanly inside the column width without spilling into the next row or overlapping neighbouring text', { size: 10 });
}

// wide table with wrapped cells (overlap regression)
const cols = [
  { title: 'Sr', frac: 0.4 },
  { title: 'Location', frac: 1.8 },
  { title: 'Security', frac: 1.1, align: 'right' },
  { title: 'Verdict', frac: 0.9 }
];
const rows = [];
for (let i = 0; i < 50; i++) {
  rows.push([String(i + 1), 'Main Floor East Wing with very long descriptive name that wraps to multiple lines', 'WPA2-Enterprise with extra long trailing text', i % 3 === 0 ? 'Fail' : 'Pass']);
}
doc.table(cols, rows, { maxLines: 3 });

// embedded image (fake RGB buffer acting as JPEG payload)
const fake = new Uint8Array(W * H * 3);
for (let i = 0; i < fake.length; i++) fake[i] = (i * 7) & 0xff;
doc.image(fake, 40, 300, 400, 260, W, H);
doc.text('Figure: Coverage heatmap.', { size: 9 });

const str = doc.build();
const bytes = PdfBuilder.toBytes(str);

function fail(m) { console.error('FAIL:', m); process.exit(1); }

if (!str.startsWith('%PDF-1.4')) fail('bad header');
if (str.indexOf('%%EOF') === -1) fail('missing EOF');

const sx = str.lastIndexOf('startxref');
const off = parseInt(str.slice(sx).split('\n')[1], 10);
if (str.substr(off, 4) !== 'xref') fail('startxref does not point to xref (got ' + JSON.stringify(str.substr(off, 8)) + ')');

// validate every stream length field matches actual bytes between stream\n and \nendstream
const re = / \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
let m, count = 0;
while ((m = re.exec(str))) {
  count++;
  const len = parseInt(m[1], 10);
  if (m[2].length !== len) fail('stream length mismatch: declared ' + len + ' actual ' + m[2].length);
}
if (count < 2) fail('expected multiple streams, got ' + count);
if (str.indexOf('/Subtype /Image') === -1) fail('image object missing');
if (str.indexOf('/Filter /DCTDecode') === -1) fail('DCTDecode missing');
if (str.indexOf('/IMG0') === -1) fail('XObject /IMG0 missing from Resources');
if (str.indexOf(' Do') === -1) fail('image draw op missing');

// page count
const pages = (str.match(/\/Type \/Page /g) || []).length;
if (pages < 3) fail('expected pagination (>2 pages), got ' + pages);

// xref offsets resolve to 'N 0 obj'
const xrefStart = str.indexOf('xref\n');
const after = str.indexOf('trailer', xrefStart);
const xrefBlock = str.slice(xrefStart, after);
const offRe = /\n(\d{10}) \d{5} n /g;
let xm, resolved = 0;
while ((xm = offRe.exec(xrefBlock))) {
  const o = parseInt(xm[1], 10);
  if (str.substr(o, 12).indexOf(' 0 obj') === -1) fail('xref offset ' + o + ' does not point to obj: ' + JSON.stringify(str.substr(o, 12)));
  resolved++;
}
if (resolved < 5) fail('too few resolved xref entries: ' + resolved);

console.log('pdf.js OK -> pages=' + pages + ' streams=' + count + ' bytes=' + bytes.length + ' xrefEntries=' + resolved);
