import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMyDig, type MyDigWallItem, type MyDigShelfSlot, type MyDigCrate } from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
import { WallLP, WallRail } from '../components/MyDig/storefront/primitives';
import { resolveApiUrl } from '../utils/apiUrl';

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

// Vinyl Wall rows: 5-5-5 = 15 slots, equal cover sizes. Reverted
// from the short-lived 5-5-6-6 experiment — the late-night pendant
// scene reads cleaner with three symmetric rows framing the lamp
// pool on all sides, and 22 slots squeezed covers narrower on
// mobile than the shopfront aesthetic wanted.
const WALL_ROW_SIZES = [5, 5, 5] as const;

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

  // Wall items come back sparse (position → item). Build a dense
  // 15-element array with nulls for the empty-frame render.
  const wallByPosition = new Map<number, MyDigWallItem>();
  for (const it of data.vinylWall) wallByPosition.set(it.position, it);

  // Shelf slots come back sparse too — fill 6 bins, null where
  // admin hasn't assigned a genre yet.
  const shelfByPosition = new Map<number, MyDigShelfSlot>();
  for (const s of data.shelf) shelfByPosition.set(s.position, s);

  return (
    <div className="flex-1" style={{ background: '#0a0503' }}>
      <main className="max-w-[1120px] mx-auto px-4 py-8 space-y-6">
        {/* Hybrid profile header: avatar block + display name block.
            Sits OUTSIDE the shop scene below — lets visitors see who
            they're visiting before the scene's late-night immersion
            takes over. Kept to a single quiet row so the header
            doesn't fight the lamp-pool drama. */}
        <ProfileHeader
          username={data.user.username}
          displayName={data.user.displayName}
          avatarUrl={data.user.avatarUrl}
          isOwner={data.user.isOwner}
          onEdit={() => setEditingWall(true)}
        />

        {/* Tier 1 — Vinyl Wall inside a late-night shop scene. Dark
            warm wall, pendant lamp pool upper-center-left, floor +
            baseboard below. Records glow where the pool hits;
            edges fade into warm shadow. */}
        <ShopScene>
          <VinylWallGrid
            wallByPosition={wallByPosition}
            isOwner={data.user.isOwner}
          />
        </ShopScene>

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

// ─── Profile header ────────────────────────────────────────────
// Avatar + name block that sits above the shop scene. Avatar is a
// circle portrait; right column stacks the @username breadcrumb,
// the italic-serif display name, and a warm amber "open" indicator
// that matches the dig.haus accent colour elsewhere.
function ProfileHeader({
  username,
  displayName,
  avatarUrl,
  isOwner,
  onEdit,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  onEdit: () => void;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const name = displayName || username;
  const showHandle =
    !!displayName && displayName.toLowerCase() !== username.toLowerCase();
  return (
    <header className="flex items-center gap-4 pt-2 pb-4">
      <div className="shrink-0">
        {resolvedAvatar ? (
          <img
            src={resolvedAvatar}
            alt=""
            aria-hidden
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border border-white/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#1a1410] border border-white/10 flex items-center justify-center">
            <span className="text-2xl sm:text-3xl text-[#e8a020]/70 font-serif italic">
              {initial}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {showHandle && (
          <div className="text-[11px] text-gray-500 tracking-wider">
            @{username}
          </div>
        )}
        <h1
          className="text-2xl sm:text-4xl font-serif italic text-[#f5e8c8] leading-tight truncate"
          title={name}
        >
          {name}
        </h1>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[11px] uppercase tracking-[0.2em] text-[#e8a020]">
            · open ·
          </span>
          {isOwner && (
            <button
              type="button"
              onClick={onEdit}
              className="text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
            >
              ✏️ 편집
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Shop scene ────────────────────────────────────────────────
// Immersive dark-mode container that wraps whatever tier is
// rendered as "the view" — right now just Vinyl Wall. Composition
// (bottom-to-top layers):
//   1. Near-black scene base (#0a0503)
//   2. Wall panel with subtle vertical plank seams + grain noise
//   3. The tier content (records on rails)
//   4. Baseboard band + floor strip at the bottom
//   5. Pendant lamp "darkening" overlay (multiply) — vignettes the
//      corners toward near-black
//   6. Pendant lamp "warmth" overlay (screen) — paints the tungsten
//      pool over the upper-center-left, brightening what's under it
//   7. A few dust motes inside the pool for atmosphere
// The two lamp overlays together produce the "lighting provides
// depth" behaviour the brief asked for: records at edges fade,
// records under the pool glow. No per-slot lighting logic needed
// at the WallLP level.
function ShopScene({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#0a0503',
        minHeight: 420,
      }}
    >
      {/* 1. Wall backdrop — matte dark warm paint on wood paneling,
          subtle radial warmth centred under the lamp so the wall
          reads lighter where the pool lands and nearly-black in
          the corners. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          bottom: '16%',
          background: `
            radial-gradient(ellipse 75% 60% at 38% 35%, #3a2818 0%, #241a0f 55%, #130c06 100%)
          `,
        }}
      />

      {/* 2. Vertical plank seams — 6 seams across the wall, thin
          dark lines with a faint cream highlight on one side
          (where the lamp catches the bevel). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          bottom: '16%',
          pointerEvents: 'none',
          opacity: 0.6,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${((i + 1) * 100) / 7}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.25))',
              boxShadow: '1px 0 0 rgba(255, 220, 160, 0.04)',
            }}
          />
        ))}
      </div>

      {/* 3. Tier content — records on rails. Rendered BEFORE the
          lamp overlays so the lighting layer stacks on top of the
          covers and attenuates the edges / lifts the centre. */}
      <div style={{ position: 'relative', zIndex: 1, padding: '32px 16px 0' }}>
        {children}
      </div>

      {/* 4. Baseboard — thin almost-black band where wall meets
          floor; top edge catches a sliver of lamp light. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '16%',
          height: 5,
          background: '#050301',
          boxShadow: 'inset 0 1px 0 rgba(232, 160, 32, 0.18)',
          zIndex: 2,
        }}
      />

      {/* 5. Floor — dark stained walnut with horizontal plank seams
          and a warm spill where the lamp falls. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '16%',
          background: `
            radial-gradient(ellipse 55% 140% at 38% 0%, rgba(90, 55, 22, 0.5) 0%, transparent 60%),
            linear-gradient(180deg, #1a0f08, #0a0503)
          `,
          zIndex: 2,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${(i + 1) * 25}%`,
              height: 1,
              background:
                'linear-gradient(90deg, transparent, rgba(0,0,0,0.55), transparent)',
            }}
          />
        ))}
      </div>

      {/* 6. Lamp pool — DARKENING layer. Multiply blend so dim
          areas (edges) push the scene toward near-black while the
          bright centre (nearly white in the gradient) passes the
          underlying colour through unchanged. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 70% 55% at 38% 32%, rgba(255,255,255,0.98) 0%, rgba(60,40,20,0.85) 45%, rgba(10,5,3,1) 90%)',
          mixBlendMode: 'multiply',
          zIndex: 5,
        }}
      />

      {/* 7. Lamp pool — WARMTH layer. Screen blend with a warm
          tungsten colour so what's inside the pool gets lifted
          toward cream/amber while outside gets no additive effect. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 55% 45% at 38% 30%, rgba(255, 208, 138, 0.32) 0%, rgba(255, 196, 110, 0.12) 40%, transparent 75%)',
          mixBlendMode: 'screen',
          zIndex: 6,
        }}
      />

      {/* 8. Dust motes — a handful of tiny specks scattered across
          the lit area, each a pinprick of warm light. Absolute
          pixel positions work here because the scene width is
          bounded by the surrounding layout (max-w-[1120px]). */}
      <svg
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 7,
          opacity: 0.6,
        }}
      >
        {[
          { x: 180, y: 80, r: 0.8 },
          { x: 260, y: 140, r: 0.5 },
          { x: 340, y: 110, r: 0.6 },
          { x: 420, y: 170, r: 0.5 },
          { x: 200, y: 220, r: 0.7 },
          { x: 370, y: 240, r: 0.5 },
        ].map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill="#ffd08a"
            opacity="0.7"
          />
        ))}
      </svg>
    </section>
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
