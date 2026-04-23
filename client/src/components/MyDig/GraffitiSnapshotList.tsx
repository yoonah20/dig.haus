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
// Fonts: Permanent Marker (Latin) + Gaegu (Korean), both chosen
// for their thick-marker look so mixed-script snapshot names
// feel like a single pen wrote them on the wall. Permanent
// Marker is weight 400 only, Gaegu 400 / 700 — the 400s across
// both read at about the same stroke weight which is what lets
// them mix without one side feeling louder.
//
// Color is a near-black charcoal — real graffiti on a painted
// interior wall — rather than the warm cream the earlier
// iteration used; amber hover still reads as the "this one is
// selected" marker pen picking out a line.
//
// Each row gets a small deterministic rotation + margin offset
// so the column reads as pen strokes scrawled on the wall
// rather than a formal list. Owner sees private snapshots with
// a "(비공개)" suffix; visitors never see private rows at all
// because the list endpoint filters server-side.

const FONT_STACK =
  "'Permanent Marker', 'Gaegu', 'Nanum Pen Script', cursive";

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
  // Section title — scrawled heading so the column announces
  // itself as "other snapshots" without a heavy sans-serif h2.
  // Sits at the same rotation budget as the rows so everything
  // reads as one hand.
  const heading = (
    <div
      className="mb-3 text-[18px] leading-none text-[#1a1208]"
      style={{
        fontFamily: FONT_STACK,
        transform: 'rotate(-1.5deg)',
        transformOrigin: 'left',
      }}
    >
      다른 기록들:
    </div>
  );

  if (snapshots.length === 0) {
    return (
      <div className="pt-2 px-2" style={{ fontFamily: FONT_STACK }}>
        {heading}
        <div className="text-[15px] leading-relaxed text-[#5a4838]">
          {isOwner
            ? '아직 없어요. 📸 버튼으로 남겨보세요.'
            : '아직 없어요.'}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="스냅샷 목록"
      // Small left padding so the scribbles feel like they're
      // written on the wall rather than against the edge. Font
      // set once on the container so every row inherits.
      className="pt-2 px-2 flex flex-col gap-2.5"
      style={{ fontFamily: FONT_STACK }}
    >
      {heading}
      {snapshots.map((snap) => {
        const rotation = jitter(snap.id, 11) * 2.5; // ±2.5deg
        const indent = Math.max(0, jitter(snap.id, 23) * 10); // 0-10px
        const labelSuffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
        return (
          // Rotation on the outer Link (inline style), scale on
          // the inner span (Tailwind class) — separate elements
          // so the hover scale doesn't clobber the rotation.
          <Link
            key={snap.id}
            to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snap.slug)}`}
            className="group inline-block origin-left"
            style={{
              transform: `rotate(${rotation.toFixed(2)}deg)`,
              marginLeft: `${indent.toFixed(1)}px`,
            }}
          >
            <span className="inline-block origin-left transition-transform duration-200 group-hover:scale-[1.05]">
              <span className="text-[22px] leading-none text-[#1a1208] group-hover:text-[#e8a020] transition-colors duration-200">
                {snap.name}
              </span>
              {labelSuffix && (
                <span className="text-[16px] ml-1.5 text-[#5a4838] group-hover:text-[#8a6848] transition-colors duration-200">
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
