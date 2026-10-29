import { useId, type ReactNode } from 'react';
import { Icon } from '../components/kit';
import type { FieldDefinition } from '../lib/types';
import { elementLabel, type AlignMode } from './ops';
import { FONT_FAMILIES, PAGE_SIZES, type CanvasElement, type CanvasPage, type TextStyle } from './types';

interface Props {
  page: CanvasPage;
  selected: CanvasElement[];
  definitions: FieldDefinition[];
  onChange: (ids: string[], patch: Partial<CanvasElement>, mergeKey?: string) => void;
  onPageChange: (patch: Partial<CanvasPage>, mergeKey?: string) => void;
  onAlign: (mode: AlignMode) => void;
  onOrder: (where: 'front' | 'back' | 'forward' | 'backward') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

// The right sidebar: settings for whatever is selected, or page settings when nothing is.
export function PropertiesPanel(props: Props) {
  const { page, selected } = props;
  if (selected.length === 0) return <PageSettings page={page} onPageChange={props.onPageChange} />;

  const ids = selected.map((e) => e.id);
  const single = selected.length === 1 ? selected[0] : null;
  const change = (patch: Partial<CanvasElement>, mergeKey?: string) => props.onChange(ids, patch, mergeKey ? `${mergeKey}:${ids.join(',')}` : undefined);
  const grouped = selected.some((e) => e.groupId);

  return (
    <div className="space-y-5 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate font-semibold text-slate-800">{single ? elementLabel(single) : `${selected.length} elements selected`}</h2>
        <div className="flex shrink-0 gap-1">
          <SmallButton label="Duplicate (Ctrl+D)" onClick={props.onDuplicate}><Icon name="copy" /></SmallButton>
          <SmallButton label="Delete (Del)" onClick={props.onDelete} danger><Icon name="trash" /></SmallButton>
        </div>
      </div>

      <Section title={selected.length === 1 ? 'Align to page' : 'Align selection'}>
        <div className="grid grid-cols-6 gap-1">
          {(
            [
              ['left', 'Left', 'M4 4v16M8 8h12M8 16h8'],
              ['hcenter', 'Centre', 'M12 4v16M6 8h12M8 16h8'],
              ['right', 'Right', 'M20 4v16M4 8h12M8 16h8'],
              ['top', 'Top', 'M4 4h16M8 8v12M16 8v8'],
              ['vcenter', 'Middle', 'M4 12h16M8 6v12M16 8v8'],
              ['bottom', 'Bottom', 'M4 20h16M8 4v12M16 8v8'],
            ] as [AlignMode, string, string][]
          ).map(([mode, label, d]) => (
            <SmallButton key={mode} label={`Align ${label.toLowerCase()}`} onClick={() => props.onAlign(mode)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d={d} /></svg>
            </SmallButton>
          ))}
        </div>
      </Section>

      <Section title="Layer order">
        <div className="grid grid-cols-4 gap-1">
          <TextButton onClick={() => props.onOrder('front')}>To front</TextButton>
          <TextButton onClick={() => props.onOrder('forward')}>Forward</TextButton>
          <TextButton onClick={() => props.onOrder('backward')}>Backward</TextButton>
          <TextButton onClick={() => props.onOrder('back')}>To back</TextButton>
        </div>
        {(selected.length > 1 || grouped) && (
          <div className="mt-2 grid grid-cols-2 gap-1">
            <TextButton onClick={props.onGroup} disabled={selected.length < 2}>Group (Ctrl+G)</TextButton>
            <TextButton onClick={props.onUngroup} disabled={!grouped}>Ungroup</TextButton>
          </div>
        )}
      </Section>

      {single && (
        <Section title="Position and size">
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="X" value={single.x} onChange={(v) => change({ x: v }, 'x')} />
            <NumberInput label="Y" value={single.y} onChange={(v) => change({ y: v }, 'y')} />
            <NumberInput label="Width" value={single.width} min={1} onChange={(v) => change({ width: v }, 'w')} />
            <NumberInput label={single.type === 'line' ? 'Height (slope)' : 'Height'} value={single.height} min={single.type === 'line' ? -5000 : 1} onChange={(v) => change({ height: v }, 'h')} />
            <NumberInput label="Rotation °" value={single.rotation} min={-360} max={360} onChange={(v) => change({ rotation: v }, 'rot')} />
            <NumberInput label="Opacity %" value={Math.round(single.opacity * 100)} min={0} max={100} onChange={(v) => change({ opacity: v / 100 }, 'op')} />
          </div>
        </Section>
      )}

      <Section title="State">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Toggle label="Locked" checked={selected.every((e) => e.locked)} onChange={(v) => change({ locked: v })} />
          <Toggle label="Visible" checked={selected.every((e) => e.visible)} onChange={(v) => change({ visible: v })} />
        </div>
        {single && <TextInput label="Layer name" value={single.name ?? ''} placeholder={elementLabel({ ...single, name: undefined })} onChange={(v) => change({ name: v || undefined }, 'name')} />}
      </Section>

      {single && <TypeSpecific element={single} definitions={props.definitions} change={change} />}
    </div>
  );
}

function TypeSpecific({ element: el, definitions, change }: { element: CanvasElement; definitions: FieldDefinition[]; change: (patch: Partial<CanvasElement>, mergeKey?: string) => void }) {
  switch (el.type) {
    case 'text':
      return (
        <>
          <Section title="Text">
            <TextArea label="Content" value={el.text} onChange={(v) => change({ text: v } as Partial<CanvasElement>, 'text')} />
          </Section>
          <TextStyleControls style={el} change={change} />
        </>
      );
    case 'field':
      return (
        <>
          <Section title="Dynamic field">
            <SelectInput
              label="Field"
              value={el.fieldKey}
              onChange={(v) => {
                const def = definitions.find((d) => d.fieldKey === v);
                change({ fieldKey: v, name: def?.label } as Partial<CanvasElement>);
              }}
              options={fieldOptions(definitions, el.fieldKey)}
            />
            <TextInput label="Text when empty" value={el.placeholder} placeholder="(blank)" onChange={(v) => change({ placeholder: v } as Partial<CanvasElement>, 'ph')} />
            <p className="text-xs text-slate-500">Shows the value typed into the form for {`{{${el.fieldKey}}}`}.</p>
          </Section>
          <TextStyleControls style={el} change={change} />
        </>
      );
    case 'rect':
    case 'ellipse':
      return (
        <Section title="Shape">
          <ColorInput label="Fill" value={el.fill} allowNone onChange={(v) => change({ fill: v } as Partial<CanvasElement>, 'fill')} />
          <ColorInput label="Border" value={el.stroke} allowNone onChange={(v) => change({ stroke: v } as Partial<CanvasElement>, 'stroke')} />
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="Border width" value={el.strokeWidth} min={0} max={200} onChange={(v) => change({ strokeWidth: v } as Partial<CanvasElement>, 'sw')} />
            {el.type === 'rect' && <NumberInput label="Corner radius" value={el.cornerRadius} min={0} max={1000} onChange={(v) => change({ cornerRadius: v } as Partial<CanvasElement>, 'cr')} />}
          </div>
          <Toggle label="Dashed border" checked={el.dash} onChange={(v) => change({ dash: v } as Partial<CanvasElement>)} />
        </Section>
      );
    case 'line':
      return (
        <Section title="Line">
          <ColorInput label="Colour" value={el.stroke} onChange={(v) => change({ stroke: v } as Partial<CanvasElement>, 'stroke')} />
          <NumberInput label="Thickness" value={el.strokeWidth} min={0.5} max={200} onChange={(v) => change({ strokeWidth: v } as Partial<CanvasElement>, 'sw')} />
          <Toggle label="Dashed" checked={el.dash} onChange={(v) => change({ dash: v } as Partial<CanvasElement>)} />
        </Section>
      );
    case 'barcode':
    case 'qrcode':
      return (
        <Section title={el.type === 'barcode' ? 'Barcode (Code 128)' : 'QR code'}>
          <SelectInput
            label="Content"
            value={el.fieldKey ?? ''}
            onChange={(v) => change({ fieldKey: v || null } as Partial<CanvasElement>)}
            options={[{ value: '', label: 'Fixed value (type below)' }, ...fieldOptions(definitions, el.fieldKey ?? '').map((o) => ({ ...o, label: `Field: ${o.label}` }))]}
          />
          {!el.fieldKey && <TextArea label="Value" value={el.value} onChange={(v) => change({ value: v } as Partial<CanvasElement>, 'val')} />}
          <ColorInput label="Colour" value={el.color} onChange={(v) => change({ color: v } as Partial<CanvasElement>, 'col')} />
          <ColorInput label="Background" value={el.background} onChange={(v) => change({ background: v } as Partial<CanvasElement>, 'bg')} />
          {el.type === 'barcode' && <Toggle label="Show the value under the bars" checked={el.showText} onChange={(v) => change({ showText: v } as Partial<CanvasElement>)} />}
          {el.type === 'barcode' && <p className="text-xs text-slate-500">Code 128 encodes letters, numbers and common symbols.</p>}
        </Section>
      );
    case 'image':
      return (
        <Section title="Image">
          <p className="text-xs text-slate-500">Drag the corner handles to resize; the proportions are kept. To use a different picture, add it from Uploads and delete this one.</p>
        </Section>
      );
  }
}

function TextStyleControls({ style, change }: { style: TextStyle; change: (patch: Partial<CanvasElement>, mergeKey?: string) => void }) {
  const bold = style.fontStyle.includes('bold');
  const italic = style.fontStyle.includes('italic');
  const fontStyle = (b: boolean, i: boolean): TextStyle['fontStyle'] => (b && i ? 'bold italic' : b ? 'bold' : i ? 'italic' : 'normal');
  const set = (patch: Partial<TextStyle>, key?: string) => change(patch as Partial<CanvasElement>, key);
  return (
    <Section title="Font">
      <SelectInput label="Font family" value={style.fontFamily} onChange={(v) => set({ fontFamily: v })} options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))} />
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Size" value={style.fontSize} min={1} max={1000} onChange={(v) => set({ fontSize: v }, 'fs')} />
        <ColorInput label="Colour" value={style.fill} onChange={(v) => set({ fill: v }, 'fill')} compact />
      </div>
      <div className="flex flex-wrap gap-1">
        <ToggleButton label="Bold" active={bold} onClick={() => set({ fontStyle: fontStyle(!bold, italic) })}><b>B</b></ToggleButton>
        <ToggleButton label="Italic" active={italic} onClick={() => set({ fontStyle: fontStyle(bold, !italic) })}><i>I</i></ToggleButton>
        <ToggleButton label="Underline" active={style.textDecoration === 'underline'} onClick={() => set({ textDecoration: style.textDecoration === 'underline' ? '' : 'underline' })}><u>U</u></ToggleButton>
        <ToggleButton label="Strikethrough" active={style.textDecoration === 'line-through'} onClick={() => set({ textDecoration: style.textDecoration === 'line-through' ? '' : 'line-through' })}><s>S</s></ToggleButton>
        <span className="mx-1 w-px bg-slate-200" />
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <ToggleButton key={a} label={`Align ${a}`} active={style.align === a} onClick={() => set({ align: a })}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d={{ left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10', justify: 'M4 6h16M4 10h16M4 14h16M4 18h16' }[a]} />
            </svg>
          </ToggleButton>
        ))}
      </div>
      <SelectInput label="Vertical position" value={style.verticalAlign} onChange={(v) => set({ verticalAlign: v as TextStyle['verticalAlign'] })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Line height" value={style.lineHeight} step={0.1} min={0.5} max={5} onChange={(v) => set({ lineHeight: v }, 'lh')} />
        <NumberInput label="Letter spacing" value={style.letterSpacing} min={-20} max={100} onChange={(v) => set({ letterSpacing: v }, 'ls')} />
      </div>
      <ColorInput label="Highlight behind text" value={style.background} allowNone onChange={(v) => set({ background: v }, 'tbg')} />
    </Section>
  );
}

function PageSettings({ page, onPageChange }: { page: CanvasPage; onPageChange: Props['onPageChange'] }) {
  const presetIndex = PAGE_SIZES.findIndex((s) => s.width === page.width && s.height === page.height);
  return (
    <div className="space-y-5 p-4 text-sm">
      <h2 className="font-semibold text-slate-800">Page settings</h2>
      <p className="text-xs text-slate-500">Select an element on the page to change it. Shift-click selects several.</p>
      <Section title="Size">
        <SelectInput
          label="Preset"
          value={presetIndex >= 0 ? String(presetIndex) : ''}
          onChange={(v) => {
            if (v === '') return;
            const s = PAGE_SIZES[Number(v)];
            onPageChange({ width: s.width, height: s.height });
          }}
          options={[{ value: '', label: 'Custom size' }, ...PAGE_SIZES.map((s, i) => ({ value: String(i), label: s.label }))]}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Width (px)" value={page.width} min={50} max={20000} onChange={(v) => onPageChange({ width: v }, 'pw')} />
          <NumberInput label="Height (px)" value={page.height} min={50} max={20000} onChange={(v) => onPageChange({ height: v }, 'ph')} />
        </div>
        <p className="text-xs text-slate-500">96 px = 1 inch. A4 is 794 × 1123 px.</p>
      </Section>
      <Section title="Background">
        <ColorInput label="Colour" value={page.background} onChange={(v) => onPageChange({ background: v }, 'pbg')} />
        {page.backgroundFileId ? (
          <TextButton onClick={() => onPageChange({ backgroundFileId: null })}>Remove background image</TextButton>
        ) : (
          <p className="text-xs text-slate-500">To use a scanned form as the background, open the Background tab on the left.</p>
        )}
      </Section>
    </div>
  );
}

export function fieldOptions(definitions: FieldDefinition[], current: string) {
  const opts = definitions.filter((d) => d.isActive || d.fieldKey === current).map((d) => ({ value: d.fieldKey, label: `${d.label} ({{${d.fieldKey}}})` }));
  if (current && !opts.some((o) => o.value === current)) opts.unshift({ value: current, label: `{{${current}}} (missing from Field Master)` });
  return opts;
}

// ---------- Small controls ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

const controlClass = 'w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

function NumberInput({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs text-slate-500">{label}</label>
      <input
        id={id}
        type="number"
        className={controlClass}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === '' || !Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs text-slate-500">{label}</label>
      <input id={id} className={controlClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs text-slate-500">{label}</label>
      <textarea id={id} rows={3} className={controlClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs text-slate-500">{label}</label>
      <select id={id} className={controlClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function ColorInput({ label, value, onChange, allowNone = false, compact = false }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean; compact?: boolean }) {
  const id = useId();
  const none = !value;
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs text-slate-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={none ? '#ffffff' : value.slice(0, 7)}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-surface p-0.5"
        />
        {!compact && (
          <input aria-label={`${label} hex value`} className={controlClass} value={value} placeholder={allowNone ? 'none' : '#000000'} onChange={(e) => onChange(e.target.value.trim())} maxLength={9} />
        )}
        {allowNone && (
          <button type="button" onClick={() => onChange('')} className={`shrink-0 rounded-md px-2 py-1 text-xs ${none ? 'bg-ink text-white' : 'text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'}`}>
            None
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
      {label}
    </label>
  );
}

function SmallButton({ label, onClick, children, danger = false }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`flex items-center justify-center rounded-md p-1.5 ring-1 ring-slate-200 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100'}`}>
      {children}
    </button>
  );
}

function ToggleButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick} className={`flex h-8 w-8 items-center justify-center rounded-md text-sm ${active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
      {children}
    </button>
  );
}

function TextButton({ onClick, children, disabled = false }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">
      {children}
    </button>
  );
}
