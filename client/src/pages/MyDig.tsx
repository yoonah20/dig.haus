import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMyDig, type MyDigWallItem, type MyDigShelfSlot, type MyDigCrate } from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
import { WallLP, WallRail } from '../components/MyDig/storefront/primitives';

// Phase 3a skeleton — the four-layer placeholder scaffold described
// in CLAUDE.md. No edit mode, no drag-drop, no flip-through yet —
// just the read-only "storefront" rendered with whatever items the
// server returns (empty arrays for users who haven't placed
// anything, which is everyone right now).
//
// The empty-is-OK aesthetic is the whole point of this commit:
// Wall renders 22 slots always, Shelf renders 6 bins always, Crate
// renders only what exists (zero crates = no crate row). Subsequent
// sub-phases (3b-3d) layer item-level interactions on top of this
// scaffold without touching the layout logic.

// Vinyl Wall rows: 5-5-6-6 = 22 slots, equal cover sizes.
const WALL_ROW_SIZES = [5, 5, 6, 6] as const;
const WALL_TOTAL = WALL_ROW_SIZES.reduce((a, b) => a + b, 0); // 22

const SHELF_BIN_COUNT = 6;

export default function MyDig() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, error } = useMyDig(username);
  const [editingWall, setEditingWall] = useState(false);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg">이 페이지를 불러오지 못했어요.</p>
          <Link to="/" className="text-[#e8a020] mt-4 inline-block hover:underline">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  // Private mode — under-construction placeholder. Preserves the
  // shop aesthetic instead of showing a cold 403/404. Per CLAUDE.md
  // the visual should read as "fabric drape over the storefront +
  // A4 notice taped on"; the full illustration lands in 3a polish.
  if (!data.isPublic) {
    return (
      <div className="flex-1 max-w-[1120px] mx-auto px-4 py-12">
        <div className="rounded-2xl bg-[#12100d] border border-white/5 p-10 sm:p-16 text-center">
          <div className="text-5xl mb-4" aria-hidden>🚧</div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-3">
            {data.user.displayName || data.user.username}님의 가게가 준비 중입니다
          </h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
            문 열 준비가 되면 다시 찾아주세요.
          </p>
        </div>
      </div>
    );
  }

  const ownerBadge = data.user.isOwner ? (
    <span className="text-[10px] font-bold uppercase tracking-wider bg-[#e8a020]/15 text-[#e8a020] px-2 py-0.5 rounded">
      MY PAGE
    </span>
  ) : null;

  // Wall items come back sparse (position → item). Build a dense
  // 22-element array with nulls for the empty-frame render.
  const wallByPosition = new Map<number, MyDigWallItem>();
  for (const it of data.vinylWall) wallByPosition.set(it.position, it);

  // Shelf slots come back sparse too — fill 6 bins, null where
  // admin hasn't assigned a genre yet.
  const shelfByPosition = new Map<number, MyDigShelfSlot>();
  for (const s of data.shelf) shelfByPosition.set(s.position, s);

  return (
    <div className="flex-1">
      <main className="max-w-[1120px] mx-auto px-4 py-8 space-y-10">
        {/* Header — display name (or username), owner badge. The
            URL already carries /my/:username, so duplicating the
            handle in the title ended up reading as "fpp @fpp" /
            "Yoonah @yoonah" — redundant either way. Only show the
            @handle when display name is set AND differs from the
            username so the two pieces aren't saying the same thing. */}
        <header className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif">
            {data.user.displayName || data.user.username}
          </h1>
          {data.user.displayName &&
            data.user.displayName.toLowerCase() !==
              data.user.username.toLowerCase() && (
              <span className="text-gray-500 text-base sm:text-lg">
                @{data.user.username}
              </span>
            )}
          {ownerBadge}
        </header>

        {/* Tier 1 — Vinyl Wall. 5-5-6-6, equal cover sizes, 5-rows
            centered with empty space at the ends. */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Vinyl Wall
            </h2>
            {data.user.isOwner && (
              <button
                type="button"
                onClick={() => setEditingWall(true)}
                className="text-xs text-[#e8a020]/80 hover:text-[#e8a020] border border-[#e8a020]/40 hover:border-[#e8a020]/70 rounded-md px-2 py-0.5 cursor-pointer transition-colors"
              >
                ✏️ 편집
              </button>
            )}
          </div>
          <VinylWallGrid
            wallByPosition={wallByPosition}
            isOwner={data.user.isOwner}
          />
        </section>

        {editingWall && username && (
          <VinylWallEditor
            username={username}
            initialWall={data.vinylWall}
            onClose={() => setEditingWall(false)}
          />
        )}

        {/* Shelf + Crate tiers temporarily hidden while we focus on
            getting Vinyl Wall right. Server routes + schema are
            untouched; the tier renders just don't mount. Restore
            when the design + interaction for those tiers is worth
            showing. */}
      </main>
    </div>
  );
}

// Layout reused from the /my-preview Storefront Wall. Four rows
// (5/5/6/6), all LPs the same pixel size, per-row wooden rail sized
// to that row's width, shorter rows centered under the widest row.
// The live mydig page differs from the preview in two ways:
//  (1) content is real album data (CoverArt) instead of FakeCover
//      seeded sleeves, and
//  (2) filled slots are clickable Links to the album page.
// WallLP takes a `children` prop so this component can inject its
// own cover node without forking the primitive.
function VinylWallGrid({
  wallByPosition,
  isOwner,
}: {
  wallByPosition: Map<number, MyDigWallItem>;
  isOwner: boolean;
}) {
  // Responsive LP size. Desktop matches the preview's 170px so the
  // wall reads "crafted wall" instead of "small thumbnails."
  // Mobile compresses to 96px so a 6-row still fits inside a 375px
  // viewport (6×96 + 5×8 gap = 616 > 375 — mobile 6-row rows will
  // overflow slightly; the outer container scrolls horizontally on
  // phones which is acceptable given the 3a scope). Measured here
  // on mount via matchMedia so hydration matches first paint.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const lpSize = mobile ? 64 : 140;
  const gapX = mobile ? 6 : 14;
  const rowSpacing = mobile ? 14 : 22;

  let cursor = 0;
  const rows = WALL_ROW_SIZES.map((count) => {
    const positions = Array.from({ length: count }, (_, i) => cursor + i);
    cursor += count;
    return { count, positions };
  });

  // Compute the widest row's width so narrower rows can center
  // under it. All rows go in a position:relative container whose
  // width locks to the widest-row pixel width.
  const maxCols = Math.max(...WALL_ROW_SIZES);
  const maxRowW = maxCols * lpSize + (maxCols - 1) * gapX;

  return (
    <div
      style={{
        position: 'relative',
        width: maxRowW,
        maxWidth: '100%',
        margin: '0 auto',
        paddingTop: 12,
      }}
    >
      {rows.map(({ count, positions }, ri) => {
        const rowW = count * lpSize + (count - 1) * gapX;
        return (
          <div
            key={ri}
            style={{ position: 'relative', marginBottom: rowSpacing }}
          >
            {/* LP row */}
            <div
              style={{
                display: 'flex',
                gap: gapX,
                justifyContent: 'center',
                alignItems: 'flex-end',
              }}
            >
              {positions.map((position, ci) => {
                const item = wallByPosition.get(position);
                const lampBias =
                  1 - Math.min(1, (ri * maxCols + ci) / (WALL_ROW_SIZES.length * maxCols));
                if (!item) {
                  return <WallLP key={position} size={lpSize} seed={position} empty lampBias={lampBias} />;
                }
                const { album } = item;
                const target = album.slug || album.mbid;
                return (
                  <Link
                    key={position}
                    to={`/album/${target}`}
                    title={`${album.artist} — ${album.title}`}
                    style={{
                      display: 'block',
                      width: lpSize,
                      height: lpSize,
                      textDecoration: 'none',
                    }}
                  >
                    <WallLP size={lpSize} seed={position} lampBias={lampBias}>
                      <CoverArt
                        src={album.coverArtUrl}
                        fallbacks={album.coverArtFallbacks}
                        alt={album.title}
                        className="w-full h-full object-cover"
                      />
                    </WallLP>
                  </Link>
                );
              })}
            </div>
            {/* Per-row rail — same sizing rule as the preview: row
                pixel width plus a ~10px overhang each side. Centered
                via margin auto within the outer container. */}
            <div style={{ position: 'relative', marginTop: -1 }}>
              <WallRail
                width={rowW + 20}
                seed={ri * 37 + 13}
                style={{ margin: '0 auto' }}
              />
            </div>
          </div>
        );
      })}
      {wallByPosition.size === 0 && (
        <p className="text-center text-xs text-gray-600 pt-2">
          {isOwner
            ? '아직 벽이 비어 있어요. 편집 버튼으로 앨범을 걸어보세요.'
            : '이 벽은 아직 비어 있어요.'}
        </p>
      )}
    </div>
  );
}

function ShelfRow({
  shelfByPosition,
  isOwner,
}: {
  shelfByPosition: Map<number, MyDigShelfSlot>;
  isOwner: boolean;
}) {
  const bins = Array.from({ length: SHELF_BIN_COUNT }, (_, i) =>
    shelfByPosition.get(i) ?? null
  );
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
      {bins.map((slot, idx) => (
        <ShelfBin key={idx} slot={slot} isOwner={isOwner} />
      ))}
    </div>
  );
}

function ShelfBin({ slot, isOwner }: { slot: MyDigShelfSlot | null; isOwner: boolean }) {
  // Empty slot (no genre assigned yet) — furniture outline with
  // "unset" copy. Owner sees a slightly more inviting message.
  if (!slot) {
    return (
      <div className="aspect-[4/5] rounded-md border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center p-3">
        <span className="text-[11px] text-gray-600 text-center leading-tight">
          {isOwner ? '빈 선반' : '—'}
        </span>
      </div>
    );
  }

  const genreLabel = slot.genre ? slot.genre.nameKo : '장르 미지정';
  const firstItem = slot.items[0];
  return (
    <div className="aspect-[4/5] rounded-md bg-[#14120e] border border-white/5 overflow-hidden flex flex-col">
      {/* Bin "stack" preview — first item's cover if any, otherwise
          empty bin interior. Future 3c commits swap this for a
          "stack of LPs with edges" illustration. */}
      <div className="flex-1 relative bg-[#0f0d0a]">
        {firstItem ? (
          <CoverArt
            src={firstItem.album.coverArtUrl}
            fallbacks={firstItem.album.coverArtFallbacks}
            alt={firstItem.album.title}
            className="w-full h-full object-cover opacity-90"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-xl">
            ♪
          </div>
        )}
        {slot.items.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded tabular-nums">
            {slot.items.length}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-white/5">
        <div className="text-[11px] text-[#e8a020] truncate">{genreLabel}</div>
        {slot.genre && (
          <div className="text-[9px] text-gray-600 truncate uppercase tracking-wider">
            {slot.genre.nameEn}
          </div>
        )}
      </div>
    </div>
  );
}

function CrateRow({ crates, isOwner }: { crates: MyDigCrate[]; isOwner: boolean }) {
  if (crates.length === 0) {
    return (
      <p className="text-xs text-gray-600 py-4">
        {isOwner
          ? '크레이트는 나중에 만들 수 있어요.'
          : '크레이트 없음.'}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
      {crates.map((crate) => (
        <CrateBox key={crate.crateId} crate={crate} />
      ))}
    </div>
  );
}

function CrateBox({ crate }: { crate: MyDigCrate }) {
  const firstItem = crate.items[0];
  return (
    <div
      className="aspect-[4/5] rounded-md bg-gradient-to-br from-[#1e1b17] to-[#14110e] border border-white/10 overflow-hidden flex flex-col relative"
      title={crate.description ?? undefined}
    >
      {/* Milk-crate vibe — subtle grid pattern overlay. 3d commit
          will replace this with the full illustration (label tape,
          crate slats, drop-shadow from the "floor"). */}
      <div
        className="flex-1 relative bg-[#0f0d0a]"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '18% 18%',
        }}
      >
        {firstItem ? (
          <CoverArt
            src={firstItem.album.coverArtUrl}
            fallbacks={firstItem.album.coverArtFallbacks}
            alt={firstItem.album.title}
            className="w-full h-full object-cover opacity-85 mix-blend-luminosity"
          />
        ) : null}
        {crate.items.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded tabular-nums">
            {crate.items.length}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-white/5">
        <div className="text-[11px] text-white truncate font-medium">
          {crate.title}
        </div>
      </div>
    </div>
  );
}
