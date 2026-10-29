import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import { codeImage, useStoredImage } from './assets';
import { codeValue, fieldDisplayText, type CanvasElement, type FieldElement, type TextElement } from './types';

interface Props {
  element: CanvasElement;
  // Field values to show. null = template mode, where fields show {{FieldKey}}.
  values: Record<string, string> | null;
  // Interaction, only passed by the designer.
  draggable?: boolean;
  highlightFields?: boolean;
  onSelect?: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragMove?: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: KonvaEventObject<DragEvent>) => void;
  onTransformEnd?: (node: Konva.Group) => void;
  onDblClick?: () => void;
}

// Draws one design element. Every element is a Group placed at (x, y) and rotated around its top-left corner;
// its shapes are drawn inside from (0, 0). The designer's resize handles act on this Group.
export function ElementNode({ element: el, values, draggable = false, highlightFields = false, onSelect, onDragMove, onDragEnd, onTransformEnd, onDblClick }: Props) {
  if (!el.visible) return null;
  return (
    <Group
      id={el.id}
      name="element"
      x={el.x}
      y={el.y}
      rotation={el.rotation}
      opacity={el.opacity}
      draggable={draggable && !el.locked}
      listening={Boolean(onSelect)}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={(e) => onTransformEnd?.(e.currentTarget as unknown as Konva.Group)}
    >
      <ElementBody el={el} values={values} highlightFields={highlightFields} />
    </Group>
  );
}

function ElementBody({ el, values, highlightFields }: { el: CanvasElement; values: Record<string, string> | null; highlightFields: boolean }) {
  switch (el.type) {
    case 'text':
    case 'field':
      return <TextBody el={el} values={values} highlightFields={highlightFields} />;
    case 'image':
      return <ImageBody el={el} />;
    case 'rect':
      return (
        <Rect
          width={el.width}
          height={el.height}
          fill={el.fill || undefined}
          stroke={el.stroke || undefined}
          strokeWidth={el.stroke ? el.strokeWidth : 0}
          cornerRadius={el.cornerRadius}
          dash={el.dash ? [el.strokeWidth * 4, el.strokeWidth * 2] : undefined}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          x={el.width / 2}
          y={el.height / 2}
          radiusX={el.width / 2}
          radiusY={el.height / 2}
          fill={el.fill || undefined}
          stroke={el.stroke || undefined}
          strokeWidth={el.stroke ? el.strokeWidth : 0}
          dash={el.dash ? [el.strokeWidth * 4, el.strokeWidth * 2] : undefined}
        />
      );
    case 'line':
      return (
        <>
          {/* A wider invisible line makes thin lines easy to click. */}
          <Line points={[0, 0, el.width, el.height]} stroke="transparent" strokeWidth={Math.max(12, el.strokeWidth)} />
          <Line points={[0, 0, el.width, el.height]} stroke={el.stroke} strokeWidth={el.strokeWidth} lineCap="round" dash={el.dash ? [el.strokeWidth * 4, el.strokeWidth * 2] : undefined} />
        </>
      );
    case 'barcode':
    case 'qrcode': {
      const value = codeValue(el, values);
      const img = codeImage(el.type, value, el.color, el.background, el.showText);
      if (!img.canvas) {
        return (
          <>
            <Rect width={el.width} height={el.height} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1} dash={[4, 3]} />
            <Text
              width={el.width}
              height={el.height}
              text={`${el.type === 'barcode' ? 'Barcode' : 'QR code'}\n${values ? img.error : value || img.error}`}
              align="center"
              verticalAlign="middle"
              fontSize={Math.max(9, Math.min(14, el.height / 6))}
              fill="#64748b"
              padding={4}
            />
          </>
        );
      }
      return <KonvaImage image={img.canvas} width={el.width} height={el.height} />;
    }
  }
}

function TextBody({ el, values, highlightFields }: { el: TextElement | FieldElement; values: Record<string, string> | null; highlightFields: boolean }) {
  const text = el.type === 'field' ? fieldDisplayText(el, values) : el.text;
  return (
    <>
      {el.background && <Rect width={el.width} height={el.height} fill={el.background} />}
      {/* In the designer, fields get a light dashed outline so they stand out from fixed text. */}
      {el.type === 'field' && highlightFields && <Rect width={el.width} height={el.height} stroke="#6366f1" strokeWidth={1} dash={[4, 3]} fill="rgba(99,102,241,0.06)" />}
      <Text
        width={el.width}
        height={el.height}
        text={text}
        fontFamily={el.fontFamily}
        fontSize={el.fontSize}
        fontStyle={el.fontStyle}
        textDecoration={el.textDecoration}
        fill={el.fill}
        align={el.align}
        verticalAlign={el.verticalAlign}
        lineHeight={el.lineHeight}
        letterSpacing={el.letterSpacing}
        wrap="word"
        ellipsis={false}
      />
    </>
  );
}

function ImageBody({ el }: { el: Extract<CanvasElement, { type: 'image' }> }) {
  const image = useStoredImage(el.fileId);
  if (!image) return <Rect width={el.width} height={el.height} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={1} />;
  return <KonvaImage image={image} width={el.width} height={el.height} />;
}
