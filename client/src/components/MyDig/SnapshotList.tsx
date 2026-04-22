import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useDeleteVinylWallSnapshot,
  useUpdateVinylWallSnapshot,
  type VinylWallSnapshotSummary,
} from '../../hooks/useMyDig';
import { formatRelativeKo } from '../../utils/relativeTime';

// Horizontal strip of saved snapshots below the live wall.
// Visitor sees only public ones (server-filtered). Owner sees all
// with inline controls to toggle public/private and delete. Each
// card links to /my/:username/snap/:slug for the read-only detail
// view.
//
// Layout: always a single row, horizontally scrollable. When
// there are enough snapshots that some sit off-screen we mount
// left/right arrow buttons that scroll the strip by one
// viewport-worth at a time. Threshold is measured from actual
// overflow, not count, so the arrows appear as soon as anything
// is clipped regardless of viewport width.
//
// ARROW_THRESHOLD: roughly 4–5 cards at 180px + gaps on desktop.
// The arrows stay hidden under that since everything fits.
export default function SnapshotList({
  username,
  snapshots,
  isOwner,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Recompute arrow enablement on mount, scroll, and resize. The
  // "can scroll further" flags drive opacity on the arrow buttons
  // so hitting an edge feels closed-off rather than silently dead.
  // isOverflowing is the truth source for whether to mount the
  // arrows at all — count-based thresholds break when card width
  // or viewport changes.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setIsOverflowing(max > 4);
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft < max - 4);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [snapshots.length]);

  if (snapshots.length === 0) return null;

  const scrollByAmount = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    // Scroll by ~80% of visible width so consecutive clicks always
    // land on fresh cards instead of re-showing the same edge pair.
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const showArrows = isOverflowing;

  return (
    <section className="relative">
      {/* Strip header compressed — just a muted count on the right
          of the first card to save vertical space. The "Snapshots"
          label fell out because the cards themselves obviously are
          snapshots and the extra line was pushing records down. */}
      <div className="relative flex items-center gap-2">
        {showArrows && (
          <NavArrow
            direction="left"
            enabled={canLeft}
            onClick={() => scrollByAmount(-1)}
          />
        )}
        <div
          ref={trackRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-1 flex-1"
          // Hide the native scrollbar so the arrow buttons are
          // the primary navigation signal. On trackpads the strip
          // still scrolls by swipe.
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {snapshots.map((s) => (
            <SnapshotCard
              key={s.id}
              username={username}
              snapshot={s}
              isOwner={isOwner}
            />
          ))}
        </div>
        {showArrows && (
          <NavArrow
            direction="right"
            enabled={canRight}
            onClick={() => scrollByAmount(1)}
          />
        )}
      </div>
    </section>
  );
}

// Horizontal triangle arrow button ("눕힌 삼각형"). Sits flush to
// the left/right edges of the snapshot strip. Fades to disabled
// look when the strip can't scroll any further in that direction.
function NavArrow({
  direction,
  enabled,
  onClick,
}: {
  direction: 'left' | 'right';
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={direction === 'left' ? '이전 스냅샷' : '다음 스냅샷'}
      className={`shrink-0 w-6 h-10 flex items-center justify-center text-[#e8a020] transition-opacity cursor-pointer disabled:cursor-not-allowed ${
        enabled ? 'opacity-80 hover:opacity-100' : 'opacity-25'
      }`}
    >
      <svg viewBox="0 0 10 14" className="w-3 h-5" fill="currentColor">
        {direction === 'left' ? (
          <path d="M9 0 L1 7 L9 14 Z" />
        ) : (
          <path d="M1 0 L9 7 L1 14 Z" />
        )}
      </svg>
    </button>
  );
}

function SnapshotCard({
  username,
  snapshot,
  isOwner,
}: {
  username: string;
  snapshot: VinylWallSnapshotSummary;
  isOwner: boolean;
}) {
  const update = useUpdateVinylWallSnapshot(username);
  const del = useDeleteVinylWallSnapshot(username);

  const togglePublic = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (update.isPending) return;
    update.mutate({ id: snapshot.id, isPublic: !snapshot.isPublic });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (del.isPending) return;
    if (!confirm(`"${snapshot.name}" 스냅샷을 삭제할까요? 되돌릴 수 없어요.`)) return;
    del.mutate(snapshot.id);
  };

  return (
    <Link
      to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snapshot.slug)}`}
      // w-[280px]: roughly 3.5 cards visible in the max-w-1120
      // content column (previously 180 showed ~5.5). bg at /40 so
      // the painted wall reads through the card the same way the
      // header action pills do now — quieter chrome against the
      // scene.
      className="group block shrink-0 w-[280px] p-3 rounded-lg bg-[#14120d]/40 border border-white/5 hover:border-[#e8a020]/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="text-sm text-[#f5e8c8] font-serif italic truncate leading-tight"
            title={snapshot.name}
          >
            {snapshot.name}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
            {formatRelativeKo(snapshot.createdAt)} · {snapshot.itemCount}장
          </div>
        </div>
        {snapshot.isPublic ? (
          <span
            className="text-[9px] uppercase tracking-wider text-[#e8a020] shrink-0"
            title="공개"
          >
            public
          </span>
        ) : (
          <span
            className="text-[9px] uppercase tracking-wider text-gray-600 shrink-0"
            title="비공개"
          >
            private
          </span>
        )}
      </div>
      {isOwner && (
        <div className="flex items-center gap-1 mt-3 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={togglePublic}
            disabled={update.isPending}
            className="text-[10px] text-gray-400 hover:text-[#e8a020] cursor-pointer disabled:opacity-50"
            title="공개 상태 전환"
          >
            {snapshot.isPublic ? '🔒 비공개로' : '🌐 공개로'}
          </button>
          <span className="text-gray-700">·</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="text-[10px] text-gray-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
            title="삭제"
          >
            삭제
          </button>
        </div>
      )}
    </Link>
  );
}
