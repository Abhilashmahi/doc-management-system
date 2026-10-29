// The saved form of a design. It must match canvasSchema in backend/src/services/canvas.ts,
// because the server checks every save against that schema.

export interface BaseElement {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  // Elements that share a groupId move and get selected together.
  groupId?: string | null;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'bold italic';
  textDecoration: '' | 'underline' | 'line-through';
  fill: string;
  align: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  background: string;
}

export interface TextElement extends BaseElement, TextStyle {
  type: 'text';
  text: string;
}

// A placeholder that shows the value typed into the form for its field, e.g. {{FullName}}.
export interface FieldElement extends BaseElement, TextStyle {
  type: 'field';
  fieldKey: string;
  placeholder: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  fileId: number;
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  dash: boolean;
}

// A straight line from (x, y) to (x + width, y + height).
export interface LineElement extends BaseElement {
  type: 'line';
  stroke: string;
  strokeWidth: number;
  dash: boolean;
}

// Barcodes and QR codes show either a fixed value or the value of a field.
export interface CodeElement extends BaseElement {
  type: 'barcode' | 'qrcode';
  value: string;
  fieldKey?: string | null;
  color: string;
  background: string;
  showText: boolean;
}

export type CanvasElement = TextElement | FieldElement | ImageElement | ShapeElement | LineElement | CodeElement;

export interface CanvasPage {
  id: string;
  width: number;
  height: number;
  background: string;
  backgroundFileId?: number | null;
  elements: CanvasElement[];
}

export interface CanvasDocument {
  schemaVersion: 1;
  pages: CanvasPage[];
}

// Page sizes in pixels at 96 DPI.
export const PAGE_SIZES: { label: string; width: number; height: number }[] = [
  { label: 'A4 portrait', width: 794, height: 1123 },
  { label: 'A4 landscape', width: 1123, height: 794 },
  { label: 'A5 portrait', width: 559, height: 794 },
  { label: 'Letter portrait', width: 816, height: 1056 },
  { label: 'Legal portrait', width: 816, height: 1344 },
  { label: 'ID card (CR80)', width: 324, height: 204 },
];

export const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Nirmala UI', // has Tamil and other Indian scripts on Windows
  'Latha',
];

export function newId(prefix = 'el'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function blankCanvas(): CanvasDocument {
  return { schemaVersion: 1, pages: [{ id: newId('page'), width: 794, height: 1123, background: '#ffffff', elements: [] }] };
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 18,
  fontStyle: 'normal',
  textDecoration: '',
  fill: '#0f172a',
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.2,
  letterSpacing: 0,
  background: '',
};

// The text a field element shows: the typed value, else the template default, else {{FieldKey}}.
export function fieldDisplayText(el: FieldElement, values: Record<string, string> | null): string {
  if (values) {
    const v = values[el.fieldKey];
    if (v !== undefined && v !== '') return v;
    return el.placeholder || '';
  }
  return el.placeholder || `{{${el.fieldKey}}}`;
}

// The value encoded by a barcode / QR code element.
export function codeValue(el: CodeElement, values: Record<string, string> | null): string {
  if (el.fieldKey) {
    const v = values?.[el.fieldKey];
    if (v) return v;
    return values ? '' : `{{${el.fieldKey}}}`;
  }
  return el.value;
}
