import { AlignmentType, Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { HttpError } from '../../utils/http-error.js';
import type { TextBlock } from './pdf-writer.js';

// Word, Excel, CSV, JSON and plain-text conversions in pure JavaScript.

// ---------- Text ----------

// Text files may be UTF-8 (with or without a byte-order mark) or UTF-16 (common from Excel "Unicode text").
export function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le');
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString('utf8');
  return data.toString('utf8');
}

// Markdown headings (# Title) become PDF/Word headings; everything else stays as paragraphs.
export function textToBlocks(text: string, markdown: boolean): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const heading = markdown ? /^(#{1,3})\s+(.*)$/.exec(para.trim()) : null;
    if (heading) blocks.push({ text: heading[2], heading: heading[1].length as 1 | 2 | 3 });
    else blocks.push({ text: para });
  }
  return blocks;
}

export async function blocksToDocx(blocks: TextBlock[], pageBreakBefore: Set<number> = new Set()): Promise<Buffer> {
  const headingLevels = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
  const paragraphs = blocks.map((block, i) => {
    const lines = block.text.split('\n');
    const children = [
      ...(pageBreakBefore.has(i) ? [new PageBreak()] : []),
      ...lines.map((line, j) => new TextRun({ text: line, break: j > 0 ? 1 : 0 })),
    ];
    return new Paragraph({ children, heading: block.heading ? headingLevels[block.heading] : undefined, alignment: AlignmentType.LEFT });
  });
  const doc = new Document({
    creator: 'e-Sevai Document Manager',
    // Nirmala UI ships with Windows and covers Tamil and English.
    styles: { default: { document: { run: { font: 'Nirmala UI', size: 22 } } } },
    sections: [{ children: paragraphs }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------- Word (DOCX) ----------

export async function docxToHtml(data: Buffer, title: string): Promise<Buffer> {
  const result = await readDocx(() => mammoth.convertToHtml({ buffer: data }));
  const escapedTitle = title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapedTitle}</title>
<style>body{font-family:'Nirmala UI',Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 16px;line-height:1.5;color:#0f172a}
table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}img{max-width:100%}</style>
</head><body>
${result.value}
</body></html>`;
  return Buffer.from(html, 'utf8');
}

export async function docxToText(data: Buffer): Promise<string> {
  const result = await readDocx(() => mammoth.extractRawText({ buffer: data }));
  return result.value.replace(/\n{3,}/g, '\n\n').trim();
}

// Headings and paragraphs from a Word file, for the simple built-in PDF.
export async function docxToBlocks(data: Buffer): Promise<TextBlock[]> {
  const result = await readDocx(() => mammoth.convertToHtml({ buffer: data }));
  const blocks: TextBlock[] = [];
  const pattern = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(result.value))) {
    const text = decodeEntities(match[2].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''));
    const tag = match[1];
    const level = tag.startsWith('h') ? Math.min(3, Number(tag[1])) : 0;
    blocks.push({ text: tag === 'li' ? `• ${text}` : text, heading: level ? (level as 1 | 2 | 3) : undefined });
  }
  return blocks.length ? blocks : [{ text: '(This document has no text.)' }];
}

async function readDocx<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new HttpError(400, 'This Word file could not be read. It may be damaged, password-protected, or not a real .docx file.');
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// ---------- CSV ----------

// Reads CSV text, including quoted values that contain commas, quotes or line breaks.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  // Semicolon-separated files (common with European Excel settings) are detected from the first line.
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Writes CSV that Excel opens correctly, including Tamil text (UTF-8 with a byte-order mark).
export function toCsv(rows: string[][]): Buffer {
  const escape = (v: string) => (/[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // Values that start with = + - @ are prefixed with ' so spreadsheet programs do not run them as formulas.
  const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const text = rows.map((r) => r.map((v) => escape(safe(v ?? ''))).join(',')).join('\r\n');
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

// ---------- Excel ----------

export interface Sheet {
  name: string;
  rows: string[][];
}

const MAX_SHEET_ROWS = 100_000;

export async function readXlsx(data: Buffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'This Excel file could not be read. It may be damaged, password-protected, or an old .xls file renamed to .xlsx.');
  }
  const sheets: Sheet[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_SHEET_ROWS) return;
      const values: string[] = [];
      // .text gives what Excel shows: formatted numbers and dates, and formula results.
      for (let c = 1; c <= sheet.actualColumnCount; c += 1) values.push(row.getCell(c).text ?? '');
      rows[rowNumber - 1] = values;
    });
    // Rows Excel skipped (completely empty) become empty rows, so row numbers stay the same.
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    sheets.push({ name: sheet.name, rows });
  });
  if (sheets.length === 0) throw new HttpError(400, 'This Excel file has no sheets.');
  return sheets;
}

export async function writeXlsx(sheets: Sheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'e-Sevai Document Manager';
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'Sheet1');
    for (const row of s.rows) {
      // Plain numbers become real numbers in Excel; everything else stays text (leading zeros are kept).
      sheet.addRow(row.map((v) => (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v) ? Number(v) : v)));
    }
    if (s.rows.length > 0) {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    sheet.columns.forEach((col, i) => {
      const longest = Math.max(8, ...s.rows.slice(0, 500).map((r) => (r[i] ?? '').length));
      col.width = Math.min(60, longest + 2);
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------- JSON ----------

// A table becomes a list of objects keyed by the header row: [{ "Name": "Ravi", "Age": "30" }, ...].
export function rowsToJson(rows: string[][]): unknown[] {
  const [header = [], ...body] = rows;
  const keys = header.map((h, i) => h.trim() || `Column${i + 1}`);
  return body.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

// The reverse: a JSON list of objects becomes a table. Anything else cannot be turned into rows.
export function jsonToRows(text: string): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'This JSON file is not valid JSON.');
  }
  const list = Array.isArray(parsed) ? parsed : null;
  if (!list || !list.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    throw new HttpError(400, 'Only a JSON list of objects (like [{"Name": "Ravi"}, ...]) can be turned into a table.');
  }
  const keys: string[] = [];
  for (const item of list as Record<string, unknown>[]) for (const k of Object.keys(item)) if (!keys.includes(k)) keys.push(k);
  const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return [keys, ...(list as Record<string, unknown>[]).map((item) => keys.map((k) => cell(item[k])))];
}

// ---------- ZIP ----------

export async function zipFiles(files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- HTML ----------

// Visible text of a web page: scripts and styles are dropped, block tags become line breaks.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
