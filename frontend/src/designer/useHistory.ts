import { useCallback, useRef, useState } from 'react';

const LIMIT = 100;

// Undo / redo for the design. Each change is a full copy of the (small) design JSON, which keeps the logic simple.
// Changes that arrive in quick succession with the same `mergeKey` (typing in a box, dragging a slider)
// become one undo step instead of dozens.
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const lastMerge = useRef<{ key: string; at: number } | null>(null);

  const set = useCallback((next: T | ((current: T) => T), mergeKey?: string) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(s.present) : next;
      if (value === s.present) return s;
      const now = Date.now();
      const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 800;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      if (merge) return { ...s, present: value, future: [] };
      return { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastMerge.current = null;
    setState((s) => (s.past.length === 0 ? s : { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }));
  }, []);

  const redo = useCallback(() => {
    lastMerge.current = null;
    setState((s) => (s.future.length === 0 ? s : { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }));
  }, []);

  // Replaces the design without an undo step (used after loading).
  const reset = useCallback((value: T) => {
    lastMerge.current = null;
    setState({ past: [], present: value, future: [] });
  }, []);

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
