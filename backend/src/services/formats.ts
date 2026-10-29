import path from 'node:path';

// Everything the app knows about each file type: its content type, how to recognise real files of that type
// from their first bytes, and whether the browser may show it.

export type FormatKind = 'pdf' | 'image' | 'word' | 'sheet' | 'slides' | 'text' | 'web' | 'archive';

// How a file may be shown in the browser. "text" files are always sent as plain text, so a browser never runs them.
// HTML and SVG can contain scripts, so they are download-only.
export type PreviewMode = 'pdf' | 'image' | 'text' | 'none';

export interface FormatInfo {
  ext: string;
  label: string;
  mime: string;
  kind: FormatKind;
  preview: PreviewMode;
  matches: (data: Buffer) => boolean;
}

const startsWith = (bytes: number[]) => (data: Buffer) => bytes.every((b, i) => data[i] === b);
const ascii = (text: string, offset = 0) => (data: Buffer) => data.subarray(offset, offset + text.length).toString('latin1') === text;
const zip = (data: Buffer) => startsWith([0x50, 0x4b, 0x03, 0x04])(data) || startsWith([0x50, 0x4b, 0x05, 0x06])(data);
const ole = startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // old Office files (.doc, .xls, .ppt)
const plainText = (data: Buffer) => !data.subarray(0, 8192).includes(0);

const LIST: FormatInfo[] = [
  { ext: 'pdf', label: 'PDF', mime: 'application/pdf', kind: 'pdf', preview: 'pdf', matches: ascii('%PDF-') },

  { ext: 'docx', label: 'Word (DOCX)', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'word', preview: 'none', matches: zip },
  { ext: 'doc', label: 'Word 97-2003 (DOC)', mime: 'application/msword', kind: 'word', preview: 'none', matches: ole },
  { ext: 'odt', label: 'OpenDocument Text (ODT)', mime: 'application/vnd.oasis.opendocument.text', kind: 'word', preview: 'none', matches: zip },
  { ext: 'rtf', label: 'Rich Text (RTF)', mime: 'application/rtf', kind: 'word', preview: 'none', matches: ascii('{\\rtf') },

  { ext: 'xlsx', label: 'Excel (XLSX)', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'sheet', preview: 'none', matches: zip },
  { ext: 'xls', label: 'Excel 97-2003 (XLS)', mime: 'application/vnd.ms-excel', kind: 'sheet', preview: 'none', matches: ole },
  { ext: 'ods', label: 'OpenDocument Sheet (ODS)', mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'sheet', preview: 'none', matches: zip },
  { ext: 'csv', label: 'CSV', mime: 'text/csv', kind: 'sheet', preview: 'text', matches: plainText },

  { ext: 'pptx', label: 'PowerPoint (PPTX)', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'slides', preview: 'none', matches: zip },
  { ext: 'ppt', label: 'PowerPoint 97-2003 (PPT)', mime: 'application/vnd.ms-powerpoint', kind: 'slides', preview: 'none', matches: ole },
  { ext: 'odp', label: 'OpenDocument Slides (ODP)', mime: 'application/vnd.oasis.opendocument.presentation', kind: 'slides', preview: 'none', matches: zip },

  { ext: 'txt', label: 'Plain text (TXT)', mime: 'text/plain', kind: 'text', preview: 'text', matches: plainText },
  { ext: 'md', label: 'Markdown (MD)', mime: 'text/markdown', kind: 'text', preview: 'text', matches: plainText },
  { ext: 'json', label: 'JSON', mime: 'application/json', kind: 'text', preview: 'text', matches: plainText },
  { ext: 'xml', label: 'XML', mime: 'application/xml', kind: 'text', preview: 'text', matches: plainText },
  { ext: 'html', label: 'Web page (HTML)', mime: 'text/html', kind: 'web', preview: 'none', matches: plainText },
  { ext: 'htm', label: 'Web page (HTM)', mime: 'text/html', kind: 'web', preview: 'none', matches: plainText },

  { ext: 'png', label: 'PNG image', mime: 'image/png', kind: 'image', preview: 'image', matches: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: 'jpg', label: 'JPEG image', mime: 'image/jpeg', kind: 'image', preview: 'image', matches: startsWith([0xff, 0xd8, 0xff]) },
  { ext: 'jpeg', label: 'JPEG image', mime: 'image/jpeg', kind: 'image', preview: 'image', matches: startsWith([0xff, 0xd8, 0xff]) },
  { ext: 'webp', label: 'WebP image', mime: 'image/webp', kind: 'image', preview: 'image', matches: (d) => ascii('RIFF')(d) && ascii('WEBP', 8)(d) },
  { ext: 'gif', label: 'GIF image', mime: 'image/gif', kind: 'image', preview: 'image', matches: ascii('GIF8') },
  { ext: 'bmp', label: 'Bitmap image (BMP)', mime: 'image/bmp', kind: 'image', preview: 'image', matches: ascii('BM') },
  { ext: 'tif', label: 'TIFF image', mime: 'image/tiff', kind: 'image', preview: 'none', matches: (d) => startsWith([0x49, 0x49, 0x2a, 0x00])(d) || startsWith([0x4d, 0x4d, 0x00, 0x2a])(d) },
  { ext: 'tiff', label: 'TIFF image', mime: 'image/tiff', kind: 'image', preview: 'none', matches: (d) => startsWith([0x49, 0x49, 0x2a, 0x00])(d) || startsWith([0x4d, 0x4d, 0x00, 0x2a])(d) },
  { ext: 'svg', label: 'SVG drawing', mime: 'image/svg+xml', kind: 'image', preview: 'none', matches: plainText },

  { ext: 'zip', label: 'ZIP archive', mime: 'application/zip', kind: 'archive', preview: 'none', matches: zip },
];

export const FORMATS = new Map(LIST.map((f) => [f.ext, f]));
export const KNOWN_EXTENSIONS = LIST.map((f) => f.ext);

// Programs and scripts are never accepted, even when "any file type" is allowed, so the app cannot be used to pass malware around.
export const BLOCKED_EXTENSIONS = [
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs',
  'wsf', 'wsh', 'hta', 'jar', 'apk', 'app', 'sh', 'lnk', 'reg', 'inf', 'msc', 'gadget', 'appx', 'msix',
];

// "*" in the allowed list means "also accept any other, non-blocked file type".
export const ANY_TYPE = '*';

export function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

export function formatOf(ext: string): FormatInfo | undefined {
  return FORMATS.get(ext);
}

export function mimeForExtension(ext: string): string {
  return FORMATS.get(ext)?.mime ?? 'application/octet-stream';
}

// The content type to send when the browser displays a file. Text-like files go out as plain text.
export function inlineContentType(ext: string): string | null {
  const format = FORMATS.get(ext);
  if (!format || format.preview === 'none') return null;
  if (format.preview === 'text') return 'text/plain; charset=utf-8';
  return format.mime;
}
