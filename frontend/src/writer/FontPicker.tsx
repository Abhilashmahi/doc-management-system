import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, TextField, useToast } from '../components/kit';
import { errorMessage, http } from '../lib/api';
import { TAMIL_FONTS, allComputerFonts, canListAllFonts, installedFonts, isInstalled, loadWebFonts, recentFonts, rememberFont, type WebFont } from './fonts';
import { unicodeToBamini } from '../lib/bamini';
import { TAMIL_FONT } from './tamil';
import { dropPosition } from './dropdown';

// A font list in the style of WPS Office: a search box, recently used fonts, Tamil fonts, fonts added to the
// website, and every font on this computer, each written in its own font.

const TAMIL_SAMPLE = 'தமிழ்';

export function FontPicker({ value, canManage, webFonts, onFontsChanged, onPick }: { value: string; canManage: boolean; webFonts: WebFont[]; onFontsChanged: (fonts: WebFont[]) => void; onPick: (font: string | null) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [computer, setComputer] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const added = useMemo(() => new Map(webFonts.map((f) => [f.family, f])), [webFonts]);
  const local = useMemo(() => (open ? computer ?? installedFonts() : []), [open, computer]);
  const q = query.trim().toLowerCase();
  const match = (f: string) => !q || f.toLowerCase().includes(q);

  function pick(font: string | null) {
    if (font) rememberFont(font);
    onPick(font);
    setOpen(false);
    setQuery('');
    const legacy = font ? added.get(font)?.encoding === 'bamini' : false;
    if (legacy) toast(`"${font}" is an old Bamini-style font. The page shows normal Tamil while you type; printing, PDF and Word files use ${font}.`);
  }

  async function addFont(file: File, family: string, encoding: 'unicode' | 'bamini') {
    setAdding(true);
    try {
      const form = new FormData();
      form.append('family', family);
      form.append('encoding', encoding);
      form.append('file', file);
      const result = await http.upload<WebFont>('/fonts', form);
      onFontsChanged(await loadWebFonts(true));
      setPending(null);
      toast(result.encoding === 'bamini' ? `Added "${result.family}" (an old Bamini-style Tamil font).` : `Added "${result.family}". Everyone can use it now.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setAdding(false);
    }
  }

  async function removeFont(font: WebFont) {
    if (!window.confirm(`Remove the font "${font.family}" from the website? Documents that use it will show another font.`)) return;
    try {
      await http.del(`/fonts/${font.id}`);
      onFontsChanged(await loadWebFonts(true));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function showAll() {
    const list = await allComputerFonts();
    if (list) setComputer(list);
    else toast('The browser did not allow listing all fonts. The common fonts are shown instead.', 'error');
  }

  const recent = recentFonts().filter(match);
  const tamil = TAMIL_FONTS.filter(match);
  const webList = webFonts.filter((f) => match(f.family));
  const all = local.filter(match);
  const nothing = recent.length + tamil.length + webList.length + all.length === 0;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label="Font"
        aria-expanded={open}
        className="flex h-7 w-44 items-center justify-between rounded border border-slate-300 bg-surface px-1.5 text-left text-sm"
      >
        <span className="truncate" style={{ fontFamily: `"${value || TAMIL_FONT}"` }}>
          {value || TAMIL_FONT}
        </span>
        <span className="text-xs text-slate-500">▾</span>
      </button>
      {open && (
        <div className="fixed z-50 flex max-h-[70vh] w-[22rem] flex-col rounded-lg border border-slate-200 bg-surface shadow-2xl" style={dropPosition(box.current)}>
          <div className="flex gap-2 border-b border-slate-200 p-2">
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q) {
                  const first = [...recent, ...tamil, ...webList.map((f) => f.family), ...all][0];
                  pick(first ?? query.trim());
                }
              }}
              placeholder="Type the first letters or full name of a font"
              className="min-w-0 flex-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="overflow-y-auto pb-2">
            {recent.length > 0 && (
              <Section title="Recently used">
                {recent.map((f) => (
                  <Row key={`r-${f}`} font={f} active={f === value} onPick={pick} sample={TAMIL_FONTS.includes(f) || added.has(f)} />
                ))}
              </Section>
            )}
            {(tamil.length > 0 || !q) && (
              <Section title="Tamil fonts">
                {tamil.map((f) => (
                  <Row key={`t-${f}`} font={f} active={f === value} onPick={pick} sample missing={!isInstalled(f) && !added.has(f)} />
                ))}
              </Section>
            )}
            <Section
              title="Added to this website"
              action={
                canManage && (
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={adding} className="rounded px-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                    {adding ? 'Adding…' : '+ Add font'}
                  </button>
                )
              }
            >
              {webList.map((f) => (
                <Row key={`w-${f.id}`} font={f.family} active={f.family === value} onPick={pick} sample tag={f.encoding === 'bamini' ? 'Bamini-style' : undefined} onRemove={canManage ? () => void removeFont(f) : undefined} />
              ))}
              {webFonts.length === 0 && (
                <p className="px-3 py-1 text-xs text-slate-500">
                  {canManage ? 'Add font files (.ttf, .otf, .woff) such as Bamini, Latha or Isvariya, and everyone can use them.' : 'An administrator can add fonts such as Bamini or Latha here.'}
                </p>
              )}
            </Section>
            <Section
              title={computer ? 'All fonts on this computer' : 'Fonts on this computer'}
              action={
                !computer &&
                canListAllFonts() && (
                  <button type="button" onClick={() => void showAll()} className="rounded px-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                    Show all
                  </button>
                )
              }
            >
              {all.map((f) => (
                <Row key={`a-${f}`} font={f} active={f === value} onPick={pick} />
              ))}
            </Section>
            {nothing && (
              <button type="button" onClick={() => pick(query.trim())} className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-blue-50">
                Use “{query.trim()}”
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => (e.target.files?.[0] && setPending(e.target.files[0]), (e.target.value = ''))} />
        </div>
      )}
      {pending && <AddFontDialog file={pending} busy={adding} onCancel={() => setPending(null)} onAdd={(family, encoding) => void addFont(pending, family, encoding)} />}
    </div>
  );
}

// The person adding a font says whether it is an old Bamini-style Tamil font: from inside, those look like English fonts.
function AddFontDialog({ file, busy, onCancel, onAdd }: { file: File; busy: boolean; onCancel: () => void; onAdd: (family: string, encoding: 'unicode' | 'bamini') => void }) {
  const base = file.name.replace(/.[^.]+$/, '');
  const [family, setFamily] = useState(base.replace(/[_-]+/g, ' ').trim());
  const [encoding, setEncoding] = useState<'unicode' | 'bamini'>(/bamini|tommy|isvar|iswar|aishw|kalaham|elango|kaviya|^tab|^tam|tsc|vanavil|shree/i.test(base) ? 'bamini' : 'unicode');
  return (
    <Modal
      title="Add a font to the website"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!family.trim()} onClick={() => onAdd(family.trim(), encoding)}>
            Add font
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{file.name}</p>
        <TextField label="Font name" value={family} onChange={setFamily} maxLength={100} hint="Shown in the font list. If the font file has its own name, that one may be used." />
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium text-slate-700">What kind of font is it?</legend>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={encoding === 'unicode'} onChange={() => setEncoding('unicode')} />
            <span>
              <b>Normal font</b> — English, or Unicode Tamil (Latha, Vijaya, Noto Sans Tamil, Marutham …)
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={encoding === 'bamini'} onChange={() => setEncoding('bamini')} />
            <span>
              <b>Old Tamil font</b> — Bamini and fonts like it, where typing <code>mDg;Geh;</code> shows அனுப்புநர். Text is kept as real Tamil and turned into these keys when printing or saving a Word file.
            </span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pt-2">
      <div className="flex items-center justify-between px-3 pb-1">
        <h3 className="text-xs font-medium text-slate-500">▾ {title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ font, active, onPick, sample, missing, tag, onRemove }: { font: string; active: boolean; onPick: (f: string) => void; sample?: boolean; missing?: boolean; tag?: string; onRemove?: () => void }) {
  return (
    <div className={`group flex items-center gap-2 px-3 hover:bg-blue-50 ${active ? 'bg-blue-50' : ''}`}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(font)}
        title={missing ? `${font} is not installed on this computer. An administrator can add its font file under "Added to this website".` : font}
        className={`flex min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left ${missing ? 'opacity-50' : ''}`}
      >
        <span className="truncate text-[15px] text-slate-800" style={{ fontFamily: `"${font}", ${TAMIL_FONT}` }}>
          {font}
        </span>
        {sample && !tag && (
          <span className="shrink-0 text-sm text-slate-500" style={{ fontFamily: `"${font}", ${TAMIL_FONT}` }}>
            {TAMIL_SAMPLE}
          </span>
        )}
        {tag && (
          <span className="shrink-0 text-sm text-slate-500" style={{ fontFamily: `"${font}"` }}>
            {unicodeToBamini(TAMIL_SAMPLE)}
          </span>
        )}
        {tag && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">{tag}</span>}
        {missing && <span className="shrink-0 text-[10px] text-slate-500">not installed</span>}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} className="hidden rounded px-1 text-xs text-red-600 hover:bg-red-50 group-hover:block" aria-label={`Remove ${font}`}>
          ✕
        </button>
      )}
    </div>
  );
}
