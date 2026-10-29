import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../src/services/convert/pdf-reader.js';
import { textToPdf } from '../src/services/convert/pdf-writer.js';
import { applyTextEdits, textEditSchema } from '../src/services/pdf-text-edit.js';

// Editing wording: old words are covered and the new Tamil/English words can be read back from the PDF.

describe('PDF text editing', () => {
  it('writes new Tamil and English text, keeps the page count, and reads back', async () => {
    const original = await textToPdf([{ text: 'Name: Old Name' }], 'test');
    const pageCount = (await PDFDocument.load(original)).getPageCount();
    const edits = [
      { page: 1, cover: { x: 40, y: 760, w: 300, h: 20 }, text: 'பெயர்: பழனாத்தாள் (New Name)', x: 50, y: 765, size: 12 },
      { page: 1, text: 'Added line', x: 50, y: 700, size: 10, bold: true, color: '#1d4ed8' },
      { page: 1, cover: { x: 400, y: 100, w: 50, h: 50 } },
    ].map((e) => textEditSchema.parse(e));
    const edited = await applyTextEdits(original, edits);
    expect((await PDFDocument.load(edited)).getPageCount()).toBe(pageCount);
    const [first] = await extractPdfText(edited);
    expect(first).toContain('New Name');
    expect(first).toContain('Added line');
    expect(first).toMatch(/[஀-௿]/); // Tamil letters were written
  });

  it('shrinks text to fit the old line, but not below 60%', async () => {
    const original = await textToPdf([{ text: 'Short' }], 'fit');
    const edit = textEditSchema.parse({ page: 1, text: 'A much longer line of replacement text than before', x: 50, y: 700, size: 12, fitWidth: 60 });
    await expect(applyTextEdits(original, [edit])).resolves.toBeInstanceOf(Buffer);
  });

  it('refuses a page that does not exist', async () => {
    const original = await textToPdf([{ text: 'One page' }], 'one');
    await expect(applyTextEdits(original, [textEditSchema.parse({ page: 5, text: 'x' })])).rejects.toThrow(/Page 5/);
  });
});
