import { z } from 'zod';

// The saved form of a design: pages, and the elements on each page. Templates and documents both use it.
// The frontend designer (frontend/src/designer/types.ts) writes exactly this shape. schemaVersion lets later
// releases upgrade old saves instead of breaking them.
//
// Images are never embedded: an image element only holds the id of a stored file.

const colour = z.string().max(40);
const finite = z.number().finite();

const baseElement = {
  id: z.string().min(1).max(60),
  name: z.string().max(100).optional(),
  x: finite,
  y: finite,
  width: finite.min(0).max(20000),
  height: finite.min(0).max(20000),
  rotation: finite.default(0),
  opacity: finite.min(0).max(1).default(1),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  groupId: z.string().max(60).nullable().optional(),
};

const textStyle = {
  fontFamily: z.string().max(80),
  fontSize: finite.min(1).max(1000),
  fontStyle: z.enum(['normal', 'bold', 'italic', 'bold italic', 'italic bold']),
  textDecoration: z.enum(['', 'underline', 'line-through']).default(''),
  fill: colour,
  align: z.enum(['left', 'center', 'right', 'justify']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
  lineHeight: finite.min(0.5).max(5).default(1.2),
  letterSpacing: finite.min(-20).max(100).default(0),
  background: colour.default(''),
};

const fieldKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/);

const element = z.discriminatedUnion('type', [
  z.object({ ...baseElement, type: z.literal('text'), text: z.string().max(10000), ...textStyle }),
  z.object({ ...baseElement, type: z.literal('field'), fieldKey, placeholder: z.string().max(200).default(''), ...textStyle }),
  z.object({ ...baseElement, type: z.literal('image'), fileId: z.number().int().positive() }),
  z.object({
    ...baseElement,
    type: z.enum(['rect', 'ellipse']),
    fill: colour,
    stroke: colour,
    strokeWidth: finite.min(0).max(200),
    cornerRadius: finite.min(0).max(1000).default(0),
    dash: z.boolean().default(false),
  }),
  z.object({
    ...baseElement,
    type: z.literal('line'),
    stroke: colour,
    strokeWidth: finite.min(0).max(200),
    dash: z.boolean().default(false),
  }),
  z.object({
    ...baseElement,
    type: z.enum(['barcode', 'qrcode']),
    value: z.string().max(2000),
    fieldKey: fieldKey.nullable().optional(),
    color: colour,
    background: colour,
    showText: z.boolean().default(true),
  }),
]);

export const canvasSchema = z.object({
  schemaVersion: z.literal(1),
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        width: finite.min(50).max(20000),
        height: finite.min(50).max(20000),
        background: colour,
        backgroundFileId: z.number().int().positive().nullable().optional(),
        elements: z.array(element).max(2000),
      }),
    )
    .min(1)
    .max(50),
});

export type CanvasDocument = z.infer<typeof canvasSchema>;

// Per-template settings for each field used on the canvas.
export const templateFieldsSchema = z
  .array(
    z.object({
      fieldKey,
      required: z.boolean().default(false),
      defaultValue: z.string().max(500).default(''),
    }),
  )
  .max(200);

export type TemplateFields = z.infer<typeof templateFieldsSchema>;

// A blank A4 page (794 x 1123 pixels at 96 DPI).
export function blankCanvas(): CanvasDocument {
  return { schemaVersion: 1, pages: [{ id: 'page-1', width: 794, height: 1123, background: '#ffffff', elements: [] }] };
}

// Every stored-file id the canvas refers to, so the server can check they belong to the same office.
export function referencedFileIds(canvas: CanvasDocument): number[] {
  const ids = new Set<number>();
  for (const page of canvas.pages) {
    if (page.backgroundFileId) ids.add(page.backgroundFileId);
    for (const el of page.elements) if (el.type === 'image') ids.add(el.fileId);
  }
  return [...ids];
}
