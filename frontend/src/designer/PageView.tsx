import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Image as KonvaImage, Layer, Rect, Stage } from 'react-konva';
import { useStoredImage } from './assets';
import { ElementNode } from './ElementNode';
import type { CanvasDocument, CanvasPage } from './types';

// The page background: a colour, and optionally an uploaded image stretched over the whole page
// (used for templates made from a scanned form or certificate).
export function PageBackground({ page }: { page: CanvasPage }) {
  const image = useStoredImage(page.backgroundFileId);
  return (
    <>
      <Rect name="page-background" width={page.width} height={page.height} fill={page.background || '#ffffff'} />
      {image && <KonvaImage name="page-background" image={image} width={page.width} height={page.height} listening={false} />}
    </>
  );
}

// Read-only drawing of one page, scaled to the given width.
export function PageView({ page, values, width, stageRef }: { page: CanvasPage; values: Record<string, string> | null; width: number; stageRef?: React.Ref<Konva.Stage> }) {
  const scale = width / page.width;
  return (
    <Stage ref={stageRef} width={page.width * scale} height={page.height * scale} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <PageBackground page={page} />
        {page.elements.map((el) => (
          <ElementNode key={el.id} element={el} values={values} />
        ))}
      </Layer>
    </Stage>
  );
}

// Shows every page of a design one below the other, fitting the width of its container.
export function DocumentPreview({ canvas, values, maxWidth = 900 }: { canvas: CanvasDocument; values: Record<string, string> | null; maxWidth?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Re-measure when the container changes size (window resize, sidebar toggles).
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setWidth(Math.min(box.clientWidth, maxWidth)));
    observer.observe(box);
    setWidth(Math.min(box.clientWidth, maxWidth));
    return () => observer.disconnect();
  }, [maxWidth]);

  return (
    <div ref={boxRef} className="w-full">
      {width > 0 && (
        <div className="flex flex-col items-center gap-4">
          {canvas.pages.map((page, i) => (
            <div key={page.id} className="shadow-md ring-1 ring-slate-200">
              <PageView page={page} values={values} width={Math.min(width, page.width * 1.5)} />
              {canvas.pages.length > 1 && <div className="sr-only">Page {i + 1}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
