import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

// Paragraph settings that Word has and the standard editor lacks: line spacing, left indent, first-line indent and
// space before/after. They are kept on paragraphs and headings and written as inline CSS, so they survive copy and
// paste, the .docx export (docx.ts) and printing.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphFormat: (attrs: Partial<Record<'lineHeight' | 'indent' | 'firstLine' | 'spaceBefore' | 'spaceAfter', string | number | null>>) => ReturnType;
      changeIndent: (by: number) => ReturnType;
    };
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}

const BLOCKS = ['paragraph', 'heading'];
const pt = (v: unknown) => (typeof v === 'number' && v !== 0 ? `${v}pt` : null);

// Reads a CSS length in points (pt, px, cm, mm or in).
export function toPt(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(-?[\d.]+)(pt|px|cm|mm|in)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'px';
  const factor = { pt: 1, px: 0.75, cm: 28.3465, mm: 2.83465, in: 72 }[unit] ?? 1;
  return Math.round(n * factor * 10) / 10;
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el) => toPt(el.style.marginLeft) ?? 0,
            renderHTML: (a) => (pt(a.indent) ? { style: `margin-left: ${pt(a.indent)}` } : {}),
          },
          firstLine: {
            default: 0,
            parseHTML: (el) => toPt(el.style.textIndent) ?? 0,
            renderHTML: (a) => (pt(a.firstLine) ? { style: `text-indent: ${pt(a.firstLine)}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => toPt(el.style.marginTop),
            renderHTML: (a) => (typeof a.spaceBefore === 'number' ? { style: `margin-top: ${a.spaceBefore}pt` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => toPt(el.style.marginBottom),
            renderHTML: (a) => (typeof a.spaceAfter === 'number' ? { style: `margin-bottom: ${a.spaceAfter}pt` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphFormat:
        (attrs) =>
        ({ commands }) =>
          BLOCKS.map((type) => commands.updateAttributes(type, attrs)).some(Boolean),
      changeIndent:
        (by) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!BLOCKS.includes(node.type.name)) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(0, Math.min(400, (node.attrs.indent ?? 0) + by)) });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Tab indents a paragraph (in lists, Tab still makes a sub-item).
      Tab: () => (this.editor.isActive('listItem') ? false : this.editor.commands.changeIndent(36)),
      'Shift-Tab': () => (this.editor.isActive('listItem') ? false : this.editor.commands.changeIndent(-36)),
    };
  },
});

// A manual page break (Ctrl+Enter), shown as a dashed line on screen and starting a new page when printed.
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' })];
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertPageBreak() };
  },
});

// Pictures keep a width (in px) so they can be made smaller or larger.
export const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const styled = toPt(el.style.width);
          return Number(el.getAttribute('width')) || (styled ? Math.round(styled / 0.75) : null);
        },
        renderHTML: (a) => (a.width ? { width: a.width, style: `width: ${a.width}px` } : {}),
      },
    };
  },
}).configure({ inline: true, allowBase64: true });
