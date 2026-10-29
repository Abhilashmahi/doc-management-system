import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useSession } from '../app/session';
import { Button, Checkbox, Modal, SelectField, TextField, useToast } from '../components/kit';
import { ApiError, errorMessage, http } from '../lib/api';
import { navigate, useSearchParams } from '../lib/router';
import { ThemeToggle } from '../lib/theme';
import type { DocumentDetail } from '../lib/types';
import { canvasToBlob, cropCanvas, floodFill, linePoints, loadImage, makeCanvas, resizeArea, rgbToHex, scaleCanvas, turnCanvas, type Turn } from './raster';
import { SHAPES, shapeIconPath, shapePath, type ShapeKind } from './shapes';

// A Paint program in the browser, in the spirit of Windows Paint: pencil, brushes, eraser, paint bucket, colour
// picker, text, shapes, rectangle selection (move, cut, copy, paste, crop), rotate/flip/resize, zoom, undo.
// Pictures are saved into Documents as PNG or JPEG files; an image document can be opened, edited and saved as a
// new version (the original is always kept in the version history).

type Tool = 'select' | 'pencil' | 'brush' | 'eraser' | 'fill' | 'picker' | 'text' | 'zoom' | 'shape';
type BrushKind = 'brush' | 'calligraphy' | 'airbrush' | 'marker';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Selection extends Rect {
  floating: boolean; // true once the pixels are lifted off the picture (moving, pasted)
}
interface TextBox {
  x: number;
  y: number;
  value: string;
}
interface OpenDoc {
  id: number;
  name: string;
  versionNo: number;
}

const DEFAULT_W = 1200;
const DEFAULT_H = 800;
const MAX_SIDE = 8000;
const MAX_UNDO = 30;
const ZOOMS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

const PALETTE = [
  '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
  '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
];

const FONTS = [
  { value: 'Arial, "Nirmala UI", sans-serif', label: 'Arial' },
  { value: '"Segoe UI", "Nirmala UI", sans-serif', label: 'Segoe UI' },
  { value: '"Times New Roman", "Nirmala UI", serif', label: 'Times New Roman' },
  { value: 'Georgia, "Nirmala UI", serif', label: 'Georgia' },
  { value: 'Verdana, "Nirmala UI", sans-serif', label: 'Verdana' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: '"Comic Sans MS", "Nirmala UI", cursive', label: 'Comic Sans' },
  { value: '"Nirmala UI", "Latha", sans-serif', label: 'Nirmala UI (தமிழ்)' },
];

const BRUSHES: { kind: BrushKind; label: string }[] = [
  { kind: 'brush', label: 'Brush' },
  { kind: 'calligraphy', label: 'Calligraphy pen' },
  { kind: 'airbrush', label: 'Airbrush' },
  { kind: 'marker', label: 'Marker' },
];

const zoomIn = (z: number) => ZOOMS.find((v) => v > z + 0.001) ?? z;
const zoomOut = (z: number) => [...ZOOMS].reverse().find((v) => v < z - 0.001) ?? z;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}

export function PaintPage() {
  const session = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const canSave = session.canEdit && Boolean(session.accountId);

  // ---------- Settings chosen in the toolbar ----------
  const [tool, setToolState] = useState<Tool>('pencil');
  const [brush, setBrush] = useState<BrushKind>('brush');
  const [shape, setShape] = useState<ShapeKind>('rect');
  const [outline, setOutline] = useState(true);
  const [fillShape, setFillShape] = useState(false);
  const [size, setSize] = useState(3);
  const [opacity, setOpacity] = useState(1);
  const [color1, setColor1] = useState('#000000');
  const [color2, setColor2] = useState('#ffffff');
  const [activeSlot, setActiveSlot] = useState<1 | 2>(1);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [font, setFont] = useState(FONTS[0].value);
  const [textSize, setTextSize] = useState(28);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [textOpaque, setTextOpaque] = useState(false);

  // ---------- Picture state ----------
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<Selection | null>(null);
  const [textBox, setTextBox] = useState<TextBox | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ w: number; h: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const [title, setTitle] = useState('Untitled');
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'resize' | null>(null);
  const [menu, setMenuState] = useState<{ name: 'file' | 'rotate' | 'brushes'; x: number; y: number } | null>(null);
  const [floatVersion, setFloatVersion] = useState(0); // changes whenever the lifted pixels change
  const [loading, setLoading] = useState(false);

  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const floatViewRef = useRef<HTMLCanvasElement>(null);
  const floatSrc = useRef<HTMLCanvasElement | null>(null);
  const clipboard = useRef<HTMLCanvasElement | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previousTool = useRef<Tool>('pencil');
  const sprayTimer = useRef<number | null>(null);
  const drag = useRef<{
    mode: 'stroke' | 'shape' | 'marquee' | 'move' | 'resize';
    button: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    origin?: Rect;
    shift?: boolean;
  } | null>(null);

  // Keep the latest values for event handlers registered once.
  const live = useRef({ sel, textBox, tool });
  live.current = { sel, textBox, tool };

  function setMenu(next: null) {
    setMenuState(next);
  }
  function toggleMenu(name: 'file' | 'rotate' | 'brushes', anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    setMenuState((m) => (m?.name === name ? null : { name, x: r.left, y: r.bottom + 4 }));
  }

  const main = () => mainRef.current!;
  const mainCtx = () => mainRef.current!.getContext('2d', { willReadFrequently: true })!;
  const overlayCtx = () => overlayRef.current!.getContext('2d')!;

  // ---------- Setting up ----------

  const replaceImage = useCallback((source: HTMLCanvasElement | HTMLImageElement | ImageData, background?: string) => {
    const c = mainRef.current!;
    const o = overlayRef.current!;
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    c.width = o.width = w;
    c.height = o.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    if (source instanceof ImageData) ctx.putImageData(source, 0, 0);
    else {
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(source, 0, 0);
    }
    setCanvasSize({ w, h });
  }, []);

  function fitZoom(w = canvasSize.w, h = canvasSize.h) {
    const box = scrollRef.current;
    if (!box) return;
    const z = Math.min((box.clientWidth - 64) / w, (box.clientHeight - 64) / h, 1);
    setZoom(Math.max(0.05, Math.floor(z * 100) / 100));
  }

  // A blank white picture, or the image document named in the address (?doc=12).
  useEffect(() => {
    replaceImage(makeCanvas(DEFAULT_W, DEFAULT_H, '#ffffff'));
    requestAnimationFrame(() => fitZoom(DEFAULT_W, DEFAULT_H));
    const docId = Number(params.get('doc'));
    if (docId > 0) void openDocument(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDocument(id: number) {
    setLoading(true);
    try {
      const detail = await http.get<DocumentDetail>(`/documents/${id}`);
      const doc = detail.document;
      if (doc.sourceType !== 'upload' || !doc.mimeType?.startsWith('image/')) throw new Error('Only picture documents (PNG, JPEG, GIF, BMP, WebP) can be opened in Paint.');
      const res = await fetch(`/api/documents/${id}/file?inline=1`, { credentials: 'include' });
      if (!res.ok) throw new Error('The picture could not be loaded.');
      const img = await loadImage(await res.blob());
      if (img.naturalWidth > MAX_SIDE || img.naturalHeight > MAX_SIDE) throw new Error(`This picture is larger than ${MAX_SIDE} pixels on a side.`);
      resetHistory();
      replaceImage(img);
      setOpenDoc({ id: doc.id, name: doc.name, versionNo: doc.currentVersionNo });
      setTitle(doc.name);
      setDirty(false);
      requestAnimationFrame(() => fitZoom(img.naturalWidth, img.naturalHeight));
    } catch (e) {
      toast(e instanceof ApiError || !(e instanceof Error) ? errorMessage(e) : e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  // Draw a lifted selection into its on-screen canvas whenever it changes.
  useEffect(() => {
    const view = floatViewRef.current;
    const src = floatSrc.current;
    if (!view || !src || !sel?.floating) return;
    view.width = src.width;
    view.height = src.height;
    view.getContext('2d')!.drawImage(src, 0, 0);
  }, [sel?.floating, floatVersion]);

  // ---------- Undo ----------

  function resetHistory() {
    undoStack.current = [];
    redoStack.current = [];
    setUndoCount(0);
    setRedoCount(0);
  }

  // Remembers the picture as it is now, before a change.
  function pushUndo() {
    const c = main();
    undoStack.current.push(mainCtx().getImageData(0, 0, c.width, c.height));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setUndoCount(undoStack.current.length);
    setRedoCount(0);
    setDirty(true);
  }

  function undo() {
    // Anything not yet placed on the picture is simply dropped.
    floatSrc.current = null;
    setSel(null);
    setTextBox(null);
    const previous = undoStack.current.pop();
    if (!previous) return;
    const c = main();
    redoStack.current.push(mainCtx().getImageData(0, 0, c.width, c.height));
    replaceImage(previous);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    setDirty(true);
  }

  function redo() {
    commitPending();
    const next = redoStack.current.pop();
    if (!next) return;
    const c = main();
    undoStack.current.push(mainCtx().getImageData(0, 0, c.width, c.height));
    replaceImage(next);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    setDirty(true);
  }

  // ---------- Selection and text that are still "floating" ----------

  function commitFloating() {
    const s = live.current.sel;
    if (s?.floating && floatSrc.current) mainCtx().drawImage(floatSrc.current, Math.round(s.x), Math.round(s.y));
    floatSrc.current = null;
    setSel(null);
  }

  function commitText() {
    const box = live.current.textBox;
    setTextBox(null);
    if (!box || !box.value.trim()) return;
    pushUndo();
    const ctx = mainCtx();
    ctx.save();
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${textSize}px ${font}`;
    ctx.textBaseline = 'top';
    const lines = box.value.split('\n');
    const lineHeight = textSize * 1.25;
    if (textOpaque) {
      const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.fillStyle = color2;
      ctx.fillRect(box.x, box.y, width + 4, lines.length * lineHeight);
    }
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color1;
    lines.forEach((line, i) => {
      const y = box.y + i * lineHeight + (lineHeight - textSize) / 2;
      ctx.fillText(line, box.x + 2, y);
      if (underline && line) {
        const w = ctx.measureText(line).width;
        ctx.fillRect(box.x + 2, y + textSize * 1.02, w, Math.max(1, textSize / 14));
      }
    });
    ctx.restore();
  }

  function commitPending() {
    commitFloating();
    commitText();
  }

  function setTool(next: Tool) {
    commitPending();
    if (next !== 'picker') previousTool.current = next;
    setToolState(next);
    setMenu(null);
  }

  // Lifts the selected pixels off the picture so they can move. The hole is filled with the background colour.
  function liftSelection(s: Selection): Selection {
    if (s.floating) return s;
    pushUndo();
    floatSrc.current = cropCanvas(main(), s.x, s.y, s.w, s.h);
    setFloatVersion((v) => v + 1);
    const ctx = mainCtx();
    ctx.fillStyle = color2;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    const lifted = { ...s, floating: true };
    setSel(lifted);
    return lifted;
  }

  function selectAll() {
    setTool('select');
    setSel({ x: 0, y: 0, w: main().width, h: main().height, floating: false });
  }

  function deleteSelection() {
    const s = live.current.sel;
    if (!s) return;
    if (s.floating) {
      floatSrc.current = null;
    } else {
      pushUndo();
      const ctx = mainCtx();
      ctx.fillStyle = color2;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    setSel(null);
    setDirty(true);
  }

  function selectionPixels(): HTMLCanvasElement | null {
    const s = live.current.sel;
    if (!s) return null;
    return s.floating && floatSrc.current ? cropCanvas(floatSrc.current, 0, 0, s.w, s.h) : cropCanvas(main(), s.x, s.y, s.w, s.h);
  }

  async function copySelection(): Promise<boolean> {
    const pixels = selectionPixels();
    if (!pixels) return false;
    clipboard.current = pixels;
    try {
      const blob = await canvasToBlob(pixels, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      /* the copy still works inside Paint */
    }
    return true;
  }

  async function cutSelection() {
    if (await copySelection()) deleteSelection();
  }

  // Places a picture as a floating selection at the top-left, growing the picture if it does not fit.
  function pasteCanvas(source: HTMLCanvasElement) {
    commitPending();
    const c = main();
    pushUndo();
    if (source.width > c.width || source.height > c.height) {
      replaceImage(resizeArea(c, Math.max(c.width, source.width), Math.max(c.height, source.height), color2));
    }
    floatSrc.current = source;
    setFloatVersion((v) => v + 1);
    setToolState('select');
    setSel({ x: 0, y: 0, w: source.width, h: source.height, floating: true });
  }

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const img = await loadImage(await item.getType(type));
          const c = makeCanvas(img.naturalWidth, img.naturalHeight);
          c.getContext('2d')!.drawImage(img, 0, 0);
          pasteCanvas(c);
          return;
        }
      }
    } catch {
      /* no permission or no picture: fall back to Paint's own clipboard */
    }
    if (clipboard.current) pasteCanvas(cropCanvas(clipboard.current, 0, 0, clipboard.current.width, clipboard.current.height));
    else toast('There is no picture to paste. Copy one first.', 'error');
  }

  // ---------- Image menu ----------

  function cropToSelection() {
    const pixels = selectionPixels();
    if (!pixels) return;
    if (!live.current.sel?.floating) pushUndo();
    floatSrc.current = null;
    setSel(null);
    replaceImage(pixels);
    setDirty(true);
  }

  function turn(t: Turn) {
    setMenu(null);
    const s = live.current.sel;
    if (s) {
      // Turn only the selection, like Paint.
      const lifted = liftSelection(s);
      floatSrc.current = turnCanvas(floatSrc.current!, t);
      setFloatVersion((v) => v + 1);
      setSel({ ...lifted, w: floatSrc.current.width, h: floatSrc.current.height });
      return;
    }
    commitText();
    pushUndo();
    replaceImage(turnCanvas(main(), t));
  }

  function applyResize(mode: 'stretch' | 'area', w: number, h: number) {
    commitPending();
    pushUndo();
    replaceImage(mode === 'stretch' ? scaleCanvas(main(), w, h) : resizeArea(main(), w, h, color2));
    setDialog(null);
  }

  // ---------- Drawing ----------

  function point(e: { clientX: number; clientY: number }) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  function strokeColor(button: number) {
    return button === 2 ? color2 : color1;
  }

  function strokeAlpha() {
    if (tool === 'eraser') return 1;
    if (tool === 'brush' && brush === 'marker') return opacity * 0.5;
    return opacity;
  }

  // Draws one piece of a freehand stroke onto the overlay (shown at the stroke's opacity, merged when the mouse is released).
  function strokeSegment(x0: number, y0: number, x1: number, y1: number, button: number) {
    const ctx = overlayCtx();
    if (tool === 'pencil' || tool === 'eraser') {
      ctx.fillStyle = tool === 'eraser' ? color2 : strokeColor(button);
      const s = tool === 'eraser' ? Math.max(size * 2, 4) : size;
      for (const [px, py] of linePoints(x0, y0, x1, y1)) ctx.fillRect(px - Math.floor(s / 2), py - Math.floor(s / 2), s, s);
      return;
    }
    ctx.strokeStyle = ctx.fillStyle = strokeColor(button);
    if (brush === 'calligraphy') {
      // A flat pen held at 45°: fill the band between the nib's old and new positions.
      const n = Math.max(size, 2) / 2;
      const nx = n * Math.SQRT1_2;
      const ny = -n * Math.SQRT1_2;
      ctx.beginPath();
      ctx.moveTo(x0 + nx, y0 + ny);
      ctx.lineTo(x0 - nx, y0 - ny);
      ctx.lineTo(x1 - nx, y1 - ny);
      ctx.lineTo(x1 + nx, y1 + ny);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (brush === 'airbrush') {
      // Spray along the whole path so a quick movement leaves no gaps.
      const step = Math.max(size * 1.5, 3);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 1; i <= steps; i += 1) spray(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, button);
      return;
    }
    ctx.lineWidth = brush === 'marker' ? Math.max(size, 2) * 2 : size;
    ctx.lineCap = brush === 'marker' ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function spray(x: number, y: number, button: number) {
    const ctx = overlayCtx();
    ctx.fillStyle = strokeColor(button);
    const radius = Math.max(size * 3, 6);
    const dots = Math.round(radius * 1.2);
    for (let i = 0; i < dots; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      ctx.fillRect(Math.round(x + r * Math.cos(a)), Math.round(y + r * Math.sin(a)), 1, 1);
    }
  }

  function drawShapeOn(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, button: number, shift: boolean) {
    const line = button === 2 ? color2 : color1;
    const fill = button === 2 ? color1 : color2;
    ctx.save();
    ctx.lineWidth = size;
    ctx.strokeStyle = line;
    ctx.fillStyle = fill;
    if (shape === 'line') {
      if (shift) {
        // Snap to the nearest 45° direction.
        const angle = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(angle) * len;
        y1 = y0 + Math.sin(angle) * len;
      }
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
      return;
    }
    let w = x1 - x0;
    let h = y1 - y0;
    if (shift) {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * side;
      h = Math.sign(h || 1) * side;
    }
    const x = Math.min(x0, x0 + w);
    const y = Math.min(y0, y0 + h);
    ctx.lineJoin = shape === 'oval' || shape === 'heart' ? 'round' : 'miter';
    ctx.beginPath();
    shapePath(ctx, shape, x, y, Math.abs(w), Math.abs(h));
    if (fillShape) ctx.fill();
    if (outline || !fillShape) ctx.stroke();
    ctx.restore();
  }

  function clearOverlay() {
    const o = overlayRef.current!;
    o.getContext('2d')!.clearRect(0, 0, o.width, o.height);
  }

  // Puts what is on the overlay onto the picture.
  function mergeOverlay(alpha: number) {
    const ctx = mainCtx();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(overlayRef.current!, 0, 0);
    ctx.restore();
    clearOverlay();
  }

  function insideSelection(x: number, y: number) {
    const s = live.current.sel;
    return Boolean(s && x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 2) return;
    const { x, y } = point(e);
    const button = e.button;

    if (tool === 'zoom') {
      setZoom(button === 2 ? zoomOut(zoom) : zoomIn(zoom));
      return;
    }
    if (tool === 'picker') {
      const [r, g, b] = mainCtx().getImageData(Math.min(main().width - 1, Math.max(0, Math.floor(x))), Math.min(main().height - 1, Math.max(0, Math.floor(y))), 1, 1).data;
      (button === 2 ? setColor2 : setColor1)(rgbToHex(r, g, b));
      setToolState(previousTool.current);
      return;
    }
    if (tool === 'text') {
      if (live.current.textBox) commitText();
      else setTextBox({ x: Math.round(x), y: Math.round(y), value: '' });
      return;
    }

    commitText();
    if (tool !== 'select') commitFloating();
    wrapRef.current!.setPointerCapture(e.pointerId);

    if (tool === 'fill') {
      pushUndo();
      floodFill(mainCtx(), x, y, strokeColor(button), opacity);
      return;
    }
    if (tool === 'select') {
      if (live.current.sel && insideSelection(x, y)) {
        const lifted = liftSelection(live.current.sel);
        drag.current = { mode: 'move', button, startX: x, startY: y, lastX: x, lastY: y, origin: lifted };
      } else {
        commitFloating();
        drag.current = { mode: 'marquee', button, startX: x, startY: y, lastX: x, lastY: y };
      }
      return;
    }
    const o = overlayRef.current!;
    clearOverlay();
    o.style.opacity = String(strokeAlpha());
    if (tool === 'shape') {
      drag.current = { mode: 'shape', button, startX: x, startY: y, lastX: x, lastY: y, shift: e.shiftKey };
      return;
    }
    // Freehand tools
    pushUndo();
    drag.current = { mode: 'stroke', button, startX: x, startY: y, lastX: x, lastY: y };
    strokeSegment(x, y, x, y, button);
    if (tool === 'brush' && brush === 'airbrush') {
      sprayTimer.current = window.setInterval(() => drag.current && spray(drag.current.lastX, drag.current.lastY, button), 30);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const { x, y } = point(e);
    setCursor({ x: Math.floor(x), y: Math.floor(y) });
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'stroke') {
      strokeSegment(d.lastX, d.lastY, x, y, d.button);
    } else if (d.mode === 'shape') {
      clearOverlay();
      drawShapeOn(overlayCtx(), d.startX, d.startY, x, y, d.button, e.shiftKey);
    } else if (d.mode === 'marquee') {
      const c = main();
      const x0 = Math.max(0, Math.min(d.startX, x));
      const y0 = Math.max(0, Math.min(d.startY, y));
      const x1 = Math.min(c.width, Math.max(d.startX, x));
      const y1 = Math.min(c.height, Math.max(d.startY, y));
      setSel({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), floating: false });
    } else if (d.mode === 'move' && d.origin) {
      setSel({ ...d.origin, x: Math.round(d.origin.x + x - d.startX), y: Math.round(d.origin.y + y - d.startY), floating: true });
    }
    d.lastX = x;
    d.lastY = y;
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (sprayTimer.current) window.clearInterval(sprayTimer.current);
    sprayTimer.current = null;
    if (!d) return;
    const { x, y } = point(e);
    if (d.mode === 'stroke') {
      mergeOverlay(strokeAlpha());
    } else if (d.mode === 'shape') {
      if (Math.abs(x - d.startX) < 1 && Math.abs(y - d.startY) < 1) {
        clearOverlay();
        return;
      }
      pushUndo();
      clearOverlay();
      drawShapeOn(overlayCtx(), d.startX, d.startY, x, y, d.button, e.shiftKey);
      mergeOverlay(strokeAlpha());
    } else if (d.mode === 'marquee') {
      const s = live.current.sel;
      if (!s || s.w < 2 || s.h < 2) setSel(null);
    }
  }

  // ---------- Resizing the picture by dragging its edge handles ----------

  function startResize(e: ReactPointerEvent<HTMLDivElement>, edges: 'right' | 'bottom' | 'corner') {
    e.stopPropagation();
    commitPending();
    const startX = e.clientX;
    const startY = e.clientY;
    const { w, h } = canvasSize;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    let latest = { w, h };
    const move = (ev: PointerEvent) => {
      latest = {
        w: edges === 'bottom' ? w : Math.min(MAX_SIDE, Math.max(1, Math.round(w + (ev.clientX - startX) / zoom))),
        h: edges === 'right' ? h : Math.min(MAX_SIDE, Math.max(1, Math.round(h + (ev.clientY - startY) / zoom))),
      };
      setResizePreview(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizePreview(null);
      if (latest.w !== w || latest.h !== h) {
        pushUndo();
        replaceImage(resizeArea(main(), latest.w, latest.h, color2));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- Files ----------

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('Your picture has changes that are not saved. Continue without saving?');
  }

  function newPicture() {
    setMenu(null);
    if (!confirmDiscard()) return;
    floatSrc.current = null;
    setSel(null);
    setTextBox(null);
    resetHistory();
    replaceImage(makeCanvas(DEFAULT_W, DEFAULT_H, '#ffffff'));
    setOpenDoc(null);
    setTitle('Untitled');
    setDirty(false);
    window.history.replaceState(null, '', '/paint');
    requestAnimationFrame(() => fitZoom(DEFAULT_W, DEFAULT_H));
  }

  async function openFile(file: File) {
    if (!confirmDiscard()) return;
    try {
      const img = await loadImage(file);
      if (img.naturalWidth > MAX_SIDE || img.naturalHeight > MAX_SIDE) throw new Error(`This picture is larger than ${MAX_SIDE} pixels on a side.`);
      floatSrc.current = null;
      setSel(null);
      setTextBox(null);
      resetHistory();
      replaceImage(img);
      setOpenDoc(null);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setDirty(false);
      window.history.replaceState(null, '', '/paint');
      requestAnimationFrame(() => fitZoom(img.naturalWidth, img.naturalHeight));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The picture could not be opened.', 'error');
    }
  }

  async function download(type: 'image/png' | 'image/jpeg') {
    setMenu(null);
    commitPending();
    const blob = await canvasToBlob(main(), type);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || 'picture'}.${type === 'image/png' ? 'png' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // Ctrl+S: a picture opened from Documents gets a new version; a new picture asks for a name first.
  async function save() {
    setMenu(null);
    if (!canSave) {
      toast(session.accountId ? 'Your role cannot save documents. Use Download instead.' : 'Choose an office in the top bar first, or use Download.', 'error');
      return;
    }
    commitPending();
    if (!openDoc) {
      setDialog('save');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', await canvasToBlob(main(), 'image/png'), `${openDoc.name}.png`);
      form.append('baseVersionNo', String(openDoc.versionNo));
      const result = await http.upload<{ versionNo: number }>(`/documents/${openDoc.id}/file`, form);
      setOpenDoc({ ...openDoc, versionNo: result.versionNo });
      setDirty(false);
      toast(`Saved as version ${result.versionNo}. Earlier versions are kept.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveAsNew(name: string, folder: string, format: 'png' | 'jpeg') {
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', await canvasToBlob(main(), format === 'png' ? 'image/png' : 'image/jpeg'), `${name}.${format === 'png' ? 'png' : 'jpg'}`);
      form.append('name', name);
      form.append('folder', folder);
      const result = await http.upload<{ id: number }>('/documents/upload', form);
      setOpenDoc({ id: result.id, name, versionNo: 1 });
      setTitle(name);
      setDirty(false);
      setDialog(null);
      window.history.replaceState(null, '', `/paint?doc=${result.id}`);
      toast('Saved to Documents.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    if (!confirmDiscard()) return;
    setDirty(false);
    navigate(openDoc ? `/documents/${openDoc.id}` : '/');
  }

  // ---------- Keyboard and clipboard ----------

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (dialog) return;
    if (isTyping(e.target)) {
      if (e.key === 'Escape' && textBox) commitText();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'z' && !e.shiftKey) undo();
    else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
    else if (ctrl && key === 's') void save();
    else if (ctrl && key === 'a') selectAll();
    else if (ctrl && key === 'c') void copySelection();
    else if (ctrl && key === 'x') void cutSelection();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
    else if (e.key === 'Escape') commitPending();
    else if (ctrl && (key === '+' || key === '=')) setZoom(zoomIn);
    else if (ctrl && key === '-') setZoom(zoomOut);
    else return;
    e.preventDefault();
  };
  const pasteHandler = useRef<(e: ClipboardEvent) => void>(() => undefined);
  pasteHandler.current = (e: ClipboardEvent) => {
    if (dialog || isTyping(e.target)) return;
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (file) {
      void loadImage(file).then((img) => {
        const c = makeCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d')!.drawImage(img, 0, 0);
        pasteCanvas(c);
      });
    } else if (clipboard.current) {
      pasteCanvas(cropCanvas(clipboard.current, 0, 0, clipboard.current.width, clipboard.current.height));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    const onPaste = (e: ClipboardEvent) => pasteHandler.current(e);
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // Ctrl + mouse wheel zooms.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? zoomIn : zoomOut);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- Layout ----------

  const cursorStyle =
    tool === 'text' ? 'text' : tool === 'zoom' ? 'zoom-in' : tool === 'select' && cursor && insideSelection(cursor.x, cursor.y) ? 'move' : 'crosshair';
  const pickColor = (c: string) => (activeSlot === 1 ? setColor1 : setColor2)(c);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-800 select-none">
      {/* Title bar */}
      <header className="flex items-center gap-1 border-b border-slate-200 bg-surface px-2 py-1.5">
        <button type="button" onClick={leave} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="mr-2 flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: 'linear-gradient(135deg,#00c4cc,#7d2ae8)' }} aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9 15l.2-3zM7 14c-2 0-3 1.5-3 3 0 1.3-.7 2-2 2 1 1.5 2.7 2 4 2 2.2 0 4-1.8 4-4" /></svg>
        </span>
        <div className="relative">
          <MenuButton open={menu?.name === 'file'} onClick={(e) => toggleMenu('file', e.currentTarget)}>File</MenuButton>
          {menu?.name === 'file' && (
            <Dropdown at={menu} onClose={() => setMenu(null)}>
              <MenuItem onClick={newPicture} hint="">New picture</MenuItem>
              <MenuItem onClick={() => { setMenu(null); fileInput.current?.click(); }}>Open from computer…</MenuItem>
              <MenuItem onClick={() => { setMenu(null); if (confirmDiscard()) { setDirty(false); navigate('/documents'); } }} hint="">Open from Documents…</MenuItem>
              <hr className="my-1 border-slate-200" />
              <MenuItem onClick={() => void save()} hint="Ctrl+S" disabled={!canSave}>{openDoc ? 'Save (new version)' : 'Save to Documents…'}</MenuItem>
              <MenuItem onClick={() => { setMenu(null); if (canSave) { commitPending(); setDialog('save'); } else void save(); }} disabled={!canSave}>Save as new document…</MenuItem>
              <hr className="my-1 border-slate-200" />
              <MenuItem onClick={() => void download('image/png')}>Download as PNG</MenuItem>
              <MenuItem onClick={() => void download('image/jpeg')}>Download as JPEG</MenuItem>
            </Dropdown>
          )}
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <IconButton label="Save (Ctrl+S)" onClick={() => void save()} disabled={saving} path="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8" />
        <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={undoCount === 0} path="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
        <IconButton label="Redo (Ctrl+Y)" onClick={redo} disabled={redoCount === 0} path="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <IconButton label="Cut (Ctrl+X)" onClick={() => void cutSelection()} disabled={!sel} path="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
        <IconButton label="Copy (Ctrl+C)" onClick={() => void copySelection()} disabled={!sel} path="M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        <IconButton label="Paste (Ctrl+V)" onClick={() => void pasteFromClipboard()} path="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9z" />
        <p className="ml-3 min-w-0 truncate text-sm">
          <span className="font-semibold text-slate-900">{title}</span>
          <span className="text-slate-500">
            {' '}— Paint{openDoc ? ` · version ${openDoc.versionNo}` : ''}{dirty ? ' · not saved' : ''}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button size="sm" variant="primary" busy={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); }} />
      </header>

      {/* Ribbon */}
      <div className="flex items-stretch gap-0 overflow-x-auto border-b border-slate-200 bg-surface px-2 py-1.5">
        <Group label="Selection">
          <div className="flex items-center gap-0.5">
            <ToolTile label="Select" active={tool === 'select'} onClick={() => setTool('select')} path="M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8" />
            <div className="flex flex-col gap-0.5">
              <SmallButton onClick={selectAll}>Select all</SmallButton>
              <SmallButton onClick={() => deleteSelection()} disabled={!sel}>Delete</SmallButton>
            </div>
          </div>
        </Group>

        <Group label="Image">
          <div className="flex items-center gap-0.5">
            <ToolTile label="Crop to selection" onClick={cropToSelection} disabled={!sel} path="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
            <ToolTile label="Resize" onClick={() => { commitPending(); setDialog('resize'); }} path="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            <div className="relative">
              <ToolTile label="Rotate or flip" onClick={(e) => toggleMenu('rotate', e.currentTarget)} path="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" caret />
              {menu?.name === 'rotate' && (
                <Dropdown at={menu} onClose={() => setMenu(null)}>
                  <MenuItem onClick={() => turn('right')}>Rotate right 90°</MenuItem>
                  <MenuItem onClick={() => turn('left')}>Rotate left 90°</MenuItem>
                  <MenuItem onClick={() => turn('half')}>Rotate 180°</MenuItem>
                  <MenuItem onClick={() => turn('flipV')}>Flip vertical</MenuItem>
                  <MenuItem onClick={() => turn('flipH')}>Flip horizontal</MenuItem>
                </Dropdown>
              )}
            </div>
          </div>
        </Group>

        <Group label="Tools">
          <div className="grid grid-cols-3 gap-0.5">
            <ToolTile small label="Pencil" active={tool === 'pencil'} onClick={() => setTool('pencil')} path="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
            <ToolTile small label="Fill with colour" active={tool === 'fill'} onClick={() => setTool('fill')} path="M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0zM5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z" />
            <ToolTile small label="Text" active={tool === 'text'} onClick={() => setTool('text')} path="M4 7V4h16v3M9 20h6M12 4v16" />
            <ToolTile small label="Eraser" active={tool === 'eraser'} onClick={() => setTool('eraser')} path="M20 20H7L3 16a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L11 20M6 11l7 7" />
            <ToolTile small label="Colour picker" active={tool === 'picker'} onClick={() => setTool('picker')} path="M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4" />
            <ToolTile small label="Magnifier (right-click to zoom out)" active={tool === 'zoom'} onClick={() => setTool('zoom')} path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M11 8v6M8 11h6" />
          </div>
        </Group>

        <Group label="Brushes">
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { const anchor = e.currentTarget; const wasOpen = menu?.name === 'brushes'; setTool('brush'); if (!wasOpen) toggleMenu('brushes', anchor); }}
              aria-label={`Brushes: ${BRUSHES.find((b) => b.kind === brush)?.label}`}
              title={BRUSHES.find((b) => b.kind === brush)?.label}
              className={`flex h-14 w-14 flex-col items-center justify-center rounded-lg ring-1 ${tool === 'brush' ? 'bg-purple-50 ring-purple-400' : 'ring-slate-200 hover:bg-slate-50'}`}
            >
              <BrushIcon kind={brush} />
              <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menu?.name === 'brushes' && (
              <Dropdown at={menu} onClose={() => setMenu(null)}>
                {BRUSHES.map((b) => (
                  <MenuItem key={b.kind} onClick={() => { setBrush(b.kind); setTool('brush'); }} active={brush === b.kind}>
                    <span className="flex items-center gap-2"><BrushIcon kind={b.kind} /> {b.label}</span>
                  </MenuItem>
                ))}
              </Dropdown>
            )}
          </div>
        </Group>

        <Group label="Shapes">
          <div className="flex items-center gap-2">
            <div className="grid max-h-[4.6rem] grid-cols-7 gap-0.5 overflow-y-auto rounded-md p-0.5 ring-1 ring-slate-200">
              {SHAPES.map((s) => (
                <button
                  key={s.kind}
                  type="button"
                  title={s.label}
                  aria-label={s.label}
                  aria-pressed={tool === 'shape' && shape === s.kind}
                  onClick={() => { setShape(s.kind); setTool('shape'); }}
                  className={`flex h-6 w-6 items-center justify-center rounded ${tool === 'shape' && shape === s.kind ? 'bg-purple-100 ring-1 ring-purple-400' : 'hover:bg-slate-100'}`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
                    <path d={shapeIconPath(s.kind)} />
                  </svg>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Outline</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={fillShape} onChange={(e) => setFillShape(e.target.checked)} /> Fill (colour 2)</label>
            </div>
          </div>
        </Group>

        <Group label="Colours">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <ColorSlot label="Colour 1" color={color1} active={activeSlot === 1} onClick={() => setActiveSlot(1)} />
              <ColorSlot label="Colour 2" color={color2} active={activeSlot === 2} onClick={() => setActiveSlot(2)} />
              <button type="button" title="Swap colours" aria-label="Swap colours" className="self-center rounded p-0.5 text-slate-500 hover:bg-slate-100" onClick={() => { setColor1(color2); setColor2(color1); }}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4" /></svg>
              </button>
            </div>
            <div>
              <div className="grid grid-cols-10 gap-1">
                {PALETTE.map((c) => (
                  <Swatch key={c} color={c} onPick={() => pickColor(c)} onPick2={() => setColor2(c)} />
                ))}
              </div>
              <div className="mt-1 grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }, (_, i) => customColors[i]).map((c, i) =>
                  c ? <Swatch key={i} color={c} onPick={() => pickColor(c)} onPick2={() => setColor2(c)} /> : <span key={i} className="h-5 w-5 rounded-full ring-1 ring-slate-200" />,
                )}
              </div>
            </div>
            <label className="flex cursor-pointer flex-col items-center gap-0.5 text-[11px] text-slate-600" title="Edit colours: pick any colour">
              <span className="relative h-8 w-8 rounded-full" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
                <input
                  type="color"
                  aria-label="Edit colours"
                  value={activeSlot === 1 ? color1 : color2}
                  onChange={(e) => pickColor(e.target.value)}
                  onBlur={(e) => setCustomColors((list) => (list.includes(e.target.value) || PALETTE.includes(e.target.value) ? list : [e.target.value, ...list].slice(0, 10)))}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </span>
              Edit
            </label>
          </div>
        </Group>
      </div>

      {/* Text options appear while the Text tool is in use */}
      {tool === 'text' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-surface px-3 py-1.5 text-sm">
          <span className="font-medium text-slate-700">Text</span>
          <select aria-label="Font" value={font} onChange={(e) => setFont(e.target.value)} className="rounded-md border border-slate-300 bg-surface px-2 py-1 text-sm">
            {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select aria-label="Font size" value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="rounded-md border border-slate-300 bg-surface px-2 py-1 text-sm">
            {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ToggleText label="Bold" on={bold} onClick={() => setBold(!bold)} className="font-bold">B</ToggleText>
          <ToggleText label="Italic" on={italic} onClick={() => setItalic(!italic)} className="italic">I</ToggleText>
          <ToggleText label="Underline" on={underline} onClick={() => setUnderline(!underline)} className="underline">U</ToggleText>
          <label className="ml-2 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={textOpaque} onChange={(e) => setTextOpaque(e.target.checked)} /> Background (colour 2)</label>
          <span className="text-xs text-slate-500">Click the picture to type; click again or press Esc to place the text.</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Size and opacity sliders, as in Paint */}
        <aside className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-surface py-3" aria-label="Brush settings">
          <VerticalSlider label={`Size: ${size}px`} icon="size" min={1} max={100} value={size} onChange={setSize} />
          <VerticalSlider label={`Opacity: ${Math.round(opacity * 100)}%`} icon="opacity" min={5} max={100} value={Math.round(opacity * 100)} onChange={(v) => setOpacity(v / 100)} />
        </aside>

        {/* Drawing area */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto bg-slate-200/70" onPointerDown={(e) => { if (e.target === e.currentTarget) commitPending(); }}>
          <div className="inline-block p-8">
            <div
              ref={wrapRef}
              className="relative shadow-md"
              style={{
                width: canvasSize.w * zoom,
                height: canvasSize.h * zoom,
                cursor: cursorStyle,
                touchAction: 'none',
                backgroundImage: 'repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%)',
                backgroundSize: '16px 16px',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => !drag.current && setCursor(null)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <canvas ref={mainRef} aria-label="Picture" className="absolute inset-0 h-full w-full" style={{ imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }} />
              <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }} />

              {sel && (
                <div
                  className="pointer-events-none absolute"
                  style={{ left: sel.x * zoom, top: sel.y * zoom, width: sel.w * zoom, height: sel.h * zoom, outline: '1px dashed #2563eb', boxShadow: '0 0 0 1px rgba(255,255,255,.8)' }}
                >
                  {sel.floating && <canvas ref={floatViewRef} className="h-full w-full" style={{ imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }} />}
                </div>
              )}

              {textBox && (
                <textarea
                  autoFocus
                  aria-label="Type your text"
                  value={textBox.value}
                  onChange={(e) => setTextBox({ ...textBox, value: e.target.value })}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute resize-none overflow-hidden border border-dashed border-blue-500 p-0 outline-none"
                  style={{
                    left: textBox.x * zoom,
                    top: textBox.y * zoom,
                    font: `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${textSize * zoom}px ${font}`,
                    lineHeight: 1.25,
                    color: color1,
                    opacity,
                    textDecoration: underline ? 'underline' : 'none',
                    background: textOpaque ? color2 : 'transparent',
                    paddingLeft: 2 * zoom,
                    minWidth: 60 * zoom,
                    minHeight: textSize * 1.25 * zoom,
                    fieldSizing: 'content',
                  } as CSSProperties}
                />
              )}

              {resizePreview && (
                <div className="pointer-events-none absolute left-0 top-0 border border-dashed border-slate-700" style={{ width: resizePreview.w * zoom, height: resizePreview.h * zoom }} />
              )}

              {/* Drag these to change the picture size */}
              <Handle className="-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" label="Drag to change the width" onPointerDown={(e) => startResize(e, 'right')} />
              <Handle className="-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" label="Drag to change the height" onPointerDown={(e) => startResize(e, 'bottom')} />
              <Handle className="-bottom-1.5 -right-1.5 cursor-nwse-resize" label="Drag to change the size" onPointerDown={(e) => startResize(e, 'corner')} />
            </div>
          </div>
          {loading && <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-sm text-slate-700">Opening the picture…</div>}
        </div>
      </div>

      {/* Status bar */}
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-200 bg-surface px-3 py-1 text-xs text-slate-600">
        <span className="w-28 tabular-nums" title="Pointer position">{cursor ? `${cursor.x}, ${cursor.y}px` : ''}</span>
        <span className="w-28 tabular-nums" title="Selection size">{sel ? `${sel.w} × ${sel.h}px` : ''}</span>
        <span className="tabular-nums" title="Picture size">{(resizePreview ?? canvasSize).w} × {(resizePreview ?? canvasSize).h}px</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => fitZoom()} className="rounded px-1.5 py-0.5 hover:bg-slate-100" title="Fit the picture in the window">Fit</button>
          <select aria-label="Zoom" value={ZOOMS.includes(zoom) ? zoom : ''} onChange={(e) => setZoom(Number(e.target.value))} className="rounded border border-slate-300 bg-surface px-1 py-0.5">
            {!ZOOMS.includes(zoom) && <option value="">{Math.round(zoom * 100)}%</option>}
            {ZOOMS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}
          </select>
          <input type="range" aria-label="Zoom slider" min={0} max={ZOOMS.length - 1} step={1} value={ZOOMS.findIndex((z) => z >= zoom - 0.001)} onChange={(e) => setZoom(ZOOMS[Number(e.target.value)])} className="w-32 accent-purple-600" />
        </div>
      </footer>

      {dialog === 'save' && (
        <SaveDialog initialName={title === 'Untitled' ? `Drawing ${new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}` : title} busy={saving} onCancel={() => setDialog(null)} onSave={saveAsNew} />
      )}
      {dialog === 'resize' && <ResizeDialog width={canvasSize.w} height={canvasSize.h} onCancel={() => setDialog(null)} onApply={applyResize} />}
    </div>
  );
}

// ---------- Small parts ----------

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col items-center justify-between border-r border-slate-200 px-3 last:border-r-0">
      <div className="flex flex-1 items-center">{children}</div>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </section>
  );
}

function ToolTile({ label, path, onClick, active, disabled, small, caret }: { label: string; path: string; onClick: (e: ReactMouseEvent<HTMLElement>) => void; active?: boolean; disabled?: boolean; small?: boolean; caret?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center rounded-lg disabled:opacity-35 ${small ? 'h-8 w-8' : 'h-12 w-11 flex-col'} ${active ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-400' : 'text-slate-700 hover:bg-slate-100'}`}
    >
      <svg viewBox="0 0 24 24" className={small ? 'h-[18px] w-[18px]' : 'h-6 w-6'} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
      {caret && <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>}
    </button>
  );
}

function SmallButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded px-2 py-0.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40">
      {children}
    </button>
  );
}

function IconButton({ label, path, onClick, disabled }: { label: string; path: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
    </button>
  );
}

function MenuButton({ children, open, onClick }: { children: ReactNode; open: boolean; onClick: (e: ReactMouseEvent<HTMLElement>) => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className={`rounded-md px-3 py-1 text-sm ${open ? 'bg-slate-100' : 'hover:bg-slate-100'}`}>
      {children}
    </button>
  );
}

function Dropdown({ children, onClose, at }: { children: ReactNode; onClose: () => void; at: { x: number; y: number } }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="menu" className="fixed z-40 min-w-52 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-slate-200" style={{ left: at.x, top: at.y }}>
        {children}
      </div>
    </>
  );
}

function MenuItem({ children, onClick, hint, disabled, active }: { children: ReactNode; onClick: () => void; hint?: string; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40 ${active ? 'font-medium text-purple-700' : 'text-slate-700'}`}>
      <span>{children}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </button>
  );
}

function ColorSlot({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={`${label}: ${color} (click, then pick a colour)`} className={`flex flex-col items-center gap-0.5 rounded-lg p-1 text-[10px] text-slate-600 ${active ? 'bg-slate-100 ring-1 ring-purple-400' : 'hover:bg-slate-100'}`}>
      <span className="h-7 w-7 rounded-full ring-1 ring-slate-300" style={{ background: color }} />
      {label.replace('Colour ', 'Colour ')}
    </button>
  );
}

function Swatch({ color, onPick, onPick2 }: { color: string; onPick: () => void; onPick2: () => void }) {
  return (
    <button
      type="button"
      title={`${color} (right-click for colour 2)`}
      aria-label={`Colour ${color}`}
      onClick={onPick}
      onContextMenu={(e) => { e.preventDefault(); onPick2(); }}
      className="h-5 w-5 rounded-full ring-1 ring-slate-300 hover:scale-110"
      style={{ background: color }}
    />
  );
}

function ToggleText({ label, on, onClick, className, children }: { label: string; on: boolean; onClick: () => void; className: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} title={label} onClick={onClick} className={`h-7 w-7 rounded-md text-sm ${className} ${on ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-400' : 'hover:bg-slate-100'}`}>
      {children}
    </button>
  );
}

function VerticalSlider({ label, icon, min, max, value, onChange }: { label: string; icon: 'size' | 'opacity'; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 rounded-xl px-1 py-2 ring-1 ring-slate-200" title={label}>
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-600" fill={icon === 'opacity' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        {icon === 'size' ? <path d="M4 6h16M4 12h16M4 18h16" /> : <path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z" />}
      </svg>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-purple-600"
        style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 20 }}
      />
      <span className="text-[10px] tabular-nums text-slate-500">{icon === 'size' ? `${value}px` : `${value}%`}</span>
    </div>
  );
}

function Handle({ className, label, onPointerDown }: { className: string; label: string; onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  return <div role="presentation" title={label} onPointerDown={onPointerDown} className={`absolute z-10 h-3 w-3 border border-slate-600 bg-white ${className}`} />;
}

function BrushIcon({ kind }: { kind: BrushKind }) {
  const paths: Record<BrushKind, string> = {
    brush: 'M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9 15l.2-3zM7 14c-2 0-3 1.5-3 3 0 1.3-.7 2-2 2 1 1.5 2.7 2 4 2 2.2 0 4-1.8 4-4',
    calligraphy: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    airbrush: 'M4 12h.01M7 8h.01M7 16h.01M10 12h.01M10 5h.01M10 19h.01M14 12l8-4v8z',
    marker: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-700" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  );
}

function SaveDialog({ initialName, busy, onCancel, onSave }: { initialName: string; busy: boolean; onCancel: () => void; onSave: (name: string, folder: string, format: 'png' | 'jpeg') => void }) {
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState('/Drawings');
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  return (
    <Modal
      title="Save to Documents"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => onSave(name.trim(), folder, format)}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" value={name} onChange={setName} maxLength={200} required />
        <TextField label="Folder" value={folder} onChange={setFolder} hint="For example /Drawings or /2026/October" />
        <SelectField
          label="File type"
          value={format}
          onChange={(v) => setFormat(v as 'png' | 'jpeg')}
          options={[
            { value: 'png', label: 'PNG — best quality, keeps transparency' },
            { value: 'jpeg', label: 'JPEG — smaller file, for photos' },
          ]}
        />
      </div>
    </Modal>
  );
}

function ResizeDialog({ width, height, onCancel, onApply }: { width: number; height: number; onCancel: () => void; onApply: (mode: 'stretch' | 'area', w: number, h: number) => void }) {
  const [mode, setMode] = useState<'stretch' | 'area'>('stretch');
  const [by, setBy] = useState<'percent' | 'pixels'>('percent');
  const [keepRatio, setKeepRatio] = useState(true);
  const [w, setW] = useState(by === 'percent' ? '100' : String(width));
  const [h, setH] = useState(by === 'percent' ? '100' : String(height));

  function changeBy(next: 'percent' | 'pixels') {
    setBy(next);
    setW(next === 'percent' ? '100' : String(width));
    setH(next === 'percent' ? '100' : String(height));
  }
  function changeW(v: string) {
    setW(v);
    if (keepRatio && Number(v) > 0) setH(String(by === 'percent' ? v : Math.round((Number(v) * height) / width)));
  }
  function changeH(v: string) {
    setH(v);
    if (keepRatio && Number(v) > 0) setW(String(by === 'percent' ? v : Math.round((Number(v) * width) / height)));
  }
  const newW = Math.round(by === 'percent' ? (width * Number(w)) / 100 : Number(w));
  const newH = Math.round(by === 'percent' ? (height * Number(h)) / 100 : Number(h));
  const valid = newW >= 1 && newH >= 1 && newW <= MAX_SIDE && newH <= MAX_SIDE;

  return (
    <Modal
      title="Resize"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply(mode, newW, newH)}>OK</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'stretch'} onChange={() => setMode('stretch')} /> Stretch the picture</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'area'} onChange={() => setMode('area')} /> Change the drawing area only</label>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5"><input type="radio" checked={by === 'percent'} onChange={() => changeBy('percent')} /> Percentage</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={by === 'pixels'} onChange={() => changeBy('pixels')} /> Pixels</label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={by === 'percent' ? 'Width (%)' : 'Width (px)'} value={w} onChange={changeW} inputMode="numeric" />
          <TextField label={by === 'percent' ? 'Height (%)' : 'Height (px)'} value={h} onChange={changeH} inputMode="numeric" />
        </div>
        <Checkbox label="Keep the shape (aspect ratio)" checked={keepRatio} onChange={setKeepRatio} />
        <p className={valid ? 'text-slate-600' : 'text-red-600'}>
          {valid ? `New size: ${newW} × ${newH} pixels` : `Choose a size between 1 and ${MAX_SIDE} pixels.`}
        </p>
      </div>
    </Modal>
  );
}
