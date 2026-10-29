import 'regenerator-runtime/runtime.js'; // the font shaper used for Tamil expects this helper to exist
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// Builds simple, searchable PDFs from text and tables (used for TXT, Word-without-LibreOffice and CSV/Excel).
// Text is set in Noto Sans, and Tamil letters automatically switch to Noto Sans Tamil, so both scripts print correctly.

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 50;

interface Fonts {
  latin: PDFFont;
  latinBold: PDFFont;
  tamil: PDFFont;
  tamilBold: PDFFont;
}

let fontBytes: Promise<Record<keyof Fonts, Buffer>> | null = null;
function loadFontBytes() {
  fontBytes ??= Promise.all([
    readFile(path.join(FONT_DIR, 'NotoSans-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'NotoSans-Bold.ttf')),
    readFile(path.join(FONT_DIR, 'NotoSansTamil-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'NotoSansTamil-Bold.ttf')),
  ]).then(([latin, latinBold, tamil, tamilBold]) => ({ latin, latinBold, tamil, tamilBold }));
  return fontBytes;
}

// Adds the Noto fonts (English and Tamil) to a PDF, new or existing.
export async function embedNotoFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  return {
    latin: await pdf.embedFont(bytes.latin, { subset: true }),
    latinBold: await pdf.embedFont(bytes.latinBold, { subset: true }),
    tamil: await pdf.embedFont(bytes.tamil, { subset: true }),
    tamilBold: await pdf.embedFont(bytes.tamilBold, { subset: true }),
  };
}

async function setup(title: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('e-Sevai Document Manager');
  const fonts = await embedNotoFonts(pdf);
  return { pdf, fonts };
}

export type { Fonts };

export function textWidth(text: string, size: number, fonts: Fonts, bold = false): number {
  return widthOf(clean(text), size, fonts, bold);
}

// Draws one line of mixed English/Tamil text, optionally coloured, see-through and rotated around (x, y).
export function drawStyledText(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; fonts: Fonts; bold?: boolean; color?: [number, number, number]; opacity?: number; rotate?: number },
) {
  const angle = ((options.rotate ?? 0) * Math.PI) / 180;
  let x = options.x;
  let y = options.y;
  const [r, g, b] = options.color ?? [0.06, 0.09, 0.16];
  for (const run of runs(clean(text), options.fonts, Boolean(options.bold))) {
    page.drawText(run.text, {
      x,
      y,
      size: options.size,
      font: run.font,
      color: rgb(r, g, b),
      opacity: options.opacity ?? 1,
      rotate: degrees(options.rotate ?? 0),
    });
    const w = run.font.widthOfTextAtSize(run.text, options.size);
    x += w * Math.cos(angle);
    y += w * Math.sin(angle);
  }
}

const TAMIL = /[஀-௿]/;

// Splits text into runs that use one font each: Tamil runs and everything else.
function runs(text: string, fonts: Fonts, bold: boolean): { text: string; font: PDFFont }[] {
  const out: { text: string; font: PDFFont }[] = [];
  // Tamil words keep their spaces and joiners together, so shaping sees whole words.
  const parts = text.match(/[஀-௿‌‍]+|[^஀-௿‌‍]+/g) ?? [];
  for (const part of parts) {
    const font = TAMIL.test(part) ? (bold ? fonts.tamilBold : fonts.tamil) : bold ? fonts.latinBold : fonts.latin;
    out.push({ text: part, font });
  }
  return out;
}

function widthOf(text: string, size: number, fonts: Fonts, bold: boolean): number {
  return runs(text, fonts, bold).reduce((sum, r) => sum + r.font.widthOfTextAtSize(r.text, size), 0);
}

function drawRuns(page: PDFPage, text: string, x: number, y: number, size: number, fonts: Fonts, bold: boolean) {
  let cursor = x;
  for (const r of runs(text, fonts, bold)) {
    page.drawText(r.text, { x: cursor, y, size, font: r.font, color: rgb(0.06, 0.09, 0.16) });
    cursor += r.font.widthOfTextAtSize(r.text, size);
  }
}

// Breaks one paragraph into lines that fit the width. Very long words are cut.
function wrap(text: string, maxWidth: number, size: number, fonts: Fonts, bold: boolean): string[] {
  if (text === '') return [''];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line + word;
    if (widthOf(candidate, size, fonts, bold) <= maxWidth || line === '') {
      if (widthOf(candidate, size, fonts, bold) > maxWidth && line === '') {
        // A single word wider than the line: cut it by characters.
        let chunk = '';
        for (const ch of word) {
          if (widthOf(chunk + ch, size, fonts, bold) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += ch;
        }
        line = chunk;
      } else {
        line = candidate;
      }
    } else {
      lines.push(line.trimEnd());
      line = word.trimStart();
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

// Characters the fonts cannot draw (control characters, emoji) are replaced so the PDF never fails to build.
function clean(text: string): string {
  return text.replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[\u{1F000}-\u{1FFFF}]/gu, '?');
}

export interface TextBlock {
  text: string;
  heading?: 1 | 2 | 3;
}

// Paragraphs (and optional headings) flowed over as many A4 pages as needed.
export async function textToPdf(blocks: TextBlock[], title: string): Promise<Buffer> {
  const { pdf, fonts } = await setup(title);
  const maxWidth = A4.width - MARGIN * 2;
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  for (const block of blocks) {
    const size = block.heading === 1 ? 20 : block.heading === 2 ? 16 : block.heading === 3 ? 13 : 11;
    const bold = Boolean(block.heading);
    const lineHeight = size * 1.45;
    if (block.heading && y < A4.height - MARGIN) y -= size * 0.6; // space above headings
    for (const line of clean(block.text).split('\n').flatMap((l) => wrap(l, maxWidth, size, fonts, bold))) {
      if (y - lineHeight < MARGIN) {
        page = pdf.addPage([A4.width, A4.height]);
        y = A4.height - MARGIN;
      }
      y -= lineHeight;
      if (line) drawRuns(page, line, MARGIN, y + size * 0.3, size, fonts, bold);
    }
    y -= size * 0.4; // paragraph spacing
  }
  return Buffer.from(await pdf.save());
}

// A table with a bold header row, repeated on every page. Wide tables switch to landscape and smaller text.
export async function tableToPdf(rows: string[][], title: string): Promise<Buffer> {
  const { pdf, fonts } = await setup(title);
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const landscape = columns > 6;
  const pageSize: [number, number] = landscape ? [A4.height, A4.width] : [A4.width, A4.height];
  const size = columns > 10 ? 7 : columns > 6 ? 8 : 9;
  const tableWidth = pageSize[0] - MARGIN * 2;

  // Column widths follow the longest text in each column, within limits.
  const natural = Array.from({ length: columns }, (_, c) =>
    Math.min(220, Math.max(30, ...rows.slice(0, 200).map((r) => widthOf(clean(r[c] ?? ''), size, fonts, false) + 8))),
  );
  const scale = tableWidth / natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => w * Math.min(scale, 3));

  const [header, ...body] = rows.length > 0 ? rows : [['(empty)']];
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - MARGIN;

  const drawRow = (row: string[], bold: boolean) => {
    const cells = Array.from({ length: columns }, (_, c) => wrap(clean(row[c] ?? ''), widths[c] - 6, size, fonts, bold).slice(0, 6));
    const height = Math.max(...cells.map((l) => l.length)) * size * 1.35 + 6;
    if (y - height < MARGIN) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - MARGIN;
      if (!bold) drawRow(header, true);
    }
    let x = MARGIN;
    if (bold) page.drawRectangle({ x, y: y - height, width: widths.reduce((a, b) => a + b, 0), height, color: rgb(0.94, 0.95, 0.97) });
    cells.forEach((lines, c) => {
      lines.forEach((line, i) => line && drawRuns(page, line, x + 3, y - 4 - size - i * size * 1.35 + 2, size, fonts, bold));
      x += widths[c];
    });
    page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: MARGIN + widths.reduce((a, b) => a + b, 0), y: y - height }, thickness: 0.5, color: rgb(0.8, 0.83, 0.87) });
    y -= height;
  };

  drawRow(header, true);
  for (const row of body) drawRow(row, false);
  return Buffer.from(await pdf.save());
}

// One image per A4 page (portrait or landscape to match the image), scaled to fit and centred.
// Scans are often 300 DPI, so fitting to the page gives the expected printed size.
export async function imagesToPdf(images: { data: Buffer; type: 'png' | 'jpeg'; width: number; height: number }[], title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('e-Sevai Document Manager');
  for (const img of images) {
    const embedded = img.type === 'png' ? await pdf.embedPng(img.data) : await pdf.embedJpg(img.data);
    const landscape = img.width > img.height;
    const [pageW, pageH] = landscape ? [A4.height, A4.width] : [A4.width, A4.height];
    // Small images (logos, photos) are not blown up beyond their 96-DPI size.
    const scale = Math.min(pageW / img.width, pageH / img.height, 0.75);
    const width = img.width * scale;
    const height = img.height * scale;
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(embedded, { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height });
  }
  return Buffer.from(await pdf.save());
}
