import { describe, expect, it } from 'vitest';
import { convertKeys, phoneticToTamil, tamil99ToTamil } from './tamilKeyboard';

describe('Tamil typing', () => {
  it.each([
    ['amma', 'அம்ம'],
    ['ammaa', 'அம்மா'],
    ['anuppuwar', 'அனுப்புநர்'],
    ['vaNakkam', 'வணக்கம்'],
    ['thamizh', 'தமிழ்'],
    ['naan', 'நான்'],
    ['panthu', 'பந்து'],
    ['kaatru', 'காற்று'],
    ['veedu', 'வீடு'],
    ['oor', 'ஊர்'],
    ['anuppunar', 'அனுப்புநர்'.replace('நர்', 'னர்')],
    ['peyaril', 'பெயரில்'],
    ['pattaa', 'பட்டா'],
    ['Kaiyeppam', 'கையெப்பம்'],
    ['sri', 'ஸ்ரீ'],
  ])('phonetic %s', (keys, tamil) => expect(phoneticToTamil(keys)).toBe(tamil));

  it('Tamil99', () => {
    expect(tamil99ToTamil('akkq')).toBe('அம்மா');
    expect(tamil99ToTamil('lks/f')).toBe('தமிழ்');
    expect(tamil99ToTamil('jbhs')).toBe('பங்கி');
  });

  it('Bamini', () => {
    expect(convertKeys('bamini', 'mDg;Geh;')).toBe('அனுப்புநர்');
    expect(convertKeys('bamini', 'nfh')).toBe('கொ');
  });
});

describe('typing into the editor', async () => {
  const { Schema } = await import('@tiptap/pm/model');
  const { EditorState, TextSelection } = await import('@tiptap/pm/state');
  const { TamilKeyboard } = await import('./tamilKeyboard');
  type Mode = import('./tamilKeyboard').TamilMode;
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });

  // A stand-in for the editor view: keys go through the plugin like real typing, and other keys are inserted plainly.
  function typist(mode: { current: Mode }) {
    const config = TamilKeyboard.config as unknown as { addProseMirrorPlugins: (this: unknown) => import('@tiptap/pm/state').Plugin[] };
    const [plugin] = config.addProseMirrorPlugins.call({ options: { getMode: () => mode.current } });
    const view = { state: EditorState.create({ schema, plugins: [plugin] }), dispatch(tr: import('@tiptap/pm/state').Transaction) { view.state = view.state.apply(tr); } };
    const props = plugin.props as { handleTextInput: Function; handleKeyDown: Function };
    return {
      type(text: string) {
        for (const ch of text) {
          const { from, to } = view.state.selection;
          if (!props.handleTextInput(view, from, to, ch)) view.dispatch(view.state.tr.insertText(ch, from, to));
        }
      },
      backspace() {
        if (!props.handleKeyDown(view, { key: 'Backspace' })) {
          const { from } = view.state.selection;
          view.dispatch(view.state.tr.delete(from - 1, from));
        }
      },
      moveTo(pos: number) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      },
      text: () => view.state.doc.textContent,
    };
  }

  it('builds words as you type, and Backspace removes the last key', () => {
    const mode = { current: 'phonetic' as Mode };
    const t = typist(mode);
    t.type('ammaa vaNakkam thamizhx');
    t.backspace();
    t.type('. ');
    expect(t.text()).toBe('அம்மா வணக்கம் தமிழ். ');
    mode.current = 'off';
    t.type('OK ');
    mode.current = 'bamini';
    t.type('mDg;Geh; ');
    mode.current = 'tamil99';
    t.type('akkq');
    expect(t.text()).toBe('அம்மா வணக்கம் தமிழ். OK அனுப்புநர் அம்மா');
  });

  it('starts a new word after the cursor moves', () => {
    const mode = { current: 'phonetic' as Mode };
    const t = typist(mode);
    t.type('naan');
    t.moveTo(1);
    t.type('a');
    expect(t.text()).toBe('அநான்');
  });
});
