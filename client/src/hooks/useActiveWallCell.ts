import { useEffect, useSyncExternalStore } from 'react';

// Module-level "which mydig wall cell is in tap-activated state"
// store. One active id across the entire wall so tapping a
// different cell deactivates the previous one — matches the
// desktop hover model (only one cell shows its peek at a time).
//
// Desktop doesn't need this; CSS :hover handles reveal directly.
// Mobile taps through setActiveWallCellId() and a document-level
// outside-tap listener (registered at the page level) clears it
// when the user taps away from the grid.

type Listener = () => void;

let activeId: string | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function setActiveWallCellId(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  notify();
}

export function getActiveWallCellId(): string | null {
  return activeId;
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useActiveWallCellId(): string | null {
  return useSyncExternalStore(subscribe, getActiveWallCellId, getActiveWallCellId);
}

// Document-level clear: tap/click anywhere outside the wall grid
// drops the active cell so the page returns to its resting state.
// Consumers call this once at the page level; WallCell itself
// doesn't need to wire anything because the store is shared.
export function useClearActiveWallCellOnOutsideTap(
  gridRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!activeId) return;
      const target = e.target as Element | null;
      if (!target) return;
      if (gridRef.current?.contains(target)) return;
      setActiveWallCellId(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [gridRef]);
}
