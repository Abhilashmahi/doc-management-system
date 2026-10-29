import type { CSSProperties } from 'react';

// Where a drop-down opens: just below its button. It is fixed to the window so the ribbon's edge does not cut it off.
export function dropPosition(anchor: HTMLElement | null): CSSProperties {
  const r = anchor?.getBoundingClientRect();
  if (!r) return {};
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 360)) };
}
