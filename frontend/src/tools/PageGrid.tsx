import { useEffect, useRef, useState, type DragEvent } from 'react';
import { renderThumbnail } from './pdfjs';

export interface PageItem {
  page: number; // 1-based page in the original file
  rotate: 0 | 90 | 180 | 270;
  removed: boolean;
}

// A lazily drawn page picture: it renders only when scrolled into view.
export function PageThumb({ file, page, rotate = 0, width = 120 }: { file: File; page: number; rotate?: number; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        renderThumbnail(file, page, width)
          .then((url) => !cancelled && setSrc(url))
          .catch(() => !cancelled && setFailed(true));
      },
      { rootMargin: '200px' },
    );
    observer.observe(box);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file, page, width]);

  return (
    <div ref={ref} className="flex items-center justify-center overflow-hidden" style={{ width, height: width * 1.35 }}>
      {src ? (
        <img src={src} alt={`Page ${page}`} className="max-h-full max-w-full bg-surface shadow ring-1 ring-slate-200 transition-transform" style={{ transform: `rotate(${rotate}deg)` }} />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded bg-slate-100 text-xs text-slate-400">{failed ? 'No preview' : `Page ${page}`}</div>
      )}
    </div>
  );
}

// All pages of one PDF. In "organize" mode pages can be dragged into a new order, rotated and removed;
// in "remove" mode they can only be removed; in "split" mode they are shown for reference.
export function PageGrid({ file, items, onChange, mode }: { file: File; items: PageItem[]; onChange: (items: PageItem[]) => void; mode: 'organize' | 'remove' | 'split' }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  const update = (i: number, patch: Partial<PageItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
      {items.map((item, i) => (
        <div
          key={item.page}
          draggable={mode === 'organize'}
          onDragStart={() => setDragIndex(i)}
          onDragOver={(e: DragEvent) => mode === 'organize' && e.preventDefault()}
          onDrop={() => {
            if (dragIndex !== null) move(dragIndex, i);
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
          className={`group relative flex flex-col items-center rounded-xl p-3 ring-1 transition ${item.removed ? 'bg-red-50 opacity-50 ring-red-200' : 'bg-surface ring-slate-200 hover:ring-slate-400'} ${mode === 'organize' ? 'cursor-grab active:cursor-grabbing' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
        >
          <PageThumb file={file} page={item.page} rotate={item.rotate} />
          <span className="mt-2 text-xs font-medium text-slate-600">{mode === 'organize' ? `${i + 1}  ·  page ${item.page}` : `Page ${item.page}`}</span>
          {mode !== 'split' && (
            <div className="absolute right-2 top-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              {mode === 'organize' && !item.removed && (
                <button type="button" title="Rotate right" aria-label={`Rotate page ${item.page}`} onClick={() => update(i, { rotate: (((item.rotate + 90) % 360) as PageItem['rotate']) })} className="rounded-full bg-surface p-1.5 text-slate-700 shadow ring-1 ring-slate-200 hover:bg-slate-50">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 2v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" /></svg>
                </button>
              )}
              <button
                type="button"
                title={item.removed ? 'Keep this page' : 'Remove this page'}
                aria-label={item.removed ? `Keep page ${item.page}` : `Remove page ${item.page}`}
                onClick={() => update(i, { removed: !item.removed })}
                className={`rounded-full p-1.5 shadow ring-1 ${item.removed ? 'bg-emerald-600 text-white ring-emerald-700' : 'bg-surface text-red-600 ring-slate-200 hover:bg-red-50'}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={item.removed ? 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10' : 'M18 6 6 18M6 6l12 12'} />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
