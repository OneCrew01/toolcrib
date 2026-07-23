// Minimal PDF 1.4 writer — zero dependencies, Helvetica only, text plus
// simple rules and boxes, multipage. Ugly is acceptable; a file that opens in
// any standard viewer with every section populated is the contract.
//
// Determinism matters here: render() output is a pure function of the calls
// made, so package hashes stay stable across rebuilds of the same job.

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Helvetica metrics, approximated: good enough for wrapping, not typesetting.
const CHAR_W = 0.52;
const textWidth = (s, size) => s.length * size * CHAR_W;

// Common typographic chars that sit above 0xFF get readable ASCII stand-ins;
// anything else out of range becomes "?" — replaced, never silently dropped.
const FALLBACK = { "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "→": "->", "≤": "<=", "≥": ">=", "×": "x" };

// PDF string escaping into WinAnsi-safe bytes.
function esc(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (FALLBACK[ch]) out += FALLBACK[ch];
    else if (c > 0xff) out += "?";
    else if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}

function wrapText(s, size, maxWidth) {
  const words = String(s).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines = [];
  let line = "";
  for (let w of words) {
    // hard-split pathological words (hashes, URLs) that alone exceed a line
    while (textWidth(w, size) > maxWidth) {
      const cut = Math.max(1, Math.floor(maxWidth / (size * CHAR_W)) - 1);
      if (line) { lines.push(line); line = ""; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const cand = line ? `${line} ${w}` : w;
    if (textWidth(cand, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = cand;
  }
  if (line) lines.push(line);
  return lines;
}

export function createPdf() {
  const pages = []; // each: array of content-stream op strings
  let ops = null;
  let y = 0;

  function newPage() {
    ops = [];
    pages.push(ops);
    y = PAGE_H - MARGIN;
  }
  function ensure(h) {
    if (!ops || y - h < MARGIN) newPage();
  }
  function putText(str, x, size, bold) {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(str)}) Tj ET`);
  }

  const doc = {
    heading(t) {
      ensure(40);
      y -= 8;
      putText(t, MARGIN, 15, true);
      y -= 20;
      return doc;
    },
    subheading(t) {
      ensure(30);
      y -= 6;
      putText(t, MARGIN, 11.5, true);
      y -= 15;
      return doc;
    },
    text(t, { size = 10, bold = false, indent = 0 } = {}) {
      const lh = size + 3.5;
      for (const line of wrapText(t, size, CONTENT_W - indent)) {
        ensure(lh);
        putText(line, MARGIN + indent, size, bold);
        y -= lh;
      }
      return doc;
    },
    /** Key on the left in bold, wrapped value in a right-hand column. */
    kv(k, v, { col = 150 } = {}) {
      const size = 10, lh = size + 3.5;
      const lines = wrapText(String(v), size, CONTENT_W - col);
      ensure(lh * lines.length);
      putText(String(k), MARGIN, size, true);
      for (const line of lines) {
        putText(line, MARGIN + col, size, false);
        y -= lh;
      }
      return doc;
    },
    /**
     * Fixed-column table; widths are fractions of the content width. First
     * row renders bold. Overlong cells are truncated with a trailing "..".
     */
    table(rows, widths) {
      const size = 9, lh = 13;
      const w = widths.map((f) => f * CONTENT_W);
      rows.forEach((row, ri) => {
        ensure(lh);
        let x = MARGIN;
        row.forEach((cell, ci) => {
          let s = String(cell ?? "");
          const maxChars = Math.floor((w[ci] - 6) / (size * CHAR_W));
          if (s.length > maxChars) s = s.slice(0, Math.max(0, maxChars - 2)) + "..";
          putText(s, x, size, ri === 0);
          x += w[ci];
        });
        y -= lh;
      });
      return doc;
    },
    rule() {
      ensure(10);
      ops.push(`q 0.6 w ${MARGIN} ${(y + 3).toFixed(2)} m ${PAGE_W - MARGIN} ${(y + 3).toFixed(2)} l S Q`);
      y -= 8;
      return doc;
    },
    /** Unfilled checkbox followed by wrapped text — checklist line. */
    check(t) {
      const size = 10, lh = size + 4;
      const lines = wrapText(t, size, CONTENT_W - 18);
      ensure(lh * lines.length);
      ops.push(`q 0.7 w ${MARGIN} ${(y - 1).toFixed(2)} 8 8 re S Q`);
      for (const line of lines) {
        putText(line, MARGIN + 18, size, false);
        y -= lh;
      }
      return doc;
    },
    space(pt = 8) {
      ensure(pt);
      y -= pt;
      return doc;
    },
    pageBreak() {
      newPage();
      return doc;
    },

    /** Serialize: header, objects, xref with exact byte offsets, trailer. */
    render() {
      if (pages.length === 0) newPage();
      const chunks = [];
      let offset = 0;
      const offsets = [];
      const push = (s) => {
        const b = Buffer.from(s, "latin1");
        chunks.push(b);
        offset += b.length;
      };
      const obj = (n, body) => {
        offsets[n] = offset;
        push(`${n} 0 obj\n${body}\nendobj\n`);
      };

      push("%PDF-1.4\n");
      // objects 1-4 fixed; page i -> obj 5+2i, its content stream -> 6+2i
      const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ");
      obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
      obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
      obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      pages.forEach((pageOps, i) => {
        const pn = 5 + 2 * i;
        obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pn + 1} 0 R >>`);
        const stream = pageOps.join("\n");
        obj(pn + 1, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      });

      const count = 4 + 2 * pages.length;
      const xrefAt = offset;
      push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
      for (let n = 1; n <= count; n++)
        push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
      push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
      return Buffer.concat(chunks);
    },
  };

  return doc;
}
