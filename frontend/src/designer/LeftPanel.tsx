import { useRef, useState, type ReactNode } from 'react';
import { Icon, useLoad } from '../components/kit';
import { errorMessage, fileUrl, http } from '../lib/api';
import type { FieldDefinition, StoredAsset, Template, TemplateDetail, TemplateField } from '../lib/types';
import { loadImage } from './assets';
import { cloneElements, elementLabel, makeCode, makeField, makeImage, makeLine, makeShape, makeText } from './ops';
import { fieldOptions } from './PropertiesPanel';
import type { CanvasElement, CanvasPage } from './types';

export type PanelTab = 'templates' | 'text' | 'shapes' | 'uploads' | 'fields' | 'barcode' | 'qrcode' | 'background' | 'layers';

const TABS: { id: PanelTab; label: string; icon: string }[] = [
  { id: 'templates', label: 'Templates', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
  { id: 'text', label: 'Text', icon: 'M4 7V4h16v3M9 20h6M12 4v16' },
  { id: 'shapes', label: 'Shapes', icon: 'M3 3h8v8H3zM17 7a4 4 0 1 1 0 0.01M3 21l4-7 4 7z' },
  { id: 'uploads', label: 'Images', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12' },
  { id: 'fields', label: 'Fields', icon: 'M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3' },
  { id: 'barcode', label: 'Barcode', icon: 'M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14' },
  { id: 'qrcode', label: 'QR Code', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z' },
  { id: 'background', label: 'Background', icon: 'M3 3h18v18H3zM3 15l5-5 4 4 3-3 6 6' },
  { id: 'layers', label: 'Layers', icon: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
];

interface Props {
  mode: 'template' | 'document';
  tab: PanelTab | null;
  onTab: (tab: PanelTab | null) => void;
  page: CanvasPage;
  definitions: FieldDefinition[];
  // Template mode: per-template field settings (required, default value).
  templateFields: TemplateField[];
  onTemplateFields: (fields: TemplateField[]) => void;
  // Document mode: the values typed into the document.
  values: Record<string, string> | null;
  onValues: (values: Record<string, string>) => void;
  usedKeys: string[];
  selectedIds: string[];
  onAdd: (elements: CanvasElement[]) => void;
  onPageChange: (patch: Partial<CanvasPage>) => void;
  onSelect: (ids: string[]) => void;
  onElementChange: (id: string, patch: Partial<CanvasElement>) => void;
  onMoveLayer: (id: string, where: 'forward' | 'backward') => void;
  onError: (message: string) => void;
}

// The left sidebar: a strip of tabs and the panel for the open tab.
export function LeftPanel(props: Props) {
  const { tab, onTab } = props;
  return (
    <div className="flex h-full">
      <nav className="flex w-[72px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-[#18191b] py-2" aria-label="Designer tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(tab === t.id ? null : t.id)}
            aria-pressed={tab === t.id}
            className={`mx-1 flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium ${tab === t.id ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
      {tab && (
        <div className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-surface p-4 text-sm">
          {tab === 'templates' && <TemplatesTab {...props} />}
          {tab === 'text' && <TextTab {...props} />}
          {tab === 'shapes' && <ShapesTab {...props} />}
          {tab === 'uploads' && <UploadsTab {...props} />}
          {tab === 'fields' && <FieldsTab {...props} />}
          {(tab === 'barcode' || tab === 'qrcode') && <CodeTab {...props} kind={tab} />}
          {tab === 'background' && <BackgroundTab {...props} />}
          {tab === 'layers' && <LayersTab {...props} />}
        </div>
      )}
    </div>
  );
}

function Title({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold text-slate-800">{children}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function AddButton({ onClick, children, className = '' }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-lg px-3 py-2.5 text-left ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-300 ${className}`}>
      {children}
    </button>
  );
}

// ---------- Templates: copy another template's layout onto this page ----------

function TemplatesTab({ page, onAdd, onError }: Props) {
  const { data, loading } = useLoad(() => http.get<{ templates: Template[] }>('/templates'), []);
  const [busy, setBusy] = useState<number | null>(null);
  async function insert(id: number) {
    setBusy(id);
    try {
      const detail = await http.get<TemplateDetail>(`/templates/${id}`);
      const source = detail.canvas.pages[0];
      // Scale the copied elements if the page sizes differ.
      const scale = page.width / source.width;
      const copies = cloneElements(source.elements, 0).map((el) =>
        scale === 1 ? el : ({ ...el, x: el.x * scale, y: el.y * scale, width: el.width * scale, height: el.height * scale } as CanvasElement),
      );
      onAdd(copies);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Title hint="Copies every element from the first page of another template onto this page. Nothing is linked, so later changes do not carry over.">Start from a template</Title>
      {loading && <p className="text-slate-500">Loading...</p>}
      <div className="space-y-2">
        {data?.templates.map((t) => (
          <AddButton key={t.id} onClick={() => insert(t.id)}>
            <span className="block truncate font-medium text-slate-800">{t.name}</span>
            <span className="text-xs text-slate-500">{busy === t.id ? 'Copying...' : `${t.categoryName ?? 'No category'} · ${t.status}`}</span>
          </AddButton>
        ))}
        {data?.templates.length === 0 && <p className="text-slate-500">No templates yet.</p>}
      </div>
    </>
  );
}

// ---------- Text ----------

function TextTab({ page, onAdd }: Props) {
  return (
    <>
      <Title hint="Click to add. Double-click text on the page to type.">Text</Title>
      <div className="space-y-2">
        <AddButton onClick={() => onAdd([makeText(page, 'heading')])}><span className="text-xl font-bold">Add a heading</span></AddButton>
        <AddButton onClick={() => onAdd([makeText(page, 'subheading')])}><span className="text-base font-semibold">Add a subheading</span></AddButton>
        <AddButton onClick={() => onAdd([makeText(page, 'body')])}><span>Add body text</span></AddButton>
        <AddButton onClick={() => onAdd([makeText(page, 'small')])}><span className="text-xs">Add small print</span></AddButton>
      </div>
    </>
  );
}

// ---------- Shapes ----------

function ShapesTab({ page, onAdd }: Props) {
  const items: { label: string; make: () => CanvasElement; preview: ReactNode }[] = [
    { label: 'Rectangle', make: () => makeShape(page, 'rect'), preview: <div className="h-8 w-12 border-2 border-indigo-600 bg-indigo-100" /> },
    { label: 'Rounded box', make: () => makeShape(page, 'rounded'), preview: <div className="h-8 w-12 rounded-lg border-2 border-indigo-600 bg-indigo-100" /> },
    { label: 'Circle / ellipse', make: () => makeShape(page, 'ellipse'), preview: <div className="h-9 w-9 rounded-full border-2 border-indigo-600 bg-indigo-100" /> },
    { label: 'Line', make: () => makeLine(page), preview: <div className="h-0.5 w-12 bg-slate-800" /> },
    { label: 'Dashed line', make: () => makeLine(page, true), preview: <div className="w-12 border-t-2 border-dashed border-slate-800" /> },
    { label: 'Page border', make: () => makeShape(page, 'frame'), preview: <div className="h-10 w-8 border-2 border-slate-800" /> },
  ];
  return (
    <>
      <Title hint="Shapes, borders and lines.">Shapes</Title>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button key={item.label} type="button" onClick={() => onAdd([item.make()])} className="flex flex-col items-center gap-2 rounded-lg p-3 ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-300">
            <span className="flex h-10 items-center">{item.preview}</span>
            <span className="text-xs text-slate-600">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- Images and uploads ----------

async function uploadAsset(file: File): Promise<StoredAsset> {
  const form = new FormData();
  form.append('file', file);
  const result = await http.upload<{ file: StoredAsset }>('/files/assets', form);
  return result.file;
}

function UploadsTab({ page, onAdd, onError }: Props) {
  const { data, reload } = useLoad(() => http.get<{ files: StoredAsset[] }>('/files/assets'), []);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function add(id: number) {
    try {
      const img = await loadImage(id);
      onAdd([makeImage(page, id, img.naturalWidth, img.naturalHeight)]);
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const stored = await uploadAsset(file);
        await add(stored.id);
      }
      reload();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <Title hint="Logos, photos, seals and signatures. PNG, JPEG, WebP or GIF.">Images</Title>
      <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp,.gif" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        <Icon name="upload" /> {busy ? 'Uploading...' : 'Upload images'}
      </button>
      <div className="grid grid-cols-2 gap-2">
        {data?.files.map((f) => (
          <button key={f.id} type="button" title={f.originalName} onClick={() => add(f.id)} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 hover:ring-2 hover:ring-indigo-400">
            <img src={fileUrl(f.id)} alt={f.originalName} className="max-h-full max-w-full object-contain" loading="lazy" />
          </button>
        ))}
      </div>
      {data?.files.length === 0 && <p className="text-slate-500">No images uploaded yet.</p>}
    </>
  );
}

// ---------- Dynamic fields ----------

function FieldsTab({ mode, page, definitions, templateFields, onTemplateFields, values, onValues, usedKeys, onAdd }: Props) {
  const active = definitions.filter((d) => d.isActive);
  const byKey = new Map(definitions.map((d) => [d.fieldKey, d]));
  const settings = (key: string) => templateFields.find((f) => f.fieldKey === key) ?? { fieldKey: key, required: false, defaultValue: '' };
  const setSetting = (key: string, patch: Partial<TemplateField>) => {
    const next = usedKeys.map((k) => (k === key ? { ...settings(k), ...patch } : settings(k)));
    onTemplateFields(next);
  };

  return (
    <>
      <Title hint="Placeholders such as {{FullName}} that are filled from the form when a document is created.">Dynamic fields</Title>

      {usedKeys.length > 0 && (
        <div className="mb-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{mode === 'template' ? 'Used in this template' : 'Values in this document'}</h3>
          {usedKeys.map((key) => {
            const def = byKey.get(key);
            return (
              <div key={key} className="rounded-lg p-2.5 ring-1 ring-slate-200">
                <p className="font-medium text-slate-800">{def?.label ?? key}</p>
                <p className="font-mono text-[11px] text-slate-400">{`{{${key}}}`}</p>
                {mode === 'template' ? (
                  <div className="mt-2 space-y-1.5">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={settings(key).required} onChange={(e) => setSetting(key, { required: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600" />
                      Required in this template
                    </label>
                    <input aria-label={`Default value for ${def?.label ?? key}`} placeholder="Default value (optional)" value={settings(key).defaultValue} onChange={(e) => setSetting(key, { defaultValue: e.target.value })} className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                  </div>
                ) : (
                  <input
                    aria-label={`Value for ${def?.label ?? key}`}
                    type={def?.dataType === 'date' ? 'date' : def?.dataType === 'number' ? 'number' : 'text'}
                    value={values?.[key] ?? ''}
                    onChange={(e) => onValues({ ...(values ?? {}), [key]: e.target.value })}
                    className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add a field to the page</h3>
      <div className="space-y-1.5">
        {active.map((d) => (
          <AddButton key={d.id} onClick={() => onAdd([makeField(page, d.fieldKey, d.label)])} className="py-2">
            <span className="block font-medium text-slate-800">{d.label}</span>
            <span className="font-mono text-[11px] text-slate-400">{`{{${d.fieldKey}}}`} · {d.dataType}</span>
          </AddButton>
        ))}
      </div>
      {active.length === 0 && <p className="text-slate-500">No fields yet. Add them in Administration → Field Master.</p>}
    </>
  );
}

// ---------- Barcode and QR code ----------

function CodeTab({ page, definitions, onAdd, kind }: Props & { kind: 'barcode' | 'qrcode' }) {
  const [source, setSource] = useState('');
  const [value, setValue] = useState(kind === 'barcode' ? 'ESV-0001' : 'https://');
  const options = fieldOptions(definitions, '');
  return (
    <>
      <Title hint={kind === 'barcode' ? 'Code 128 barcode, readable by any barcode scanner.' : 'QR code, readable by any phone camera.'}>{kind === 'barcode' ? 'Barcode' : 'QR code'}</Title>
      <div className="space-y-3">
        <div>
          <label htmlFor="code-source" className="mb-1 block text-xs text-slate-500">Content</label>
          <select id="code-source" value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5">
            <option value="">A fixed value</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>Field: {o.label}</option>
            ))}
          </select>
        </div>
        {!source && (
          <div>
            <label htmlFor="code-value" className="mb-1 block text-xs text-slate-500">Value</label>
            <input id="code-value" value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          </div>
        )}
        {source && <p className="text-xs text-slate-500">Each document encodes its own {`{{${source}}}`} value, e.g. the registration number.</p>}
        <button type="button" onClick={() => onAdd([makeCode(page, kind, source || null, source ? '' : value)])} className="w-full rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700">
          Add {kind === 'barcode' ? 'barcode' : 'QR code'}
        </button>
      </div>
    </>
  );
}

// ---------- Background ----------

const SWATCHES = ['#ffffff', '#f8fafc', '#fefce8', '#fff7ed', '#f0fdf4', '#eff6ff', '#fdf2f8', '#f1f5f9', '#e2e8f0', '#1e293b'];

function BackgroundTab({ page, onPageChange, onError }: Props) {
  const { data, reload } = useLoad(() => http.get<{ files: StoredAsset[] }>('/files/assets'), []);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const stored = await uploadAsset(file);
      onPageChange({ backgroundFileId: stored.id });
      reload();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title hint="A colour, or an image stretched over the whole page — for example a scanned blank certificate.">Background</Title>
      <div className="mb-4 grid grid-cols-5 gap-2">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`Background ${c}`} onClick={() => onPageChange({ background: c })} className={`h-9 rounded-md ring-1 ${page.background === c ? 'ring-2 ring-indigo-500' : 'ring-slate-300'}`} style={{ background: c }} />
        ))}
      </div>
      <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mb-3 w-full rounded-lg px-3 py-2 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60">
        {busy ? 'Uploading...' : 'Upload a background image'}
      </button>
      {page.backgroundFileId && (
        <button type="button" onClick={() => onPageChange({ backgroundFileId: null })} className="mb-3 w-full rounded-lg px-3 py-2 text-red-600 ring-1 ring-red-200 hover:bg-red-50">
          Remove background image
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        {data?.files.map((f) => (
          <button key={f.id} type="button" title={`Use ${f.originalName}`} onClick={() => onPageChange({ backgroundFileId: f.id })} className={`flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ${page.backgroundFileId === f.id ? 'ring-2 ring-indigo-500' : 'ring-slate-200'}`}>
            <img src={fileUrl(f.id)} alt={f.originalName} className="max-h-full max-w-full object-contain" loading="lazy" />
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- Layers ----------

function LayersTab({ page, selectedIds, onSelect, onElementChange, onMoveLayer }: Props) {
  // Top of the list = drawn on top.
  const layers = [...page.elements].reverse();
  return (
    <>
      <Title hint="The top of the list is drawn on top. Click to select.">Layers</Title>
      {layers.length === 0 && <p className="text-slate-500">The page is empty.</p>}
      <ul className="space-y-1">
        {layers.map((el) => {
          const selected = selectedIds.includes(el.id);
          return (
            <li key={el.id} className={`flex items-center gap-1 rounded-md px-2 py-1.5 ${selected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}`}>
              <button type="button" onClick={() => onSelect([el.id])} className={`min-w-0 flex-1 truncate text-left text-xs ${el.visible ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                {el.groupId && <span className="mr-1 text-indigo-500" title="Grouped">▣</span>}
                {elementLabel(el)}
              </button>
              <LayerButton label="Move up" onClick={() => onMoveLayer(el.id, 'forward')}>↑</LayerButton>
              <LayerButton label="Move down" onClick={() => onMoveLayer(el.id, 'backward')}>↓</LayerButton>
              <LayerButton label={el.visible ? 'Hide' : 'Show'} onClick={() => onElementChange(el.id, { visible: !el.visible })}>{el.visible ? '◉' : '○'}</LayerButton>
              <LayerButton label={el.locked ? 'Unlock' : 'Lock'} onClick={() => onElementChange(el.id, { locked: !el.locked })}>{el.locked ? '🔒' : '🔓'}</LayerButton>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LayerButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-slate-500 hover:bg-slate-200">
      {children}
    </button>
  );
}
