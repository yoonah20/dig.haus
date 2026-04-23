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
import GraffitiSnapshotList from '../components/MyDig/GraffitiSnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
import UserHoverCard from '../components/UserHoverCard';
import FollowButton from '../components/FollowButton';
import FollowListModal from '../components/FollowListModal';
import { useUserPublic } from '../hooks/useMe';
import {
  playPreview,
  stopPreview,
  usePlayingPreviewUrl,
  useStopPreviewOnUnmount,
} from '../hooks/useTrackPreview';
import {
  setActiveWallCellId,
  useActiveWallCellId,
  useClearActiveWallCellOnOutsideTap,
} from '../hooks/useActiveWallCell';
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
  // Stop any preview audio playing when the user navigates away
  // from the mydig page.
  useStopPreviewOnUnmount();

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
  // "기억 남기기" surfaces SnapshotSaveModal directly against the
  // live wall — no editing detour. Available on live mode only;
  // snapshot mode keeps the 편집 / 🗑 pair.
  const [savingSnapshot, setSavingSnapshot] = useState(false);

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
      if (it.album) {
        wallByPosition.set(it.position, {
          position: it.position,
          album: it.album,
          // Forward the server-joined userReview so snapshot hovers
          // render the same bubble the live wall does. null cases
          // fall through as undefined which matches MyDigWallItem's
          // optional `userReview` shape.
          userReview: it.userReview ?? undefined,
        });
      }
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
    } catch (err: any) {
      // Surface the server error text so regressions (e.g. FK
      // cascade, missing column after a half-applied migration)
      // show up in the alert instead of a generic "failed" toast.
      console.error('[mydig/snapshots] delete failed:', err);
      const serverError =
        err?.response?.data?.error ??
        err?.response?.statusText ??
        err?.message ??
        '알 수 없는 오류';
      alert(`스냅샷 삭제 실패: ${serverError}`);
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
          // Snapshots reuse the wall-description slot so the
          // subtitle renders the same way whether the viewer is on
          // a live wall or an archived snapshot.
          wallDescription={
            isSnapshotMode
              ? snap?.description ?? null
              : data.vinylWallDescription
          }
          // Snapshot mode carries its own meta line (date + public
          // flag) on top of the description.
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
          onDeleteSnapshot={handleDeleteSnapshot}
          deleteSnapshotPending={deleteSnap.isPending}
          shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        />

        {/* Desktop grid: wall at max 890px flush to the left edge of
            the content area, graffiti column takes the remainder.
            The earlier left-gutter column was removed — the wall
            sits a touch left-of-centre, which reads better now that
            the snapshot strip on the right anchors the page's
            visual mass. */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,890px)_minmax(0,1fr)] gap-4 md:gap-8">
          <WallSection>
            {snapLoading ? (
              <div className="text-center py-12 text-sm text-gray-500">
                스냅샷 불러오는 중…
              </div>
            ) : (
              // cellKey scopes the remount to individual LPs only —
              // the VinylWallGrid stays mounted (so the wooden rail
              // SVGs don't re-paint their shadows, which looked like
              // a flicker every swap) but each cell receives a new
              // React key that changes with the active view, which
              // restarts the .album-reveal drop-in animation.
              <VinylWallGrid
                wallByPosition={wallByPosition}
                isOwner={data.user.isOwner}
                emptyHint={isSnapshotMode ? 'snapshot' : 'live'}
                cellKey={activeSlug ?? 'live'}
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
            initialTheme={
              isSnapshotMode && snap
                ? snap.name
                : data.vinylWallTheme
            }
            initialDescription={
              isSnapshotMode && snap
                ? snap.description ?? null
                : data.vinylWallDescription
            }
            initialIsPublic={isSnapshotMode && snap ? snap.isPublic : false}
            initialSnapshotDate={
              isSnapshotMode && snap ? snap.createdAt : null
            }
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
            initialDescription={data.vinylWallDescription ?? null}
            onClose={() => setSavingSnapshot(false)}
            onSaved={() => setSavingSnapshot(false)}
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
  // Live-mode only — opens the snapshot-save modal straight from
  // the header so the owner can capture the current wall without
  // going through the full editor flow.
  onSaveSnapshot: () => void;
  onDeleteSnapshot: () => void;
  deleteSnapshotPending: boolean;
  shareUrl: string;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const displayThemeText = wallTheme || 'my dig';
  const themePlaceholder = !wallTheme;
  const displayLabel = displayName || username;
  // Drive follow-related UI off the shared user-public cache so
  // the counts + follow state stay in sync with the hover card
  // (mutations invalidate 'user-public' globally). The query is
  // gated on userId; visitors on a page whose owner hasn't been
  // resolved yet see no counts until the wall data lands.
  const publicData = useUserPublic(userId, !!userId);
  const followerCount = publicData.data?.stats?.followerCount ?? 0;
  const followingCount = publicData.data?.stats?.followingCount ?? 0;
  const viewerIsFollowing = !!publicData.data?.followingByViewer;
  const [followListOpen, setFollowListOpen] = useState<
    'followers' | 'following' | null
  >(null);
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
      <div className="shrink-0 flex flex-col items-center gap-2.5">
        <div className="relative pb-2">
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
        {/* Follower/following chips are deliberately not rendered
            here while the placement is still being decided. The
            hover card still surfaces the count, and the list modal
            stays wired below so we can re-enable a trigger without
            digging state back out. */}
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
            {/* Single unified 편집 action for both modes. Live opens
                the wall editor (title + description + albums); the
                same editor in snapshot mode edits the snapshot's
                name + description + public flag + albums. The old
                split of 📸 / ✏️ 이름 / ✏️ 앨범 is gone — one
                obvious "edit this thing" button regardless of
                whether the user is looking at the live wall or a
                saved snapshot. */}
            {isOwner && (
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title={
                  mode === 'snapshot'
                    ? '스냅샷 이름·설명·앨범 편집'
                    : '벽 제목·설명·앨범 편집'
                }
              >
                ✏️ 편집
              </button>
            )}
            {isOwner && mode === 'live' && (
              <button
                type="button"
                onClick={onSaveSnapshot}
                className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title="현재 구성을 기억으로 남기기"
              >
                📸 기억 남기기
              </button>
            )}
            {isOwner && mode === 'snapshot' && (
              <button
                type="button"
                onClick={onDeleteSnapshot}
                disabled={deleteSnapshotPending}
                className="text-[11px] text-gray-500 hover:text-red-400 bg-[#1a130a]/40 border border-white/10 hover:border-red-500/40 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="스냅샷 삭제"
              >
                {deleteSnapshotPending ? '삭제 중…' : '🗑 삭제'}
              </button>
            )}
            {/* Follow button — visible to logged-in visitors who
                aren't the page owner. FollowButton renders null
                for the self / anon cases so this is a no-op on
                the owner's own page view. */}
            {!isOwner && userId != null && (
              <FollowButton
                targetUserId={userId}
                following={viewerIsFollowing}
              />
            )}
            <ShareButton url={shareUrl} label="공유" />
          </div>
        </div>

        {/* Subtitle order: description first, then the snapshot
            meta strip (date + public/private). Live mode shows
            description + owner hint only — no meta strip. The date
            is rendered as "YYYY년 M월 D일의 기억" to read as a
            memory tag rather than a timestamp. */}
        {wallDescription ? (
          <p className="text-[13px] text-[#c9a060]/90 leading-relaxed max-w-[640px]">
            {wallDescription}
          </p>
        ) : mode === 'live' && isOwner ? (
          <p className="text-[12px] text-gray-600 italic">
            ✏️ 편집에서 간단한 설명을 추가할 수 있어요.
          </p>
        ) : null}
        {mode === 'snapshot' && snapshotMeta && (
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <span className="uppercase tracking-[0.22em] text-[#c9a060]">
              {formatKoreanMemoryDate(snapshotMeta.createdAt)}
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
        )}
      </div>
      {followListOpen && userId != null && (
        <FollowListModal
          userId={userId}
          kind={followListOpen}
          title={followListOpen === 'followers' ? '팔로워' : '팔로잉'}
          onClose={() => setFollowListOpen(null)}
        />
      )}
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
  cellKey = 'live',
}: {
  wallByPosition: Map<number, MyDigWallItem>;
  isOwner: boolean;
  /** Tweaks the "no items" copy — 'live' speaks to the owner about
   *  filling their wall; 'snapshot' reads as factual since a
   *  visitor/owner can't act on the empty state there. */
  emptyHint?: 'live' | 'snapshot';
  /** When this string changes, every cell's React key flips — the
   *  rail container stays mounted (so the shadow SVG doesn't
   *  flicker), but each LP remounts, which restarts the drop-in
   *  animation on a swap. */
  cellKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Mobile tap-to-activate: tapping outside the grid drops the
  // currently-active cell back to its resting state. Registered
  // at the grid level so every WallCell can share the same
  // outside-tap detection without each one duplicating it.
  useClearActiveWallCellOnOutsideTap(containerRef);
  // Snapshot swaps remount every cell via cellKey but the active
  // id in the module store would otherwise persist, landing on
  // the same position in the new view with no tap. Clearing
  // on cellKey change keeps the active state scoped to one view.
  useEffect(() => {
    setActiveWallCellId(null);
  }, [cellKey]);
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
  // 0..1 range variant for drop-delay seeding — same hash, just
  // without the ±1 centering.
  const variancePositive = (seed: number) => {
    return Math.abs(((seed * 2654435761) >>> 0) % 10000) / 10000;
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
              // Random drop-in delay (0-500ms) seeded off cellKey
              // + position so the pattern stays stable within one
              // view but changes between swaps. Feels like records
              // landing one at a time in no particular order.
              const dropDelay = Math.floor(
                variancePositive(
                  `${cellKey}-${position}`.split('').reduce(
                    (acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0,
                    17
                  )
                ) * 500
              );
              return (
                <CellAnim
                  key={`${cellKey}-${position}`}
                  delayMs={dropDelay}
                  offsetX={jx}
                >
                  {!item ? (
                    <WallLP
                      size={lpSize}
                      seed={position}
                      empty
                      lampBias={lampBias}
                    />
                  ) : (
                    <WallCell
                      item={item}
                      position={position}
                      lpSize={lpSize}
                      lampBias={lampBias}
                      mobile={mobile}
                      offsetX={0}
                    />
                  )}
                </CellAnim>
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

// Per-cell drop-in wrapper. `.album-reveal` animates opacity +
// translateY with `animation-fill-mode: both`, which leaves a
// `transform: translateY(0)` on the element after the animation
// ends — that creates a new stacking context and traps the cell's
// `hover:z-20` below neighbours with their own retained
// transforms. Stripping the class once the animation fires
// `onAnimationEnd` drops the residual transform so the hover-peek
// vinyl disc can actually rise above adjacent covers.
//
// `offsetX` is applied via marginLeft (not transform) for the
// same reason: no stacking context on the static element.
function CellAnim({
  delayMs,
  offsetX,
  children,
}: {
  delayMs: number;
  offsetX: number;
  children: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <div
      className={done ? undefined : 'album-reveal'}
      style={{
        marginLeft: offsetX,
        animationDelay: done ? undefined : `${delayMs}ms`,
      }}
      onAnimationEnd={() => setDone(true)}
    >
      {children}
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
  // Server extracts + stores cover_dominant_color once per album
  // and ships it as a "r,g,b" string on the wall payload. Null on
  // very first view of an album (server kicks off async extraction
  // on that same request); subsequent fetches carry the value.
  const discBodyRgb = parseRgbString(album.coverDominantColor ?? null);
  // Preview URL drives the hover play chip. Null = no chip.
  const previewUrl = album.previewTrackUrl ?? null;
  const playingUrl = usePlayingPreviewUrl();
  const isPlaying = !!previewUrl && playingUrl === previewUrl;
  const handlePreviewClick = (e: React.MouseEvent) => {
    // Don't follow the Link when clicking the chip; just toggle
    // audio. stopPropagation keeps the outer <Link> inert.
    e.preventDefault();
    e.stopPropagation();
    if (!previewUrl) return;
    if (isPlaying) stopPreview();
    else playPreview(previewUrl);
  };
  // Mobile tap-to-activate. First tap on the cell reveals the
  // vinyl peek + comment bubble + play chip; second tap (on the
  // cover) navigates to the album. Shared store means tapping a
  // different cell swaps the active one automatically, so at most
  // one cell is in the "lifted" state at any time.
  const cellId = `cell-${position}`;
  const activeId = useActiveWallCellId();
  const isActive = activeId === cellId;

  if (mobile) {
    const handleMobileTap = (e: React.MouseEvent) => {
      if (!isActive) {
        e.preventDefault();
        setActiveWallCellId(cellId);
      }
      // Already active → fall through; <Link> navigates.
    };
    return (
      <Link
        to={`/album/${target}`}
        title={`${album.artist} — ${album.title}`}
        className={`relative block ${isActive ? 'z-20' : ''}`}
        style={{
          width: lpSize,
          height: lpSize,
          marginLeft: offsetX,
          textDecoration: 'none',
        }}
        onClick={handleMobileTap}
      >
        {/* Vinyl peek — same geometry as the desktop hover state,
            but triggered by the tap-activated `isActive` flag. */}
        <div
          aria-hidden
          className={`absolute inset-0 z-0 origin-bottom transition-transform duration-[280ms] ease-out ${
            isActive ? 'translate-x-[24%] rotate-[6deg] scale-[1.2]' : ''
          }`}
        >
          <VinylDisc size={lpSize} bodyColor={discBodyRgb} />
        </div>
        <div
          className={`absolute inset-0 z-10 origin-bottom transition-transform duration-[280ms] ease-out ${
            isActive ? 'scale-[1.2]' : ''
          }`}
        >
          <WallLP size={lpSize} seed={position} lampBias={lampBias}>
            <CoverArt
              src={album.coverArtUrl}
              fallbacks={album.coverArtFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
          </WallLP>
        </div>
        {userReview && isActive && (
          <CommentBubble
            body={userReview.body}
            emoji={userReview.emoji}
            rating={userReview.rating}
            lpSize={lpSize}
            forceShow
          />
        )}
        {previewUrl && (
          <PreviewPlayChip
            isPlaying={isPlaying}
            onClick={handlePreviewClick}
            trackName={album.previewTrackName ?? null}
            forceShow={isActive}
            lpSize={lpSize}
          />
        )}
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
        <VinylDisc size={lpSize} bodyColor={discBodyRgb} />
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

      {previewUrl && (
        <PreviewPlayChip
          isPlaying={isPlaying}
          onClick={handlePreviewClick}
          trackName={album.previewTrackName ?? null}
          lpSize={lpSize}
        />
      )}
    </Link>
  );
}

// Centered play button over the cover. Sized to be unmissable
// (lpSize · 40%), with a soft dark scrim behind so the glyph
// stays legible against any cover art underneath. Slides in on
// hover (desktop) or tap-activation (mobile); while a track is
// playing the same button turns into the stop glyph and stays
// visible regardless of hover state.
//
// `forceShow` is the mobile path — the parent cell is in its
// tap-activated state and group-hover won't fire on touch. Desktop
// leaves this undefined/false and the group-hover classes take
// over for the reveal.
function PreviewPlayChip({
  isPlaying,
  onClick,
  trackName,
  forceShow = false,
  lpSize,
}: {
  isPlaying: boolean;
  onClick: (e: React.MouseEvent) => void;
  trackName: string | null;
  forceShow?: boolean;
  lpSize: number;
}) {
  const visibilityClasses =
    isPlaying || forceShow
      ? 'opacity-100 scale-100 pointer-events-auto'
      : 'opacity-0 scale-90 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto';

  // Button sizes proportionally to the cover so it reads the
  // same across the 3-col mobile grid and the 5-col desktop grid.
  // 42% of lpSize lands around 60-80px in typical conditions —
  // large enough to be an obvious affordance, small enough to
  // leave the cover identifiable underneath.
  const buttonSize = Math.round(lpSize * 0.42);
  const iconSize = Math.round(buttonSize * 0.42);

  return (
    <div
      aria-hidden={!isPlaying && !forceShow}
      className={`absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-200 ${
        isPlaying || forceShow
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
      }`}
    >
      {/* Scrim: a radial dark wash behind the button so the
          amber glyph keeps contrast against covers that happen
          to have amber / beige tones of their own. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(10,7,3,0.45) 0%, rgba(10,7,3,0.15) 45%, transparent 70%)',
        }}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={
          isPlaying
            ? '미리듣기 정지'
            : trackName
              ? `"${trackName}" 미리듣기`
              : '미리듣기 재생'
        }
        title={
          isPlaying
            ? '정지'
            : trackName
              ? `${trackName} · 미리듣기`
              : '미리듣기'
        }
        style={{ width: buttonSize, height: buttonSize }}
        className={`relative rounded-full bg-[#141008]/85 border-2 border-[#e8a020] text-[#e8a020] flex items-center justify-center shadow-[0_6px_20px_rgba(0,0,0,0.55)] hover:bg-[#e8a020] hover:text-[#141008] transition-all duration-200 cursor-pointer ${visibilityClasses}`}
      >
        {isPlaying ? (
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 12 12"
            aria-hidden
          >
            <rect x="3" y="2.5" width="2.2" height="7" fill="currentColor" rx="0.5" />
            <rect x="6.8" y="2.5" width="2.2" height="7" fill="currentColor" rx="0.5" />
          </svg>
        ) : (
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 12 12"
            aria-hidden
          >
            {/* Slight x-offset so the triangle's optical centre
                aligns with the circle's geometric centre — the
                classic play-button trick. */}
            <path
              d="M3.8 2 L9.6 6 L3.8 10 Z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function CommentBubble({
  body,
  emoji,
  rating,
  lpSize,
  forceShow = false,
}: {
  body: string;
  emoji: string | null;
  rating: string | null;
  lpSize: number;
  // Mobile path: the outer cell is in its tap-activated state and
  // group-hover won't fire on touch. forceShow flips the bubble
  // fully visible without needing :hover on an ancestor.
  forceShow?: boolean;
}) {
  const ratingIcon =
    rating === 'up' ? '👍' : rating === 'down' ? '👎' : null;
  const visibilityClasses = forceShow
    ? 'opacity-100 scale-100'
    : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100';
  return (
    <div
      aria-hidden
      className={`absolute z-40 pointer-events-none transition-all duration-[220ms] ease-out ${visibilityClasses}`}
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

// Server timestamps are UTC ISO strings. Parse + reformat into
// "YYYY년 M월 D일의 기억" using the local (KST for most of this
// audience) calendar date — the snapshot is anchored to the day the
// owner captured it, not the UTC instant. Falls back to the raw
// string if the input can't be parsed so the subtitle never renders
// as a bare "Invalid Date".
// Parse the server's "r,g,b" dominant-colour string into a triple.
// Returns null for null/malformed input; WallCell feeds the result
// straight into VinylDisc's bodyColor prop, which falls back to
// classic black when null.
function parseRgbString(
  s: string | null
): [number, number, number] | null {
  if (!s) return null;
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [clamp(parts[0]), clamp(parts[1]), clamp(parts[2])];
}

function formatKoreanMemoryDate(input: string | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일의 기억`;
}

