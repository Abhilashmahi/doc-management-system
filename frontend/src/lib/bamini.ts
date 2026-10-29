// Converts text written with the old "Bamini" Tamil font into real (Unicode) Tamil.
//
// Many Tamil PDFs made in Word years ago use Bamini: the letters are stored as English keys (அனுப்புநர் is stored as
// "mDg;Geh;") and the font only draws them as Tamil. Copying such text, or editing it, gives gibberish unless it is
// converted. Bamini also stores the vowel signs ெ ே ை before the consonant, as they are written, while Unicode puts
// them after it; baminiToUnicode() reorders them.

const KEYS: Record<string, string> = {
  // vowels
  m: 'அ', M: 'ஆ', ',': 'இ', '<': 'ஈ', c: 'உ', C: 'ஊ', v: 'எ', V: 'ஏ',
  I: 'ஐ', x: 'ஒ', X: 'ஓ', '?': 'ஃ',
  // consonants, and the -u / -uu / -i / -ii letters that have their own keys
  f: 'க', F: 'கு', $: 'கூ', q: 'ங', r: 'ச', R: 'சு', Q: 'ஞ',
  l: 'ட', L: 'டு', '^': 'டூ', b: 'டி', B: 'டீ',
  z: 'ண', Z: 'ணு', j: 'த', J: 'து', e: 'ந', E: 'நு',
  g: 'ப', G: 'பு', k: 'ம', K: 'மு', '%': 'மூ',
  a: 'ய', A: 'யு', u: 'ர', U: 'ரு', '&': 'ரூ',
  y: 'ல', Y: 'லு', t: 'வ', T: 'வு', o: 'ழ', O: 'ழு', '*': 'ழூ',
  s: 'ள', S: 'ளு', w: 'ற', W: 'று', d: 'ன', D: 'னு',
  '[': 'ஜ', '\\': 'ஷ', ']': 'ஸ', '`': 'ஹ', '=': 'ஸ்ரீ',
  // vowel signs and the dot (pulli)
  h: 'ா', p: 'ி', P: 'ீ', n: 'ெ', N: 'ே', i: 'ை', ';': '்', '{': 'ு', _: 'ூ',
  // punctuation that Bamini moves to another key
  '>': ',',
};

// Tamil consonants (க … ன) and the grantha letters ஜ ஷ ஸ ஹ.
const CONSONANT = '[கஙசஞடணதநபமயரலவழளறனஜஷஸஹ]';
// A vowel sign written before its consonant (ெ ே ை), followed by that consonant (or ஸ்ரீ).
const PREFIX = new RegExp(`([ெேை])(ஸ்ரீ|${CONSONANT})`, 'g');
// ெ + ள after a consonant is the ௌ vowel, unless the ள carries its own sign.
const AU = new RegExp(`(${CONSONANT})ெள(?![ா-்])`, 'g');

export function baminiToUnicode(text: string): string {
  // "ர்" is drawn with the ா glyph plus the dot, so it is stored as "h;".
  let out = text.replace(/h;/g, '\u0000');
  out = Array.from(out, (ch) => (ch === '\u0000' ? 'ர்' : (KEYS[ch] ?? ch))).join('');
  // "}" lengthens an -u ending: து} = தூ.
  out = out.replace(/ு\}/g, 'ூ').replace(/\}/g, 'ூ');
  out = out.replace(PREFIX, '$2$1');
  // ெ + ா = ொ, ே + ா = ோ, ெ + ள = ௌ
  out = out.replace(/ொ/g, 'ொ').replace(/ோ/g, 'ோ');
  out = out.replace(AU, '$1ௌ');
  return out;
}

// True when a run of text looks like Bamini rather than English: Tamil words in Bamini end in ";" (the dot) far
// more often than English uses semicolons, and the vowel-sign keys make spellings English never has.
export function looksLikeBamini(sample: string): boolean {
  if (/[஀-௿]/.test(sample)) return false;
  const words = sample.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return false;
  const tamilish = words.filter((w) => /[A-Za-z];/.test(w) || /^[nNi][bcdfgjklmpqrstwyz]/.test(w) || /[A-Za-z]>$/.test(w)).length;
  return tamilish / words.length > 0.2;
}

// ---------- Unicode Tamil → Bamini keys ----------
// Used when text is printed or saved in an old Bamini-style font (which only draws Tamil over English keys).

// Letters with a key of their own for the -u, -uu, -i and -ii forms.
const SPECIAL: Record<string, string> = {
  கு: 'F', கூ: '$', சு: 'R', டு: 'L', டூ: '^', டி: 'b', டீ: 'B', ணு: 'Z', து: 'J', நு: 'E', பு: 'G', மு: 'K', மூ: '%',
  யு: 'A', ரு: 'U', ரூ: '&', லு: 'Y', வு: 'T', ழு: 'O', ழூ: '*', ளு: 'S', று: 'W', னு: 'D',
};
const SIGN_KEY: Record<string, string> = { 'ா': 'h', 'ி': 'p', 'ீ': 'P', '்': ';', 'ு': '{', 'ூ': '_' };
const PREFIX_KEY: Record<string, string> = { 'ெ': 'n', 'ே': 'N', 'ை': 'i' };
const LETTER_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(KEYS)
    .filter(([key, value]) => [...value].length === 1 && !(value in SIGN_KEY) && !(value in PREFIX_KEY) && key !== '>')
    .map(([key, value]) => [value, key]),
);
const IS_CONSONANT = new RegExp(`^${CONSONANT}$`);

export function unicodeToBamini(text: string): string {
  const s = text.normalize('NFC');
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('ஸ்ரீ', i)) {
      out += '=';
      i += 4;
      continue;
    }
    const ch = s[i];
    if (IS_CONSONANT.test(ch)) {
      const key = LETTER_KEY[ch];
      const sign = s[i + 1] ?? '';
      if (sign in PREFIX_KEY) out += PREFIX_KEY[sign] + key;
      else if (sign === 'ொ') out += `n${key}h`;
      else if (sign === 'ோ') out += `N${key}h`;
      else if (sign === 'ௌ') out += `n${key}s`;
      else if (ch === 'ர' && sign === '்') out += 'h;';
      else if (SPECIAL[ch + sign]) out += SPECIAL[ch + sign];
      else if (sign === 'ூ' && SPECIAL[`${ch}ு`]) out += `${SPECIAL[`${ch}ு`]}}`;
      else if (sign in SIGN_KEY) out += key + SIGN_KEY[sign];
      else {
        out += key;
        i += 1;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === ',') out += '>';
    else out += LETTER_KEY[ch] ?? ch;
    i += 1;
  }
  return out;
}

// PDFs made by Chrome, Edge and some other programs store the vowel signs ெ ே ை in the order they are drawn, before
// their letter (ேகா instead of கோ). Real Tamil text never has these signs before a letter, so they are moved back.
const DRAWN_ORDER = new RegExp(`([ெேை])(க்ஷ|ஸ்ரீ|${CONSONANT})`, 'g');
export function repairTamilOrder(text: string): string {
  if (!/[ெேை]/.test(text)) return text;
  return text.replace(DRAWN_ORDER, '$2$1').normalize('NFC');
}
