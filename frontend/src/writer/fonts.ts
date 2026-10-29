import { http } from '../lib/api';
import { registerLegacyFonts } from './tamil';

// Fonts for the Writer: those installed on this computer, and those added to the website by an administrator
// (backend routes/fonts.ts), which every user's browser downloads so they work without installing anything.

export interface WebFont {
  id: number;
  family: string;
  encoding: 'unicode' | 'bamini';
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  url: string;
}

const CSS_FORMAT = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' } as const;

// @font-face rules for the added fonts. `origin` makes the addresses absolute, for the print window.
export function fontFaceCss(fonts: WebFont[], origin = ''): string {
  return fonts.map((f) => `@font-face { font-family: "${f.family}"; src: url("${origin}${f.url}") format("${CSS_FORMAT[f.format]}"); font-display: swap; }`).join('\n');
}

let loading: Promise<WebFont[]> | null = null;

export function loadWebFonts(force = false): Promise<WebFont[]> {
  if (!loading || force) {
    loading = http
      .get<{ fonts: WebFont[] }>('/fonts')
      .then(({ fonts }) => {
        let style = document.getElementById('web-fonts');
        if (!style) {
          style = document.createElement('style');
          style.id = 'web-fonts';
          document.head.appendChild(style);
        }
        style.textContent = fontFaceCss(fonts);
        registerLegacyFonts(fonts.filter((f) => f.encoding === 'bamini').map((f) => f.family));
        return fonts;
      })
      .catch(() => []);
  }
  return loading;
}

// Fonts that come with Windows, Office and WPS, in the order a font list shows them. Only those found on this
// computer are listed (see installedFonts).
const COMMON_FONTS = [
  'Agency FB', 'Algerian', 'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS', 'Bahnschrift',
  'Bahnschrift Condensed', 'Bahnschrift Light', 'Bahnschrift SemiBold', 'Bahnschrift SemiLight', 'Baskerville Old Face',
  'Bauhaus 93', 'Bell MT', 'Berlin Sans FB', 'Berlin Sans FB Demi', 'Bernard MT Condensed', 'Blackadder ITC', 'Bodoni MT',
  'Bodoni MT Black', 'Bodoni MT Condensed', 'Bodoni MT Poster Compressed', 'Book Antiqua', 'Bookman Old Style',
  'Bookshelf Symbol 7', 'Bradley Hand ITC', 'Britannic Bold', 'Broadway', 'Brush Script MT', 'Calibri', 'Calibri Light',
  'Californian FB', 'Calisto MT', 'Cambria', 'Cambria Math', 'Candara', 'Candara Light', 'Cascadia Code', 'Cascadia Mono',
  'Castellar', 'Centaur', 'Century', 'Century Gothic', 'Century Schoolbook', 'Chiller', 'Colonna MT', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Cooper Black', 'Copperplate Gothic Bold', 'Copperplate Gothic Light', 'Corbel', 'Corbel Light',
  'Courier New', 'Curlz MT', 'DejaVu Math TeX Gyre', 'Dubai', 'Dubai Light', 'Dubai Medium', 'Ebrima', 'Edwardian Script ITC',
  'Elephant', 'Engravers MT', 'Eras Bold ITC', 'Eras Demi ITC', 'Eras Light ITC', 'Eras Medium ITC', 'Felix Titling',
  'Footlight MT Light', 'Forte', 'Franklin Gothic Book', 'Franklin Gothic Demi', 'Franklin Gothic Demi Cond',
  'Franklin Gothic Heavy', 'Franklin Gothic Medium', 'Franklin Gothic Medium Cond', 'Freestyle Script', 'French Script MT',
  'Gabriola', 'Gadugi', 'Garamond', 'Georgia', 'Gigi', 'Gill Sans MT', 'Gill Sans MT Condensed', 'Gill Sans MT Ext Condensed Bold',
  'Gill Sans Ultra Bold', 'Gill Sans Ultra Bold Condensed', 'Gloucester MT Extra Condensed', 'Goudy Old Style', 'Goudy Stout',
  'Haettenschweiler', 'Harlow Solid Italic', 'Harrington', 'High Tower Text', 'Impact', 'Imprint MT Shadow', 'Informal Roman',
  'Ink Free', 'Javanese Text', 'Jokerman', 'Juice ITC', 'Kingsoft UE', 'Kristen ITC', 'Kunstler Script', 'Latha',
  'Leelawadee UI', 'Leelawadee UI Semilight', 'Lucida Blackletter', 'Lucida Bright', 'Lucida Calligraphy', 'Lucida Console',
  'Lucida Fax', 'Lucida Handwriting', 'Lucida Sans', 'Lucida Sans Typewriter', 'Lucida Sans Unicode', 'Magneto', 'Maiandra GD',
  'Malgun Gothic', 'Malgun Gothic Semilight', 'Marlett', 'Matura MT Script Capitals', 'Microsoft Himalaya', 'Microsoft JhengHei',
  'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti',
  'MingLiU-ExtB', 'Mistral', 'Modern No. 20', 'Mongolian Baiti', 'Monotype Corsiva', 'MS Gothic', 'MS Outlook', 'MS Reference Sans Serif',
  'MS Reference Specialty', 'MT Extra', 'MV Boli', 'Myanmar Text', 'Niagara Engraved', 'Niagara Solid', 'Nirmala UI',
  'Nirmala UI Semilight', 'Noto Sans Tamil', 'OCR A Extended', 'Old English Text MT', 'Onyx', 'Palace Script MT',
  'Palatino Linotype', 'Papyrus', 'Parchment', 'Perpetua', 'Perpetua Titling MT', 'Playbill', 'Poor Richard', 'Pristina',
  'Rage Italic', 'Ravie', 'Rockwell', 'Rockwell Condensed', 'Rockwell Extra Bold', 'Script MT Bold', 'Segoe MDL2 Assets',
  'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Light',
  'Segoe UI Semibold', 'Segoe UI Semilight', 'Segoe UI Symbol', 'Showcard Gothic', 'SimSun', 'Sitka Text', 'Snap ITC', 'Stencil',
  'Sylfaen', 'Symbol', 'Tahoma', 'Tempus Sans ITC', 'Times New Roman', 'Trebuchet MS', 'Tw Cen MT', 'Tw Cen MT Condensed',
  'Verdana', 'Vijaya', 'Viner Hand ITC', 'Vivaldi', 'Vladimir Script', 'Webdings', 'Wide Latin', 'Wingdings', 'Wingdings 2',
  'Wingdings 3', 'Yu Gothic',
];

// Tamil fonts shown in their own group. Latha and Vijaya come with Windows' Tamil supplemental fonts.
export const TAMIL_FONTS = ['Nirmala UI', 'Latha', 'Vijaya', 'Noto Sans Tamil', 'Arial Unicode MS'];

let measure: CanvasRenderingContext2D | null = null;
const PROBE = 'mmmmmmmmmmlliWWQ@#அஆஇகஙசஞ';

// True when the font is installed: text drawn with it differs in width from the fallback fonts.
export function isInstalled(font: string): boolean {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return true;
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    measure!.font = `40px ${base}`;
    const plain = measure!.measureText(PROBE).width;
    measure!.font = `40px "${font}", ${base}`;
    return measure!.measureText(PROBE).width !== plain;
  });
}

let installed: string[] | null = null;
export function installedFonts(): string[] {
  installed ??= COMMON_FONTS.filter(isInstalled);
  return installed;
}

// Every font on the computer, by asking the browser (Chrome and Edge; the user is asked to allow it once).
export async function allComputerFonts(): Promise<string[] | null> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!query) return null;
  try {
    const fonts = await query();
    return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

export const canListAllFonts = () => 'queryLocalFonts' in window;

const RECENT_KEY = 'writer-recent-fonts';
export function recentFonts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function rememberFont(font: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([font, ...recentFonts().filter((f) => f !== font)].slice(0, 6)));
  } catch {
    // Only a convenience.
  }
}
