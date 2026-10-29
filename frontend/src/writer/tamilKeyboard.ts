import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { baminiToUnicode } from '../lib/bamini';

// Typing Tamil with an ordinary English keyboard. Three layouts:
// - Phonetic: Tamil written in English letters ("amma" → அம்மா), as in Google Input Tools.
// - Bamini: the old typewriter layout used with the Bamini font ("mk;kh" → அம்மா).
// - Tamil99: the Tamil Nadu Government standard layout.
// The keys of the word being typed are kept, and the whole word is converted again after every key, so later keys
// can change earlier letters (a vowel joins the consonant before it). Backspace removes the last key.

export type TamilMode = 'off' | 'phonetic' | 'bamini' | 'tamil99';

export const TAMIL_MODES: { id: TamilMode; label: string }[] = [
  { id: 'off', label: 'English' },
  { id: 'phonetic', label: 'Tamil – Phonetic (amma → அம்மா)' },
  { id: 'bamini', label: 'Tamil – Bamini' },
  { id: 'tamil99', label: 'Tamil – Tamil99' },
];

// ---------- Phonetic ----------

const PULLI = '்';

// [keys, letter on its own, sign after a consonant]; longest keys first.
const VOWELS: [string, string, string][] = [
  ['aa', 'ஆ', 'ா'], ['ai', 'ஐ', 'ை'], ['au', 'ஔ', 'ௌ'], ['A', 'ஆ', 'ா'], ['a', 'அ', ''],
  ['ii', 'ஈ', 'ீ'], ['ee', 'ஈ', 'ீ'], ['I', 'ஈ', 'ீ'], ['i', 'இ', 'ி'],
  ['uu', 'ஊ', 'ூ'], ['oo', 'ஊ', 'ூ'], ['U', 'ஊ', 'ூ'], ['u', 'உ', 'ு'],
  ['E', 'ஏ', 'ே'], ['e', 'எ', 'ெ'], ['O', 'ஓ', 'ோ'], ['o', 'ஒ', 'ொ'],
];

// Consonants (and common joined pairs); longest keys first. "n" is decided by place (see below).
const CONSONANTS: [string, string][] = [
  ['ksh', 'க்ஷ'], ['nth', 'ந்த'], ['ndh', 'ந்த'], ['nch', 'ஞ்ச'],
  ['ng', 'ங'], ['nj', 'ஞ'], ['nd', 'ண்ட'], ['ch', 'ச'], ['th', 'த'], ['dh', 'த'], ['sh', 'ஷ'], ['zh', 'ழ'], ['tr', 'ற்ற'],
  ['k', 'க'], ['g', 'க'], ['c', 'ச'], ['s', 'ச'], ['j', 'ஜ'], ['t', 'ட'], ['d', 'ட'], ['N', 'ண'], ['w', 'ந'],
  ['p', 'ப'], ['b', 'ப'], ['m', 'ம'], ['y', 'ய'], ['r', 'ர'], ['R', 'ற'], ['l', 'ல'], ['L', 'ள'], ['z', 'ழ'],
  ['v', 'வ'], ['f', 'ஃப'], ['h', 'ஹ'], ['S', 'ஸ'], ['x', 'க்ஸ'],
];

// Capitals only matter where they mean another letter (A, N, L ...); otherwise K is the same as k.
const OWN_CAPITALS = /[AIUEONRLS]/;

export function phoneticToTamil(typed: string): string {
  const raw = typed.replace(/[A-Z]/g, (c) => (OWN_CAPITALS.test(c) ? c : c.toLowerCase()));
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('sri', i)) {
      out += 'ஸ்ரீ';
      i += 3;
      continue;
    }
    if (raw[i] === 'q') {
      out += 'ஃ';
      i += 1;
      continue;
    }
    let consonant: string | null = null;
    let used = 0;
    if (raw[i] === 'n' && !CONSONANTS.some(([k]) => k.startsWith('n') && k.length > 1 && raw.startsWith(k, i))) {
      // "n" is ந at the start of a word and ன elsewhere; "nn" is ன்ன.
      consonant = i === 0 ? 'ந' : 'ன';
      used = 1;
    } else {
      const match = CONSONANTS.find(([k]) => raw.startsWith(k, i));
      if (match) [consonant, used] = [match[1], match[0].length];
    }
    if (consonant) {
      i += used;
      const vowel = VOWELS.find(([k]) => raw.startsWith(k, i));
      if (vowel) {
        out += consonant + vowel[2];
        i += vowel[0].length;
      } else out += consonant + PULLI;
      continue;
    }
    const vowel = VOWELS.find(([k]) => raw.startsWith(k, i));
    if (vowel) {
      out += vowel[1];
      i += vowel[0].length;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

// ---------- Tamil99 ----------

const T99: Record<string, string> = {
  q: 'ஆ', w: 'ஈ', e: 'ஊ', r: 'ஐ', t: 'ஏ', y: 'ள', u: 'ற', i: 'ன', o: 'ட', p: 'ண', '[': 'ச', ']': 'ஞ',
  a: 'அ', s: 'இ', d: 'உ', f: PULLI, g: 'எ', h: 'க', j: 'ப', k: 'ம', l: 'த', ';': 'ந', "'": 'ய',
  z: 'ஔ', x: 'ஓ', c: 'ஒ', v: 'வ', b: 'ங', n: 'ல', m: 'ர', '/': 'ழ',
  Q: 'ஸ', W: 'ஷ', E: 'ஜ', R: 'ஹ', T: 'க்ஷ', Y: 'ஸ்ரீ', F: 'ஃ',
};
const T99_SIGN: Record<string, string> = { அ: '', ஆ: 'ா', இ: 'ி', ஈ: 'ீ', உ: 'ு', ஊ: 'ூ', எ: 'ெ', ஏ: 'ே', ஐ: 'ை', ஒ: 'ொ', ஓ: 'ோ', ஔ: 'ௌ' };
// A soft consonant followed by its hard partner gets the dot automatically (ங்க, ந்த ...).
const T99_PAIRS = new Set(['ஙக', 'ஞச', 'ணட', 'நத', 'மப', 'னற']);
const isConsonant = (c: string) => /[க-ஹ]/.test(c) && !(c in T99_SIGN);

export function tamil99ToTamil(raw: string): string {
  let out = '';
  let bare = false; // the last letter is a consonant still waiting for its vowel
  for (const key of raw) {
    const letter = T99[key];
    if (!letter) {
      out += key;
      bare = false;
    } else if (letter in T99_SIGN) {
      if (bare) out += T99_SIGN[letter];
      else out += letter;
      bare = false;
    } else if (letter === PULLI) {
      if (bare) out += PULLI;
      bare = false;
    } else if (isConsonant(letter[letter.length - 1]) && letter.length === 1) {
      const last = out[out.length - 1];
      if (bare && (last === letter || T99_PAIRS.has(last + letter))) out += PULLI;
      out += letter;
      bare = true;
    } else {
      out += letter;
      bare = false;
    }
  }
  return out;
}

// ---------- The editor extension ----------

export function convertKeys(mode: TamilMode, raw: string): string {
  if (mode === 'phonetic') return phoneticToTamil(raw);
  if (mode === 'bamini') return baminiToUnicode(raw);
  if (mode === 'tamil99') return tamil99ToTamil(raw);
  return raw;
}

// Which typed characters belong to the Tamil word being built; anything else (space, digits ...) ends it.
function composes(mode: TamilMode, ch: string): boolean {
  if (mode === 'phonetic') return /[A-Za-z]/.test(ch);
  if (mode === 'tamil99') return ch in T99;
  if (mode === 'bamini') return /\S/.test(ch) && !/[0-9]/.test(ch);
  return false;
}

interface Composing {
  start: number;
  raw: string;
  len: number;
}

const composingKey = new PluginKey<Composing | null>('tamilKeyboard');

export const TamilKeyboard = Extension.create<{ getMode: () => TamilMode }>({
  name: 'tamilKeyboard',
  addOptions() {
    return { getMode: () => 'off' as TamilMode };
  },
  addProseMirrorPlugins() {
    const getMode = () => this.options.getMode();
    return [
      new Plugin<Composing | null>({
        key: composingKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(composingKey) as Composing | null | undefined;
            if (meta !== undefined) return meta;
            // Any other change or cursor move starts a new word.
            return tr.docChanged || tr.selectionSet ? null : value;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const mode = getMode();
            if (mode === 'off' || text.length !== 1 || !composes(mode, text)) return false;
            const current = composingKey.getState(view.state);
            const continues = current && from === to && from === current.start + current.len;
            const start = continues ? current.start : from;
            const raw = continues ? current.raw + text : text;
            const len = continues ? current.len : to - from;
            const out = convertKeys(mode, raw);
            const tr = view.state.tr.insertText(out, start, start + len);
            tr.setMeta(composingKey, { start, raw, len: out.length });
            view.dispatch(tr);
            return true;
          },
          handleKeyDown(view, event) {
            if (event.key !== 'Backspace' || getMode() === 'off' || event.ctrlKey || event.altKey) return false;
            const current = composingKey.getState(view.state);
            const { from, to } = view.state.selection;
            if (!current || from !== to || from !== current.start + current.len) return false;
            const raw = current.raw.slice(0, -1);
            const out = raw ? convertKeys(getMode(), raw) : '';
            const tr = out ? view.state.tr.insertText(out, current.start, current.start + current.len) : view.state.tr.delete(current.start, current.start + current.len);
            tr.setMeta(composingKey, raw ? { start: current.start, raw, len: out.length } : null);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
