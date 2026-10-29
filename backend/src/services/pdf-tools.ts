import { PDFDocument, degrees } from 'pdf-lib';
import sharp, { type OutputInfo } from 'sharp';
import { HttpError } from '../utils/http-error.js';
import { renderPdfPages } from './convert/pdf-reader.js';
import { drawStyledText, embedNotoFonts, textWidth } from './convert/pdf-writer.js';

// iLovePDF-style page tools, built on pdf-lib. Each takes PDF bytes and returns new bytes; inputs are never changed.

export interface NamedFile {
  name: string;
  data: Buffer;
}

export async function loadPdf(data: Buffer, name = 'The file'): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(data, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) throw new HttpError(400, `${name} is password-protected. Remove the password first, then try again.`);
    throw new HttpError(400, `${name} could not be read as a PDF. It may be damaged.`);
  }
}

async function save(pdf: PDFDocument): Promise<Buffer> {
  pdf.setProducer('e-Sevai Document Manager');
  pdf.setModificationDate(new Date());
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

// ---------- Page ranges ----------

// Turns "1-3, 5, 8-" into page numbers (1-based) for a document with `total` pages.
export function parseRanges(text: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!match || (!match[1] && !match[3])) throw new HttpError(400, `“${part}” is not a page range. Use forms like 1-3, 5 or 8-.`);
    const start = match[1] ? Number(match[1]) : 1;
    const end = match[2] ? (match[3] ? Number(match[3]) : total) : start;
    if (start < 1 || end > total || start > end) throw new HttpError(400, `Pages ${part} are outside this ${total}-page document.`);
    groups.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }
  if (groups.length === 0) throw new HttpError(400, 'Enter at least one page or page range.');
  return groups;
}

// ---------- Merge, split, organise ----------

export async function mergePdfs(files: NamedFile[]): Promise<Buffer> {
  if (files.length < 2) throw new HttpError(400, 'Choose at least two PDF files to merge.');
  const out = await PDFDocument.create();
  for (const file of files) {
    const src = await loadPdf(file.data, `“${file.name}”`);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

// Builds a new PDF from chosen pages of the source, in the given order, each with an extra rotation.
export async function pickPages(data: Buffer, pages: { page: number; rotate?: number }[]): Promise<Buffer> {
  const src = await loadPdf(data);
  const total = src.getPageCount();
  if (pages.length === 0) throw new HttpError(400, 'Keep at least one page.');
  for (const p of pages) if (p.page < 1 || p.page > total) throw new HttpError(400, `Page ${p.page} does not exist (the PDF has ${total} pages).`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p.page - 1));
  copied.forEach((page, i) => {
    const extra = pages[i].rotate ?? 0;
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra + 360) % 360));
    out.addPage(page);
  });
  return save(out);
}

export async function pageCount(data: Buffer): Promise<number> {
  return (await loadPdf(data)).getPageCount();
}

export async function splitPdf(data: Buffer, mode: { kind: 'each' } | { kind: 'ranges'; ranges: string } | { kind: 'every'; size: number }, baseName: string): Promise<NamedFile[]> {
  const total = await pageCount(data);
  let groups: number[][];
  if (mode.kind === 'each') groups = Array.from({ length: total }, (_, i) => [i + 1]);
  else if (mode.kind === 'every') {
    const size = Math.max(1, Math.floor(mode.size));
    groups = [];
    for (let start = 1; start <= total; start += size) groups.push(Array.from({ length: Math.min(size, total - start + 1) }, (_, i) => start + i));
  } else groups = parseRanges(mode.ranges, total);

  const files: NamedFile[] = [];
  for (const group of groups) {
    const label = group.length === 1 ? `page-${group[0]}` : `pages-${group[0]}-${group[group.length - 1]}`;
    files.push({ name: `${baseName}-${label}.pdf`, data: await pickPages(data, group.map((page) => ({ page }))) });
  }
  return files;
}

export async function rotatePdf(data: Buffer, angle: 90 | 180 | 270, pages: string): Promise<Buffer> {
  const pdf = await loadPdf(data);
  const total = pdf.getPageCount();
  const chosen = pages.trim() ? new Set(parseRanges(pages, total).flat()) : null;
  pdf.getPages().forEach((page, i) => {
    if (!chosen || chosen.has(i + 1)) page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return save(pdf);
}

// ---------- Stamping ----------

type Position = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

// The visible page box, in the page's own (unrotated) coordinates, and its rotation.
function pageFrame(page: ReturnType<PDFDocument['getPages']>[number]) {
  const box = page.getCropBox();
  return { ...box, rotation: ((page.getRotation().angle % 360) + 360) % 360 };
}

// Converts a point measured on the page as the reader sees it into the page's own coordinates.
function toPageSpace(frame: ReturnType<typeof pageFrame>, vx: number, vy: number) {
  const { x, y, width, height, rotation } = frame;
  switch (rotation) {
    case 90:
      return { x: x + width - vy, y: y + vx, rotate: 90 };
    case 180:
      return { x: x + width - vx, y: y + height - vy, rotate: 180 };
    case 270:
      return { x: x + vy, y: y + height - vx, rotate: 270 };
    default:
      return { x: x + vx, y: y + vy, rotate: 0 };
  }
}

export async function addPageNumbers(
  data: Buffer,
  options: { position: Position; start: number; format: string; size: number; skipFirst: boolean },
): Promise<Buffer> {
  const pdf = await loadPdf(data);
  const fonts = await embedNotoFonts(pdf);
  const pages = pdf.getPages();
  const counted = options.skipFirst ? pages.length - 1 : pages.length;
  pages.forEach((page, i) => {
    if (options.skipFirst && i === 0) return;
    const n = options.start + (options.skipFirst ? i - 1 : i);
    const text = options.format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(counted + options.start - 1));
    const frame = pageFrame(page);
    // Width and height as the reader sees the page.
    const [vw, vh] = frame.rotation % 180 === 0 ? [frame.width, frame.height] : [frame.height, frame.width];
    const w = textWidth(text, options.size, fonts);
    const margin = 28;
    const vx = options.position.endsWith('left') ? margin : options.position.endsWith('right') ? vw - margin - w : (vw - w) / 2;
    const vy = options.position.startsWith('top') ? vh - margin - options.size : margin;
    const p = toPageSpace(frame, vx, vy);
    drawStyledText(page, text, { x: p.x, y: p.y, size: options.size, fonts, rotate: p.rotate, color: [0.2, 0.25, 0.33] });
  });
  return save(pdf);
}

export async function addWatermark(
  data: Buffer,
  options: { text: string; size: number; opacity: number; color: string; angle: number; pages: string },
): Promise<Buffer> {
  const pdf = await loadPdf(data);
  const fonts = await embedNotoFonts(pdf);
  const hex = /^#([0-9a-f]{6})$/i.exec(options.color)?.[1] ?? 'dc2626';
  const color: [number, number, number] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const total = pdf.getPageCount();
  const chosen = options.pages.trim() ? new Set(parseRanges(options.pages, total).flat()) : null;

  pdf.getPages().forEach((page, i) => {
    if (chosen && !chosen.has(i + 1)) return;
    const frame = pageFrame(page);
    const [vw, vh] = frame.rotation % 180 === 0 ? [frame.width, frame.height] : [frame.height, frame.width];
    const w = textWidth(options.text, options.size, fonts, true);
    // Centre the text on the page, turned by the chosen angle around its own middle.
    const a = (options.angle * Math.PI) / 180;
    const vx = vw / 2 - (w / 2) * Math.cos(a) + (options.size / 3) * Math.sin(a);
    const vy = vh / 2 - (w / 2) * Math.sin(a) - (options.size / 3) * Math.cos(a);
    const p = toPageSpace(frame, vx, vy);
    drawStyledText(page, options.text, { x: p.x, y: p.y, size: options.size, fonts, bold: true, color, opacity: options.opacity, rotate: p.rotate + options.angle });
  });
  return save(pdf);
}

// ---------- Compress ----------

// "basic" re-saves the PDF compactly without changing how it looks.
// "strong" redraws every page as a JPEG picture: much smaller for scans and photos, but the text can no longer be selected.
export async function compressPdf(data: Buffer, level: 'basic' | 'strong'): Promise<{ data: Buffer; note: string }> {
  if (level === 'basic') {
    const pdf = await loadPdf(data);
    const out = await save(pdf);
    return out.length < data.length
      ? { data: out, note: 'Re-saved compactly. The pages look exactly the same.' }
      : { data, note: 'This PDF is already compact; basic compression could not make it smaller. Try strong compression.' };
  }
  const pages = await renderPdfPages(data, 'jpeg', 110);
  const src = await loadPdf(data);
  const out = await PDFDocument.create();
  for (let i = 0; i < pages.length; i += 1) {
    const original = src.getPage(i);
    const { width, height } = original.getSize();
    const rotation = original.getRotation().angle % 180 === 0;
    const jpeg = await sharp(pages[i].data).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
    const image = await out.embedJpg(jpeg);
    const [w, h] = rotation ? [width, height] : [height, width];
    out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  const result = await save(out);
  return result.length < data.length
    ? { data: result, note: 'Pages were redrawn as pictures. Text in this copy can no longer be selected or searched.' }
    : { data, note: 'This PDF is already well compressed; the original is returned unchanged.' };
}

// ---------- Images to PDF ----------

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(
  files: NamedFile[],
  options: { pageSize: 'a4' | 'letter' | 'fit'; orientation: 'auto' | 'portrait' | 'landscape'; margin: number },
): Promise<Buffer> {
  if (files.length === 0) throw new HttpError(400, 'Choose at least one image.');
  const out = await PDFDocument.create();
  for (const file of files) {
    let jpeg: Buffer;
    let info: OutputInfo;
    try {
      ({ data: jpeg, info } = await sharp(file.data, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true }));
    } catch {
      throw new HttpError(400, `“${file.name}” could not be read as an image.`);
    }
    const image = await out.embedJpg(jpeg);
    if (options.pageSize === 'fit') {
      // Page exactly the size of the image (at 96 DPI) plus the margin.
      const w = info.width * 0.75;
      const h = info.height * 0.75;
      out.addPage([w + options.margin * 2, h + options.margin * 2]).drawImage(image, { x: options.margin, y: options.margin, width: w, height: h });
      continue;
    }
    const [a, b] = PAGE_SIZES[options.pageSize];
    const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && info.width > info.height);
    const [pw, ph] = landscape ? [b, a] : [a, b];
    const scale = Math.min((pw - options.margin * 2) / info.width, (ph - options.margin * 2) / info.height);
    const w = info.width * scale;
    const h = info.height * scale;
    out.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return save(out);
}

