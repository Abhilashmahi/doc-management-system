// Reads the text lines of a PDF page from the pieces PDF.js returns. Used by the PDF text editor and the Writer.

import { repairTamilOrder } from '../lib/bamini';

export interface Line {
  id: string;
  page: number;
  x: number; // PDF points, bottom-left origin
  y: number; // baseline
  w: number;
  size: number;
  text: string; // as readable text (Bamini converted)
  bamini: boolean; // printed with the old Bamini font, which looks larger than Noto at the same size
  runs: { text: string; bold: boolean }[]; // the text in pieces of bold and normal
}

export interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  bold?: boolean; // drawn bold (the Writer's PDF importer finds these)
}

// Groups PDF.js text pieces into lines (same baseline, close together), left to right.
export function buildLines(pageNo: number, items: RawItem[], decode: (s: string, font: string) => string): Line[] {
  const pieces = items
    .filter((it) => it.str.length > 0)
    .map((it) => ({ ...it, x: it.transform[4], y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; parts: typeof pieces }[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y - p.y) < Math.max(l.size, p.size) * 0.45);
    const last = line?.parts[line.parts.length - 1];
    // A big gap on the same baseline means a separate column (e.g. a label and its value far apart).
    if (line && last && p.x - (last.x + last.width) < Math.max(line.size, p.size) * 4) line.parts.push(p);
    else lines.push({ y: p.y, size: p.size, parts: [p] });
  }
  return lines
    .map((l, i) => {
      const parts = l.parts.sort((a, b) => a.x - b.x);
      let text = '';
      const runs: { text: string; bold: boolean }[] = [];
      parts.forEach((p, j) => {
        let piece = decode(p.str, p.fontName);
        const prev = parts[j - 1];
        if (prev && p.x - (prev.x + prev.width) > l.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(piece)) piece = ` ${piece}`;
        text += piece;
        const last = runs[runs.length - 1];
        if (last && last.bold === Boolean(p.bold)) last.text += piece;
        else runs.push({ text: piece, bold: Boolean(p.bold) });
      });
      // The same spacing as the plain text: single spaces, none at the ends.
      runs.forEach((r, k) => {
        r.text = repairTamilOrder(r.text.replace(/\s+/g, ' '));
        if (k === 0 || runs[k - 1].text.endsWith(' ')) r.text = r.text.replace(/^ /, '');
      });
      if (runs.length > 0) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ $/, '');
      const x = parts[0].x;
      const right = Math.max(...parts.map((p) => p.x + p.width));
      const bamini = parts.some((p) => decode(p.str, p.fontName) !== p.str);
      return { id: `p${pageNo}-l${i}`, page: pageNo, bamini, x, y: l.y, w: right - x, size: Math.round(Math.max(...parts.map((p) => p.size)) * 10) / 10, text: repairTamilOrder(text.replace(/\s+/g, ' ').trim()), runs: runs.filter((r) => r.text) };
    })
    .filter((l) => l.text.length > 0);
}
