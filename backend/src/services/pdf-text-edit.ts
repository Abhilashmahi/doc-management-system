import { PDFDocument, rgb } from 'pdf-lib';
import { z } from 'zod';
import { HttpError } from '../utils/http-error.js';
import { drawStyledText, embedNotoFonts, textWidth } from './convert/pdf-writer.js';

// Changing the wording of an existing PDF. Each change covers the old words with a white box and writes the new
// words on top in Noto Sans / Noto Sans Tamil, so English and Tamil both print correctly. Everything else on the
// page (logos, stamps, signatures, other text) stays exactly as it was. Coordinates are PDF points (1/72 inch),
// measured from the bottom-left corner of the page, as PDF.js reports them in the browser.

const finite = z.number().finite();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const textEditSchema = z.object({
  page: z.number().int().min(1),
  // The area to blank out first (the old words), if any.
  cover: z.object({ x: finite, y: finite, w: finite.min(0).max(20000), h: finite.min(0).max(20000) }).optional(),
  // The new words; empty or missing for a plain white-out. Line breaks start new lines below.
  text: z.string().max(4000).optional(),
  x: finite.default(0),
  y: finite.default(0), // baseline of the first line
  size: finite.min(3).max(300).default(12),
  bold: z.boolean().default(false),
  color: hex.default('#000000'),
  // Shrink the text (down to 60%) when it is wider than this many points, so it stays inside the old line.
  fitWidth: finite.min(1).max(20000).optional(),
});
export type TextEdit = z.infer<typeof textEditSchema>;

function toRgb(value: string): [number, number, number] {
  const n = parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function applyTextEdits(input: Buffer, edits: TextEdit[]): Promise<Buffer> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(input, { updateMetadata: false });
  } catch (error) {
    if (/encrypt/i.test(String((error as Error).message))) throw new HttpError(400, 'This PDF is password-protected, so its text cannot be changed.');
    throw new HttpError(400, 'This PDF could not be read. It may be damaged.');
  }
  const pages = pdf.getPages();
  const fonts = await embedNotoFonts(pdf);

  // White boxes first, then the new words, so a new line is never covered by a neighbour's box.
  for (const edit of edits) {
    if (!edit.cover) continue;
    const page = pages[edit.page - 1];
    if (!page) throw new HttpError(400, `Page ${edit.page} does not exist in this PDF.`);
    page.drawRectangle({ x: edit.cover.x, y: edit.cover.y, width: edit.cover.w, height: edit.cover.h, color: rgb(1, 1, 1) });
  }
  for (const edit of edits) {
    const text = edit.text?.replace(/\r/g, '') ?? '';
    if (!text.trim()) continue;
    const page = pages[edit.page - 1];
    if (!page) throw new HttpError(400, `Page ${edit.page} does not exist in this PDF.`);
    const lines = text.split('\n');
    let size = edit.size;
    if (edit.fitWidth) {
      const widest = Math.max(...lines.map((l) => textWidth(l, size, fonts, edit.bold)));
      if (widest > edit.fitWidth) size = Math.max(size * 0.6, (size * edit.fitWidth) / widest);
    }
    lines.forEach((line, i) => {
      if (!line) return;
      drawStyledText(page, line, { x: edit.x, y: edit.y - i * size * 1.25, size, fonts, bold: edit.bold, color: toRgb(edit.color) });
    });
  }
  return Buffer.from(await pdf.save());
}
