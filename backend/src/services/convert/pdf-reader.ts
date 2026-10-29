import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { HttpError } from '../../utils/http-error.js';
import { baminiToUnicode, looksLikeBamini, repairTamilOrder } from '../bamini.js';

// Reads PDFs with Mozilla's PDF.js: draws pages as pictures, and pulls out their text.

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import(pathToFileURL(path.join(PDFJS_DIR, 'legacy/build/pdf.mjs')).href) as Promise<PdfJs>;
  return pdfjs;
}

export const MAX_RENDER_PAGES = 100;

// PDF.js wants folder paths with forward slashes and a trailing slash, even on Windows.
const folderUrl = (name: string) => path.join(PDFJS_DIR, name).replace(/\\/g, '/') + '/';

// Opens a PDF. Call close() when finished to free its memory.
async function open(data: Buffer) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({
    data: new Uint8Array(data),
    // Fonts and character maps for PDFs that do not embed their own fonts.
    standardFontDataUrl: folderUrl('standard_fonts'),
    cMapUrl: folderUrl('cmaps'),
    cMapPacked: true,
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    return Object.assign(doc, { close: () => task.destroy() });
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = (error as { name?: string }).name;
    if (name === 'PasswordException') throw new HttpError(400, 'This PDF is password-protected. Remove the password and upload it again.');
    console.error('PDF.js could not open a PDF:', error instanceof Error ? error.message : error);
    throw new HttpError(400, 'This PDF could not be read. It may be damaged.');
  }
}

// Draws each page as an image. dpi 150 is sharp on screen and fine for printing text.
export async function renderPdfPages(data: Buffer, format: 'png' | 'jpeg', dpi = 150): Promise<{ data: Buffer; width: number; height: number }[]> {
  const doc = await open(data);
  try {
    if (doc.numPages > MAX_RENDER_PAGES) {
      throw new HttpError(400, `This PDF has ${doc.numPages} pages. Converting to images works for up to ${MAX_RENDER_PAGES} pages.`);
    }
    const pages: { data: Buffer; width: number; height: number }[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // PDFs have transparent backgrounds; JPEG needs white
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as never, canvas: canvas as never, viewport }).promise;
      pages.push({
        data: format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 90),
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.close();
  }
}

// Text of each page, with line breaks where the PDF has them. Scanned PDFs (pictures only) have no text.
export async function extractPdfText(data: Buffer): Promise<string[]> {
  const doc = await open(data);
  try {
    // Tamil typed with the old Bamini font is stored as English keys ("mDg;Geh;"); find those fonts across the
    // whole file and turn their text into real Tamil, so the Word or text file can be read and copied.
    const pageItems: { str: string; fontName: string; hasEOL: boolean }[][] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageItems.push(content.items.filter((item) => 'str' in item) as { str: string; fontName: string; hasEOL: boolean }[]);
      page.cleanup();
    }
    const byFont = new Map<string, string[]>();
    for (const item of pageItems.flat()) byFont.set(item.fontName, [...(byFont.get(item.fontName) ?? []), item.str]);
    const bamini = new Set([...byFont].filter(([, strs]) => looksLikeBamini(strs.join(' '))).map(([font]) => font));
    const pages = pageItems.map((items) => {
      let text = '';
      for (const item of items) {
        text += bamini.has(item.fontName) ? baminiToUnicode(item.str) : item.str;
        if (item.hasEOL) text += '\n';
      }
      return repairTamilOrder(text.replace(/[ \t]+\n/g, '\n').trim());
    });
    if (pages.every((p) => p === '')) {
      throw new HttpError(400, 'This PDF has no text layer (it is probably a scan). Convert it to images instead; reading text from scans (OCR) is not available yet.');
    }
    return pages;
  } finally {
    await doc.close();
  }
}
