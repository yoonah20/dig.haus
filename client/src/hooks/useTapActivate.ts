import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Tap-to-activate behaviour shared across cards that have a hover
// reveal (flip / scale) the visitor should also be able to see on
// touch devices. AlbumCard runs its own version of this — first
// tap reveals, second tap navigates — and this hook generalises it
// so BlurredReviewCard and the hero LP can plug in without the
// stop-propagation gymnastics. One card across the whole page can
// be active at a time; tapping outside or scrolling clears it.

const TAP_THRESHOLD_PX = 12;
const SCROLL_CANCEL_DY = 5;
const TAP_MAX_MS = 350;

let activeTapId: string | null = null;
const tapListeners = new Set<() => void>();
function setActiveTapId(id: string | null) {
  if (activeTapId === id) return;
  activeTapId = id;
  tapListeners.forEach((l) => l());
}
function getActiveTapId() {
  return activeTapId;
}
function subscribeActiveTap(fn: () => void) {
  tapListeners.add(fn);
  return () => {
    tapListeners.delete(fn);
  };
}

export interface TapActivateHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchCancel: () => void;
  // Touch-end handler. When the tap is the first on this card it
  // calls preventDefault on the event and activates the card; the
  // second tap clears the active state and lets the caller
  // navigate (passed as a callback).
  onTouchEnd: (e: React.TouchEvent, onConfirmedNav: () => void) => void;
  // Click handler that suppresses the synthetic click after a
  // touch tap so the browser doesn't fire navigation a second time.
  onClick: (e: React.MouseEvent) => void;
}

export function useTapActivate({
  cardId,
  outsideSelector,
  enabled = true,
}: {
  cardId: string;
  // CSS selector matching the card's outer wrapper. Used to detect
  // when an outside tap should clear the active state — taps that
  // hit anything matching this selector are treated as "still
  // inside a card" and don't deactivate.
  outsideSelector: string;
  // When false the hook becomes a no-op (handlers do nothing,
  // isActive stays false). Lets callers gate by viewport or
  // surface type without conditional hook calls.
  enabled?: boolean;
}) {
  const activeId = useSyncExternalStore(
    subscribeActiveTap,
    getActiveTapId,
    getActiveTapId
  );
  const isActive = enabled && activeId === cardId;

  const isHoverNoneRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    isHoverNoneRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none)').matches;
  }, []);

  useEffect(() => {
    if (!isActive) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (target?.closest?.(outsideSelector)) return;
      setActiveTapId(null);
    }
    function onScroll() {
      setActiveTapId(null);
    }
    const isTouch =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none)').matches;
    document.addEventListener('pointerdown', onDocPointerDown);
    if (isTouch) {
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      if (isTouch) {
        window.removeEventListener('scroll', onScroll);
      }
    };
  }, [isActive, outsideSelector]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !isHoverNoneRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      touchStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        t: performance.now(),
      };
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !isHoverNoneRef.current) return;
      const start = touchStartRef.current;
      if (!start) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (
        Math.abs(dy) > SCROLL_CANCEL_DY ||
        Math.hypot(dx, dy) > TAP_THRESHOLD_PX
      ) {
        touchStartRef.current = null;
      }
    },
    [enabled]
  );

  const onTouchCancel = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent, onConfirmedNav: () => void) => {
      if (!enabled || !isHoverNoneRef.current) return;
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) return;
      if (performance.now() - start.t > TAP_MAX_MS) return;
      e.preventDefault();
      if (activeTapId !== cardId) {
        setActiveTapId(cardId);
      } else {
        setActiveTapId(null);
        onConfirmedNav();
      }
    },
    [cardId, enabled]
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (enabled && isHoverNoneRef.current) {
        // Touch devices route navigation through onTouchEnd so the
        // first tap reveals instead of navigating. Suppress the
        // synthetic click that fires after touchend.
        e.preventDefault();
      }
    },
    [enabled]
  );

  const handlers: TapActivateHandlers = {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    onTouchEnd,
    onClick,
  };

  return { isActive, handlers };
}
