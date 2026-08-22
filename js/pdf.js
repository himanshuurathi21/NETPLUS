/*
 * NetPlus AI - Minimal self-contained PDF generator (no external packages).
 * Builds a valid PDF 1.4 document with Helvetica / Helvetica-Bold,
 * flowing layout (text, rules, tables with pagination) and page numbers,
 * plus JPEG image embedding for the coverage heatmap.
 *
 *   const doc = new PdfBuilder();
 *   doc.text('Hello', { size: 14, bold: true });
 *   doc.table(columns, rows, {});
 *   doc.image(jpegBytes, x, y, w, h, pw, ph);   // JPEG (Uint8Array)
 *   const str = doc.build();                    // latin1-safe string
 *   const bytes = PdfBuilder.toBytes(str);
 */
(function (global) {
  'use strict';

  const PW = 841.89;   // A4 width  (landscape, points)
  const PH = 595.28;   // A4 height (landscape, points)
  const MARGIN = 42;
  const FOOT_ROOM = 34;

  // Helvetica AFM glyph widths (units / 1000 em), ASCII 32..126
  const GLYPH_W = [278,278,355,556,556,889,722,222,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,556,556,556,556,556,556,556,556,556,556,556,556,611,556,556,556,556,556,556,500,556,611,278,278,611,278,334,260,334,584];

  function widthOf(code) {
    if (code >= 32 && code <= 126) return GLYPH_W[code - 32];
    return 500;
  }
  function textWidth(str, size) {
    let w = 0;
    for (let i = 0; i < str.length; i++) w += widthOf(str.charCodeAt(i));
    return w / 1000 * size;
  }
  function bytesToLatin1(arr) {
    let s = '';
    const chunk = 8192;
    for (let i = 0; i < arr.length; i += chunk) {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return s;
  }

  function sanitize(s) {
    s = String(s == null ? '' : s);
    return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }
  function esc(s) {
    return sanitize(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  function n(v) { return Math.round(v * 100) / 100; }

  // Word/char wrap based on measured text width.
  function wrap(text, size, maxW) {
    text = sanitize(text);
    maxW = maxW - 2; // small safety margin so real-font metrics cannot spill
    if (maxW < 6) maxW = 6;
    if (textWidth(text, size) <= maxW) return [text];
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) { cur = w; continue; }
      if (textWidth(cur + ' ' + w, size) <= maxW) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const out = [];
    for (const l of lines) {
      if (textWidth(l, size) <= maxW) { out.push(l); continue; }
      let part = '';
      for (const ch of l) {
        if (textWidth(part + ch, size) <= maxW) part += ch;
        else { out.push(part); part = ch; }
      }
      if (part) out.push(part);
    }
    return out;
  }

  function PdfBuilder() {
    this.pages = [];
    this.imageDefs = [];
    this.pageNo = 0;
    this.newPage();
  }

  PdfBuilder.prototype.newPage = function () {
    this.pageNo++;
    this.page = { ops: [], no: this.pageNo };
    this.pages.push(this.page);
    this.y = PH - MARGIN;
  };

  PdfBuilder.prototype.ensure = function (h) {
    if (this.y - h < MARGIN + FOOT_ROOM) {
      this.finishPage();
      this.newPage();
    }
  };

  PdfBuilder.prototype.finishPage = function () {
    const p = this.page;
    const fy = MARGIN - 8;
    p.ops.push('q 0.55 0.55 0.6 rg BT /F1 9 Tf ' + MARGIN + ' ' + fy + ' Td (' + esc('NetPlus AI  -  Network Survey Report') + ') Tj ET Q');
    const pg = 'Page ' + p.no;
    p.ops.push('q 0.55 0.55 0.6 rg BT /F1 9 Tf ' + (PW - MARGIN - 46) + ' ' + fy + ' Td (' + esc(pg) + ') Tj ET Q');
    p.ops.push('q 0.85 0.85 0.85 RG 0.5 w ' + MARGIN + ' ' + (fy + 9) + ' m ' + (PW - MARGIN) + ' ' + (fy + 9) + ' l S Q');
  };

  PdfBuilder.prototype.text = function (str, opts) {
    opts = opts || {};
    const size = opts.size || 10;
    const x = opts.x != null ? opts.x : MARGIN;
    const maxW = opts.maxW != null ? opts.maxW : (PW - MARGIN - x);
    const lh = size * 1.32;
    const color = opts.color || [0, 0, 0];
    const lines = wrap(str, size, maxW);
    for (const ln of lines) {
      this.ensure(lh);
      const baseY = this.y - size;
      this.page.ops.push('q ' + n(color[0]) + ' ' + n(color[1]) + ' ' + n(color[2]) + ' rg BT /' + (opts.bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + n(x) + ' ' + n(baseY) + ' Td (' + esc(ln) + ') Tj ET Q');
      this.y -= lh;
    }
    if (opts.gap) this.y -= opts.gap;
  };

  PdfBuilder.prototype.spacer = function (h) { this.y -= (h || 6); };

  PdfBuilder.prototype.hr = function (opts) {
    opts = opts || {};
    const y = opts.y != null ? opts.y : (this.y - 4);
    const color = opts.color || [0.85, 0.85, 0.85];
    const x0 = opts.x0 != null ? opts.x0 : MARGIN;
    const x1 = opts.x1 != null ? opts.x1 : (PW - MARGIN);
    this.ensure(6);
    this.page.ops.push('q ' + n(color[0]) + ' ' + n(color[1]) + ' ' + n(color[2]) + ' RG ' + (opts.w || 0.5) + ' w ' + n(x0) + ' ' + n(y) + ' m ' + n(x1) + ' ' + n(y) + ' l S Q');
    if (opts.consume !== false) this.y = y - 6;
  };

  PdfBuilder.prototype.rect = function (x, y, w, h, color) {
    this.page.ops.push('q ' + n(color[0]) + ' ' + n(color[1]) + ' ' + n(color[2]) + ' rg ' + n(x) + ' ' + n(y) + ' ' + n(w) + ' ' + n(h) + ' re f Q');
  };

  PdfBuilder.prototype.image = function (bytes, x, y, w, h, pw, ph) {
    this.ensure(h + 6);
    const idx = this.imageDefs.length;
    this.imageDefs.push({ bytes: bytes, pw: pw, ph: ph });
    this.page.ops.push('q ' + n(w) + ' 0 0 ' + n(h) + ' ' + n(x) + ' ' + n(this.y - h) + ' cm IMG' + idx + ' Do Q');
    this.y -= (h + 6);
  };

  /*
   * columns: [{ title, frac, align }]   (frac = relative width)
   * rows:    [[cell, cell, ...], ...]
   * opts:    { maxLines, fontSize, headSize }
   */
  PdfBuilder.prototype.table = function (columns, rows, opts) {
    opts = opts || {};
    const size = opts.fontSize || 8.5;
    const headSize = opts.headSize || 9;
    const pad = 5, topPad = 4;
    const lineH = size * 1.32, headLineH = headSize * 1.32;
    const avail = PW - MARGIN * 2;
    let totalFrac = 0;
    columns.forEach(c => { totalFrac += (c.frac || 1); });
    const widths = columns.map(c => avail * (c.frac || 1) / totalFrac);
    const inner = (w) => Math.max(12, w - pad * 2);
    const cap = opts.maxLines || 3;

    const fit = (val, sz, mw) => {
      let lines = wrap(val == null ? '' : val, sz, inner(mw));
      if (lines.length > cap) {
        const keep = lines.slice(0, cap - 1);
        let last = lines[cap - 1];
        while (last.length > 1 && textWidth(last + '…', sz) > inner(mw)) last = last.slice(0, -1);
        keep.push(last + '…');
        lines = keep;
      }
      return lines;
    };

    const colX = [];
    { let off = 0; for (const w of widths) { colX.push(off); off += w; } }

    const drawHeader = () => {
      let headLines = 1;
      const head = columns.map((c, i) => { const l = fit(c.title, headSize, widths[i]); headLines = Math.max(headLines, l.length); return l; });
      const hh = headLines * headLineH + topPad * 2;
      this.rect(MARGIN, this.y - hh, avail, hh, [0.13, 0.27, 0.55]);
      columns.forEach((c, i) => {
        const cx = MARGIN + colX[i];
        head[i].forEach((ln, li) => {
          const ty = this.y - topPad - headSize * 0.8 - li * headLineH;
          this.page.ops.push('q ' + n(cx) + ' ' + n(this.y - hh) + ' ' + n(widths[i]) + ' ' + n(hh) + ' re W n 1 1 1 rg BT /F2 ' + headSize + ' Tf ' + n(cx + pad) + ' ' + n(ty) + ' Td (' + esc(ln) + ') Tj ET Q');
        });
      });
      this.y -= hh;
    };

    const drawRow = (r) => {
      const content = columns.map((c, i) => fit(r[i] == null ? '' : r[i], size, widths[i]));
      let maxLines = 1;
      content.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
      const rh = maxLines * lineH + topPad * 2;
      const rowIndex = r.__ri;
      if (rowIndex % 2 === 1) this.rect(MARGIN, this.y - rh, avail, rh, [0.96, 0.97, 0.99]);
      columns.forEach((c, i) => {
        const align = c.align || 'left';
        const cx = MARGIN + colX[i];
        content[i].forEach((ln, li) => {
          let tx = cx + pad;
          const tw = textWidth(ln, size);
          if (align === 'right') tx = cx + widths[i] - pad - tw;
          else if (align === 'center') tx = cx + (widths[i] - tw) / 2;
          const ty = this.y - topPad - size * 0.8 - li * lineH;
          this.page.ops.push('q ' + n(cx) + ' ' + n(this.y - rh) + ' ' + n(widths[i]) + ' ' + n(rh) + ' re W n 0.13 0.13 0.2 rg BT /F1 ' + size + ' Tf ' + n(tx) + ' ' + n(ty) + ' Td (' + esc(ln) + ') Tj ET Q');
        });
      });
      this.page.ops.push('q 0.85 0.85 0.85 RG 0.4 w ' + n(MARGIN) + ' ' + n(this.y - rh) + ' m ' + n(PW - MARGIN) + ' ' + n(this.y - rh) + ' l S Q');
      this.y -= rh;
    };

    this.ensure(40);
    drawHeader();
    rows.forEach((r, ri) => {
      r.__ri = ri;
      const content = columns.map((c, i) => fit(r[i] == null ? '' : r[i], size, widths[i]));
      let maxLines = 1;
      content.forEach(l => { if (l.length > maxLines) maxLines = l.length; });
      const rh = maxLines * lineH + topPad * 2;
      if (this.y - rh < MARGIN + FOOT_ROOM) { this.finishPage(); this.newPage(); drawHeader(); }
      drawRow(r);
    });
    this.page.ops.push('q 0.85 0.85 0.85 RG 0.4 w ' + n(MARGIN) + ' ' + n(this.y) + ' m ' + n(PW - MARGIN) + ' ' + n(this.y) + ' l S Q');
  };

  PdfBuilder.prototype.build = function () {
    this.finishPage();
    const objs = {};
    let nextId = 5;
    const pageIds = [], contentIds = [];
    this.pages.forEach(() => { pageIds.push(nextId++); contentIds.push(nextId++); });
    const imgIds = [];
    for (let i = 0; i < this.imageDefs.length; i++) imgIds.push(nextId++);

    const contentStrings = this.pages.map((p) => {
      let s = p.ops.join('\n');
      this.imageDefs.forEach((_, idx) => { s = s.split('IMG' + idx).join(String(imgIds[idx])); });
      return s;
    });

    const xobj = this.imageDefs.length
      ? ' /XObject << ' + this.imageDefs.map((_, idx) => '/IMG' + idx + ' ' + imgIds[idx] + ' 0 R').join(' ') + ' >>'
      : '';

    this.pages.forEach((p, i) => {
      objs[pageIds[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xobj + ' >> /Contents ' + contentIds[i] + ' 0 R >>';
      objs[contentIds[i]] = '<< /Length ' + contentStrings[i].length + ' >>\nstream\n' + contentStrings[i] + '\nendstream';
    });

    this.imageDefs.forEach((def, i) => {
      objs[imgIds[i]] = '<< /Type /XObject /Subtype /Image /Width ' + def.pw + ' /Height ' + def.ph + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + def.bytes.length + ' >>\nstream\n' + bytesToLatin1(def.bytes) + '\nendstream';
    });

    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + this.pages.length + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    const ids = Object.keys(objs).map(Number).sort((a, b) => a - b);
    let pdf = '%PDF-1.4\n';
    const offsets = {};
    ids.forEach(id => {
      offsets[id] = pdf.length;
      pdf += id + ' 0 obj\n' + objs[id] + '\nendobj\n';
    });
    const xrefPos = pdf.length;
    pdf += 'xref\n0 ' + (ids.length + 1) + '\n0000000000 65535 f \n';
    ids.forEach(id => {
      pdf += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    });
    pdf += 'trailer\n<< /Size ' + (ids.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    return pdf;
  };

  PdfBuilder.toBytes = function (str) {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
    return arr;
  };

  PdfBuilder._textWidth = textWidth; // (test/debug helper)

  global.PdfBuilder = PdfBuilder;
})(window);
