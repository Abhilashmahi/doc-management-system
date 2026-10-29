import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSession } from '../app/session';
import { Badge, ErrorBanner, Spinner, useLoad, useToast } from '../components/kit';
import { Link } from '../components/Link';
import { errorMessage, http } from '../lib/api';
import { formatBytes } from '../lib/format';
import { navigate } from '../lib/router';
import { findTool, type Tool } from './catalog';
import { PageGrid, PageThumb, type PageItem } from './PageGrid';
import { openPdf } from './pdfjs';
import { ToolIcon } from './ToolsHome';

interface Picked {
  id: string;
  file: File;
}

interface Result {
  token: string;
  name: string;
  sizeBytes: number;
  note?: string;
}

interface ConversionOption {
  to: string;
  label: string;
  quality: 'exact' | 'good' | 'text-only';
  available: boolean;
  note?: string;
}

type Step = 'select' | 'ready' | 'working' | 'done';

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

// One tool, in four steps like iLovePDF: choose files → check them and set options → wait → download or save.
export function ToolPage({ toolId }: { toolId: string }) {
  const tool = findTool(toolId);
  const session = useSession();
  if (!tool || (tool.managersOnly && !session.canManage)) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-medium text-slate-800">This tool does not exist.</p>
        <Link to="/tools" className="mt-2 inline-block text-indigo-600 hover:underline">See all PDF tools</Link>
      </div>
    );
  }
  return <ToolFlow key={tool.id} tool={tool} />;
}

function ToolFlow({ tool }: { tool: Tool }) {
  const session = useSession();
  const toast = useToast();
  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<Picked[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [options, setOptions] = useState<Record<string, unknown>>(defaultOptions(tool));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data: caps } = useLoad(() => http.get<{ libreoffice: boolean }>('/tools/capabilities'), []);

  const accept = tool.accept.length ? tool.accept.map((e) => `.${e}`).join(',') : undefined;
  const kindLabel = tool.accept.length === 1 && tool.accept[0] === 'pdf' ? 'PDF' : tool.id === 'jpg-to-pdf' ? 'images' : 'file';

  // Page tools need the page count of the chosen PDF.
  useEffect(() => {
    if (!tool.pages || files.length === 0) return;
    let cancelled = false;
    openPdf(files[0].file)
      .then((doc) => !cancelled && setPages(Array.from({ length: doc.numPages }, (_, i) => ({ page: i + 1, rotate: 0, removed: false }))))
      .catch(() => !cancelled && setError('This PDF could not be opened. It may be damaged or password-protected.'));
    return () => {
      cancelled = true;
    };
  }, [files, tool.pages]);

  function add(list: FileList | File[] | null) {
    if (!list) return;
    setError(null);
    const chosen = Array.from(list);
    const wrong = tool.accept.length ? chosen.filter((f) => !tool.accept.includes(ext(f.name))) : [];
    if (wrong.length) {
      setError(`${wrong.map((f) => f.name).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not ${tool.accept.map((a) => a.toUpperCase()).join(' / ')}.`);
    }
    const ok = chosen.filter((f) => !wrong.includes(f));
    if (ok.length === 0) return;
    const items = ok.map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file }));
    setFiles((current) => (tool.multiple ? [...current, ...items] : items.slice(0, 1)));
    setStep('ready');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  }

  async function run() {
    setError(null);
    if (tool.id === 'merge' && files.length < 2) {
      setError('Add at least two PDF files to merge.');
      return;
    }
    let runOptions = { ...(tool.run !== 'template' ? tool.run.options : {}), ...options };
    if (tool.pages === 'organize' || tool.pages === 'remove') {
      const kept = pages.filter((p) => !p.removed).map((p) => ({ page: p.page, rotate: p.rotate }));
      if (kept.length === 0) {
        setError('Keep at least one page.');
        return;
      }
      runOptions = { pages: kept };
    }
    if (tool.id === 'any-convert' && !options.to) {
      setError('Choose the format to convert to.');
      return;
    }

    const form = new FormData();
    for (const f of files) form.append('files', f.file);
    form.append('options', JSON.stringify(runOptions));
    setStep('working');
    try {
      if (tool.run === 'template') {
        const created = await http.upload<{ templateId: number; pages: number }>('/tools/pdf-to-template', form);
        toast(`Template created with ${created.pages} page${created.pages === 1 ? '' : 's'}. Add fields on top of the PDF.`);
        navigate(`/templates/${created.templateId}/design`);
        return;
      }
      setResult(await http.upload<Result>(`/tools/${tool.run.endpoint}`, form));
      setStep('done');
    } catch (e) {
      setError(errorMessage(e));
      setStep('ready');
    }
  }

  async function saveToDocuments() {
    if (!result) return;
    setSaving(true);
    try {
      const saved = await http.post<{ id: number }>(`/tools/results/${result.token}/save`, { folder: '/' });
      toast('Saved to Documents.');
      navigate(`/documents/${saved.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setSaving(false);
    }
  }

  function startOver() {
    setFiles([]);
    setPages([]);
    setResult(null);
    setError(null);
    setOptions(defaultOptions(tool));
    setStep('select');
  }

  const fileInput = (
    <input ref={input} type="file" className="hidden" multiple={tool.multiple} accept={accept} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
  );

  // ---------- Step 1: choose files ----------
  if (step === 'select') {
    return (
      <div
        className={`-mx-4 -mt-4 flex min-h-[calc(100vh-4rem)] flex-col items-center px-4 pt-14 text-center sm:-mx-6 sm:-mt-6 ${dragging ? 'bg-indigo-50' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {fileInput}
        <Link to="/tools" className="mb-6 text-sm text-slate-500 hover:text-slate-800">← All PDF tools</Link>
        <ToolIcon tool={tool} size="h-16 w-16" />
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{tool.title}</h1>
        <p className="mt-3 max-w-xl text-base text-slate-600 sm:text-lg">{tool.description}</p>
        {tool.needsLibreOffice && caps && !caps.libreoffice && (
          <p className="mt-4 max-w-lg rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
            This tool needs LibreOffice (free) on the server, which is not installed yet. Ask your administrator.
          </p>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-8 rounded-2xl px-10 py-5 text-xl font-semibold text-white shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
          style={{ background: tool.color }}
        >
          Select {tool.multiple ? `${kindLabel === 'PDF' ? 'PDF files' : kindLabel}` : `${kindLabel === 'file' ? 'a file' : `a ${kindLabel}`}`}
        </button>
        <p className="mt-3 text-sm text-slate-500">or drop {tool.multiple ? 'them' : 'it'} here</p>
        {error && <div className="mt-6 w-full max-w-lg"><ErrorBanner message={error} /></div>}
      </div>
    );
  }

  // ---------- Step 3: working ----------
  if (step === 'working') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <span style={{ color: tool.color }}><Spinner /></span>
        <h1 className="mt-5 text-2xl font-semibold text-slate-900">Working on it…</h1>
        <p className="mt-2 text-slate-500">{tool.title} is processing your {files.length > 1 ? `${files.length} files` : 'file'}. Large files can take a little while.</p>
      </div>
    );
  }

  // ---------- Step 4: done ----------
  if (step === 'done' && result) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center px-4 pt-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your file is ready</h1>
        {result.note && <p className="mt-3 max-w-xl text-slate-600">{result.note}</p>}
        <a
          href={`/api/tools/results/${result.token}`}
          className="mt-8 inline-flex items-center gap-3 rounded-2xl px-10 py-5 text-xl font-semibold text-white shadow-lg hover:brightness-110"
          style={{ background: tool.color }}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          Download
        </a>
        <p className="mt-3 text-sm text-slate-500">{result.name} · {formatBytes(result.sizeBytes)}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {session.canEdit && session.accountId && (
            <button type="button" disabled={saving} onClick={saveToDocuments} className="rounded-xl bg-surface px-5 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save to Documents'}
            </button>
          )}
          <button type="button" onClick={startOver} className="rounded-xl bg-surface px-5 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
            {tool.title} again
          </button>
          <Link to="/tools" className="rounded-xl bg-surface px-5 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">All PDF tools</Link>
        </div>
        <p className="mt-6 text-xs text-slate-400">The download link works for 30 minutes. Your uploaded files were not stored.</p>
      </div>
    );
  }

  // ---------- Step 2: review files and options ----------
  return (
    <div
      className="-mx-4 -mt-4 grid min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_22rem] sm:-mx-6 sm:-mt-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {fileInput}
      <section className="bg-slate-100 p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link to="/tools" className="text-sm text-slate-500 hover:text-slate-800">← All PDF tools</Link>
          {tool.multiple && (
            <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow" style={{ background: tool.color }}>
              + Add more
            </button>
          )}
        </div>
        {tool.pages && files[0] ? (
          pages.length ? (
            <PageGrid file={files[0].file} items={pages} onChange={setPages} mode={tool.pages} />
          ) : (
            <div className="flex justify-center py-20 text-slate-500"><Spinner /></div>
          )
        ) : (
          <FileCards files={files} onChange={setFiles} sortable={tool.multiple} />
        )}
        {tool.multiple && files.length > 1 && <p className="mt-4 text-center text-xs text-slate-500">Drag the cards to change the order.</p>}
      </section>

      <aside className="flex flex-col border-l border-slate-200 bg-surface">
        <div className="border-b border-slate-100 px-5 py-4">
          <h1 className="text-xl font-bold text-slate-900">{tool.title}</h1>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <ToolOptions tool={tool} options={options} onChange={setOptions} file={files[0]?.file} pages={pages} />
          {error && <ErrorBanner message={error} />}
        </div>
        <div className="border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={run}
            disabled={files.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
            style={{ background: tool.color }}
          >
            {tool.action}
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <button type="button" onClick={startOver} className="mt-3 w-full text-center text-sm text-slate-500 hover:text-slate-800">Start over</button>
        </div>
      </aside>
    </div>
  );
}

// ---------- File cards ----------

function FileCards({ files, onChange, sortable }: { files: Picked[]; onChange: (f: Picked[]) => void; sortable: boolean }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
      {files.map((item, i) => (
        <div
          key={item.id}
          draggable={sortable}
          onDragStart={() => setDragIndex(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.stopPropagation();
            if (dragIndex === null || dragIndex === i) return;
            const next = [...files];
            const [moved] = next.splice(dragIndex, 1);
            next.splice(i, 0, moved);
            onChange(next);
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
          className={`group relative flex flex-col items-center rounded-xl bg-surface p-3 shadow-sm ring-1 ring-slate-200 ${sortable ? 'cursor-grab' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
        >
          <FilePreview file={item.file} />
          <p className="mt-2 w-full truncate text-center text-xs font-medium text-slate-700" title={item.file.name}>{item.file.name}</p>
          <p className="text-[11px] text-slate-400">{formatBytes(item.file.size)}</p>
          <button
            type="button"
            aria-label={`Remove ${item.file.name}`}
            onClick={() => onChange(files.filter((f) => f.id !== item.id))}
            className="absolute right-2 top-2 rounded-full bg-surface p-1 text-slate-500 shadow ring-1 ring-slate-200 hover:text-red-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  const kind = ext(file.name);
  const imageUrl = useMemo(() => (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(kind) ? URL.createObjectURL(file) : null), [file, kind]);
  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);
  if (kind === 'pdf') return <PageThumb file={file} page={1} width={130} />;
  if (imageUrl) return <div className="flex h-44 w-[130px] items-center justify-center"><img src={imageUrl} alt="" className="max-h-full max-w-full shadow ring-1 ring-slate-200" /></div>;
  return (
    <div className="flex h-44 w-[130px] items-center justify-center rounded-lg bg-slate-100">
      <span className="rounded-md bg-surface px-2 py-1 text-sm font-bold uppercase text-slate-600 shadow-sm">{kind || 'file'}</span>
    </div>
  );
}

// ---------- Options per tool ----------

function defaultOptions(tool: Tool): Record<string, unknown> {
  switch (tool.id) {
    case 'split':
      return { kind: 'each', ranges: '', size: 1 };
    case 'rotate':
      return { angle: 90, pages: '' };
    case 'compress':
      return { level: 'basic' };
    case 'jpg-to-pdf':
      return { pageSize: 'a4', orientation: 'auto', margin: 0 };
    case 'pdf-to-jpg':
    case 'pdf-to-png':
      return { dpi: 150 };
    case 'page-numbers':
      return { position: 'bottom-center', start: 1, format: '{n}', size: 11, skipFirst: false };
    case 'watermark':
      return { text: 'COPY', size: 60, opacity: 0.2, color: '#dc2626', angle: 45, pages: '' };
    default:
      return {};
  }
}

function Choice({ selected, onClick, title, text, color }: { selected: boolean; onClick: () => void; title: string; text?: string; color: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`w-full rounded-xl p-3 text-left ring-1 transition ${selected ? 'ring-2' : 'ring-slate-200 hover:ring-slate-400'}`} style={selected ? { boxShadow: `0 0 0 2px ${color}`, background: `${color}0d` } : undefined}>
      <span className="block font-semibold text-slate-900">{title}</span>
      {text && <span className="mt-0.5 block text-xs text-slate-500">{text}</span>}
    </button>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

function ToolOptions({ tool, options, onChange, file, pages }: { tool: Tool; options: Record<string, unknown>; onChange: (o: Record<string, unknown>) => void; file?: File; pages: PageItem[] }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...patch });
  const c = tool.color;

  switch (tool.id) {
    case 'merge':
      return <p className="text-slate-600">Files are joined in the order shown. Drag the cards to change it.</p>;
    case 'split':
      return (
        <div className="space-y-3">
          <Choice color={c} selected={options.kind === 'each'} onClick={() => set({ kind: 'each' })} title="Every page" text="Each page becomes its own PDF." />
          <Choice color={c} selected={options.kind === 'ranges'} onClick={() => set({ kind: 'ranges' })} title="Custom ranges" text="For example 1-3, 4, 5-8. Each range becomes one PDF." />
          {options.kind === 'ranges' && <input className={inputClass} aria-label="Page ranges" placeholder="1-3, 4, 5-8" value={String(options.ranges ?? '')} onChange={(e) => set({ ranges: e.target.value })} />}
          <Choice color={c} selected={options.kind === 'every'} onClick={() => set({ kind: 'every' })} title="Fixed size" text="A new PDF every N pages." />
          {options.kind === 'every' && <input type="number" min={1} className={inputClass} aria-label="Pages per file" value={Number(options.size ?? 1)} onChange={(e) => set({ size: Math.max(1, Number(e.target.value) || 1) })} />}
          {pages.length > 0 && <p className="text-xs text-slate-500">This PDF has {pages.length} pages. Several result files arrive together in a ZIP.</p>}
        </div>
      );
    case 'remove-pages':
    case 'organize': {
      const removed = pages.filter((p) => p.removed).length;
      return (
        <div className="space-y-2 text-slate-600">
          <p>{tool.id === 'organize' ? 'Drag pages to sort them. Use the buttons on each page to rotate or remove it.' : 'Click × on the pages you want to remove.'}</p>
          <p className="font-medium text-slate-800">{pages.length - removed} of {pages.length} pages kept{removed ? ` · ${removed} removed` : ''}</p>
        </div>
      );
    }
    case 'rotate':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: 270, label: '↺ Left' },
              { v: 90, label: '↻ Right' },
              { v: 180, label: 'Upside down' },
            ].map((a) => (
              <Choice key={a.v} color={c} selected={options.angle === a.v} onClick={() => set({ angle: a.v })} title={a.label} />
            ))}
          </div>
          <Field label="Pages" hint="Leave empty for all pages, or type e.g. 1, 3-4.">
            <input className={inputClass} value={String(options.pages ?? '')} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages" />
          </Field>
          {file && <div className="flex justify-center rounded-lg bg-slate-50 py-3"><PageThumb file={file} page={1} rotate={Number(options.angle)} width={110} /></div>}
        </div>
      );
    case 'compress':
      return (
        <div className="space-y-3">
          <Choice color={c} selected={options.level === 'basic'} onClick={() => set({ level: 'basic' })} title="Basic" text="Smaller file, pages look exactly the same. Best for typed documents." />
          <Choice color={c} selected={options.level === 'strong'} onClick={() => set({ level: 'strong' })} title="Strong" text="Much smaller for scans and photos. Pages become pictures, so text can no longer be selected." />
        </div>
      );
    case 'jpg-to-pdf':
      return (
        <div className="space-y-4">
          <Field label="Page size">
            <select className={inputClass} value={String(options.pageSize)} onChange={(e) => set({ pageSize: e.target.value })}>
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="fit">Same size as the image</option>
            </select>
          </Field>
          {options.pageSize !== 'fit' && (
            <div className="grid grid-cols-3 gap-2">
              {['auto', 'portrait', 'landscape'].map((o) => (
                <Choice key={o} color={c} selected={options.orientation === o} onClick={() => set({ orientation: o })} title={o[0].toUpperCase() + o.slice(1)} />
              ))}
            </div>
          )}
          <Field label="Margin">
            <select className={inputClass} value={String(options.margin)} onChange={(e) => set({ margin: Number(e.target.value) })}>
              <option value={0}>No margin</option>
              <option value={20}>Small</option>
              <option value={50}>Big</option>
            </select>
          </Field>
        </div>
      );
    case 'pdf-to-jpg':
    case 'pdf-to-png':
      return (
        <Field label="Quality">
          <select className={inputClass} value={String(options.dpi)} onChange={(e) => set({ dpi: Number(e.target.value) })}>
            <option value={100}>Normal (100 DPI, small files)</option>
            <option value={150}>High (150 DPI)</option>
            <option value={300}>Print (300 DPI, large files)</option>
          </select>
        </Field>
      );
    case 'page-numbers':
      return (
        <div className="space-y-4">
          <Field label="Position">
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-50 p-2">
              {['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((p) => (
                <button key={p} type="button" aria-label={p.replace('-', ' ')} aria-pressed={options.position === p} onClick={() => set({ position: p })} className={`h-9 rounded-md ring-1 ${options.position === p ? 'text-white' : 'bg-surface ring-slate-200 hover:ring-slate-400'}`} style={options.position === p ? { background: c } : undefined}>
                  •
                </button>
              ))}
            </div>
          </Field>
          <Field label="Text">
            <select className={inputClass} value={String(options.format)} onChange={(e) => set({ format: e.target.value })}>
              <option value="{n}">1</option>
              <option value="Page {n}">Page 1</option>
              <option value="Page {n} of {total}">Page 1 of 10</option>
              <option value="{n} / {total}">1 / 10</option>
              <option value="பக்கம் {n}">பக்கம் 1</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First number"><input type="number" min={0} className={inputClass} value={Number(options.start)} onChange={(e) => set({ start: Number(e.target.value) || 0 })} /></Field>
            <Field label="Text size"><input type="number" min={6} max={48} className={inputClass} value={Number(options.size)} onChange={(e) => set({ size: Number(e.target.value) || 11 })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={Boolean(options.skipFirst)} onChange={(e) => set({ skipFirst: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            No number on the first page (cover)
          </label>
        </div>
      );
    case 'watermark':
      return (
        <div className="space-y-4">
          <Field label="Text"><input className={inputClass} value={String(options.text)} onChange={(e) => set({ text: e.target.value })} maxLength={100} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Colour"><input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-surface p-1" value={String(options.color)} onChange={(e) => set({ color: e.target.value })} /></Field>
            <Field label="Text size"><input type="number" min={8} max={200} className={inputClass} value={Number(options.size)} onChange={(e) => set({ size: Number(e.target.value) || 60 })} /></Field>
          </div>
          <Field label={`Transparency · ${Math.round((1 - Number(options.opacity)) * 100)}%`}>
            <input type="range" min={0.05} max={1} step={0.05} value={Number(options.opacity)} onChange={(e) => set({ opacity: Number(e.target.value) })} className="w-full" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            {[0, 45, -45].map((a) => (
              <Choice key={a} color={c} selected={options.angle === a} onClick={() => set({ angle: a })} title={a === 0 ? 'Straight' : a > 0 ? 'Diagonal ↗' : 'Diagonal ↘'} />
            ))}
          </div>
          <Field label="Pages" hint="Leave empty for all pages."><input className={inputClass} value={String(options.pages ?? '')} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages" /></Field>
        </div>
      );
    case 'pdf-to-word':
      return <TextOnlyNote />;
    case 'pdf-to-text':
      return <p className="text-slate-600">All text is copied into a .txt file, page by page. Scanned PDFs have no text to copy.</p>;
    case 'pdf-to-template':
      return <p className="text-slate-600">Each page becomes a template page with the PDF as its background (up to 20 pages). You then place fill-in fields, text, barcodes and QR codes on top in the designer.</p>;
    case 'any-convert':
      return file ? <AnyConvertOptions file={file} value={String(options.to ?? '')} onChange={(to) => set({ to })} color={c} /> : null;
    default:
      return <p className="text-slate-600">Ready when you are.</p>;
  }
}

function TextOnlyNote() {
  return (
    <div className="space-y-2 text-slate-600">
      <p>The text of each page is copied into an editable Word file.</p>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
        <Badge tone="amber">Text only</Badge> A PDF does not store paragraphs or tables, so the layout and pictures are not kept. Scanned PDFs have no text.
      </p>
    </div>
  );
}

function AnyConvertOptions({ file, value, onChange, color }: { file: File; value: string; onChange: (to: string) => void; color: string }) {
  const fromExt = ext(file.name);
  const { data, loading } = useLoad(() => http.get<{ options: ConversionOption[] }>('/tools/conversions', { ext: fromExt }), [fromExt]);
  if (loading) return <Spinner small />;
  if (!data || data.options.length === 0) return <p className="text-slate-600">.{fromExt || '?'} files cannot be converted into another format.</p>;
  const quality = { exact: 'Exact', good: 'Good', 'text-only': 'Text only' } as const;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Convert .{fromExt} to</p>
      {data.options.map((o) => (
        <button key={o.to} type="button" disabled={!o.available} onClick={() => onChange(o.to)} aria-pressed={value === o.to} className={`w-full rounded-xl p-3 text-left ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${value === o.to ? '' : 'ring-slate-200 hover:ring-slate-400'}`} style={value === o.to ? { boxShadow: `0 0 0 2px ${color}`, background: `${color}0d` } : undefined}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">{o.label}</span>
            <Badge tone={o.quality === 'exact' ? 'green' : o.quality === 'good' ? 'blue' : 'amber'}>{quality[o.quality]}</Badge>
          </span>
          {o.note && <span className="mt-0.5 block text-xs text-slate-500">{o.note}</span>}
        </button>
      ))}
    </div>
  );
}
