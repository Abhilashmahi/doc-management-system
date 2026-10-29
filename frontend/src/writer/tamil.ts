import { baminiToUnicode, looksLikeBamini } from '../lib/bamini';

// Fonts that store Tamil as English keys in the Bamini layout. Text in these fonts is always converted.
const BAMINI_FONT = /bamini|tommy|kalaham|kaviya|elango|baamini/i;
// Fonts that hold real (Unicode) Tamil; old-font names in a style are replaced with this.
export const TAMIL_FONT = 'Nirmala UI';

// Old Bamini-style fonts added to the website (see fonts.ts), such as a decorative Tamil font.
const legacyFonts = new Set<string>();
export function registerLegacyFonts(families: string[]) {
  legacyFonts.clear();
  for (const f of families) legacyFonts.add(f.toLowerCase());
}

const familyName = (name: string) => name.split(',')[0].replace(/["']/g, '').trim();

// An added font that draws Tamil over English keys: text in it is printed and saved as Bamini keys.
export function isAddedLegacyFont(name: string | null | undefined): boolean {
  return Boolean(name && legacyFonts.has(familyName(name).toLowerCase()));
}

export function isBaminiFont(name: string | null | undefined): boolean {
  return Boolean(name && (BAMINI_FONT.test(name) || isAddedLegacyFont(name)));
}

// Pasted HTML (from Word, WPS, a PDF viewer or a web page): blocks whose text reads as Bamini, or whose font is a
// Bamini font, are converted to Unicode Tamil, and the old font name is dropped so the letters show correctly.
export function fixPastedHtml(html: string): string {
  if (!/[A-Za-z]/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  const blocks = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, div, pre');
  const seen = new Set<Text>();
  const convert = (root: Element, wholeBlock: boolean) => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (seen.has(node)) continue;
      const font = node.parentElement?.closest('[style*="font-family"], font[face]');
      const fontName = font?.getAttribute('face') ?? (font as HTMLElement | null)?.style.fontFamily;
      if (wholeBlock || isBaminiFont(fontName)) {
        seen.add(node);
        const next = baminiToUnicode(node.data);
        if (next !== node.data) {
          node.data = next;
          changed = true;
        }
      }
    }
  };
  // Innermost blocks first, so a <div> wrapping many paragraphs is judged by each paragraph.
  for (const block of Array.from(blocks).reverse()) {
    if (block.querySelector('p, h1, h2, h3, h4, h5, h6, li, td, th, div, pre')) continue;
    convert(block, looksLikeBamini(block.textContent ?? ''));
  }
  convert(doc.body, blocks.length === 0 && looksLikeBamini(doc.body.textContent ?? ''));
  doc.body.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach((el) => {
    if (isBaminiFont(el.style.fontFamily)) {
      el.style.fontFamily = TAMIL_FONT;
      changed = true;
    }
  });
  doc.body.querySelectorAll('font[face]').forEach((el) => {
    if (isBaminiFont(el.getAttribute('face'))) el.setAttribute('face', TAMIL_FONT);
  });
  return changed ? doc.body.innerHTML : html;
}

// Pasted plain text: converted when it reads as Bamini, paragraph by paragraph.
export function fixPastedText(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((part) => (looksLikeBamini(part) ? baminiToUnicode(part) : part))
    .join('');
}
