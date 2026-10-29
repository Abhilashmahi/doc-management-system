import {
  DEFAULT_TEXT_STYLE,
  newId,
  type CanvasDocument,
  type CanvasElement,
  type CanvasPage,
  type CodeElement,
  type FieldElement,
  type ImageElement,
  type LineElement,
  type ShapeElement,
  type TextElement,
} from './types';

// Pure functions that return a changed copy of the design. The designer keeps every result in its undo history,
// so nothing here mutates its input.

export function updatePage(canvas: CanvasDocument, pageIndex: number, change: (page: CanvasPage) => CanvasPage): CanvasDocument {
  return { ...canvas, pages: canvas.pages.map((p, i) => (i === pageIndex ? change(p) : p)) };
}

export function updateElements(canvas: CanvasDocument, pageIndex: number, ids: string[], patch: Partial<CanvasElement> | ((el: CanvasElement) => Partial<CanvasElement>)): CanvasDocument {
  const set = new Set(ids);
  return updatePage(canvas, pageIndex, (page) => ({
    ...page,
    elements: page.elements.map((el) => (set.has(el.id) ? ({ ...el, ...(typeof patch === 'function' ? patch(el) : patch) } as CanvasElement) : el)),
  }));
}

export function addElements(canvas: CanvasDocument, pageIndex: number, elements: CanvasElement[]): CanvasDocument {
  return updatePage(canvas, pageIndex, (page) => ({ ...page, elements: [...page.elements, ...elements] }));
}

export function removeElements(canvas: CanvasDocument, pageIndex: number, ids: string[]): CanvasDocument {
  const set = new Set(ids);
  return updatePage(canvas, pageIndex, (page) => ({ ...page, elements: page.elements.filter((el) => !set.has(el.id)) }));
}

// Copies elements with new ids, shifted a little so the copy is visible. Grouped copies form a new group.
export function cloneElements(elements: CanvasElement[], offset = 16): CanvasElement[] {
  const groupMap = new Map<string, string>();
  return elements.map((el) => {
    let groupId = el.groupId ?? null;
    if (groupId) {
      if (!groupMap.has(groupId)) groupMap.set(groupId, newId('grp'));
      groupId = groupMap.get(groupId)!;
    }
    return { ...el, id: newId(el.type), x: el.x + offset, y: el.y + offset, groupId, locked: false } as CanvasElement;
  });
}

// Changes stacking order. Later elements in the list are drawn on top.
export function reorder(canvas: CanvasDocument, pageIndex: number, ids: string[], where: 'front' | 'back' | 'forward' | 'backward'): CanvasDocument {
  const set = new Set(ids);
  return updatePage(canvas, pageIndex, (page) => {
    const els = [...page.elements];
    if (where === 'front') return { ...page, elements: [...els.filter((e) => !set.has(e.id)), ...els.filter((e) => set.has(e.id))] };
    if (where === 'back') return { ...page, elements: [...els.filter((e) => set.has(e.id)), ...els.filter((e) => !set.has(e.id))] };
    if (where === 'forward') {
      for (let i = els.length - 2; i >= 0; i -= 1) {
        if (set.has(els[i].id) && !set.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
      }
    } else {
      for (let i = 1; i < els.length; i += 1) {
        if (set.has(els[i].id) && !set.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
      }
    }
    return { ...page, elements: els };
  });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

// Aligns the selected elements to each other, or to the page when only one is selected.
export function align(canvas: CanvasDocument, pageIndex: number, ids: string[], mode: AlignMode): CanvasDocument {
  const page = canvas.pages[pageIndex];
  const selected = page.elements.filter((e) => ids.includes(e.id));
  if (selected.length === 0) return canvas;
  const box =
    selected.length === 1
      ? { left: 0, top: 0, right: page.width, bottom: page.height }
      : {
          left: Math.min(...selected.map((e) => e.x)),
          top: Math.min(...selected.map((e) => e.y)),
          right: Math.max(...selected.map((e) => e.x + e.width)),
          bottom: Math.max(...selected.map((e) => e.y + e.height)),
        };
  return updateElements(canvas, pageIndex, ids, (el) => {
    switch (mode) {
      case 'left':
        return { x: box.left };
      case 'hcenter':
        return { x: Math.round((box.left + box.right) / 2 - el.width / 2) };
      case 'right':
        return { x: box.right - el.width };
      case 'top':
        return { y: box.top };
      case 'vcenter':
        return { y: Math.round((box.top + box.bottom) / 2 - el.height / 2) };
      case 'bottom':
        return { y: box.bottom - el.height };
    }
  });
}

export function group(canvas: CanvasDocument, pageIndex: number, ids: string[]): CanvasDocument {
  if (ids.length < 2) return canvas;
  const groupId = newId('grp');
  return updateElements(canvas, pageIndex, ids, { groupId });
}

export function ungroup(canvas: CanvasDocument, pageIndex: number, ids: string[]): CanvasDocument {
  return updateElements(canvas, pageIndex, ids, { groupId: null });
}

// Selecting any member of a group selects the whole group.
export function expandToGroups(page: CanvasPage, ids: string[]): string[] {
  const groups = new Set(page.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  const out = new Set(ids);
  for (const el of page.elements) if (el.groupId && groups.has(el.groupId)) out.add(el.id);
  return [...out];
}

// ---------- New elements ----------

const base = (x: number, y: number, width: number, height: number) => ({
  x: Math.round(x),
  y: Math.round(y),
  width,
  height,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  groupId: null,
});

export function makeText(page: CanvasPage, preset: 'heading' | 'subheading' | 'body' | 'small'): TextElement {
  const presets = {
    heading: { text: 'Add a heading', fontSize: 32, fontStyle: 'bold' as const, height: 44 },
    subheading: { text: 'Add a subheading', fontSize: 22, fontStyle: 'bold' as const, height: 32 },
    body: { text: 'Add body text. Double-click to edit.', fontSize: 16, fontStyle: 'normal' as const, height: 24 },
    small: { text: 'Small print', fontSize: 11, fontStyle: 'normal' as const, height: 16 },
  }[preset];
  const width = Math.min(page.width - 80, 420);
  return {
    ...base((page.width - width) / 2, page.height * 0.15, width, presets.height),
    ...DEFAULT_TEXT_STYLE,
    type: 'text',
    id: newId('text'),
    text: presets.text,
    fontSize: presets.fontSize,
    fontStyle: presets.fontStyle,
    align: 'center',
  };
}

export function makeField(page: CanvasPage, fieldKey: string, label: string): FieldElement {
  return {
    ...base(page.width / 2 - 140, page.height * 0.3, 280, 26),
    ...DEFAULT_TEXT_STYLE,
    type: 'field',
    id: newId('field'),
    name: label,
    fieldKey,
    placeholder: '',
  };
}

export function makeShape(page: CanvasPage, kind: 'rect' | 'rounded' | 'ellipse' | 'frame'): ShapeElement {
  if (kind === 'frame') {
    // A border around the whole page, 24 px in from the edges.
    return { ...base(24, 24, page.width - 48, page.height - 48), type: 'rect', id: newId('rect'), name: 'Page border', fill: '', stroke: '#1e293b', strokeWidth: 3, cornerRadius: 0, dash: false };
  }
  return {
    ...base(page.width / 2 - 80, page.height * 0.3, 160, kind === 'ellipse' ? 160 : 100),
    type: kind === 'ellipse' ? 'ellipse' : 'rect',
    id: newId(kind),
    fill: '#e0e7ff',
    stroke: '#4f46e5',
    strokeWidth: 2,
    cornerRadius: kind === 'rounded' ? 16 : 0,
    dash: false,
  };
}

export function makeLine(page: CanvasPage, dashed = false): LineElement {
  return { ...base(page.width / 2 - 150, page.height * 0.4, 300, 0), type: 'line', id: newId('line'), stroke: '#1e293b', strokeWidth: 2, dash: dashed };
}

export function makeImage(page: CanvasPage, fileId: number, naturalWidth: number, naturalHeight: number): ImageElement {
  const width = Math.min(naturalWidth, page.width * 0.5);
  const height = Math.round((width * naturalHeight) / Math.max(1, naturalWidth));
  return { ...base((page.width - width) / 2, (page.height - height) / 3, Math.round(width), height), type: 'image', id: newId('img'), fileId };
}

export function makeCode(page: CanvasPage, kind: 'barcode' | 'qrcode', fieldKey: string | null, value: string): CodeElement {
  const size = kind === 'barcode' ? { w: 260, h: 90 } : { w: 120, h: 120 };
  return {
    ...base(page.width - size.w - 40, 40, size.w, size.h),
    type: kind,
    id: newId(kind),
    value,
    fieldKey,
    color: '#000000',
    background: '#ffffff',
    showText: true,
  };
}

// A readable name for the Layers list.
export function elementLabel(el: CanvasElement): string {
  if (el.name) return el.name;
  switch (el.type) {
    case 'text':
      return el.text.slice(0, 30) || 'Text';
    case 'field':
      return `{{${el.fieldKey}}}`;
    case 'image':
      return 'Image';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'barcode':
      return el.fieldKey ? `Barcode ({{${el.fieldKey}}})` : 'Barcode';
    case 'qrcode':
      return el.fieldKey ? `QR code ({{${el.fieldKey}}})` : 'QR code';
  }
}

// Field keys used anywhere in the design, in first-use order.
export function usedFieldKeys(canvas: CanvasDocument): string[] {
  const keys: string[] = [];
  for (const page of canvas.pages) {
    for (const el of page.elements) {
      const key = el.type === 'field' ? el.fieldKey : (el.type === 'barcode' || el.type === 'qrcode') && el.fieldKey ? el.fieldKey : null;
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}
