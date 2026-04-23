import type { VinylWallSnapshotSummary } from '../../hooks/useMyDig';

// Handwritten-style snapshot switcher. Sits to the right of the
// vinyl wall — clicking a row swaps the wall's 15 records to the
// selected snapshot (or back to the live wall via the "현재
// 마이딕 보기" entry up top). Active row is amber; inactive rows
// are near-black ink on the painted wall backdrop.
//
// Fonts: Shadows Into Light (Latin) + Gamja Flower (Korean). Both
// restrained pen strokes that mix without one side feeling
// louder. Rows stay upright — the earlier per-row rotation read
// as forced once the fonts were already handwritten.
//
// Owner sees private snapshots with a "(비공개)" suffix; visitors
// never see private rows because the list endpoint filters them
// server-side.

const FONT_STACK =
  "'Shadows Into Light', 'Gamja Flower', 'Nanum Pen Script', cursive";

export default function GraffitiSnapshotList({
  snapshots,
  isOwner,
  activeSlug,
  onSelect,
  onClear,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onClear: () => void;
}) {
  // Shown only in snapshot mode (activeSlug !== null). Acts as
  // the escape hatch back to the live wall — sits ABOVE the
  // "다른 기억들:" heading so it reads as the user's "way home"
  // rather than another snapshot to pick from. In live mode this
  // row is hidden entirely; the URL already reflects that state.
  const backToLiveRow = activeSlug !== null ? (
    <button
      type="button"
      onClick={onClear}
      className="group inline-block origin-left text-left mb-4"
    >
      <span className="inline-block origin-left transition-transform duration-200 group-hover:scale-[1.05]">
        <span className="text-[20px] leading-[1.15] text-[#1a1208] group-hover:text-[#e8a020] transition-colors duration-200">
          ← 현재 마이딕으로…
        </span>
      </span>
    </button>
  ) : null;

  const heading = (
    <div
      className="mb-3 text-[22px] leading-none text-[#1a1208]"
      style={{ fontFamily: FONT_STACK }}
    >
      다른 기억들:
    </div>
  );

  // Column positioning: pt-10 anchors the start near "10% from
  // the top of the wall row" without measuring the wall height —
  // the heading + a short list sit high on the painted column
  // where a graffito would naturally live.
  const outer = 'px-2 pt-10 flex flex-col gap-2';

  if (snapshots.length === 0) {
    return (
      <div className={outer} style={{ fontFamily: FONT_STACK }}>
        {backToLiveRow}
        {heading}
        <div className="flex flex-col gap-1.5 pl-3">
          <div className="text-[14px] leading-relaxed text-[#5a4838]">
            {isOwner
              ? '아직 스냅샷이 없어요. 📸 버튼으로 남겨보세요.'
              : '아직 스냅샷이 없어요.'}
          </div>
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
      {backToLiveRow}
      {heading}
      <div className="flex flex-col gap-1.5 pl-3">
        {snapshots.map((snap) => {
          const labelSuffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
          const isActive = activeSlug === snap.slug;
          return (
            <button
              type="button"
              key={snap.id}
              onClick={() => onSelect(snap.slug)}
              disabled={isActive}
              className="group inline-block origin-left text-left"
            >
              <span className="inline-block origin-left transition-transform duration-200 group-hover:scale-[1.05]">
                <span
                  className={`text-[18px] leading-[1.15] transition-colors duration-200 ${
                    isActive
                      ? 'text-[#e8a020]'
                      : 'text-[#1a1208] group-hover:text-[#e8a020]'
                  }`}
                >
                  {snap.name}
                </span>
                {labelSuffix && (
                  <span
                    className={`text-[14px] ml-1.5 transition-colors duration-200 ${
                      isActive
                        ? 'text-[#c9a060]'
                        : 'text-[#5a4838] group-hover:text-[#8a6848]'
                    }`}
                  >
                    {labelSuffix}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
