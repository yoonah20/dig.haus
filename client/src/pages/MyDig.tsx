import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  useMyDig,
  useVinylWallSnapshots,
  useVinylWallSnapshot,
  useDeleteVinylWallSnapshot,
  type MyDigAlbum,
  type MyDigWallItem,
} from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
import SnapshotSaveModal from '../components/MyDig/SnapshotSaveModal';
import SnapshotRenameModal from '../components/MyDig/SnapshotRenameModal';
import GraffitiSnapshotList from '../components/MyDig/GraffitiSnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
import UserHoverCard from '../components/UserHoverCard';
import { VinylDisc, WallLP, WallRail } from '../components/MyDig/storefront/primitives';
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

export default function MyDig() {
  const { username, slug: pathSlug } = useParams<{
    username: string;
    slug?: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Active snapshot is taken from either /my/:u/snap/:s (legacy
  // route kept for share-link compatibility) or the #<slug> hash
  // on /my/:u (the canonical shape now that snapshots render
  // in-place instead of a separate page). Hash is URL-encoded at
  // set-time so we decode back here; null means "live wall".
  const hashSlug = location.hash
    ? decodeURIComponent(location.hash.slice(1))
    : null;
  const activeSlug = pathSlug ?? hashSlug;

  const { data, isLoading, error } = useMyDig(username);
  const snapshotsQuery = useVinylWallSnapshots(username);
  const snapshotDetail = useVinylWallSnapshot(
    username,
    activeSlug ?? undefined
  );
  const deleteSnap = useDeleteVinylWallSnapshot(username);

  const [editingWall, setEditingWall] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [editingSnapshotName, setEditingSnapshotName] = useState(false);

  // When a legacy /my/:u/snap/:s URL lands here, rewrite the bar
  // to the in-page hash form so refresh / share / back all operate
  // on the same (cleaner) URL shape.
  useEffect(() => {
    if (pathSlug && username) {
      navigate(`/my/${encodeURIComponent(username)}#${encodeURIComponent(pathSlug)}`, {
        replace: true,
      });
    }
    // username/pathSlug are route params — intentionally not
    // depending on navigate (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathSlug, username]);

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
  // shop aesthetic instead of showing a cold 403/404.
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

  // Snapshot mode: the wall renders that snapshot's captured
  // items (minus any whose album row has since been deleted).
  // Live mode: use the current vinyl_wall_items list.
  const snap = activeSlug ? snapshotDetail.data?.snapshot : null;
  const snapItems = activeSlug ? snapshotDetail.data?.items ?? [] : null;
  const isSnapshotMode = !!snap && !!snapItems;
  const snapLoading = !!activeSlug && snapshotDetail.isLoading;

  const wallByPosition = new Map<number, MyDigWallItem>();
  if (isSnapshotMode) {
    for (const it of snapItems!) {
      if (it.album) wallByPosition.set(it.position, { position: it.position, album: it.album });
    }
  } else {
    for (const it of data.vinylWall) wallByPosition.set(it.position, it);
  }

  const initialWallForEditor: MyDigWallItem[] = isSnapshotMode
    ? (snapItems ?? [])
        .filter((it): it is typeof it & { album: MyDigAlbum } => it.album != null)
        .map((it) => ({ position: it.position, album: it.album }))
    : data.vinylWall;

  const handleSelectSnapshot = (slug: string) => {
    navigate(`#${encodeURIComponent(slug)}`);
  };
  const handleClearSnapshot = () => {
    navigate(location.pathname);
  };
  const handleDeleteSnapshot = async () => {
    if (!snap) return;
    if (deleteSnap.isPending) return;
    if (!confirm(`"${snap.name}" 스냅샷을 삭제할까요? 되돌릴 수 없어요.`))
      return;
    try {
      await deleteSnap.mutateAsync(snap.id);
      // Drop back to the live wall view after a successful delete.
      handleClearSnapshot();
    } catch (err) {
      console.error('[mydig/snapshots] delete failed:', err);
      alert('스냅샷 삭제 실패');
    }
  };

  return (
    <div className="flex-1">
      <main className="max-w-[1280px] mx-auto px-4 pt-4 pb-8 space-y-1">
        <ProfileHeader
          userId={data.user.id ?? null}
          username={data.user.username}
          displayName={data.user.displayName}
          avatarUrl={data.user.avatarUrl}
          isOwner={data.user.isOwner}
          wallTheme={isSnapshotMode ? snap!.name : data.vinylWallTheme}
          wallDescription={
            isSnapshotMode
              ? null
              : data.vinylWallDescription
          }
          // Snapshot mode carries its own meta line (date + public
          // flag); live mode keeps the description subtitle.
          snapshotMeta={
            isSnapshotMode
              ? {
                  createdAt: snap!.createdAt,
                  isPublic: snap!.isPublic,
                }
              : null
          }
          mode={isSnapshotMode ? 'snapshot' : 'live'}
          onEdit={() => setEditingWall(true)}
          onSaveSnapshot={() => setSavingSnapshot(true)}
          onRenameSnapshot={() => setEditingSnapshotName(true)}
          onDeleteSnapshot={handleDeleteSnapshot}
          deleteSnapshotPending={deleteSnap.isPending}
          shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        />

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,890px)_1fr] gap-4 md:gap-8">
          <WallSection>
            {snapLoading ? (
              <div className="text-center py-12 text-sm text-gray-500">
                스냅샷 불러오는 중…
              </div>
            ) : (
              // key on activeSlug triggers a remount when the user
              // swaps between live and any snapshot — the LPs
              // re-animate their drop-in entrance so the swap
              // reads as "records being changed out" instead of a
              // silent content flip.
              <VinylWallGrid
                key={activeSlug ?? 'live'}
                wallByPosition={wallByPosition}
                isOwner={data.user.isOwner}
                emptyHint={isSnapshotMode ? 'snapshot' : 'live'}
              />
            )}
          </WallSection>
          {username && (
            <GraffitiSnapshotList
              username={username}
              snapshots={snapshotsQuery.data?.snapshots ?? []}
              isOwner={data.user.isOwner}
              activeSlug={activeSlug}
              onSelect={handleSelectSnapshot}
              onClear={handleClearSnapshot}
            />
          )}
        </div>

        {editingWall && username && (
          <VinylWallEditor
            username={username}
            initialWall={initialWallForEditor}
            initialTheme={isSnapshotMode ? null : data.vinylWallTheme}
            initialDescription={isSnapshotMode ? null : data.vinylWallDescription}
            target={
              isSnapshotMode && snap
                ? { kind: 'snapshot', id: snap.id, slug: snap.slug }
                : { kind: 'wall' }
            }
            onClose={() => setEditingWall(false)}
          />
        )}

        {savingSnapshot && username && (
          <SnapshotSaveModal
            username={username}
            onClose={() => setSavingSnapshot(false)}
          />
        )}

        {editingSnapshotName && username && snap && (
          <SnapshotRenameModal
            username={username}
            snapshotId={snap.id}
            initialName={snap.name}
            initialIsPublic={snap.isPublic}
            onClose={() => setEditingSnapshotName(false)}
          />
        )}
      </main>
    </div>
  );
}

// ─── Profile header ──────────────────────────────────────────
// Hierarchy on wide viewports:
//   [avatar]  WALL THEME (big italic serif)        [·open· 편집 📸 공유]
//             @username · displayName
//
// Actions (open indicator + owner controls + share) used to sit in a
// third row below the username, which forced the wall to start well
// below the avatar's bottom edge. Moving them into a right-aligned
// cluster on the same line as the title lets the header collapse to
// avatar-height and the wall rail starts ~40–50px higher. On narrow
// viewports the cluster wraps below the title block so none of it
// gets squashed.
function ProfileHeader({
  userId,
  username,
  displayName,
  avatarUrl,
  isOwner,
  wallTheme,
  wallDescription,
  snapshotMeta,
  mode,
  onEdit,
  onSaveSnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
  deleteSnapshotPending,
  shareUrl,
}: {
  userId: number | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  wallTheme: string | null;
  wallDescription: string | null;
  snapshotMeta: { createdAt: string; isPublic: boolean } | null;
  mode: 'live' | 'snapshot';
  onEdit: () => void;
  onSaveSnapshot: () => void;
  onRenameSnapshot: () => void;
  onDeleteSnapshot: () => void;
  deleteSnapshotPending: boolean;
  shareUrl: string;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const displayThemeText = wallTheme || 'my dig';
  const themePlaceholder = !wallTheme;
  const displayLabel = displayName || username;
  const avatarEl = resolvedAvatar ? (
    <img
      src={resolvedAvatar}
      alt=""
      aria-hidden
      className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border border-white/10"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#1a1410] border border-white/10 flex items-center justify-center">
      <span className="text-xl sm:text-2xl text-[#e8a020]/70 font-serif italic">
        {initial}
      </span>
    </div>
  );
  return (
    // Two-column header: avatar block on the left (the @ chip
    // sticks to the portrait's corner, display name reads under
    // it), theme + description + actions fill the right. Kept
    // tight vertically — the header used to eat ~150px with its
    // separate @username line; now the avatar stack carries the
    // identity in about 100px total.
    <header className="flex items-start gap-8 pt-2 pb-3">
      {/* Avatar block — two sticker chips overlap the portrait:
          @username at the top-left as a small amber tag, display
          name across the bottom edge as a darker label that
          straddles the avatar / baseline. Both tilted a few
          degrees so they read as "stuck on" rather than
          baseline-aligned. pb-4 reserves room for the bottom
          chip's overhang so the next row in the header doesn't
          collide with it. */}
      <div className="shrink-0 pb-4">
        <div className="relative">
          {userId != null ? (
            <UserHoverCard userId={userId}>{avatarEl}</UserHoverCard>
          ) : (
            avatarEl
          )}
          <span
            aria-hidden
            className="absolute -top-1.5 -left-2 text-[9px] font-semibold text-[#141008] bg-[#e8a020] px-1.5 py-[1px] rounded-[3px] shadow-sm pointer-events-none select-none"
            style={{ transform: 'rotate(-4deg)' }}
          >
            @{username}
          </span>
          <span
            aria-hidden
            className="absolute -bottom-2 left-1/2 text-[11px] font-medium text-[#f5e8c8] bg-[#1a1410] border border-[#e8a020]/40 px-2 py-[1px] rounded-[3px] shadow-sm pointer-events-none select-none max-w-[120px] truncate"
            style={{ transform: 'translateX(-50%) rotate(-1.5deg)' }}
          >
            {displayLabel}
          </span>
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-1 flex flex-col gap-2">
        {/* Title + actions share a row so the header stays
            compact. Actions push right; on narrow viewports the
            flex-wrap drops them to the next line rather than
            squashing the h1. */}
        <div className="flex items-start gap-3 flex-wrap">
          <h1
            className={`text-xl sm:text-2xl font-serif italic leading-tight truncate flex-1 min-w-0 ${
              themePlaceholder ? 'text-[#c9a860]' : 'text-[#f5d89a]'
            }`}
            title={displayThemeText}
          >
            {displayThemeText}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {isOwner && mode === 'live' && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                  title="벽 제목·설명·앨범 편집"
                >
                  ✏️ 편집
                </button>
                <button
                  type="button"
                  onClick={onSaveSnapshot}
                  className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                  title="현재 벽을 스냅샷으로 저장"
                >
                  📸 스냅샷
                </button>
              </>
            )}
            {isOwner && mode === 'snapshot' && (
              <>
                <button
                  type="button"
                  onClick={onRenameSnapshot}
                  className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                  title="스냅샷 이름 / 공개 여부 수정"
                >
                  ✏️ 이름
                </button>
                <button
                  type="button"
                  onClick={onEdit}
                  className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                  title="스냅샷의 앨범 편집"
                >
                  ✏️ 앨범
                </button>
                <button
                  type="button"
                  onClick={onDeleteSnapshot}
                  disabled={deleteSnapshotPending}
                  className="text-[11px] text-gray-500 hover:text-red-400 bg-[#1a130a]/40 border border-white/10 hover:border-red-500/40 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="스냅샷 삭제"
                >
                  {deleteSnapshotPending ? '삭제 중…' : '🗑 삭제'}
                </button>
              </>
            )}
            <ShareButton url={shareUrl} label="공유" />
          </div>
        </div>

        {/* Subtitle line — description (live mode) or date +
            public/private tag (snapshot mode). Live + empty +
            owner gets a hint pointing at the edit button where
            theme + description + albums all edit together. */}
        {mode === 'snapshot' && snapshotMeta ? (
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <span className="uppercase tracking-[0.22em] text-[#c9a060] tabular-nums">
              {snapshotMeta.createdAt.slice(0, 10)}
            </span>
            <span
              className={
                snapshotMeta.isPublic
                  ? 'uppercase tracking-[0.22em] text-[#e8a020]'
                  : 'uppercase tracking-[0.22em] text-[#8a7250]'
              }
            >
              · {snapshotMeta.isPublic ? 'public' : 'private'}
            </span>
          </div>
        ) : wallDescription ? (
          <p className="text-[13px] text-[#c9a060]/90 leading-relaxed max-w-[640px]">
            {wallDescription}
          </p>
        ) : isOwner ? (
          <p className="text-[12px] text-gray-600 italic">
            ✏️ 편집에서 간단한 설명을 추가할 수 있어요.
          </p>
        ) : null}
      </div>
    </header>
  );
}


// ─── Wall section ─────────────────────────────────────────────
// Plain wrapper. Previous iterations layered radial lamp pools +
// concrete noise + dust motes here, then an image backdrop with
// scene container; both created visible zone boundaries against
// the rest of the page. Stripping the overlays keeps the whole
// page uniform warm walnut.
function WallSection({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        // Bottom padding also trimmed (was 40px) so the snapshot
        // strip beneath sits closer to the wall without a big
        // dead zone between.
        padding: '4px 12px 12px',
      }}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

// ─── Vinyl Wall grid ──────────────────────────────────────────
// CSS grid with wooden rail under each row. 5 cols × 3 rows on
// desktop, 3 cols × 5 rows on mobile — both cover the full 15
// slots. Container-width-driven via ResizeObserver so the cover
// size + rail width always track the available space cleanly.
function VinylWallGrid({
  wallByPosition,
  isOwner,
  emptyHint = 'live',
}: {
  wallByPosition: Map<number, MyDigWallItem>;
  isOwner: boolean;
  /** Tweaks the "no items" copy — 'live' speaks to the owner about
   *  filling their wall; 'snapshot' reads as factual since a
   *  visitor/owner can't act on the empty state there. */
  emptyHint?: 'live' | 'snapshot';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mobile = width < 520;
  const cols = mobile ? 3 : 5;
  const rowCount = 15 / cols;
  const maxLpSize = mobile ? 128 : 168;
  const gapX = mobile ? 10 : 16;
  const rowGap = mobile ? 24 : 32;
  const overhang = mobile ? 14 : 36;
  const fit = (width - 2 * overhang - (cols - 1) * gapX) / cols;
  const lpSize = Math.max(40, Math.min(maxLpSize, Math.floor(fit)));
  const railWidth = Math.round(width);
  const railHeight = mobile ? 16 : 20;

  const rows = Array.from({ length: rowCount }, (_, ri) => ({
    positions: Array.from({ length: cols }, (_, ci) => ri * cols + ci),
  }));

  // Tiny deterministic pseudo-random so records don't sit on a
  // perfect x-axis. Applied via marginLeft (not transform) so the
  // wrapper isn't a new stacking context and hover:z-20 on the
  // cell can still raise it above its neighbours.
  const variance = (seed: number) => {
    const h = Math.abs(((seed * 2654435761) >>> 0) % 10000) / 10000;
    return h * 2 - 1;
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 890,
        marginLeft: 0,
        marginRight: 'auto',
        paddingTop: 12,
        // Very subtle "painted" post-process so the photographic
        // covers and the SVG rails read as closer siblings of the
        // painted wall backdrop — slight desaturation + softer
        // contrast + tiny brightness knock pull the records out of
        // their photo-crisp look without making them hard to read.
        filter: 'contrast(0.94) saturate(0.88) brightness(0.97)',
      }}
    >
      {rows.map(({ positions }, ri) => (
        <div key={ri} style={{ position: 'relative', marginBottom: rowGap }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, ${lpSize}px)`,
              gap: gapX,
              justifyContent: 'center',
              alignItems: 'end',
            }}
          >
            {positions.map((position, ci) => {
              const item = wallByPosition.get(position);
              const lampBias = 1 - Math.min(1, (ri * cols + ci) / (rowCount * cols));
              const jx = variance(ri * 131 + ci * 17 + 1) * (mobile ? 2 : 4);
              // Stagger the drop-in per cell so swapping between
              // live and a snapshot (which remounts this grid via
              // key=activeSlug in the parent) reads as a wave of
              // records landing one-after-another instead of all 15
              // popping in simultaneously. 30ms × position index
              // → ~420ms spread across the whole wall.
              const dropStyle = {
                marginLeft: jx,
                animationDelay: `${(ri * cols + ci) * 30}ms`,
              };
              if (!item) {
                return (
                  <div
                    key={position}
                    className="album-reveal"
                    style={dropStyle}
                  >
                    <WallLP
                      size={lpSize}
                      seed={position}
                      empty
                      lampBias={lampBias}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={position}
                  className="album-reveal"
                  style={dropStyle}
                >
                  <WallCell
                    item={item}
                    position={position}
                    lpSize={lpSize}
                    lampBias={lampBias}
                    mobile={mobile}
                    offsetX={0}
                  />
                </div>
              );
            })}
          </div>
          {/* Per-row horizontal offset so the three rails don't
              sit in perfectly lined-up positions. Small deltas
              only — the wall still reads as one wall, just with
              the rails clearly not joined seams. */}
          <div
            style={{
              position: 'relative',
              marginTop: 0,
              transform: `translateX(${[0, 10, -5][ri] ?? 0}px)`,
            }}
          >
            <WallRail
              width={railWidth}
              seed={ri * 37 + 13}
              height={railHeight}
              style={{ display: 'block' }}
            />
          </div>
        </div>
      ))}
      {wallByPosition.size === 0 && (
        <p className="text-center text-xs text-gray-600 pt-2">
          {emptyHint === 'snapshot'
            ? '이 스냅샷은 비어 있어요.'
            : isOwner
              ? '아직 벽이 비어 있어요. 편집 버튼으로 앨범을 걸어보세요.'
              : '이 벽은 아직 비어 있어요.'}
        </p>
      )}
    </div>
  );
}

// ─── Wall cell ────────────────────────────────────────────────
// One filled slot. Desktop: hover triggers vinyl-peek + cover
// scale (bottom-origin so the record grows upward from the rail)
// + optional comment bubble on the owner's own 50자 평. Mobile:
// plain tap-to-navigate, no hover state.
function WallCell({
  item,
  position,
  lpSize,
  lampBias,
  mobile,
  offsetX,
}: {
  item: MyDigWallItem;
  position: number;
  lpSize: number;
  lampBias: number;
  mobile: boolean;
  offsetX: number;
}) {
  const { album, userReview } = item;
  const target = album.slug || album.mbid;

  if (mobile) {
    return (
      <Link
        to={`/album/${target}`}
        title={`${album.artist} — ${album.title}`}
        className="relative block"
        style={{
          width: lpSize,
          height: lpSize,
          marginLeft: offsetX,
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
  }

  return (
    <Link
      to={`/album/${target}`}
      title={`${album.artist} — ${album.title}`}
      className="group relative block hover:z-20"
      style={{
        width: lpSize,
        height: lpSize,
        marginLeft: offsetX,
        textDecoration: 'none',
      }}
    >
      {/* Vinyl disc behind the cover — peeks out to the right on
          hover. Scales with the same bottom-center origin as the
          cover so both grow in lockstep from the rail line. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 origin-bottom transition-transform duration-[280ms] ease-out group-hover:translate-x-[24%] group-hover:rotate-[6deg] group-hover:scale-[1.2]"
      >
        <VinylDisc size={lpSize} />
      </div>

      {/* Cover — scales up 1.2× on hover, bottom-pinned so the
          record "grows up" rather than lifting off the rail. */}
      <div className="absolute inset-0 z-10 origin-bottom transition-transform duration-[280ms] ease-out group-hover:scale-[1.2]">
        <WallLP size={lpSize} seed={position} lampBias={lampBias}>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
        </WallLP>
      </div>

      {userReview && (
        <CommentBubble
          body={userReview.body}
          emoji={userReview.emoji}
          rating={userReview.rating}
          lpSize={lpSize}
        />
      )}
    </Link>
  );
}

function CommentBubble({
  body,
  emoji,
  rating,
  lpSize,
}: {
  body: string;
  emoji: string | null;
  rating: string | null;
  lpSize: number;
}) {
  const ratingIcon =
    rating === 'up' ? '👍' : rating === 'down' ? '👎' : null;
  return (
    <div
      aria-hidden
      className="absolute z-40 pointer-events-none opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-[220ms] ease-out"
      style={{
        bottom: 'calc(100% + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        transformOrigin: '50% 100%',
        width: 'max-content',
        maxWidth: Math.min(260, lpSize * 1.5),
      }}
    >
      <div className="relative">
        <div
          className="px-3 py-2 rounded-xl text-[11px] leading-snug font-serif italic"
          style={{
            background: '#f5e8c8',
            color: '#141008',
            boxShadow:
              '0 6px 14px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(20,14,8,0.2)',
          }}
        >
          {body}
          {ratingIcon && <span className="not-italic ml-1.5">{ratingIcon}</span>}
          {emoji && <span className="not-italic ml-1">{emoji}</span>}
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -5,
            marginLeft: -6,
            width: 12,
            height: 12,
            background: '#f5e8c8',
            transform: 'rotate(45deg)',
            boxShadow: '3px 3px 6px rgba(0,0,0,0.3)',
            clipPath: 'polygon(100% 0%, 100% 100%, 0% 100%)',
          }}
        />
      </div>
    </div>
  );
}

