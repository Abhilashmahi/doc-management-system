import JSZip from 'jszip';
import { baminiToUnicode, looksLikeBamini } from '../lib/bamini';
import { buildLines, type Line, type RawItem } from '../pdfedit/lines';
import { loadLib } from '../tools/pdfjs';
import { DEFAULT_PAGE, type PageSetup } from './page';
import { TAMIL_FONT, fixPastedText, isAddedLegacyFont, isBaminiFont } from './tamil';

// Opens Word (.docx), PDF, text and HTML files as editor HTML. Tamil stored with the old Bamini font (as in
// "mDg;Geh;") is turned into real Unicode Tamil while reading, so it can be edited, copied and pasted anywhere.

export interface Imported {
  html: string;
  page: PageSetup;
  bamini: boolean; // some Bamini text was converted
}

export async function importFile(name: string, data: ArrayBuffer): Promise<Imported> {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx' || ext === 'dotx') return importDocx(data);
  if (ext === 'pdf') return importPdf(data);
  if (ext === 'html' || ext === 'htm') {
    const html = new TextDecoder().decode(data);
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    return { html: body, page: DEFAULT_PAGE, bamini: false };
  }
  if (['txt', 'md', 'csv', 'json', 'xml', 'log'].includes(ext)) {
    const raw = new TextDecoder().decode(data);
    const text = fixPastedText(raw);
    return { html: textToHtml(text), page: DEFAULT_PAGE, bamini: text !== raw };
  }
  if (ext === 'doc' || ext === 'rtf' || ext === 'odt') {
    throw new Error(`.${ext} files cannot be opened here directly. Use Convert on the document's page to make a .docx first, or open it in Word and "Save as" .docx.`);
  }
  throw new Error('This file type cannot be opened in the Writer. Open a .docx, PDF, text or HTML file.');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${esc(line).replace(/\t/g, '&emsp;&emsp;').replace(/ {2}/g, ' &nbsp;')}</p>`)
    .join('');
}

// ---------- Word (.docx) ----------

type El = Element;
const kids = (el: El | null | undefined, name?: string) => (el ? Array.from(el.children).filter((c) => !name || c.localName === name) : []);
const kid = (el: El | null | undefined, name: string) => kids(el, name)[0] ?? null;
const val = (el: El | null | undefined, name = 'val') => {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
};
const deep = (el: El, name: string) => Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name);
const on = (el: El | null) => Boolean(el) && !['0', 'false', 'off', 'none'].includes(val(el) ?? 'true');
const twipsToPt = (v: string | null) => (v ? Math.round(Number(v) / 2) / 10 : 0);

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number; // pt
  color?: string;
  background?: string;
  font?: string;
  vert?: 'superscript' | 'subscript';
  caps?: boolean;
}

interface ParaProps {
  align?: string;
  indent?: number;
  firstLine?: number;
  lineHeight?: number;
  before?: number;
  after?: number;
  heading?: number;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

function readRunProps(rPr: El | null): RunProps {
  if (!rPr) return {};
  const p: RunProps = {};
  const flag = (name: string) => (kid(rPr, name) ? on(kid(rPr, name)) : undefined);
  p.bold = flag('b');
  p.italic = flag('i');
  p.strike = flag('strike') ?? flag('dstrike');
  p.caps = flag('caps');
  const u = kid(rPr, 'u');
  if (u) p.underline = val(u) !== 'none';
  const sz = val(kid(rPr, 'sz'));
  if (sz) p.size = Number(sz) / 2;
  const color = val(kid(rPr, 'color'));
  if (color && color !== 'auto') p.color = `#${color}`;
  const hl = val(kid(rPr, 'highlight'));
  const shd = val(kid(rPr, 'shd'), 'fill');
  if (hl && HIGHLIGHT[hl]) p.background = HIGHLIGHT[hl];
  else if (shd && shd !== 'auto' && /^[0-9a-f]{6}$/i.test(shd) && shd.toLowerCase() !== 'ffffff') p.background = `#${shd}`;
  const fonts = kid(rPr, 'rFonts');
  const font = val(fonts, 'ascii') ?? val(fonts, 'hAnsi') ?? val(fonts, 'cs');
  if (font) p.font = font;
  const vert = val(kid(rPr, 'vertAlign'));
  if (vert === 'superscript' || vert === 'subscript') p.vert = vert;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as RunProps;
}

function readParaProps(pPr: El | null): ParaProps {
  if (!pPr) return {};
  const p: ParaProps = {};
  const jc = val(kid(pPr, 'jc'));
  if (jc) p.align = { both: 'justify', distribute: 'justify', start: 'left', end: 'right', center: 'center', right: 'right', left: 'left' }[jc] ?? undefined;
  const ind = kid(pPr, 'ind');
  if (ind) {
    const left = val(ind, 'left') ?? val(ind, 'start');
    if (left) p.indent = twipsToPt(left);
    const first = val(ind, 'firstLine');
    const hanging = val(ind, 'hanging');
    if (first) p.firstLine = twipsToPt(first);
    else if (hanging) p.firstLine = -twipsToPt(hanging);
  }
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const line = val(sp, 'line');
    const rule = val(sp, 'lineRule');
    if (line && (!rule || rule === 'auto')) p.lineHeight = Math.round((Number(line) / 240) * 100) / 100;
    const before = val(sp, 'before');
    const after = val(sp, 'after');
    if (before) p.before = twipsToPt(before);
    if (after) p.after = twipsToPt(after);
  }
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as ParaProps;
}

interface Style {
  basedOn: string | null;
  run: RunProps;
  para: ParaProps;
}

interface DocxContext {
  styles: Map<string, Style>;
  defaults: { run: RunProps; para: ParaProps };
  numbering: Map<string, Map<number, string>>; // numId → level → numFmt
  rels: Map<string, string>;
  media: Map<string, string>; // target path → data URL
  baminiFonts: Set<string>; // fonts whose text reads as Bamini in this file
  converted: boolean;
}

function styleChain(ctx: DocxContext, id: string | null): Style[] {
  const chain: Style[] = [];
  for (let i = 0, s = id ? ctx.styles.get(id) : undefined; s && i < 10; i += 1, s = s.basedOn ? ctx.styles.get(s.basedOn) : undefined) chain.unshift(s);
  return chain;
}

async function importDocx(data: ArrayBuffer): Promise<Imported> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This Word file could not be read. It may be damaged, password-protected, or an old .doc file renamed to .docx.');
  }
  const read = async (path: string) => {
    const file = zip.file(path);
    return file ? new DOMParser().parseFromString(await file.async('text'), 'application/xml') : null;
  };
  const doc = await read('word/document.xml');
  if (!doc) throw new Error('This is not a Word document (word/document.xml is missing).');

  const ctx: DocxContext = { styles: new Map(), defaults: { run: {}, para: {} }, numbering: new Map(), rels: new Map(), media: new Map(), baminiFonts: new Set(), converted: false };

  const styles = await read('word/styles.xml');
  if (styles) {
    const defaults = deep(styles.documentElement, 'docDefaults')[0];
    ctx.defaults = { run: readRunProps(defaults ? deep(defaults, 'rPr')[0] ?? null : null), para: readParaProps(defaults ? deep(defaults, 'pPr')[0] ?? null : null) };
    for (const s of kids(styles.documentElement, 'style')) {
      const id = val(s, 'styleId');
      if (!id) continue;
      const name = (val(kid(s, 'name')) ?? '').toLowerCase();
      const para = readParaProps(kid(s, 'pPr'));
      const heading = /^heading ([1-6])$/.exec(name)?.[1] ?? (name === 'title' ? '1' : null);
      if (heading) para.heading = Number(heading);
      ctx.styles.set(id, { basedOn: val(kid(s, 'basedOn')), run: readRunProps(kid(s, 'rPr')), para });
    }
  }

  const numbering = await read('word/numbering.xml');
  if (numbering) {
    const abstract = new Map<string, Map<number, string>>();
    for (const a of kids(numbering.documentElement, 'abstractNum')) {
      const levels = new Map<number, string>();
      for (const lvl of kids(a, 'lvl')) levels.set(Number(val(lvl, 'ilvl')), val(kid(lvl, 'numFmt')) ?? 'bullet');
      abstract.set(val(a, 'abstractNumId') ?? '', levels);
    }
    for (const n of kids(numbering.documentElement, 'num')) {
      const levels = abstract.get(val(kid(n, 'abstractNumId')) ?? '');
      if (levels) ctx.numbering.set(val(n, 'numId') ?? '', levels);
    }
  }

  const rels = await read('word/_rels/document.xml.rels');
  if (rels) for (const r of kids(rels.documentElement, 'Relationship')) ctx.rels.set(val(r, 'Id') ?? '', val(r, 'Target') ?? '');
  for (const [, target] of ctx.rels) {
    const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    const file = /\.(png|jpe?g|gif|bmp|webp)$/i.test(path) ? zip.file(path) : null;
    if (file) {
      const ext = path.split('.').pop()!.toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      ctx.media.set(target, `data:${mime};base64,${await file.async('base64')}`);
    }
  }

  const body = kid(doc.documentElement, 'body');
  if (!body) throw new Error('This Word document has no body.');

  // Decide per font which fonts hold Bamini text (a PDF converted to Word often names a normal font).
  const byFont = new Map<string, string[]>();
  for (const r of deep(body, 'r')) {
    const text = deep(r, 't').map((t) => t.textContent ?? '').join('');
    if (!text.trim()) continue;
    const font = runFont(ctx, r);
    byFont.set(font, [...(byFont.get(font) ?? []), text]);
  }
  for (const [font, texts] of byFont) if (isBaminiFont(font) || looksLikeBamini(texts.join(' '))) ctx.baminiFonts.add(font);

  const html = blocksToHtml(ctx, kids(body));
  const page = readPage(kid(body, 'sectPr'));
  return { html, page, bamini: ctx.converted };
}

function runFont(ctx: DocxContext, r: El): string {
  const own = readRunProps(kid(r, 'rPr')).font;
  if (own) return own;
  let p: El | null = r.parentElement;
  while (p && p.localName !== 'p') p = p.parentElement;
  const styleId = val(kid(kid(p, 'pPr'), 'pStyle'));
  for (const s of styleChain(ctx, styleId).reverse()) if (s.run.font) return s.run.font;
  return ctx.defaults.run.font ?? '';
}

function readPage(sectPr: El | null): PageSetup {
  if (!sectPr) return DEFAULT_PAGE;
  const size = kid(sectPr, 'pgSz');
  const mar = kid(sectPr, 'pgMar');
  const w = Number(val(size, 'w')) / 20 || DEFAULT_PAGE.width;
  const h = Number(val(size, 'h')) / 20 || DEFAULT_PAGE.height;
  const m = (name: string, fallback: number) => (val(mar, name) ? Number(val(mar, name)) / 20 : fallback);
  return {
    width: Math.min(w, h),
    height: Math.max(w, h),
    landscape: w > h,
    margins: { top: m('top', 72), right: m('right', 72), bottom: m('bottom', 72), left: m('left', 72) },
  };
}

function blocksToHtml(ctx: DocxContext, elements: El[]): string {
  let html = '';
  const lists: { tag: string; level: number }[] = [];
  const closeLists = (toLevel: number) => {
    while (lists.length > 0 && lists[lists.length - 1].level >= toLevel) html += `</li></${lists.pop()!.tag}>`;
  };
  for (const el of elements) {
    if (el.localName === 'sdt') {
      closeLists(0);
      html += blocksToHtml(ctx, kids(kid(el, 'sdtContent')));
      continue;
    }
    if (el.localName === 'tbl') {
      closeLists(0);
      html += tableToHtml(ctx, el);
      continue;
    }
    if (el.localName !== 'p') continue;
    const pPr = kid(el, 'pPr');
    const numPr = kid(pPr, 'numPr');
    const numId = val(kid(numPr, 'numId'));
    const level = Number(val(kid(numPr, 'ilvl')) ?? 0);
    const extra: El[] = [];
    const para = paragraphToHtml(ctx, el, extra);
    if (numId && numId !== '0' && ctx.numbering.has(numId)) {
      const fmt = ctx.numbering.get(numId)!.get(level) ?? 'bullet';
      const tag = fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
      const top = lists[lists.length - 1];
      if (top && top.level === level && top.tag === tag) html += '</li><li>';
      else if (top && top.level < level) {
        html += `<${tag}><li>`;
        lists.push({ tag, level });
      } else {
        closeLists(level);
        const again = lists[lists.length - 1];
        if (again && again.level === level && again.tag === tag) html += '</li><li>';
        else {
          html += `<${tag}><li>`;
          lists.push({ tag, level });
        }
      }
      html += para;
    } else {
      closeLists(0);
      html += para;
    }
    if (extra.length > 0) {
      closeLists(0);
      html += blocksToHtml(ctx, extra);
    }
  }
  closeLists(0);
  return html;
}

function tableToHtml(ctx: DocxContext, tbl: El): string {
  const rows = kids(tbl, 'tr');
  // Cells merged downwards (vMerge) become one cell with a rowspan.
  const grid: { el: El; col: number; span: number; rowspan: number; skip: boolean }[][] = rows.map((tr) => {
    let col = 0;
    return kids(tr, 'tc').map((tc) => {
      const tcPr = kid(tc, 'tcPr');
      const span = Number(val(kid(tcPr, 'gridSpan')) ?? 1);
      const vMerge = kid(tcPr, 'vMerge');
      const cell = { el: tc, col, span, rowspan: 1, skip: Boolean(vMerge) && val(vMerge) !== 'restart' };
      col += span;
      return cell;
    });
  });
  grid.forEach((row, r) =>
    row.forEach((cell) => {
      if (cell.skip) return;
      for (let below = r + 1; below < grid.length; below += 1) {
        const next = grid[below].find((c) => c.col === cell.col);
        if (!next?.skip) break;
        cell.rowspan += 1;
      }
    }),
  );
  let html = '<table><tbody>';
  for (const row of grid) {
    html += '<tr>';
    for (const cell of row) {
      if (cell.skip) continue;
      const fill = val(kid(kid(cell.el, 'tcPr'), 'shd'), 'fill');
      const attrs = `${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}${fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'ffffff' ? ` style="background-color:#${fill}"` : ''}`;
      html += `<td${attrs}>${blocksToHtml(ctx, kids(cell.el)) || '<p></p>'}</td>`;
    }
    html += '</tr>';
  }
  return `${html}</tbody></table>`;
}

function paragraphToHtml(ctx: DocxContext, p: El, extra: El[]): string {
  const pPr = kid(p, 'pPr');
  const styleId = val(kid(pPr, 'pStyle'));
  const chain = styleChain(ctx, styleId);
  const para: ParaProps = Object.assign({}, ctx.defaults.para, ...chain.map((s) => s.para), readParaProps(pPr));
  const baseRun: RunProps = Object.assign({}, ctx.defaults.run, ...chain.map((s) => s.run));

  // The runs of the paragraph, including those inside links, tracked insertions and content controls.
  const runs: El[] = [];
  const collect = (el: El) => {
    for (const c of kids(el)) {
      if (c.localName === 'r') runs.push(c);
      else if (c.localName === 'AlternateContent') collect(kid(c, 'Choice') ?? c);
      else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple', 'customXml', 'Choice'].includes(c.localName)) collect(c);
    }
  };
  collect(p);

  const paraText = runs.map((r) => deep(r, 't').map((t) => t.textContent ?? '').join('')).join('');
  const paraIsBamini = looksLikeBamini(paraText);

  let inner = '';
  let pageBreakAfter = false;
  for (const r of runs) {
    const props: RunProps = { ...baseRun, ...runStyleProps(ctx, r), ...readRunProps(kid(r, 'rPr')) };
    const font = props.font ?? '';
    const bamini = isBaminiFont(font) || (ctx.baminiFonts.has(runFont(ctx, r)) && paraIsBamini);
    // The text becomes Unicode Tamil; an old font added to the website is kept, since printing uses it again.
    if (bamini && !isAddedLegacyFont(font)) props.font = TAMIL_FONT;
    let text = '';
    const flush = () => {
      if (!text) return;
      let t = bamini ? baminiToUnicode(text) : text;
      if (bamini && t !== text) ctx.converted = true;
      if (props.caps) t = t.toUpperCase();
      inner += wrapRun(esc(t).replace(/ {2}/g, ' &nbsp;'), props, para.heading ? baseRun : undefined);
      text = '';
    };
    const walk = (el: El) => {
      for (const c of kids(el)) {
        switch (c.localName) {
          case 't':
            text += c.textContent ?? '';
            break;
          case 'tab':
            text += '  ';
            break;
          case 'noBreakHyphen':
            text += '-';
            break;
          case 'br':
          case 'cr':
            flush();
            if (val(c, 'type') === 'page') pageBreakAfter = true;
            else inner += '<br>';
            break;
          case 'AlternateContent':
            walk(kid(c, 'Choice') ?? c);
            break;
          case 'drawing':
          case 'pict':
          case 'object': {
            flush();
            // Text boxes (common in PDFs converted to Word) are opened as normal paragraphs after this one.
            const boxes = deep(c, 'txbxContent');
            if (boxes.length > 0) {
              for (const box of boxes) extra.push(...kids(box));
              break;
            }
            const blip = deep(c, 'blip')[0] ?? deep(c, 'imagedata')[0];
            const target = ctx.rels.get(val(blip, 'embed') ?? val(blip, 'id') ?? '');
            const src = target ? ctx.media.get(target) : undefined;
            if (src) {
              const extent = deep(c, 'extent')[0];
              const width = extent ? Math.round(Number(val(extent, 'cx')) / 9525) : null;
              inner += `<img src="${src}"${width ? ` width="${width}"` : ''}>`;
            }
            break;
          }
          default:
            break;
        }
      }
    };
    walk(r);
    flush();
  }

  const style = [
    para.indent ? `margin-left:${para.indent}pt` : '',
    para.firstLine ? `text-indent:${para.firstLine}pt` : '',
    para.lineHeight ? `line-height:${para.lineHeight}` : '',
    para.before !== undefined ? `margin-top:${para.before}pt` : '',
    para.after !== undefined ? `margin-bottom:${para.after}pt` : '',
    para.align && para.align !== 'left' ? `text-align:${para.align}` : '',
  ]
    .filter(Boolean)
    .join(';');
  const tag = para.heading ? `h${Math.min(para.heading, 3)}` : 'p';
  const pageBreakBefore = on(kid(pPr, 'pageBreakBefore'));
  return `${pageBreakBefore ? '<div data-page-break></div>' : ''}<${tag}${style ? ` style="${style}"` : ''}>${inner}</${tag}>${pageBreakAfter ? '<div data-page-break></div>' : ''}`;
}

function runStyleProps(ctx: DocxContext, r: El): RunProps {
  const id = val(kid(kid(r, 'rPr'), 'rStyle'));
  return Object.assign({}, ...styleChain(ctx, id).map((s) => s.run));
}

// Writes a run's formatting as HTML the editor understands. In headings, the heading's own size and boldness are
// left to the heading style.
function wrapRun(text: string, p: RunProps, headingBase?: RunProps): string {
  const css: string[] = [];
  if (p.font) css.push(`font-family:'${p.font.replace(/'/g, '')}'`);
  if (p.size && p.size !== headingBase?.size) css.push(`font-size:${p.size}pt`);
  if (p.color && p.color.toLowerCase() !== '#000000') css.push(`color:${p.color}`);
  if (p.background) css.push(`background-color:${p.background}`);
  let out = css.length > 0 ? `<span style="${css.join(';')}">${text}</span>` : text;
  if (p.bold && !headingBase) out = `<strong>${out}</strong>`;
  if (p.italic) out = `<em>${out}</em>`;
  if (p.underline) out = `<u>${out}</u>`;
  if (p.strike) out = `<s>${out}</s>`;
  if (p.vert === 'superscript') out = `<sup>${out}</sup>`;
  if (p.vert === 'subscript') out = `<sub>${out}</sub>`;
  return out;
}

// ---------- PDF ----------

// Reads the PDF's text lines and joins them into paragraphs, keeping the PDF's look as closely as an editable page
// can: the page size and margins, indents, centred and justified paragraphs, bold words, line spacing, and a text
// size at which lines break where they break in the PDF. Columns, pictures and drawn boxes are not kept.
async function importPdf(data: ArrayBuffer): Promise<Imported> {
  const pdfjs = await loadLib();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    if (pdf.numPages > 200) throw new Error(`This PDF has ${pdf.numPages} pages. The Writer opens PDFs of up to 200 pages.`);
    const pages: { items: RawItem[]; width: number; height: number }[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const [x0, y0, x1, y1] = page.view;
      const items = content.items.filter((it) => 'str' in it) as unknown as RawItem[];
      pages.push({ items: await markBold(page as unknown as OperatorSource, pdfjs.OPS as unknown as Record<string, number>, items), width: x1 - x0, height: y1 - y0 });
    }
    const all = pages.flatMap((p) => p.items);
    if (all.every((it) => !it.str.trim())) throw new Error('This PDF has no text to open (it is probably a scanned picture). Use OCR first, or type the text.');

    const byFont = new Map<string, string[]>();
    for (const it of all) byFont.set(it.fontName, [...(byFont.get(it.fontName) ?? []), it.str]);
    const bamini = new Set([...byFont].filter(([, s]) => looksLikeBamini(s.join(' '))).map(([f]) => f));
    const decode = (s: string, font: string) => (bamini.has(font) ? baminiToUnicode(s) : s);

    const pageLines = pages.map((p, i) => buildLines(i + 1, p.items, decode));
    const lines = pageLines.flat();
    const first = pages[0];
    const left = Math.min(...lines.map((l) => l.x));
    const right = Math.max(...lines.map((l) => l.x + l.w));
    const top = Math.max(...(pageLines.find((p) => p.length > 0) ?? lines).map((l) => l.y + l.size * 0.85));
    const page: PageSetup = {
      width: Math.min(first.width, first.height),
      height: Math.max(first.width, first.height),
      landscape: first.width > first.height,
      // The PDF's own margins, so lines are as wide as in the PDF.
      margins: {
        top: clampMargin(first.height - top),
        bottom: clampMargin(Math.min(...pageLines.flatMap((onPage) => onPage.map((l) => l.y - l.size * 0.3))) - 2),
        left: clampMargin(left),
        right: clampMargin(first.width - right),
      },
    };
    const scale = sizeScale(lines);
    const textWidth = right - left;
    // The usual distance between lines, from lines that follow each other closely.
    const closeGaps = pageLines.flatMap((onPage) => onPage.slice(1).map((l, k) => onPage[k].y - l.y).filter((g, k) => g > 0 && g < onPage[k].size * 1.75));
    const lineGap = closeGaps.length > 0 ? median(closeGaps) : 14;
    const reachesRight = (l: Line) => l.x + l.w >= right - Math.max(l.size * 1.5, textWidth * 0.03);

    let html = '';
    pageLines.forEach((onPage, i) => {
      if (onPage.length === 0) return;
      if (i > 0 && html) html += '<div data-page-break></div>';
      let current: Line[] | null = null;
      const out: Line[][] = [];
      for (const line of onPage) {
        const prev = current?.[current.length - 1];
        const gap = prev ? prev.y - line.y : 0;
        const prevEndsShort = prev ? prev.x + prev.w < right - Math.max(prev.size * 3, textWidth * 0.12) : true;
        const sameStart = prev && current ? Math.abs(line.x - (current.length > 1 ? current[1].x : left)) < prev.size * 1.5 : false;
        // A line that starts far to the right (as in a signature block) is a paragraph of its own.
        const farRight = current?.length === 1 && current[0].x - left > textWidth * 0.25;
        const joins = prev && gap > 0 && gap < prev.size * 1.75 && !prevEndsShort && !farRight && Math.abs(line.size - prev.size) < 1.5 && (sameStart || line.x <= prev.x + 2);
        if (joins && current) current.push(line);
        else {
          current = [line];
          out.push(current);
        }
      }
      out.forEach((para, n) => {
        const firstLine = para[0];
        // A blank line in the PDF (a gap of about two lines) becomes an empty paragraph.
        const above = out[n - 1]?.[out[n - 1].length - 1];
        // Its height is the extra space, so the page is as tall as the PDF's.
        const space = above ? above.y - firstLine.y : 0;
        if (above && space > Math.max(above.size, firstLine.size) * 2.2) html += `<p style="line-height:${Math.round((space - lineGap) * 10) / 10}pt"></p>`;
        const body = para[1] ?? firstLine;
        const pdfSize = Math.max(...para.map((l) => l.size));
        const size = Math.round(pdfSize * scale * 2) / 2;
        const indent = Math.max(0, Math.round(body.x - left));
        const firstIndent = Math.round(firstLine.x - body.x);
        const lineCentre = firstLine.x + firstLine.w / 2;
        const centred = para.length === 1 && firstLine.x - left > textWidth * 0.12 && Math.abs(lineCentre - (left + right) / 2) < textWidth * 0.06;
        // Justified in the PDF: every line but the last reaches the right margin.
        const justified = para.length > 1 && para.slice(0, -1).every(reachesRight);
        // Line spacing: the distance between baselines, in points as in the PDF.
        const gaps = para.slice(1).map((l, k) => para[k].y - l.y);
        const next = out[n + 1]?.[0];
        if (gaps.length === 0 && next && firstLine.y - next.y < pdfSize * 1.75) gaps.push(firstLine.y - next.y);
        const lineHeight = gaps.length > 0 ? Math.round(median(gaps) * 10) / 10 : null;
        const style = [
          centred ? 'text-align:center' : '',
          !centred && indent > 4 ? `margin-left:${indent}pt` : '',
          !centred && Math.abs(firstIndent) > 4 ? `text-indent:${firstIndent}pt` : '',
          justified ? 'text-align:justify' : '',
          lineHeight && lineHeight >= size * 0.9 && lineHeight <= size * 3 ? `line-height:${lineHeight}pt` : '',
        ]
          .filter(Boolean)
          .join(';');
        const font = para.some((l) => l.bamini) ? `font-family:'${TAMIL_FONT}';` : '';
        // Bold pieces, with the lines of the paragraph joined by spaces.
        const runs = para.flatMap((l, k) => (k === 0 ? l.runs : [{ text: ' ', bold: false }, ...l.runs]));
        const inner = runs.map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join('');
        html += `<p${style ? ` style="${style}"` : ''}><span style="${font}font-size:${size}pt">${inner}</span></p>`;
      });
    });
    return { html, page, bamini: bamini.size > 0 };
  } finally {
    void pdf.loadingTask.destroy();
  }
}

const clampMargin = (pt: number) => Math.round(Math.max(18, Math.min(144, pt)));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

let measureCtx: CanvasRenderingContext2D | null = null;

// The PDF's font is usually not the one the page shows (an old Bamini font becomes Nirmala UI), and fonts differ in
// width. This finds the size change at which lines that end naturally (not stretched by justification) are as wide
// as in the PDF, so the text wraps at the same words.
function sizeScale(lines: Line[]): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 1;
  const ratios: number[] = [];
  for (const line of lines) {
    if (line.text.length < 12) continue;
    let width = 0;
    for (const run of line.runs) {
      measureCtx.font = `${run.bold ? 'bold ' : ''}${line.size}px "${line.bamini ? TAMIL_FONT : 'Calibri'}", "${TAMIL_FONT}", sans-serif`;
      width += measureCtx.measureText(run.text).width;
    }
    if (width > 0) ratios.push(line.w / width);
  }
  if (ratios.length === 0) return 1;
  // The narrowest lines are the ones not stretched by justification.
  const sorted = ratios.sort((a, b) => a - b);
  const natural = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  return Math.max(0.7, Math.min(1.6, median(natural)));
}

interface OperatorSource {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

// Many PDFs (Word and WPS among them) make bold by drawing the letters filled and outlined, not with a bold font.
// PDF.js does not report that with the text, so the drawing instructions are read to find those pieces.
async function markBold(page: OperatorSource, OPS: Record<string, number>, items: RawItem[]): Promise<RawItem[]> {
  const ops = await page.getOperatorList();
  const runs: { x: number; y: number; end: number }[] = [];
  let mode = 0;
  const saved: number[] = [];
  let x = 0;
  let y = 0;
  let fontSize = 12;
  let charSpacing = 0;
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] ?? [];
    // The drawing mode is part of the saved graphics state, so a restore brings back the earlier one.
    if (fn === OPS.save) saved.push(mode);
    else if (fn === OPS.restore) mode = saved.pop() ?? 0;
    else if (fn === OPS.setTextRenderingMode) mode = Number(args[0]);
    else if (fn === OPS.setFont) fontSize = Math.abs(Number(args[1])) || fontSize;
    else if (fn === OPS.setCharSpacing) charSpacing = Number(args[0]) || 0;
    else if (fn === OPS.setTextMatrix) {
      const m = (args[0] && typeof args[0] === 'object' ? args[0] : args) as ArrayLike<number>;
      x = Number(m[4]);
      y = Number(m[5]);
    } else if (fn === OPS.showText) {
      // Where the drawn text starts and ends on the line.
      const glyphs = (args[0] ?? []) as ({ width?: number } | number | null)[];
      let width = 0;
      for (const g of glyphs) {
        if (g && typeof g === 'object') width += ((g.width ?? 0) * fontSize) / 1000 + charSpacing;
        else if (typeof g === 'number') width -= (g * fontSize) / 1000;
      }
      if (mode === 1 || mode === 2) runs.push({ x, y, end: x + width });
      x += width;
    }
  });
  if (runs.length === 0) return items;

  const result: RawItem[] = [];
  for (const item of items) {
    const ix = item.transform[4];
    const iy = item.transform[5];
    const mine = runs.filter((r) => Math.abs(r.y - iy) < 1 && r.end > ix && r.x < ix + Math.max(item.width, 1));
    if (mine.length === 0 || !item.str) {
      result.push(item);
      continue;
    }
    // Whole words are bold or not (splitting inside a word would separate Bamini's ெ ே ை keys from their letter):
    // a word is bold when its middle lies in a bold piece.
    const bold = new Array<boolean>(item.str.length).fill(false);
    const len = item.str.length;
    for (const word of item.str.matchAll(/\S+/g)) {
      const from = word.index ?? 0;
      const to = from + word[0].length;
      const middle = ix + (item.width * (from + to)) / 2 / len;
      if (mine.some((r) => middle >= r.x && middle <= r.end)) bold.fill(true, from, to);
    }
    // Split the piece where boldness changes; the width is shared out by letters.
    let start = 0;
    for (let k = 1; k <= item.str.length; k += 1) {
      if (k < item.str.length && bold[k] === bold[start]) continue;
      const str = item.str.slice(start, k);
      const t = [...item.transform];
      t[4] = ix + (item.width * start) / item.str.length;
      result.push({ ...item, str, transform: t, width: (item.width * str.length) / item.str.length, bold: bold[start] });
      start = k;
    }
  }
  return result;
}
