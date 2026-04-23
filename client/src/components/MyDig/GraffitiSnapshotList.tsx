import { Link } from 'react-router-dom';
import type { VinylWallSnapshotSummary } from '../../hooks/useMyDig';

// Handwritten-style snapshot list that sits to the right of the
// vinyl wall. The wall is pushed left and this column fills the
// resulting gap with a vertical list of scribbled snapshot
// names, as if they were written on the wall next to the
// records.
//
// Fonts: Homemade Apple (Latin) + Gamja Flower (Korean). Both
// are tidier handwriting fonts than the Permanent Marker +
// Gaegu pair used earlier — they sit at comparable stroke
// weights so a mixed Korean/Latin name doesn't feel like two
// different hands wrote it. Rows stay upright now too (the
// earlier per-row rotation read as forced once the fonts were
// already handwritten); variation comes from font + ink alone.
//
// Color is near-black charcoal — real graffiti on a painted
// interior wall — with amber as the hover accent. Owner sees
// private snapshots with a "(비공개)" suffix; visitors never
// see private rows because the list endpoint filters them
// server-side.

const FONT_STACK =
  "'Homemade Apple', 'Gamja Flower', 'Nanum Pen Script', cursive";

export default function GraffitiSnapshotList({
  username,
  snapshots,
  isOwner,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
}) {
  const heading = (
    <div
      className="mb-2 text-[15px] leading-none text-[#1a1208]"
      style={{ fontFamily: FONT_STACK }}
    >
      다른 기록들:
    </div>
  );

  // Flex column + h-full so the grid stretches this to the wall's
  // row height, then justify-center with a slight bottom bias
  // (pb-12) leaves the list sitting a bit above the vertical
  // centre — which is where the heading anchors the eye.
  const outer =
    'px-2 flex flex-col h-full justify-center pb-12 gap-2';

  if (snapshots.length === 0) {
    return (
      <div className={outer} style={{ fontFamily: FONT_STACK }}>
        {heading}
        <div className="text-[14px] leading-relaxed text-[#5a4838]">
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
      {snapshots.map((snap) => {
        const labelSuffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
        return (
          <Link
            key={snap.id}
            to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snap.slug)}`}
            className="group inline-block origin-left"
          >
            <span className="inline-block origin-left transition-transform duration-200 group-hover:scale-[1.05]">
              <span className="text-[18px] leading-[1.15] text-[#1a1208] group-hover:text-[#e8a020] transition-colors duration-200">
                {snap.name}
              </span>
              {labelSuffix && (
                <span className="text-[14px] ml-1.5 text-[#5a4838] group-hover:text-[#8a6848] transition-colors duration-200">
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
