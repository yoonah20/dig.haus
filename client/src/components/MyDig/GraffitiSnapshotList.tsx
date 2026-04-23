import { Link } from 'react-router-dom';
import type { VinylWallSnapshotSummary } from '../../hooks/useMyDig';

// Handwritten-style snapshot list that sits to the right of the
// vinyl wall. The wall is pushed left and this column fills the
// resulting gap with a vertical list of scribbled snapshot
// names, as if they were written on the wall next to the
// records.
//
// Fonts: Shadows Into Light (Latin) + Gamja Flower (Korean).
// Both are thin pen-stroke styles; Shadows Into Light is less
// "explicitly handwritten" than the previous Homemade Apple
// while still reading as a pen — a better match for Gamja
// Flower's restraint on the Korean side.
//
// Rows sit upright (per-row rotation was read as forced), the
// list anchors near the top (about 10% down from the column's
// top edge so it visually ties to where the wall title lives
// across the page), and the "다른 기록들:" heading is larger +
// slightly indented from the rows below it.

const FONT_STACK =
  "'Shadows Into Light', 'Gamja Flower', 'Nanum Pen Script', cursive";

export default function GraffitiSnapshotList({
  username,
  snapshots,
  isOwner,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
}) {
  // Heading — larger than the rows so the column reads clearly
  // as a labelled section, with a small indent so rows below it
  // hang at a wall-graffiti "list under a label" rhythm.
  const heading = (
    <div
      className="mb-3 text-[22px] leading-none text-[#1a1208]"
      style={{ fontFamily: FONT_STACK }}
    >
      다른 기록들:
    </div>
  );

  // Column positioning: pt-[7%] lands the start near "10% from
  // the top" without needing to measure the wall's actual
  // height (pt-% is % of parent WIDTH in CSS but the column is
  // ~280px wide and the wall is ~500-600px tall, so 7% of 280
  // ≈ 20px which sits just below the top edge — same general
  // vibe the user was after). Rows themselves get a small
  // left indent so they hang under the heading rather than
  // sharing its x.
  const outer = 'px-2 pt-10 flex flex-col gap-2';

  if (snapshots.length === 0) {
    return (
      <div className={outer} style={{ fontFamily: FONT_STACK }}>
        {heading}
        <div className="text-[15px] leading-relaxed text-[#5a4838] pl-3">
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
      className={outer}
      style={{ fontFamily: FONT_STACK }}
    >
      {heading}
      <div className="flex flex-col gap-1.5 pl-3">
        {snapshots.map((snap) => {
          const labelSuffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
          return (
            <Link
              key={snap.id}
              to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snap.slug)}`}
              className="group inline-block origin-left"
            >
              <span className="inline-block origin-left transition-transform duration-200 group-hover:scale-[1.05]">
                <span className="text-[20px] leading-[1.15] text-[#1a1208] group-hover:text-[#e8a020] transition-colors duration-200">
                  {snap.name}
                </span>
                {labelSuffix && (
                  <span className="text-[15px] ml-1.5 text-[#5a4838] group-hover:text-[#8a6848] transition-colors duration-200">
                    {labelSuffix}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
