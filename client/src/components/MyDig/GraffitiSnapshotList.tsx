import { Link } from 'react-router-dom';
import type { VinylWallSnapshotSummary } from '../../hooks/useMyDig';

// Handwritten-style snapshot list that sits to the right of the
// vinyl wall — the wall gets shrunken down a bit and pushed left,
// this column fills the resulting gap with a column of scribbled
// snapshot names. Replaces the earlier horizontal SnapshotList
// strip that sat below the wall; moving snapshots into the same
// visual plane as the wall lets the whole page read as "shop
// interior" instead of "wall with a tray of archive cards under
// it".
//
// Fonts: Caveat for Latin + Nanum Pen Script for Korean. Both are
// already loaded site-wide (see index.html). Each row gets a
// small deterministic rotation + margin offset so the column
// reads as pen strokes scrawled on the wall rather than a formal
// list. Owner sees private snapshots with a "(비공개)" suffix;
// visitors never see them at all (server filters at the list
// endpoint).

// Seeded pseudo-random — deterministic per snapshot id so the
// scrawl doesn't re-jitter on every render while the list is
// visible.
function jitter(seed: number, salt: number): number {
  const h = Math.abs(((seed * 2654435761 + salt * 374761393) >>> 0) % 10000) / 10000;
  return h * 2 - 1; // [-1, 1]
}

export default function GraffitiSnapshotList({
  username,
  snapshots,
  isOwner,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="text-[15px] italic text-[#8a7250] leading-relaxed pt-4 px-2" style={{ fontFamily: "'Caveat', 'Nanum Pen Script', cursive" }}>
        {isOwner
          ? '아직 스냅샷이 없어요. 📸 버튼으로 벽을 보관해보세요.'
          : '스냅샷이 없어요.'}
      </div>
    );
  }

  return (
    <div
      aria-label="스냅샷 목록"
      // Slight left padding so the scribbled names feel like
      // they're written on the wall rather than against the edge.
      // Font-family set here once so every row inherits.
      className="pt-2 px-2 flex flex-col gap-2.5"
      style={{
        fontFamily: "'Caveat', 'Nanum Pen Script', cursive",
        color: '#c9a060',
      }}
    >
      {snapshots.map((snap) => {
        const rotation = jitter(snap.id, 11) * 2.5; // ±2.5deg
        const indent = Math.max(0, jitter(snap.id, 23) * 10); // 0-10px
        const labelSuffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
        return (
          // Rotation goes on the outer Link (inline style) — the
          // inner span handles hover scale via a Tailwind class.
          // Splitting the two keeps the transforms on separate
          // elements so the hover scale doesn't clobber the
          // per-item rotation the way a single-element
          // `group-hover:scale-...` would when composed with an
          // inline `transform: rotate(...)`.
          <Link
            key={snap.id}
            to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snap.slug)}`}
            className="group inline-block origin-left"
            style={{
              transform: `rotate(${rotation.toFixed(2)}deg)`,
              marginLeft: `${indent.toFixed(1)}px`,
            }}
          >
            <span className="inline-block origin-left transition-all duration-200 text-[#c9a060] group-hover:text-[#e8a020] group-hover:scale-[1.05]">
              <span className="text-[22px] leading-none">{snap.name}</span>
              {labelSuffix && (
                <span className="text-[16px] text-[#8a7250] group-hover:text-[#c9a060] ml-1.5">
                  {labelSuffix}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
