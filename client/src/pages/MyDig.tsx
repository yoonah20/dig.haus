import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useMyDig,
  useVinylWallSnapshots,
  type MyDigWallItem,
  type MyDigShelfSlot,
  type MyDigCrate,
} from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
import SnapshotSaveModal from '../components/MyDig/SnapshotSaveModal';
import SnapshotList from '../components/MyDig/SnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
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
// Vinyl Wall rows: 5-5-5 = 15 slots on three rails. Earlier trim
// to 10 (5-5) was a workaround for a layout bug where the second
// row was landing on the baseboard because ShopScene was a
// fixed-ratio box that sliced its own interior into wall vs
// floor. The real fix is to drop the box (no more wall/floor
// boundary), which means there's no boundary to clip against
// anymore and all three rails fit naturally.
const WALL_ROW_SIZES = [5, 5, 5] as const;

const SHELF_BIN_COUNT = 6;

export default function MyDig() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, error } = useMyDig(username);
  const [editingWall, setEditingWall] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const snapshotsQuery = useVinylWallSnapshots(username);

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
          onSaveSnapshot={() => setSavingSnapshot(true)}
          shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        />

        {/* Tier 1 — Vinyl Wall. Three rails (5-5-5 = 15) sitting
            on a soft ambient page background. No bordered container,
            no floor / baseboard bands — the wall flows straight
            out of the profile header above and out to the snapshot
            list below. */}
        <WallSection>
          <VinylWallGrid
            wallByPosition={wallByPosition}
            isOwner={data.user.isOwner}
          />
        </WallSection>

        {/* Snapshot archive — horizontal strip of past walls. Owner
            sees private + public; visitors see only public. Each
            card links into /my/:username/snap/:slug. The whole
            strip hides itself when there are no snapshots to show. */}
        {username && (
          <SnapshotList
            username={username}
            snapshots={snapshotsQuery.data?.snapshots ?? []}
            isOwner={data.user.isOwner}
          />
        )}

        {editingWall && username && (
          <VinylWallEditor
            username={username}
            initialWall={data.vinylWall}
            onClose={() => setEditingWall(false)}
          />
        )}

        {savingSnapshot && username && (
          <SnapshotSaveModal
            username={username}
            onClose={() => setSavingSnapshot(false)}
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
  onSaveSnapshot,
  shareUrl,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  onEdit: () => void;
  onSaveSnapshot: () => void;
  shareUrl: string;
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
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.2em] text-[#e8a020]">
            · open ·
          </span>
          {isOwner && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                ✏️ 편집
              </button>
              <button
                type="button"
                onClick={onSaveSnapshot}
                className="text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title="현재 벽을 스냅샷으로 저장"
              >
                📸 스냅샷
              </button>
            </>
          )}
          <ShareButton url={shareUrl} label="공유" />
        </div>
      </div>
    </header>
  );
}

// ─── Wall section ─────────────────────────────────────────────
// Previously this was a fixed-ratio "shop scene" — bordered panel
// with explicit wall/floor bands, baseboard, plank seams, pendant
// overlays. Three problems stacked up: (1) the box read as a
// framed container on an otherwise full-bleed dark page, breaking
// the "융화" feel; (2) the wall-vs-floor boundary lived at a %
// split of the container height, so records in the third row got
// clipped by the fake baseboard whenever content outgrew the
// pre-set ratio; (3) the lamp overlays doubled up on the per-LP
// lampBias that WallLP already applies and read as over-staged.
//
// This version keeps just the ambient atmosphere and drops every
// piece of scene chrome: no border, no background box, no floor
// band, no baseboard line, no plank seams. The only non-content
// element is a soft warm radial wash pinned to the upper-left so
// the page still reads as "lit from somewhere." Records on rails
// extend whatever vertical distance they need — no boundary to
// clip against because there isn't a boundary anymore.
function WallSection({ children }: { children: React.ReactNode }) {
  return (
    <section style={{ position: 'relative', padding: '16px 8px' }}>
      {/* Ambient warmth — single very-soft radial, no blend mode.
          Just nudges the upper-left toward a lit-interior feel
          without the hard pool shape the old overlays had. The
          rest of the mood comes from each WallLP's internal
          lampBias-driven highlight + drop shadow. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -40,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 60% 55% at 32% 25%, rgba(255, 196, 110, 0.09) 0%, transparent 65%)',
        }}
      />
      <div style={{ position: 'relative' }}>{children}</div>
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
