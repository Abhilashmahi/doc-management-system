import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useSession } from '../app/session';
import { Button, Checkbox, ErrorBanner, LoadingBlock, TextField, useToast } from '../components/kit';
import { baminiToUnicode, looksLikeBamini } from '../lib/bamini';
import { ApiError, errorMessage, http } from '../lib/api';
import { navigate } from '../lib/router';
import { ThemeToggle } from '../lib/theme';
import type { DocumentDetail } from '../lib/types';
import { loadLib } from '../tools/pdfjs';
import { buildLines, type Line, type RawItem } from './lines';

// Edit the wording of a PDF (Tamil and English) inside the website.
// The browser reads the PDF's text lines with PDF.js; Tamil typed with the old Bamini font is converted to real
// Tamil so it can be edited. Changed lines are sent to the server, which covers the old words with white and writes
// the new words (services/pdf-text-edit.ts). The result is saved as a new version; the original is kept.


type Kind = 'line' | 'add' | 'whiteout';
interface Change {
  id: string;
  kind: Kind;
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  color: string;
  fit: boolean;
  cover?: { x: number; y: number; w: number; h: number };
  fitWidth?: number;
}

type Changes = Record<string, Change>;
type Tool = 'edit' | 'add' | 'whiteout';

const MAX_PAGES = 40;
const PREVIEW_FONT = '"Noto Sans Tamil", "Nirmala UI", "Noto Sans", Arial, sans-serif';

// New words in Noto look smaller than Bamini letters at the same size, so Bamini lines start 10% larger.
function defaultSize(line: Line): number {
  return line.bamini ? Math.round(line.size * 11) / 10 : line.size;
}

function coverFor(line: { x: number; y: number; w: number; size: number }) {
  return { x: line.x - 1.5, y: line.y - line.size * 0.34, w: line.w + 3, h: line.size * 1.42 };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function previewScale(text: string, size: number, bold: boolean, fitWidth?: number): number {
  if (!fitWidth) return 1;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 1;
  measureCtx.font = `${bold ? 'bold ' : ''}${size}px ${PREVIEW_FONT}`;
  const widest = Math.max(...text.split('\n').map((l) => measureCtx!.measureText(l).width));
  return widest > fitWidth ? Math.max(0.6, fitWidth / widest) : 1;
}

export function PdfTextEditor({ documentId }: { documentId: number }) {
  const session = useSession();
  const toast = useToast();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [rawItems, setRawItems] = useState<RawItem[][]>([]);
  const [baminiFonts, setBaminiFonts] = useState<Set<string>>(new Set());
  const [convertBamini, setConvertBamini] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.4);
  const [tool, setTool] = useState<Tool>('edit');
  const [changes, setChanges] = useState<Changes>({});
  const [history, setHistory] = useState<Changes[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const doc = detail?.document;
  const canChange = Boolean(session.canEdit && session.accountId && doc && !doc.isArchived);

  // Load the document, its PDF file and the text of every page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await http.get<DocumentDetail>(`/documents/${documentId}`);
        if (d.document.sourceType !== 'upload' || !/\.pdf$/i.test(d.document.fileName ?? '')) throw new Error('Only PDF files can have their text edited here.');
        const res = await fetch(`/api/documents/${documentId}/file?inline=1`, { credentials: 'include' });
        if (!res.ok) throw new Error('The PDF could not be loaded.');
        const pdfjs = await loadLib();
        const loaded = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        if (loaded.numPages > MAX_PAGES) throw new Error(`This PDF has ${loaded.numPages} pages. Text editing works on PDFs of up to ${MAX_PAGES} pages; split it first with PDF Tools.`);
        const list: PDFPageProxy[] = [];
        const items: RawItem[][] = [];
        for (let n = 1; n <= loaded.numPages; n += 1) {
          const page = await loaded.getPage(n);
          list.push(page);
          const content = await page.getTextContent();
          items.push(content.items.filter((it): it is RawItem & typeof it => 'str' in it) as unknown as RawItem[]);
        }
        // Which fonts hold Bamini Tamil? Decide per font from all of its text.
        const byFont = new Map<string, string[]>();
        for (const it of items.flat()) byFont.set(it.fontName, [...(byFont.get(it.fontName) ?? []), it.str]);
        const bamini = new Set([...byFont].filter(([, strs]) => looksLikeBamini(strs.join(' '))).map(([font]) => font));
        if (cancelled) return;
        setDetail(d);
        setPdf(loaded);
        setPages(list);
        setRawItems(items);
        setBaminiFonts(bamini);
        if (items.every((p) => p.length === 0)) setError('This PDF has no text to edit (it is probably a scanned picture). You can still add new text and white-out areas.');
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError || !(e instanceof Error) ? errorMessage(e) : e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Free the PDF.js worker memory when leaving the page.
  useEffect(() => () => void pdf?.loadingTask.destroy(), [pdf]);

  const lines = useMemo(() => {
    const decode = (s: string, font: string) => (convertBamini && baminiFonts.has(font) ? baminiToUnicode(s) : s);
    return rawItems.map((items, i) => buildLines(i + 1, items, decode));
  }, [rawItems, baminiFonts, convertBamini]);
  const lineById = useMemo(() => new Map(lines.flat().map((l) => [l.id, l])), [lines]);

  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---------- Changes ----------

  function commit(next: Changes) {
    setHistory((h) => [...h.slice(-99), changes]);
    setChanges(next);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setChanges(previous);
    if (selected && !previous[selected] && !lineById.has(selected)) setSelected(null);
  }

  function changeFor(id: string): Change | null {
    if (changes[id]) return changes[id];
    const line = lineById.get(id);
    if (!line) return null;
    return { id, kind: 'line', page: line.page, text: line.text, x: line.x, y: line.y, size: defaultSize(line), bold: false, color: '#000000', fit: true, cover: coverFor(line), fitWidth: line.w * 1.02 };
  }

  function update(id: string, patch: Partial<Change>) {
    const base = changeFor(id);
    if (!base) return;
    const next = { ...base, ...patch };
    if (next.kind === 'line') next.fitWidth = next.fit ? (lineById.get(id)?.w ?? next.fitWidth ?? 0) * 1.02 : undefined;
    commit({ ...changes, [id]: next });
  }

  function revert(id: string) {
    const next = { ...changes };
    delete next[id];
    commit(next);
    if (!lineById.has(id)) setSelected(null);
  }

  function addText(page: number, x: number, yTop: number) {
    const id = `add-${Date.now()}`;
    commit({ ...changes, [id]: { id, kind: 'add', page, text: '', x, y: yTop - 12 * 0.95, size: 12, bold: false, color: '#000000', fit: false } });
    setSelected(id);
    setTool('edit');
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function addWhiteout(page: number, rect: { x: number; y: number; w: number; h: number }) {
    if (rect.w < 2 || rect.h < 2) return;
    const id = `wo-${Date.now()}`;
    commit({ ...changes, [id]: { id, kind: 'whiteout', page, text: '', x: rect.x, y: rect.y, size: 12, bold: false, color: '#000000', fit: false, cover: rect } });
    setSelected(id);
  }

  function replaceAll() {
    if (!find) return;
    let count = 0;
    const next = { ...changes };
    for (const line of lines.flat()) {
      const current = next[line.id] ?? changeFor(line.id)!;
      if (current.text.includes(find)) {
        next[line.id] = { ...current, text: current.text.split(find).join(replace) };
        count += 1;
      }
    }
    for (const c of Object.values(next)) {
      if (c.kind === 'add' && c.text.includes(find)) {
        next[c.id] = { ...c, text: c.text.split(find).join(replace) };
        count += 1;
      }
    }
    if (count === 0) {
      toast(`“${find}” was not found.`, 'error');
      return;
    }
    commit(next);
    toast(`Replaced in ${count} line${count === 1 ? '' : 's'}.`);
  }

  // Only real differences are sent: a line edited back to its original wording is left alone.
  function editsToSave() {
    return Object.values(changes)
      .filter((c) => {
        if (c.kind !== 'line') return c.kind === 'whiteout' || c.text.trim() !== '';
        const line = lineById.get(c.id);
        return !line || c.text !== line.text || c.size !== defaultSize(line) || c.bold || c.color !== '#000000';
      })
      .map((c) => ({
        page: c.page,
        cover: c.cover,
        text: c.kind === 'whiteout' ? undefined : c.text,
        x: c.x,
        y: c.y,
        size: c.size,
        bold: c.bold,
        color: c.color,
        fitWidth: c.kind === 'line' && c.fit ? c.fitWidth : undefined,
      }));
  }
  const pendingCount = useMemo(editsToSave, [changes, lineById]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!doc || pendingCount.length === 0) return;
    setSaving(true);
    try {
      const result = await http.post<{ versionNo: number }>(`/documents/${doc.id}/edit-text`, { baseVersionNo: doc.currentVersionNo, edits: pendingCount });
      setChanges({});
      toast(`Saved as version ${result.versionNo}. The original is kept in the version history.`);
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    if (dirty && !window.confirm('Your text changes are not saved. Leave without saving?')) return;
    setChanges({});
    navigate(`/documents/${documentId}`);
  }

  // Ctrl+Z undoes; Esc closes the selection.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') setSelected(null);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ---------- Layout ----------

  if (error && !pdf) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorBanner message={error} />
        <Button className="mt-4" onClick={() => navigate(`/documents/${documentId}`)}>Back to the document</Button>
      </div>
    );
  }
  if (!pdf || !doc) return <LoadingBlock />;

  const current = selected ? changeFor(selected) : null;
  const currentLine = selected ? lineById.get(selected) : undefined;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-surface px-3 py-2">
        <button type="button" onClick={leave} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="mr-2 min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">Edit text — {doc.name}</p>
          <p className="text-xs text-slate-500">Version {doc.currentVersionNo} · {pendingCount.length} change{pendingCount.length === 1 ? '' : 's'} not saved</p>
        </div>
        <div role="radiogroup" aria-label="Tool" className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {([['edit', 'Edit text'], ['add', 'Add text'], ['whiteout', 'White-out']] as const).map(([t, label]) => (
            <button key={t} type="button" role="radio" aria-checked={tool === t} onClick={() => setTool(t)} className={`rounded-md px-3 py-1 ${tool === t ? 'bg-surface font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={undo} disabled={history.length === 0}>Undo</Button>
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}>−</Button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.2) * 10) / 10))}>+</Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button variant="primary" busy={saving} disabled={!canChange || pendingCount.length === 0} onClick={() => void save()}>
            Save as new version
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-6" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="mx-auto flex w-max flex-col items-center gap-6">
            {pages.map((page, i) => (
              <PageCanvas
                key={i}
                page={page}
                pageNo={i + 1}
                zoom={zoom}
                tool={tool}
                lines={lines[i] ?? []}
                changes={changes}
                selected={selected}
                onSelect={setSelected}
                onAdd={addText}
                onWhiteout={addWhiteout}
                onMove={(id, x, y) => update(id, { x, y })}
              />
            ))}
          </div>
        </div>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-surface p-4 text-sm" aria-label="Edit panel">
          {!canChange && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              {doc.isArchived ? 'This document is archived. Restore it to edit.' : session.accountId ? 'Your role can view but not change documents.' : 'Choose an office in the top bar to save changes.'}
            </p>
          )}
          {error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">{error}</p>}

          {current ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{current.kind === 'line' ? `Line on page ${current.page}` : current.kind === 'add' ? 'New text' : 'White-out box'}</p>
                <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-800">Close</button>
              </div>
              {currentLine && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Original</p>
                  <p className="mt-0.5 rounded-md bg-slate-50 px-2 py-1.5 text-slate-700" style={{ fontFamily: PREVIEW_FONT }}>{currentLine.text}</p>
                </div>
              )}
              {current.kind !== 'whiteout' && (
                <>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">New text</span>
                    <textarea
                      ref={textRef}
                      value={current.text}
                      onChange={(e) => update(current.id, { text: e.target.value })}
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-surface px-2.5 py-2 text-base text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      style={{ fontFamily: PREVIEW_FONT }}
                      placeholder="Type in Tamil or English"
                    />
                    <span className="text-xs text-slate-500">Type Tamil with the Windows Tamil keyboard, or paste it. Leave empty to remove the line.</span>
                  </label>
                  <div className="flex items-end gap-3">
                    <label className="w-20">
                      <span className="text-xs font-medium text-slate-700">Size</span>
                      <input type="number" min={4} max={200} step={0.5} value={current.size} onChange={(e) => Number(e.target.value) >= 3 && update(current.id, { size: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 bg-surface px-2 py-1.5" />
                    </label>
                    <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={current.bold} onChange={(e) => update(current.id, { bold: e.target.checked })} /> Bold</label>
                    <label className="flex items-center gap-1.5 pb-1.5" title="Text colour">
                      <input type="color" value={current.color} onChange={(e) => update(current.id, { color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-slate-300" aria-label="Text colour" />
                    </label>
                  </div>
                  {current.kind === 'line' && (
                    <Checkbox label="Shrink to fit the old line" checked={current.fit} onChange={(v) => update(current.id, { fit: v })} hint="Keeps longer text from running into the margin." />
                  )}
                  {current.kind === 'add' && <p className="text-xs text-slate-500">Drag the text on the page to move it.</p>}
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {current.kind === 'line' && (
                  <Button size="sm" variant="danger" onClick={() => update(current.id, { text: '' })}>Remove line</Button>
                )}
                {changes[current.id] && (
                  <Button size="sm" onClick={() => revert(current.id)}>{current.kind === 'line' ? 'Undo changes to this line' : 'Delete'}</Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="font-semibold text-slate-900">How to edit</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">
                  <li><strong>Edit text:</strong> click a line on the page, then change it here.</li>
                  <li><strong>Add text:</strong> click where the new words should go.</li>
                  <li><strong>White-out:</strong> drag over anything to hide it.</li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">Changed words are printed in Noto Sans Tamil, so they may look slightly different from the rest. Saving keeps the original as an earlier version.</p>
              </div>

              {baminiFonts.size > 0 && (
                <div className="rounded-lg bg-indigo-50 p-3 ring-1 ring-indigo-200">
                  <p className="text-xs text-slate-700">This PDF uses the old <strong>Bamini</strong> Tamil font. Its text is converted to real Tamil so you can edit it.</p>
                  <Checkbox label="Convert Bamini Tamil" checked={convertBamini} onChange={setConvertBamini} />
                </div>
              )}

              <div className="space-y-2">
                <p className="font-semibold text-slate-900">Find and replace</p>
                <TextField label="Find" value={find} onChange={setFind} placeholder="e.g. சின்னப்பன்" />
                <TextField label="Replace with" value={replace} onChange={setReplace} />
                <Button size="sm" disabled={!find} onClick={replaceAll}>Replace everywhere</Button>
              </div>

              {pendingCount.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-900">Changes ({pendingCount.length})</p>
                  <ul className="mt-2 space-y-1">
                    {Object.values(changes).map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setSelected(c.id)} className="w-full truncate rounded-md px-2 py-1 text-left text-slate-700 hover:bg-slate-100" style={{ fontFamily: PREVIEW_FONT }}>
                          <span className="text-xs text-slate-400">p{c.page} </span>
                          {c.kind === 'whiteout' ? 'White-out' : c.text || <em className="text-red-600">line removed</em>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// One page: the rendered PDF, clickable line boxes, and previews of the changes.
function PageCanvas({
  page,
  pageNo,
  zoom,
  tool,
  lines,
  changes,
  selected,
  onSelect,
  onAdd,
  onWhiteout,
  onMove,
}: {
  page: PDFPageProxy;
  pageNo: number;
  zoom: number;
  tool: Tool;
  lines: Line[];
  changes: Changes;
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (page: number, x: number, yTop: number) => void;
  onWhiteout: (page: number, rect: { x: number; y: number; w: number; h: number }) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const viewport: PageViewport = useMemo(() => page.getViewport({ scale: zoom }), [page, zoom]);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [moving, setMoving] = useState<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    const task = page.render({ canvas, viewport: page.getViewport({ scale: zoom * ratio }) });
    task.promise.catch(() => undefined);
    return () => task.cancel();
  }, [page, viewport, zoom]);

  const rectOnScreen = (r: { x: number; y: number; w: number; h: number }) => {
    const [a, b] = viewport.convertToViewportPoint(r.x, r.y);
    const [c, d] = viewport.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return { left: Math.min(a, c), top: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
  };
  const toPdf = (e: { clientX: number; clientY: number }) => {
    const box = boxRef.current!.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(e.clientX - box.left, e.clientY - box.top);
    return { x, y, sx: e.clientX - box.left, sy: e.clientY - box.top };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (tool === 'add') {
      const p = toPdf(e);
      onAdd(pageNo, p.x, p.y);
    } else if (tool === 'whiteout') {
      const p = toPdf(e);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy });
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag) {
      const p = toPdf(e);
      setDrag({ ...drag, x1: p.sx, y1: p.sy });
    }
  }
  function onPointerUp() {
    if (!drag) return;
    const [ax, ay] = viewport.convertToPdfPoint(drag.x0, drag.y0);
    const [bx, by] = viewport.convertToPdfPoint(drag.x1, drag.y1);
    setDrag(null);
    onWhiteout(pageNo, { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
  }

  const pageChanges = Object.values(changes).filter((c) => c.page === pageNo);

  return (
    <div
      ref={boxRef}
      className="relative bg-white shadow-md"
      style={{ width: viewport.width, height: viewport.height, cursor: tool === 'add' ? 'text' : tool === 'whiteout' ? 'crosshair' : 'default', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={`Page ${pageNo}`} />

      {/* White boxes and new words, drawn as they will be printed */}
      {pageChanges.map((c) => {
        const cover = c.cover ? rectOnScreen(c.cover) : null;
        const scale = previewScale(c.text, c.size, c.bold, c.kind === 'line' && c.fit ? c.fitWidth : undefined);
        const size = c.size * scale;
        const [tx, ty] = viewport.convertToViewportPoint(c.x, c.y + size * 0.92);
        const isSelected = selected === c.id;
        return (
          <div key={c.id}>
            {cover && <div className="pointer-events-none absolute bg-white" style={cover} />}
            {c.kind !== 'whiteout' && c.text && (
              <div
                className={`absolute whitespace-pre ${c.kind === 'add' && tool === 'edit' ? 'cursor-move' : 'pointer-events-none'}`}
                style={{
                  left: tx + (moving?.id === c.id ? moving.dx : 0),
                  top: ty - size * zoom * 0.125 + (moving?.id === c.id ? moving.dy : 0),
                  fontFamily: PREVIEW_FONT,
                  fontSize: size * zoom,
                  lineHeight: 1.25,
                  fontWeight: c.bold ? 700 : 400,
                  color: c.color,
                }}
                onPointerDown={(e) => {
                  if (c.kind !== 'add' || tool !== 'edit') return;
                  e.stopPropagation();
                  onSelect(c.id);
                  const start = { x: e.clientX, y: e.clientY };
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const el = e.currentTarget as HTMLElement;
                  const move = (ev: PointerEvent) => setMoving({ id: c.id, dx: ev.clientX - start.x, dy: ev.clientY - start.y });
                  const up = (ev: PointerEvent) => {
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', up);
                    setMoving(null);
                    const dx = (ev.clientX - start.x) / zoom;
                    const dy = (ev.clientY - start.y) / zoom;
                    if (Math.abs(dx) + Math.abs(dy) > 0.5) onMove(c.id, c.x + dx, c.y - dy);
                  };
                  el.addEventListener('pointermove', move);
                  el.addEventListener('pointerup', up);
                }}
              >
                {c.text}
              </div>
            )}
            {isSelected && (cover || c.kind === 'add') && (
              <div
                className="pointer-events-none absolute rounded-sm ring-2 ring-indigo-500"
                style={cover ?? { left: tx - 2, top: ty - 2, width: Math.max(40, 0.6 * c.text.length * c.size * zoom), height: c.size * zoom * 1.3 * Math.max(1, c.text.split('\n').length) }}
              />
            )}
          </div>
        );
      })}

      {/* Clickable text lines */}
      {tool === 'edit' &&
        lines.map((line) => {
          const r = rectOnScreen(coverFor(line));
          const changed = Boolean(changes[line.id]);
          return (
            <button
              key={line.id}
              type="button"
              title={line.text}
              aria-label={`Edit line: ${line.text}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(line.id)}
              className={`absolute rounded-sm transition ${selected === line.id ? 'ring-2 ring-indigo-500' : changed ? 'ring-1 ring-emerald-500/70 hover:ring-2' : 'hover:bg-indigo-500/10 hover:ring-1 hover:ring-indigo-400'}`}
              style={r}
            />
          );
        })}

      {drag && (
        <div
          className="pointer-events-none absolute border border-dashed border-slate-600 bg-white/80"
          style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }}
        />
      )}
      <span className="pointer-events-none absolute -top-5 left-0 text-xs text-slate-500">Page {pageNo}</span>
    </div>
  );
}
