import { HttpError } from '../../utils/http-error.js';
import { formatOf } from '../formats.js';
import { convertImage, imageToPdf } from './images.js';
import { convertWithLibreOffice, libreOfficePath } from './libreoffice.js';
import {
  blocksToDocx,
  decodeText,
  docxToBlocks,
  docxToHtml,
  docxToText,
  htmlToText,
  jsonToRows,
  parseCsv,
  readXlsx,
  rowsToJson,
  textToBlocks,
  toCsv,
  writeXlsx,
  zipFiles,
} from './office.js';
import { extractPdfText, renderPdfPages } from './pdf-reader.js';
import { tableToPdf, textToPdf } from './pdf-writer.js';

// Which conversions exist, how faithful each one is, and the code that runs it.
// Not every format can become every other format: a scanned PDF has no text to put in Word, and a spreadsheet
// has no sensible "image". Only conversions that give a useful result are listed, each with an honest quality label.

// exact      the result looks the same as the original
// good       content and structure are kept; small layout differences are possible
// text-only  only the words are kept; layout, images and styling are lost
export type Quality = 'exact' | 'good' | 'text-only';

export interface ConversionOption {
  to: string; // target extension
  label: string;
  quality: Quality;
  engine: 'built-in' | 'libreoffice';
  available: boolean;
  note?: string;
}

interface Route {
  to: string;
  quality: Quality;
  engine: 'built-in' | 'libreoffice';
  note?: string;
  // When LibreOffice is missing, a built-in route of lower quality may stand in for a LibreOffice one.
  fallbackFor?: true;
}

export interface ConversionResult {
  data: Buffer;
  ext: string;
}

const IMAGE_IN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'svg'];
const lo = (to: string, quality: Quality = 'exact', note?: string): Route => ({ to, quality, engine: 'libreoffice', note });
const builtIn = (to: string, quality: Quality, note?: string): Route => ({ to, quality, engine: 'built-in', note });

function routesFor(from: string): Route[] {
  if (IMAGE_IN.includes(from)) {
    return [
      builtIn('png', 'exact'),
      builtIn('jpeg', 'exact', 'Transparent areas become white.'),
      builtIn('webp', 'exact'),
      builtIn('pdf', 'exact', 'The image is fitted onto an A4 page.'),
    ].filter((r) => !(r.to === from || (r.to === 'jpeg' && from === 'jpg')));
  }
  switch (from) {
    case 'bmp':
      return [lo('png'), lo('pdf')];
    case 'pdf':
      return [
        builtIn('png', 'exact', 'One image per page at 150 DPI. Several pages arrive as a ZIP file.'),
        builtIn('jpeg', 'exact', 'One image per page at 150 DPI. Several pages arrive as a ZIP file.'),
        builtIn('docx', 'text-only', 'Only the words are copied into Word, page by page. Layout, tables and pictures are not kept. Scanned PDFs have no text.'),
        builtIn('txt', 'text-only', 'Scanned PDFs have no text to copy.'),
      ];
    case 'docx':
      return [
        lo('pdf'),
        { ...builtIn('pdf', 'text-only', 'Headings and paragraphs only. Install LibreOffice for an exact copy.'), fallbackFor: true },
        builtIn('html', 'good', 'Opens in any web browser. Formatting is simplified.'),
        builtIn('txt', 'text-only'),
        lo('odt'),
      ];
    case 'doc':
    case 'odt':
    case 'rtf':
      return [lo('pdf'), lo('docx'), lo('txt', 'text-only')];
    case 'xlsx':
      return [
        lo('pdf'),
        { ...builtIn('pdf', 'good', 'A plain table of each value (first sheet). Install LibreOffice for an exact copy of the formatting.'), fallbackFor: true },
        builtIn('csv', 'good', 'Values only. Workbooks with several sheets arrive as a ZIP of CSV files.'),
        builtIn('json', 'good', 'Values only. The first row becomes the field names.'),
        lo('ods'),
      ];
    case 'xls':
    case 'ods':
      return [lo('xlsx'), lo('pdf'), lo('csv', 'good', 'Values of the first sheet.')];
    case 'csv':
      return [
        builtIn('xlsx', 'exact'),
        builtIn('pdf', 'good', 'A plain table. Wide tables use landscape pages.'),
        builtIn('json', 'exact', 'The first row becomes the field names.'),
      ];
    case 'json':
      return [
        builtIn('csv', 'good', 'Works for a JSON list of objects.'),
        builtIn('xlsx', 'good', 'Works for a JSON list of objects.'),
      ];
    case 'pptx':
    case 'ppt':
    case 'odp':
      return [lo('pdf'), ...(from === 'pptx' ? [] : [lo('pptx')])];
    case 'txt':
    case 'md':
      return [builtIn('pdf', 'good'), builtIn('docx', 'good')];
    case 'html':
    case 'htm':
      return [lo('pdf', 'good'), lo('docx', 'good'), builtIn('txt', 'text-only')];
    default:
      return [];
  }
}

const TARGET_LABELS: Record<string, string> = {
  pdf: 'PDF',
  png: 'PNG image',
  jpeg: 'JPEG image',
  webp: 'WebP image',
  docx: 'Word (DOCX)',
  odt: 'OpenDocument Text (ODT)',
  xlsx: 'Excel (XLSX)',
  ods: 'OpenDocument Sheet (ODS)',
  pptx: 'PowerPoint (PPTX)',
  csv: 'CSV',
  json: 'JSON',
  txt: 'Plain text (TXT)',
  html: 'Web page (HTML)',
};

// The conversions offered for a file type. A LibreOffice route and its built-in stand-in become one option.
export function conversionOptions(from: string): ConversionOption[] {
  const hasLibreOffice = libreOfficePath() !== null;
  const routes = routesFor(from);
  const options: ConversionOption[] = [];
  for (const route of routes) {
    if (route.fallbackFor) continue;
    const fallback = routes.find((r) => r.fallbackFor && r.to === route.to);
    const chosen = route.engine === 'libreoffice' && !hasLibreOffice && fallback ? fallback : route;
    const available = chosen.engine === 'built-in' || hasLibreOffice;
    options.push({
      to: chosen.to,
      label: TARGET_LABELS[chosen.to] ?? chosen.to.toUpperCase(),
      quality: chosen.quality,
      engine: chosen.engine,
      available,
      note: available ? chosen.note : 'Needs LibreOffice (free) installed on the server. Ask your administrator.',
    });
  }
  return options;
}

// Runs one conversion. The original bytes are only read, never changed.
export async function convert(data: Buffer, from: string, to: string, title: string): Promise<ConversionResult> {
  const option = conversionOptions(from).find((o) => o.to === to);
  if (!option) {
    const fromLabel = formatOf(from)?.label ?? `.${from}`;
    throw new HttpError(400, `${fromLabel} files cannot be converted to ${TARGET_LABELS[to] ?? to}.`);
  }
  if (!option.available) throw new HttpError(400, option.note ?? 'This conversion is not available.');

  if (option.engine === 'libreoffice') {
    return { data: await convertWithLibreOffice(data, from, to), ext: to };
  }

  // ---------- Built-in conversions ----------
  if (IMAGE_IN.includes(from)) {
    if (to === 'pdf') return { data: await imageToPdf(data, title), ext: 'pdf' };
    return { data: await convertImage(data, to as 'png' | 'jpeg' | 'webp'), ext: to === 'jpeg' ? 'jpg' : to };
  }

  switch (`${from}->${to}`) {
    case 'pdf->png':
    case 'pdf->jpeg': {
      const format = to as 'png' | 'jpeg';
      const ext = format === 'png' ? 'png' : 'jpg';
      const pages = await renderPdfPages(data, format);
      if (pages.length === 1) return { data: pages[0].data, ext };
      const width = String(pages.length).length;
      return { data: await zipFiles(pages.map((p, i) => ({ name: `page-${String(i + 1).padStart(width, '0')}.${ext}`, data: p.data }))), ext: 'zip' };
    }
    case 'pdf->txt': {
      const pages = await extractPdfText(data);
      return { data: Buffer.from(pages.join('\n\n\f\n\n'), 'utf8'), ext: 'txt' };
    }
    case 'pdf->docx': {
      const pages = await extractPdfText(data);
      const blocks = pages.flatMap((p) => textToBlocks(p, false));
      // Start each PDF page on a new Word page.
      const breaks = new Set<number>();
      let index = 0;
      pages.forEach((p, i) => {
        if (i > 0) breaks.add(index);
        index += textToBlocks(p, false).length;
      });
      return { data: await blocksToDocx(blocks, breaks), ext: 'docx' };
    }
    case 'docx->pdf':
      return { data: await textToPdf(await docxToBlocks(data), title), ext: 'pdf' };
    case 'docx->html':
      return { data: await docxToHtml(data, title), ext: 'html' };
    case 'docx->txt':
      return { data: Buffer.from(await docxToText(data), 'utf8'), ext: 'txt' };
    case 'xlsx->pdf': {
      const [first] = await readXlsx(data);
      return { data: await tableToPdf(first.rows, title), ext: 'pdf' };
    }
    case 'xlsx->csv': {
      const sheets = await readXlsx(data);
      if (sheets.length === 1) return { data: toCsv(sheets[0].rows), ext: 'csv' };
      return { data: await zipFiles(sheets.map((s, i) => ({ name: `${i + 1}-${s.name.replace(/[\\/:*?"<>|]/g, '_')}.csv`, data: toCsv(s.rows) }))), ext: 'zip' };
    }
    case 'xlsx->json': {
      const sheets = await readXlsx(data);
      const value = sheets.length === 1 ? rowsToJson(sheets[0].rows) : Object.fromEntries(sheets.map((s) => [s.name, rowsToJson(s.rows)]));
      return { data: Buffer.from(JSON.stringify(value, null, 2), 'utf8'), ext: 'json' };
    }
    case 'csv->xlsx':
      return { data: await writeXlsx([{ name: 'Sheet1', rows: parseCsv(decodeText(data)) }]), ext: 'xlsx' };
    case 'csv->pdf':
      return { data: await tableToPdf(parseCsv(decodeText(data)), title), ext: 'pdf' };
    case 'csv->json':
      return { data: Buffer.from(JSON.stringify(rowsToJson(parseCsv(decodeText(data))), null, 2), 'utf8'), ext: 'json' };
    case 'json->csv':
      return { data: toCsv(jsonToRows(decodeText(data))), ext: 'csv' };
    case 'json->xlsx':
      return { data: await writeXlsx([{ name: 'Sheet1', rows: jsonToRows(decodeText(data)) }]), ext: 'xlsx' };
    case 'txt->pdf':
    case 'md->pdf':
      return { data: await textToPdf(textToBlocks(decodeText(data), from === 'md'), title), ext: 'pdf' };
    case 'txt->docx':
    case 'md->docx':
      return { data: await blocksToDocx(textToBlocks(decodeText(data), from === 'md')), ext: 'docx' };
    case 'html->txt':
    case 'htm->txt':
      return { data: Buffer.from(htmlToText(decodeText(data)), 'utf8'), ext: 'txt' };
  }
  throw new HttpError(400, 'This conversion is not available.');
}
