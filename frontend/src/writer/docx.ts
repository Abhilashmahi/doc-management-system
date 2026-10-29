import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { toPt } from './extensions';
import { pageBox, type PageSetup } from './page';
import { unicodeToBamini } from '../lib/bamini';
import { TAMIL_FONT, isBaminiFont } from './tamil';

// Writes the editor's content as a Word (.docx) file. Tamil is real Unicode Tamil, so it shows correctly in Word,
// WPS and LibreOffice and can be copied from there.

const TWIP = 20; // twips per point
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

function hex(color: unknown): string | undefined {
  if (typeof color !== 'string' || !color) return undefined;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([0-9a-f]{6})/i.exec(color);
  if (long) return long[1];
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return undefined;
}

interface Ctx {
  images: Map<string, { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number }>;
  contentWidth: number; // pt
  listInstance: number;
}

function runsOf(nodes: JSONContent[] | undefined, ctx: Ctx, force: { bold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (node.type === 'image') {
      const img = ctx.images.get(String(node.attrs?.src ?? ''));
      if (!img) continue;
      const wantPx = Number(node.attrs?.width) || img.width;
      const maxPx = (ctx.contentWidth / 0.75) | 0;
      const w = Math.min(wantPx, maxPx);
      out.push(new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: Math.round((img.height * w) / img.width) } }));
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    const style = marks.find((m) => m.type === 'textStyle')?.attrs ?? {};
    const highlight = marks.find((m) => m.type === 'highlight')?.attrs?.color;
    const size = toPt(style.fontSize);
    const font = typeof style.fontFamily === 'string' ? style.fontFamily.split(',')[0].replace(/["']/g, '').trim() : undefined;
    const fill = hex(style.backgroundColor) ?? hex(highlight);
    const legacy = isBaminiFont(font);
    const run = new TextRun({
      // Text in an old Bamini-style font is written as the keys that font draws as Tamil.
      text: legacy ? unicodeToBamini(node.text) : node.text,
      bold: has('bold') || force.bold || undefined,
      italics: has('italic') || undefined,
      underline: has('underline') ? {} : undefined,
      strike: has('strike') || undefined,
      superScript: has('superscript') || undefined,
      subScript: has('subscript') || undefined,
      color: hex(style.color),
      size: size ? Math.round(size * 2) : undefined,
      font: font ? { ascii: font, hAnsi: font, cs: !legacy && /[஀-௿]/.test(node.text) && !/tamil|nirmala|latha|vijaya|arial unicode/i.test(font) ? TAMIL_FONT : font, eastAsia: font } : undefined,
      shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    });
    const link = marks.find((m) => m.type === 'link')?.attrs?.href;
    out.push(link ? new ExternalHyperlink({ link: String(link), children: [run] }) : run);
  }
  return out;
}

function paragraphOptions(node: JSONContent) {
  const a = node.attrs ?? {};
  return {
    alignment: ALIGN[a.textAlign as keyof typeof ALIGN],
    spacing: {
      // "1.5" is a multiple of single spacing; "15.6pt" is an exact distance between lines.
      ...(typeof a.lineHeight === 'string' && a.lineHeight.endsWith('pt')
        ? { line: Math.round(parseFloat(a.lineHeight) * TWIP), lineRule: LineRuleType.EXACT }
        : { line: a.lineHeight ? Math.round(Number(a.lineHeight) * 240) : undefined }),
      before: typeof a.spaceBefore === 'number' ? a.spaceBefore * TWIP : undefined,
      after: typeof a.spaceAfter === 'number' ? a.spaceAfter * TWIP : 0,
    },
    indent: a.indent || a.firstLine ? { left: (a.indent ?? 0) * TWIP, firstLine: a.firstLine > 0 ? a.firstLine * TWIP : undefined, hanging: a.firstLine < 0 ? -a.firstLine * TWIP : undefined } : undefined,
  };
}

function blocks(nodes: JSONContent[] | undefined, ctx: Ctx, list?: { reference: string; level: number; instance: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'paragraph':
        out.push(new Paragraph({ ...paragraphOptions(node), children: runsOf(node.content, ctx), numbering: list }));
        break;
      case 'heading':
        out.push(new Paragraph({ ...paragraphOptions(node), heading: HEADING[Number(node.attrs?.level) || 1], children: runsOf(node.content, ctx) }));
        break;
      case 'bulletList':
      case 'orderedList': {
        const reference = node.type === 'bulletList' ? 'bullets' : 'numbers';
        const level = list ? list.level + 1 : 0;
        const instance = list && list.reference === reference ? list.instance : (ctx.listInstance += 1);
        for (const item of node.content ?? []) {
          // The first paragraph of an item carries the bullet; any others are part of the same item.
          const [first, ...rest] = item.content ?? [];
          if (first) out.push(...blocks([first], ctx, { reference, level: Math.min(level, 8), instance }));
          for (const more of rest) {
            if (more.type === 'paragraph') out.push(new Paragraph({ ...paragraphOptions(more), indent: { left: 720 * (level + 1) }, children: runsOf(more.content, ctx) }));
            else out.push(...blocks([more], ctx, { reference, level: Math.min(level, 8), instance }));
          }
        }
        break;
      }
      case 'blockquote':
        for (const b of blocks(node.content, ctx)) out.push(b);
        break;
      case 'codeBlock':
        out.push(new Paragraph({ children: [new TextRun({ text: (node.content ?? []).map((c) => c.text ?? '').join(''), font: 'Consolas' })] }));
        break;
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, children: [] }));
        break;
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'table':
        out.push(tableOf(node, ctx));
        out.push(new Paragraph({ children: [] }));
        break;
      default:
        if (node.content) out.push(...blocks(node.content, ctx));
    }
  }
  return out;
}

function tableOf(node: JSONContent, ctx: Ctx): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map((cell) => {
          const fill = hex(cell.attrs?.backgroundColor);
          const content = blocks(cell.content, ctx);
          return new TableCell({
            columnSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined,
            rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
            shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
            children: content.length > 0 ? content : [new Paragraph({ children: [] })],
          });
        }),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function loadImages(json: JSONContent): Promise<Ctx['images']> {
  const sources = new Set<string>();
  const visit = (n: JSONContent) => {
    if (n.type === 'image' && n.attrs?.src) sources.add(String(n.attrs.src));
    n.content?.forEach(visit);
  };
  visit(json);
  const images: Ctx['images'] = new Map();
  for (const src of sources) {
    try {
      const blob = await (await fetch(src)).blob();
      const bitmap = await createImageBitmap(blob);
      let type: 'png' | 'jpg' | 'gif' | 'bmp' = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/bmp' ? 'bmp' : 'png';
      let data = new Uint8Array(await blob.arrayBuffer());
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/bmp'].includes(blob.type)) {
        // WebP, SVG and others are turned into PNG, which Word always shows.
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        data = new Uint8Array(await (await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('image'))), 'image/png'))).arrayBuffer());
        type = 'png';
      }
      images.set(src, { data, type, width: bitmap.width, height: bitmap.height });
    } catch {
      // A picture that cannot be read is left out rather than stopping the save.
    }
  }
  return images;
}

export async function toDocx(json: JSONContent, page: PageSetup, title: string): Promise<Blob> {
  const box = pageBox(page);
  const ctx: Ctx = { images: await loadImages(json), contentWidth: box.width - page.margins.left - page.margins.right, listInstance: 0 };
  const bulletLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: ['•', '◦', '▪'][level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const numberLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new Document({
    title,
    creator: 'e-Sevai Document Manager',
    styles: { default: { document: { run: { font: { ascii: TAMIL_FONT, hAnsi: TAMIL_FONT, cs: TAMIL_FONT }, size: 24 } } } },
    numbering: { config: [{ reference: 'bullets', levels: bulletLevels }, { reference: 'numbers', levels: numberLevels }] },
    sections: [
      {
        properties: {
          page: {
            size: { width: Math.round(page.width * TWIP), height: Math.round(page.height * TWIP), orientation: page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: page.margins.top * TWIP, right: page.margins.right * TWIP, bottom: page.margins.bottom * TWIP, left: page.margins.left * TWIP },
          },
        },
        children: blocks(json.content, ctx),
      },
    ],
  });
  return Packer.toBlob(doc);
}
