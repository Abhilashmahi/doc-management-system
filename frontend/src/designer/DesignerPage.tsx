import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { Button, ErrorBanner, Icon, LoadingBlock, Modal, useLoad, useToast } from '../components/kit';
import { ApiError, errorMessage, http } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import type { DocumentDetail, FieldDefinition, TemplateDetail, TemplateField, VersionInfo } from '../lib/types';
import { CanvasEditor } from './CanvasEditor';
import { exportDesign, type ExportFormat } from './export';
import { LeftPanel, type PanelTab } from './LeftPanel';
import { addElements, align, cloneElements, expandToGroups, group, removeElements, reorder, ungroup, updateElements, updatePage, usedFieldKeys, type AlignMode } from './ops';
import { PropertiesPanel } from './PropertiesPanel';
import { newId, type CanvasDocument, type CanvasElement, type CanvasPage } from './types';
import { useHistory } from './useHistory';

// Copied elements live here, so Ctrl+C on one page and Ctrl+V on another works.
let clipboard: CanvasElement[] = [];

const AUTOSAVE_DELAY_MS = 30_000;

interface Loaded {
  title: string;
  canvas: CanvasDocument;
  definitions: FieldDefinition[];
  templateFields: TemplateField[];
  values: Record<string, string> | null;
  versionNo: number;
  versions: VersionInfo[];
  documentStatus: 'Draft' | 'Final';
  backTo: string;
}

async function load(mode: 'template' | 'document', id: number): Promise<Loaded> {
  if (mode === 'template') {
    const [detail, fields] = await Promise.all([
      http.get<TemplateDetail>(`/templates/${id}`),
      http.get<{ fields: FieldDefinition[] }>('/fields', { includeInactive: true }),
    ]);
    return {
      title: detail.template.name,
      canvas: detail.canvas,
      definitions: fields.fields,
      templateFields: detail.fields,
      values: null,
      versionNo: detail.template.currentVersionNo,
      versions: detail.versions,
      documentStatus: 'Draft',
      backTo: '/templates',
    };
  }
  const [detail, fields] = await Promise.all([
    http.get<DocumentDetail>(`/documents/${id}`),
    http.get<{ fields: FieldDefinition[] }>('/fields', { includeInactive: true }),
  ]);
  if (!detail.content) throw new ApiError(400, 'Uploaded files cannot be opened in the designer. Upload a new version instead.');
  if (detail.document.isArchived) throw new ApiError(409, 'This document is archived. Restore it before editing.');
  return {
    title: detail.document.name,
    canvas: detail.content.canvas,
    definitions: fields.fields,
    templateFields: detail.content.fields,
    values: detail.content.data,
    versionNo: detail.document.currentVersionNo,
    versions: [],
    documentStatus: detail.document.status,
    backTo: `/documents/${id}`,
  };
}

// The full-screen designer. mode="template" edits a template (each save = a new template version);
// mode="document" edits one document's own copy of the layout and its values (each save = a new document version).
export function DesignerPage({ mode, id }: { mode: 'template' | 'document'; id: number }) {
  const { data, error, loading, reload } = useLoad(() => load(mode, id), [mode, id]);
  if (loading && !data) return <div className="flex h-screen items-center justify-center bg-slate-100"><LoadingBlock /></div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-8">
        <ErrorBanner message={error ?? 'Not found.'} onRetry={reload} />
        <Button onClick={() => navigate(mode === 'template' ? '/templates' : `/documents/${id}`)}>Go back</Button>
      </div>
    );
  }
  return <Designer key={`${mode}-${id}`} mode={mode} id={id} initial={data} />;
}

type SaveState = { kind: 'saved'; at: Date | null } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string };

function Designer({ mode, id, initial }: { mode: 'template' | 'document'; id: number; initial: Loaded }) {
  const session = useSession();
  const toast = useToast();
  const history = useHistory<CanvasDocument>(initial.canvas);
  const canvas = history.value;
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<PanelTab | null>('text');
  const [zoom, setZoom] = useState(0.75);
  const [preview, setPreview] = useState(false);
  const [templateFields, setTemplateFields] = useState(initial.templateFields);
  const [values, setValues] = useState(initial.values);
  const [versionNo, setVersionNo] = useState(initial.versionNo);
  const [versions, setVersions] = useState(initial.versions);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved', at: null });
  const [autosave, setAutosave] = useState(true);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const page = canvas.pages[Math.min(pageIndex, canvas.pages.length - 1)];
  const selected = page.elements.filter((e) => selectedIds.includes(e.id));
  const usedKeys = useMemo(() => usedFieldKeys(canvas), [canvas]);

  // In template preview, fields show their default values (or stay as {{Key}} placeholders).
  const previewValues = useMemo(() => {
    if (mode === 'document') return values;
    if (!preview) return null;
    const out: Record<string, string> = {};
    for (const key of usedKeys) {
      const def = initial.definitions.find((d) => d.fieldKey === key);
      out[key] = templateFields.find((f) => f.fieldKey === key)?.defaultValue || def?.defaultValue || `{{${key}}}`;
    }
    return out;
  }, [mode, values, preview, usedKeys, templateFields, initial.definitions]);

  // ---------- Fit the page to the window on first load ----------

  const fitZoom = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const z = Math.min((box.clientWidth - 80) / page.width, (box.clientHeight - 80) / page.height);
    setZoom(Math.max(0.1, Math.min(2, Math.round(z * 100) / 100)));
  }, [page.width, page.height]);

  useEffect(() => {
    fitZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Change tracking and saving ----------

  // "Unsaved" means the design differs from what was last saved, so undoing back to the saved state clears it.
  const snapshot = JSON.stringify({ canvas, templateFields, values });
  const savedSnapshot = useRef(snapshot);
  const dirty = snapshot !== savedSnapshot.current;
  // Also re-runs when a save finishes, in case more changes were made while it was in flight.
  useEffect(() => {
    if (dirty) setSaveState((s) => (s.kind === 'saving' || s.kind === 'error' ? s : s.kind === 'dirty' ? s : { kind: 'dirty' }));
    else setSaveState((s) => (s.kind === 'dirty' ? { kind: 'saved', at: null } : s));
  }, [dirty, snapshot, saveState.kind]);

  const save = useCallback(async () => {
    setSaveState({ kind: 'saving' });
    try {
      if (mode === 'template') {
        const result = await http.post<{ versionNo: number; fields: TemplateField[] }>(`/templates/${id}/versions`, { canvas, fields: templateFields, baseVersionNo: versionNo });
        setVersionNo(result.versionNo);
        // The server tidies the field list (adds fields placed on the page, drops unused ones).
        setTemplateFields(result.fields);
        savedSnapshot.current = JSON.stringify({ canvas, templateFields: result.fields, values });
        setVersions((v) => [{ versionNo: result.versionNo, createdAt: new Date().toISOString(), createdByName: session.user.fullName }, ...v]);
      } else {
        const result = await http.put<{ versionNo: number }>(`/documents/${id}/content`, { canvas, data: values ?? {}, status: initial.documentStatus, baseVersionNo: versionNo });
        setVersionNo(result.versionNo);
        savedSnapshot.current = JSON.stringify({ canvas, templateFields, values });
      }
      setSaveState({ kind: 'saved', at: new Date() });
    } catch (e) {
      const message = e instanceof ApiError && e.details.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : errorMessage(e);
      setSaveState({ kind: 'error', message });
      toast(message, 'error');
    }
  }, [mode, id, canvas, templateFields, values, versionNo, initial.documentStatus, session.user.fullName, toast]);

  // Autosave a while after the last change. Each save is a version, so it waits for a pause in editing.
  useEffect(() => {
    if (!autosave || saveState.kind !== 'dirty') return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autosave, saveState.kind, canvas, templateFields, values, save]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (saveState.kind !== 'dirty' && saveState.kind !== 'error') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState.kind]);

  function leave() {
    if ((saveState.kind === 'dirty' || saveState.kind === 'error') && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate(initial.backTo);
  }

  // ---------- Editing helpers ----------

  const setCanvas = history.set;

  const select = useCallback(
    (ids: string[], additive = false) => {
      const expanded = expandToGroups(page, ids);
      setSelectedIds((current) => {
        if (!additive) return expanded;
        const allIn = expanded.every((x) => current.includes(x));
        return allIn ? current.filter((x) => !expanded.includes(x)) : [...new Set([...current, ...expanded])];
      });
    },
    [page],
  );

  const add = useCallback(
    (elements: CanvasElement[]) => {
      setCanvas((c) => addElements(c, pageIndex, elements));
      setSelectedIds(elements.map((e) => e.id));
      setPreview(false);
    },
    [pageIndex, setCanvas],
  );

  const removeSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setCanvas((c) => removeElements(c, pageIndex, selectedIds));
    setSelectedIds([]);
  }, [pageIndex, selectedIds, setCanvas]);

  const duplicateSelected = useCallback(() => {
    if (selected.length === 0) return;
    const copies = cloneElements(selected);
    add(copies);
  }, [selected, add]);

  const updateById = useCallback(
    (changes: Record<string, Partial<CanvasElement>>, mergeKey?: string) => {
      setCanvas((c) => {
        let next = c;
        for (const [elId, patch] of Object.entries(changes)) next = updateElements(next, pageIndex, [elId], patch);
        return next;
      }, mergeKey);
    },
    [pageIndex, setCanvas],
  );

  // ---------- Keyboard shortcuts ----------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        void save();
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        history.redo();
      } else if (mod && key === 'c' && selected.length) {
        clipboard = selected.map((el) => ({ ...el }));
      } else if (mod && key === 'x' && selected.length) {
        clipboard = selected.map((el) => ({ ...el }));
        removeSelected();
      } else if (mod && key === 'v' && clipboard.length) {
        e.preventDefault();
        add(cloneElements(clipboard));
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && key === 'g') {
        e.preventDefault();
        setCanvas((c) => (e.shiftKey ? ungroup(c, pageIndex, selectedIds) : group(c, pageIndex, selectedIds)));
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelectedIds(page.elements.filter((el) => !el.locked).map((el) => el.id));
      } else if (key === 'delete' || key === 'backspace') {
        if (selectedIds.length) {
          e.preventDefault();
          removeSelected();
        }
      } else if (key === 'escape') {
        setSelectedIds([]);
        setPreview(false);
      } else if (key.startsWith('arrow') && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        const movable = selected.filter((el) => !el.locked).map((el) => el.id);
        setCanvas((c) => updateElements(c, pageIndex, movable, (el) => ({ x: el.x + dx, y: el.y + dy })), 'nudge');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, history, selected, selectedIds, removeSelected, add, duplicateSelected, setCanvas, pageIndex, page.elements]);

  // Ctrl + mouse wheel zooms.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.1, Math.min(4, Math.round((z * (e.deltaY < 0 ? 1.1 : 0.9)) * 100) / 100)));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- Pages ----------

  function addPage(copy: boolean) {
    const newPage: CanvasPage = copy
      ? { ...page, id: newId('page'), elements: cloneElements(page.elements, 0) }
      : { id: newId('page'), width: page.width, height: page.height, background: '#ffffff', elements: [] };
    setCanvas((c) => ({ ...c, pages: [...c.pages.slice(0, pageIndex + 1), newPage, ...c.pages.slice(pageIndex + 1)] }));
    setPageIndex(pageIndex + 1);
    setSelectedIds([]);
  }

  function deletePage() {
    if (canvas.pages.length <= 1) return;
    if (page.elements.length > 0 && !window.confirm(`Delete page ${pageIndex + 1} and everything on it?`)) return;
    setCanvas((c) => ({ ...c, pages: c.pages.filter((_, i) => i !== pageIndex) }));
    setPageIndex(Math.max(0, pageIndex - 1));
    setSelectedIds([]);
  }

  async function doExport(format: ExportFormat) {
    setExporting(true);
    try {
      await exportDesign(canvas, values, format, initial.title);
      if (mode === 'document') await http.post(`/documents/${id}/exported`, { format });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  async function loadVersion(no: number) {
    try {
      const v = await http.get<{ canvas: CanvasDocument; fields: TemplateField[] }>(`/templates/${id}/versions/${no}`);
      setCanvas(v.canvas);
      setTemplateFields(v.fields);
      setPageIndex(0);
      setSelectedIds([]);
      setVersionsOpen(false);
      toast(`Version ${no} loaded. Save to make it the newest version.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  // ---------- Layout ----------

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* Top toolbar */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 text-white shadow-sm" style={{ background: 'linear-gradient(90deg, #00c4cc 0%, #6a5cff 60%, #7d2ae8 100%)' }}>
        <button type="button" onClick={leave} className="rounded-md p-1.5 text-white hover:bg-white/15" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="mr-2 min-w-0">
          <p className="truncate text-sm font-semibold text-white">{initial.title}</p>
          <p className="text-xs text-white/80">
            {mode === 'template' ? 'Template' : 'Document layout'} · version {versionNo} · <SaveStatus state={saveState} />
          </p>
        </div>

        <ToolbarGroup>
          <ToolButton label="Undo (Ctrl+Z)" disabled={!history.canUndo} onClick={history.undo} path="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
          <ToolButton label="Redo (Ctrl+Y)" disabled={!history.canRedo} onClick={history.redo} path="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" />
        </ToolbarGroup>
        <ToolbarGroup>
          <ToolButton label="Duplicate (Ctrl+D)" disabled={selected.length === 0} onClick={duplicateSelected} path="M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          <ToolButton label="Delete (Del)" disabled={selected.length === 0} onClick={removeSelected} path="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
        </ToolbarGroup>
        <ToolbarGroup>
          <ToolButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, Math.round((z - 0.1) * 100) / 100))} path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M8 11h6" />
          <button type="button" onClick={fitZoom} className="w-14 rounded-md py-1 text-xs font-medium tabular-nums text-white hover:bg-white/15" title="Fit to window">
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton label="Zoom in" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))} path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M11 8v6M8 11h6" />
        </ToolbarGroup>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="hidden items-center gap-1.5 text-xs text-white/90 md:flex" title="Saves a new version 30 seconds after your last change">
            <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
            Autosave
          </label>
          {mode === 'template' && (
            <Button size="sm" onClick={() => setVersionsOpen(true)}>History</Button>
          )}
          <Button size="sm" onClick={() => { setPreview(!preview); setSelectedIds([]); }} aria-pressed={preview}>
            <Icon name="eye" /> {preview ? 'Exit preview' : 'Preview'}
          </Button>
          {mode === 'document' && (
            <>
              <Button size="sm" busy={exporting} onClick={() => doExport(session.settings?.defaultExportFormat ?? 'pdf')}>
                <Icon name="download" /> Export {(session.settings?.defaultExportFormat ?? 'pdf').toUpperCase()}
              </Button>
            </>
          )}
          <Button size="sm" className="!bg-white !text-[#6a1fd0] !ring-0 hover:!bg-white/90" busy={saveState.kind === 'saving'} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {!preview && (
          <LeftPanel
            mode={mode}
            tab={tab}
            onTab={setTab}
            page={page}
            definitions={initial.definitions}
            templateFields={templateFields}
            onTemplateFields={setTemplateFields}
            values={values}
            onValues={setValues}
            usedKeys={usedKeys}
            selectedIds={selectedIds}
            onAdd={add}
            onPageChange={(patch) => setCanvas((c) => updatePage(c, pageIndex, (p) => ({ ...p, ...patch })))}
            onSelect={(ids) => select(ids)}
            onElementChange={(elId, patch) => updateById({ [elId]: patch })}
            onMoveLayer={(elId, where) => setCanvas((c) => reorder(c, pageIndex, [elId], where))}
            onError={(m) => toast(m, 'error')}
          />
        )}

        {/* Centre: the page */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <div className="flex min-h-full min-w-max items-start justify-center p-10">
              <CanvasEditor
                page={page}
                values={previewValues}
                zoom={zoom}
                selectedIds={selectedIds}
                preview={preview}
                onSelect={select}
                onUpdate={updateById}
              />
            </div>
          </div>

          {/* Page navigation */}
          <div className="flex items-center gap-1 overflow-x-auto border-t border-slate-200 bg-surface px-3 py-1.5 text-xs">
            {canvas.pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPageIndex(i);
                  setSelectedIds([]);
                }}
                className={`rounded-md px-2.5 py-1 font-medium ${i === pageIndex ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Page {i + 1}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button type="button" onClick={() => addPage(false)} className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100">+ Add page</button>
            <button type="button" onClick={() => addPage(true)} className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100">Duplicate page</button>
            {canvas.pages.length > 1 && (
              <button type="button" onClick={deletePage} className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50">Delete page</button>
            )}
            <span className="ml-auto whitespace-nowrap text-slate-400">{page.width} × {page.height} px · {page.elements.length} elements</span>
          </div>
        </div>

        {!preview && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-surface lg:block">
            <PropertiesPanel
              page={page}
              selected={selected}
              definitions={initial.definitions}
              onChange={(ids, patch, mergeKey) => setCanvas((c) => updateElements(c, pageIndex, ids, patch), mergeKey)}
              onPageChange={(patch, mergeKey) => setCanvas((c) => updatePage(c, pageIndex, (p) => ({ ...p, ...patch })), mergeKey)}
              onAlign={(m: AlignMode) => setCanvas((c) => align(c, pageIndex, selectedIds, m))}
              onOrder={(where) => setCanvas((c) => reorder(c, pageIndex, selectedIds, where))}
              onGroup={() => setCanvas((c) => group(c, pageIndex, selectedIds))}
              onUngroup={() => setCanvas((c) => ungroup(c, pageIndex, selectedIds))}
              onDuplicate={duplicateSelected}
              onDelete={removeSelected}
            />
          </aside>
        )}
      </div>

      {versionsOpen && (
        <Modal title="Version history" onClose={() => setVersionsOpen(false)}>
          <p className="mb-3 text-sm text-slate-500">Every save is kept. Loading an older version puts it in the editor; save to make it the newest version. Documents keep the version they were created from.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {versions.map((v) => (
              <li key={v.versionNo} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium text-slate-800">Version {v.versionNo}</span>
                  {v.versionNo === versionNo && <span className="ml-2 text-xs text-emerald-600">current</span>}
                  <span className="block text-xs text-slate-500">{formatDateTime(v.createdAt)} · {v.createdByName}</span>
                </span>
                {v.versionNo !== versionNo && <Button size="sm" onClick={() => loadVersion(v.versionNo)}>Load</Button>}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  switch (state.kind) {
    case 'saved':
      return <span className="font-medium text-white">{state.at ? `Saved at ${state.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'All changes saved'}</span>;
    case 'dirty':
      return <span className="font-medium text-amber-200">Unsaved changes</span>;
    case 'saving':
      return <span className="text-white/80">Saving...</span>;
    case 'error':
      return <span className="font-medium text-red-200" title={state.message}>Save failed</span>;
  }
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5 border-l border-white/25 pl-2">{children}</div>;
}

function ToolButton({ label, onClick, path, disabled = false }: { label: string; onClick: () => void; path: string; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-md p-1.5 text-white hover:bg-white/15 disabled:opacity-40">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
    </button>
  );
}
