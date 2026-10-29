import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfText } from '../src/services/convert/pdf-reader.js';
import { textToPdf } from '../src/services/convert/pdf-writer.js';
import { addPageNumbers, addWatermark, compressPdf, imagesToPdf, mergePdfs, parseRanges, pickPages, rotatePdf, splitPdf } from '../src/services/pdf-tools.js';

// Every PDF tool runs on small generated PDFs, and the results are read back to check pages, order and text.

let threePages: Buffer;
let onePage: Buffer;

async function pages(data: Buffer) {
  return (await PDFDocument.load(data)).getPages();
}

beforeAll(async () => {
  // Three pages, each starting with its own number, so the order can be checked from the text.
  const doc = await PDFDocument.create();
  for (const n of [1, 2, 3]) {
    const src = await PDFDocument.load(await textToPdf([{ text: `Page ${n}` }], `p${n}`));
    const [page] = await doc.copyPages(src, [0]);
    doc.addPage(page);
  }
  threePages = Buffer.from(await doc.save());
  onePage = await textToPdf([{ text: 'Single page' }], 'single');
});

describe('page ranges', () => {
  it('understands lists, ranges and open ends', () => {
    expect(parseRanges('1-2, 3', 5)).toEqual([[1, 2], [3]]);
    expect(parseRanges('4-', 5)).toEqual([[4, 5]]);
  });
  it('rejects pages outside the document', () => {
    expect(() => parseRanges('2-9', 5)).toThrow(/outside/);
    expect(() => parseRanges('abc', 5)).toThrow(/not a page range/);
  });
});

describe('PDF tools', () => {
  it('merges files in the given order', async () => {
    const merged = await mergePdfs([{ name: 'a.pdf', data: threePages }, { name: 'b.pdf', data: onePage }]);
    const text = await extractPdfText(merged);
    expect(text.map((t) => t.split('\n')[0])).toEqual(['Page 1', 'Page 2', 'Page 3', 'Single page']);
  });

  it('splits into single pages, ranges and fixed-size parts', async () => {
    expect(await splitPdf(threePages, { kind: 'each' }, 'x')).toHaveLength(3);
    const ranges = await splitPdf(threePages, { kind: 'ranges', ranges: '1-2,3' }, 'x');
    expect(ranges.map((r) => r.name)).toEqual(['x-pages-1-2.pdf', 'x-page-3.pdf']);
    expect(await splitPdf(threePages, { kind: 'every', size: 2 }, 'x')).toHaveLength(2);
  });

  it('reorders, removes and rotates pages', async () => {
    const result = await pickPages(threePages, [{ page: 3, rotate: 90 }, { page: 1 }]);
    const text = await extractPdfText(result);
    expect(text.map((t) => t.split('\n')[0])).toEqual(['Page 3', 'Page 1']);
    expect((await pages(result))[0].getRotation().angle).toBe(90);
  });

  it('rotates only the chosen pages', async () => {
    const result = await pages(await rotatePdf(threePages, 180, '2'));
    expect(result.map((p) => p.getRotation().angle)).toEqual([0, 180, 0]);
  });

  it('adds page numbers and a Tamil watermark', async () => {
    const numbered = await addPageNumbers(threePages, { position: 'bottom-center', start: 1, format: 'Page {n} of {total}', size: 10, skipFirst: false });
    expect((await extractPdfText(numbered)).join(' ')).toContain('Page 3 of 3');
    const marked = await addWatermark(onePage, { text: 'நகல் COPY', size: 50, opacity: 0.2, color: '#dc2626', angle: 45, pages: '' });
    expect((await extractPdfText(marked))[0]).toContain('COPY');
  });

  it('never returns a bigger file from compression', async () => {
    for (const level of ['basic', 'strong'] as const) {
      const result = await compressPdf(threePages, level);
      expect(result.data.length).toBeLessThanOrEqual(threePages.length);
    }
  });

  it('puts each image on its own page', async () => {
    const wide = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#4f46e5' } }).png().toBuffer();
    const tall = await sharp({ create: { width: 200, height: 400, channels: 3, background: '#16a34a' } }).jpeg().toBuffer();
    const pdf = await pages(await imagesToPdf([{ name: 'w.png', data: wide }, { name: 't.jpg', data: tall }], { pageSize: 'a4', orientation: 'auto', margin: 20 }));
    expect(pdf).toHaveLength(2);
    expect(pdf[0].getWidth()).toBeGreaterThan(pdf[0].getHeight()); // landscape for the wide image
    expect(pdf[1].getWidth()).toBeLessThan(pdf[1].getHeight());
  });
});
