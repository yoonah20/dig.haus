import { useEffect, useState } from 'react';

// Resolves the current Tailwind breakpoint to a col count from a
// caller-supplied map. Used by the home activity grids to slice
// their item list to a multiple of cols, so the last row always
// fills edge-to-edge instead of leaving an awkward 2-of-5 tail
// at lg etc.

export interface GridColsMap {
  base: number; // < sm (640)
  sm: number; // ≥ 640
  md: number; // ≥ 768
  lg: number; // ≥ 1024
  xl: number; // ≥ 1280
}

type Bp = keyof GridColsMap;

const BREAKPOINTS: ReadonlyArray<{ key: Bp; mq: string }> = [
  { key: 'xl', mq: '(min-width: 1280px)' },
  { key: 'lg', mq: '(min-width: 1024px)' },
  { key: 'md', mq: '(min-width: 768px)' },
  { key: 'sm', mq: '(min-width: 640px)' },
];

function resolveBp(): Bp {
  if (typeof window === 'undefined') return 'xl';
  for (const q of BREAKPOINTS) {
    if (window.matchMedia(q.mq).matches) return q.key;
  }
  return 'base';
}

export function useGridCols(cols: GridColsMap): number {
  const [bp, setBp] = useState<Bp>(() => resolveBp());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setBp(resolveBp());
    const cleanups = BREAKPOINTS.map((q) => {
      const m = window.matchMedia(q.mq);
      m.addEventListener('change', update);
      return () => m.removeEventListener('change', update);
    });
    return () => cleanups.forEach((fn) => fn());
  }, []);

  return cols[bp];
}

// Slice a list down to the largest multiple of cols that's still
// ≤ the list length, so the last row is always full. When cols >
// list length we just return the list as-is (single short row).
export function trimToFullRows<T>(items: T[], cols: number): T[] {
  if (cols <= 0 || items.length === 0) return items;
  if (items.length < cols) return items;
  const fit = Math.floor(items.length / cols) * cols;
  return items.slice(0, fit);
}
