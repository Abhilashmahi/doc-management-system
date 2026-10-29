import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Layer, Line, Stage, Transformer } from 'react-konva';
import { ElementNode } from './ElementNode';
import { PageBackground } from './PageView';
import type { CanvasElement, CanvasPage, TextElement } from './types';

interface Props {
  page: CanvasPage;
  values: Record<string, string> | null;
  zoom: number;
  selectedIds: string[];
  preview: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  // Applies changes to elements by id. mergeKey groups rapid changes into one undo step.
  onUpdate: (changes: Record<string, Partial<CanvasElement>>, mergeKey?: string) => void;
}

const SNAP = 6; // screen pixels within which an edge snaps to a guide

interface Guide {
  orientation: 'v' | 'h';
  pos: number;
}

// The editable page: click to select, drag to move, handles to resize and rotate, double-click text to type.
// While dragging, edges and centres snap to the page and to other elements, with pink guide lines.
export function CanvasEditor({ page, values, zoom, selectedIds, preview, onSelect, onUpdate }: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const selected = page.elements.filter((e) => selectedIds.includes(e.id));
  const movable = selected.filter((e) => !e.locked && e.visible);

  // Attach the resize handles to the selected (unlocked) elements whenever the selection changes.
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const nodes = preview ? [] : movable.map((e) => stage.findOne(`#${e.id}`)).filter((n): n is Konva.Node => Boolean(n));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  });

  // Images and QR codes keep their proportions while resizing; everything else can stretch.
  const keepRatio = movable.length === 1 && (movable[0].type === 'image' || movable[0].type === 'qrcode');
  const lockedOnly = selected.length > 0 && movable.length === 0;

  function handleSelect(el: CanvasElement, e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (preview) return;
    e.cancelBubble = true;
    const additive = 'shiftKey' in e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
    if (!additive && selectedIds.includes(el.id)) return; // keep a multi-selection so it can be dragged together
    onSelect([el.id], Boolean(additive));
  }

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const target = e.target;
    if (target === target.getStage() || target.hasName('page-background')) onSelect([], false);
  }

  // ---------- Snapping ----------

  function snapTargets(excludeIds: string[]) {
    const v = [0, page.width / 2, page.width];
    const h = [0, page.height / 2, page.height];
    for (const el of page.elements) {
      if (excludeIds.includes(el.id) || !el.visible) continue;
      v.push(el.x, el.x + el.width / 2, el.x + el.width);
      h.push(el.y, el.y + el.height / 2, el.y + el.height);
    }
    return { v, h };
  }

  function handleDragMove(el: CanvasElement, e: KonvaEventObject<DragEvent>) {
    // Snapping works on a single unrotated element; multi-selection moves freely.
    if (movable.length > 1 || el.rotation !== 0) return;
    const node = e.target;
    const threshold = SNAP / zoom;
    const { v, h } = snapTargets([el.id]);
    const x = node.x();
    const y = node.y();
    const xs = [x, x + el.width / 2, x + el.width];
    const ys = [y, y + el.height / 2, y + el.height];
    const found: Guide[] = [];

    let bestX: { diff: number; pos: number } | null = null;
    xs.forEach((edge, i) => {
      for (const t of v) {
        const diff = Math.abs(edge - t);
        if (diff < threshold && (!bestX || diff < bestX.diff)) bestX = { diff, pos: t - (i === 0 ? 0 : i === 1 ? el.width / 2 : el.width) };
        if (diff < threshold) found.push({ orientation: 'v', pos: t });
      }
    });
    let bestY: { diff: number; pos: number } | null = null;
    ys.forEach((edge, i) => {
      for (const t of h) {
        const diff = Math.abs(edge - t);
        if (diff < threshold && (!bestY || diff < bestY.diff)) bestY = { diff, pos: t - (i === 0 ? 0 : i === 1 ? el.height / 2 : el.height) };
        if (diff < threshold) found.push({ orientation: 'h', pos: t });
      }
    });
    if (bestX) node.x((bestX as { pos: number }).pos);
    if (bestY) node.y((bestY as { pos: number }).pos);
    setGuides(found.slice(0, 6));
  }

  // When a multi-selection is dragged, Konva moves all the selected nodes; read every one back.
  // The dragged element is included too, because a drag can start on an element that was not selected yet.
  function handleDragEnd(dragged: CanvasElement) {
    setGuides([]);
    const stage = stageRef.current;
    if (!stage) return;
    const changes: Record<string, Partial<CanvasElement>> = {};
    const moved = movable.some((e) => e.id === dragged.id) ? movable : [dragged];
    for (const el of moved) {
      const node = stage.findOne(`#${el.id}`);
      if (node) changes[el.id] = { x: Math.round(node.x()), y: Math.round(node.y()) };
    }
    onUpdate(changes);
  }

  function handleTransformEnd(el: CanvasElement, node: Konva.Group) {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onUpdate(
      {
        [el.id]: {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: Math.max(1, Math.round(el.width * scaleX)),
          height: el.type === 'line' ? Math.round(el.height * scaleY) : Math.max(1, Math.round(el.height * scaleY)),
          rotation: Math.round(node.rotation() * 10) / 10,
        },
      },
      'transform',
    );
  }

  const editing = editingId ? (page.elements.find((e) => e.id === editingId) as TextElement | undefined) : undefined;

  return (
    <div className="relative inline-block">
      <Rulers width={page.width} height={page.height} zoom={zoom} />
      <div className="relative shadow-lg ring-1 ring-slate-300" style={{ width: page.width * zoom, height: page.height * zoom }}>
        <Stage ref={stageRef} width={page.width * zoom} height={page.height * zoom} scaleX={zoom} scaleY={zoom} onMouseDown={handleStageMouseDown} onTouchStart={handleStageMouseDown}>
          <Layer>
            <PageBackground page={page} />
            {page.elements.map((el) => (
              <ElementNode
                key={el.id}
                element={el}
                values={values}
                draggable={!preview}
                highlightFields={!preview}
                onSelect={preview ? undefined : (e) => handleSelect(el, e)}
                onDragMove={(e) => handleDragMove(el, e)}
                onDragEnd={() => handleDragEnd(el)}
                onTransformEnd={(node) => handleTransformEnd(el, node)}
                onDblClick={() => !preview && el.type === 'text' && !el.locked && setEditingId(el.id)}
              />
            ))}
            {!preview && (
              <Transformer
                ref={transformerRef}
                keepRatio={keepRatio}
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                rotationSnapTolerance={4}
                anchorSize={8}
                anchorCornerRadius={2}
                borderStroke="#6366f1"
                anchorStroke="#6366f1"
                ignoreStroke
                boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 2 ? oldBox : newBox)}
              />
            )}
            {guides.map((g, i) => (
              <Line
                key={i}
                points={g.orientation === 'v' ? [g.pos, 0, g.pos, page.height] : [0, g.pos, page.width, g.pos]}
                stroke="#ec4899"
                strokeWidth={1 / zoom}
                dash={[4 / zoom, 4 / zoom]}
                listening={false}
              />
            ))}
          </Layer>
        </Stage>

        {lockedOnly && !preview && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-ink/80 px-2 py-1 text-xs text-white">Locked — unlock it in the properties panel to move it.</div>
        )}

        {editing && (
          <InlineTextEditor
            element={editing}
            zoom={zoom}
            onDone={(text) => {
              setEditingId(null);
              if (text !== null && text !== editing.text) onUpdate({ [editing.id]: { text } });
            }}
          />
        )}
      </div>
    </div>
  );
}

// A textarea laid over the text element, styled to match it, for typing directly on the page.
function InlineTextEditor({ element, zoom, onDone }: { element: TextElement; zoom: number; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(element.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep Delete / arrows inside the text box
        if (e.key === 'Escape') onDone(null);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onDone(text);
      }}
      aria-label="Edit text"
      className="absolute resize-none overflow-hidden border border-indigo-400 bg-surface/90 p-0 outline-none"
      style={{
        left: element.x * zoom,
        top: element.y * zoom,
        width: Math.max(element.width * zoom, 60),
        height: Math.max(element.height * zoom, element.fontSize * zoom * 1.5),
        fontFamily: element.fontFamily,
        fontSize: element.fontSize * zoom,
        fontWeight: element.fontStyle.includes('bold') ? 700 : 400,
        fontStyle: element.fontStyle.includes('italic') ? 'italic' : 'normal',
        color: element.fill,
        textAlign: element.align === 'justify' ? 'justify' : element.align,
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing * zoom,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: 'top left',
      }}
    />
  );
}

// Rulers along the top and left edge, in page pixels (96 per inch), with a label every 100 px.
function Rulers({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const step = zoom < 0.5 ? 50 : 10;
  const ticks = (length: number) => Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => i * step);
  return (
    <>
      <svg className="absolute -top-5 left-0 text-slate-400" width={width * zoom} height={18} aria-hidden="true">
        {ticks(width).map((t) => (
          <g key={t}>
            <line x1={t * zoom} x2={t * zoom} y1={t % 100 === 0 ? 4 : t % 50 === 0 ? 10 : 13} y2={18} stroke="currentColor" strokeWidth={1} />
            {t % 100 === 0 && t > 0 && (
              <text x={t * zoom + 2} y={9} fontSize={9} fill="currentColor">
                {t}
              </text>
            )}
          </g>
        ))}
      </svg>
      <svg className="absolute -left-5 top-0 text-slate-400" width={18} height={height * zoom} aria-hidden="true">
        {ticks(height).map((t) => (
          <g key={t}>
            <line y1={t * zoom} y2={t * zoom} x1={t % 100 === 0 ? 4 : t % 50 === 0 ? 10 : 13} x2={18} stroke="currentColor" strokeWidth={1} />
            {t % 100 === 0 && t > 0 && (
              <text x={9} y={t * zoom + 2} fontSize={9} fill="currentColor" transform={`rotate(-90 9 ${t * zoom + 2})`}>
                {t}
              </text>
            )}
          </g>
        ))}
      </svg>
    </>
  );
}
