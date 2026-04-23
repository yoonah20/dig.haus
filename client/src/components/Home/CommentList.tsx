import { useEffect, useRef, useState } from 'react';
import { useUserReviewsFeed } from '../../hooks/useUserReviewsFeed';
import { TickerItem } from './CommentTicker';

// Vertical list of 50자 평 cards for the activity rail. Four slots
// visible at a time; every SWAP_INTERVAL_MS one slot (round-robin)
// gets swapped with the next pool entry so the rail reads as a slow,
// alive feed instead of a static excerpt. Alternating orientation
// (left / right / left / right) mirrors the mobile interleave
// rhythm — even slots lean left, odd slots lean right — so four
// stacked cards don't all point the same way.
//
// If the feed has fewer than VISIBLE items we just render what's
// there with no rotation; with exactly VISIBLE we skip the interval
// too since there's nothing to rotate to.
const VISIBLE = 4;
const POOL_SIZE = 20;
const SWAP_INTERVAL_MS = 3000;

export default function CommentList() {
  const { data, isLoading } = useUserReviewsFeed(true, POOL_SIZE);
  const items = data?.items ?? [];

  // slots hold the pool index currently shown in each of the four
  // rail positions. Initial: 0..VISIBLE-1 in order.
  const [slots, setSlots] = useState<number[]>(() =>
    Array.from({ length: VISIBLE }, (_, i) => i)
  );

  // Round-robin bookkeeping — which slot to replace next, and which
  // pool entry to pull in. Refs (not state) because advancing these
  // shouldn't re-render on its own; the slot array's setState does
  // the render.
  const nextSlotRef = useRef(0);
  const nextPoolRef = useRef(VISIBLE);

  useEffect(() => {
    const total = items.length;
    // Reset indices + slots whenever the pool changes — freshly
    // fetched data should start the rotation from the top.
    nextSlotRef.current = 0;
    nextPoolRef.current = Math.min(VISIBLE, total);
    setSlots(
      Array.from({ length: VISIBLE }, (_, i) => (total > 0 ? i % total : 0))
    );
    if (total <= VISIBLE) return;

    const id = setInterval(() => {
      setSlots((prev) => {
        const next = [...prev];
        next[nextSlotRef.current % VISIBLE] =
          nextPoolRef.current % total;
        return next;
      });
      nextSlotRef.current += 1;
      nextPoolRef.current += 1;
    }, SWAP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [items.length]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: VISIBLE }, (_, i) => (
          <div
            key={i}
            className="h-[72px] rounded-2xl border border-white/5 bg-[#0e0903] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-600 italic py-4 text-center">
        아직 50자 평이 없어요.
      </div>
    );
  }

  // Clamp to whatever the pool has. With fewer than VISIBLE items
  // the rail just shows what exists rather than padding with
  // duplicates, which would read as a bug more than a design.
  const rendered = slots.slice(0, Math.min(VISIBLE, items.length));

  return (
    <div className="flex flex-col gap-3">
      {rendered.map((poolIdx, slotIdx) => {
        const item = items[poolIdx];
        if (!item) return null;
        return (
          <TickerItem
            key={slotIdx}
            item={item}
            fullWidth
            orientation={slotIdx % 2 === 0 ? 'left' : 'right'}
          />
        );
      })}
    </div>
  );
}
