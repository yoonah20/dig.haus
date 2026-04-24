import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  useMyDig,
  useVinylWallSnapshots,
  useVinylWallSnapshot,
  useDeleteVinylWallSnapshot,
  type MyDigAlbum,
  type MyDigWallItem,
  type VinylWallSnapshotSummary,
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

// Temporary feature flags — both features are wired end-to-end
// (server extraction, hooks, primitives, payload) but the
// cover-tint extraction and Spotify preview playback paths are
// still misbehaving in practice. Render-side gates keep the UX
// clean while the underlying flow is debugged; flip to true to
// re-enable without touching the rest of the wiring.
const MYDIG_VINYL_TINT_ENABLED = false;
const MYDIG_PREVIEW_ENABLED = false;
// Old "vinyl disc slides out from behind the cover" peek on hover.
// Replaced by the tilt + specular sheen effect; flip back to true to
// restore the original peek animation and drop the shine overlays.
const MYDIG_VINYL_PEEK_ENABLED = false;
// Shrink-wrap overlay (SVG turbulence noise + CSS gradient crease).
// CSS-only rendering never reached "actually looks wrapped in
// plastic" — real plastic needs a raster texture (PNG/WebP with
// baked highlights) to read convincingly. Disabled until we source
// or license a tileable shrink-wrap asset; tilt + specular alone
// carry the hover interaction fine in the interim.
const MYDIG_SHRINKWRAP_ENABLED = false;

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
      {/* pb-24 reserves space under the wall so the last row
          clears the fixed `pinned` SiteFooter overlay when the
          page scrolls. */}
      <main className="max-w-[1280px] mx-auto px-4 pt-4 pb-24 space-y-1">
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

        {/* Mobile-only snapshot dropdown — the sidebar graffiti list
            fell BELOW the wall on narrow viewports and got lost in
            the painted-wall backdrop where the lamp light doesn't
            reach (near-black handwriting on a dim brown field
            reads as invisible). A compact button-style disclosure
            above the wall keeps the entry point discoverable on
            mobile without moving the desktop placement. */}
        {username && (
          <div className="md:hidden">
            <MobileSnapshotsDropdown
              username={username}
              snapshots={snapshotsQuery.data?.snapshots ?? []}
              isOwner={data.user.isOwner}
              activeSlug={activeSlug}
              onSelect={handleSelectSnapshot}
              onClear={handleClearSnapshot}
            />
          </div>
        )}

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
            <div className="hidden md:block">
              <GraffitiSnapshotList
                username={username}
                snapshots={snapshotsQuery.data?.snapshots ?? []}
                isOwner={data.user.isOwner}
                activeSlug={activeSlug}
                onSelect={handleSelectSnapshot}
                onClear={handleClearSnapshot}
              />
            </div>
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
            initialName={data.vinylWallTheme ?? null}
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
    // Two-column header on sm+; stacked on mobile. The display-name
    // chip under the avatar is up to 120px wide — side-by-side with
    // `gap-8` on narrow viewports that chip physically overlapped the
    // theme text. Stacking the block vertically below `sm` keeps the
    // chip from leaking into the title, and the actions cluster then
    // wraps under the title with proper breathing room.
    <header className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8 pt-2 pb-3">
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

// ─── Mobile snapshot dropdown ─────────────────────────────────
// Sits above the wall on mobile in place of the desktop sidebar
// graffiti list. Collapsed by default so it doesn't push the
// wall down the page; expanded panel shows the same snapshot
// entries — styled as compact amber chips instead of the
// handwriting treatment the sidebar uses (handwriting reads as
// decoration against the backdrop on desktop; a compact list on
// dark chrome reads clearer on a small screen). Active snapshot
// appears in the collapsed header so the user knows which memory
// is currently loaded without expanding.
function MobileSnapshotsDropdown({
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
  const [open, setOpen] = useState(false);
  const activeSnap = activeSlug
    ? snapshots.find((s) => s.slug === activeSlug)
    : null;
  const label = activeSnap ? activeSnap.name : '현재 마이딕';
  const empty = snapshots.length === 0;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-[#1a130a]/60 border border-white/10 text-[13px] text-gray-200 hover:border-[#e8a020]/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 shrink-0">
            기억
          </span>
          <span className="truncate text-[#f5d89a]">{label}</span>
        </span>
        <span
          aria-hidden
          className={`text-gray-500 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded-md bg-[#0f0a05]/85 border border-white/10 divide-y divide-white/5 overflow-hidden">
          {/* Back-to-live row when viewing a snapshot. Mirrors the
              "← 현재 마이딕으로…" affordance from the desktop list
              but as a plain button row for mobile. */}
          {activeSlug && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[13px] text-[#e8a020] hover:bg-[#e8a020]/10"
            >
              ← 현재 마이딕으로
            </button>
          )}
          {empty ? (
            <div className="px-3 py-2 text-[12px] text-gray-500 italic">
              {isOwner
                ? '아직 기억하지 않았어요. 📸 버튼으로 남겨보세요.'
                : '아직 기억하지 않았어요.'}
            </div>
          ) : (
            snapshots.map((snap) => {
              const isActive = activeSlug === snap.slug;
              const suffix = isOwner && !snap.isPublic ? ' (비공개)' : '';
              return (
                <button
                  type="button"
                  key={snap.id}
                  onClick={() => {
                    onSelect(snap.slug);
                    setOpen(false);
                  }}
                  disabled={isActive}
                  className={`w-full text-left px-3 py-2 text-[13px] ${
                    isActive
                      ? 'text-[#e8a020] bg-[#e8a020]/5 cursor-default'
                      : 'text-gray-200 hover:bg-white/5'
                  }`}
                >
                  {snap.name}
                  {suffix && (
                    <span className="text-[11px] text-gray-500 ml-1.5">
                      {suffix}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
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
// One filled slot. Desktop: hover scales the sleeve up 1.4× and
// applies a cursor-tracked 3D tilt + specular streak — the
// "shrink-wrapped LP catching pendant light" read, inspired by
// simeydotme/pokemon-cards-css. Mobile: tap-activate scales up
// without tilt (no cursor on touch). Comment bubble + (when
// enabled) preview chip surface on the active cell either way.
// The vinyl disc behind the cover is kept in the tree but no
// longer peeks on hover — the tilt + shine carry the interaction
// now. Flip MYDIG_VINYL_PEEK_ENABLED back to true to restore.
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
  // Gated by MYDIG_VINYL_TINT_ENABLED — when off, every disc renders
  // classic black regardless of what the server returns.
  const discBodyRgb = MYDIG_VINYL_TINT_ENABLED
    ? parseRgbString(album.coverDominantColor ?? null)
    : null;
  // Preview URL drives the hover play chip. Null = no chip. Gated
  // by MYDIG_PREVIEW_ENABLED so the chip + audio stay dormant even
  // when the payload carries a URL.
  const previewUrl = MYDIG_PREVIEW_ENABLED ? album.previewTrackUrl ?? null : null;
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

  // Cursor-tracked tilt + lamp-anchored specular — written to CSS
  // custom properties on the card element via a plain ref (no
  // React state per-pixel; mousemove fires every frame and
  // setState would thrash).
  //
  // - `--tilt-x` / `--tilt-y` : 3D transform. Cursor drives these
  //   directly, ±7°.
  // - `--spec-x` / `--spec-y` : specular centre. Cursor does NOT
  //   drive these directly; we anchor the shine near the scene's
  //   upper-left pendant (22%, 18%) and slide it INVERSE to the
  //   cursor. Physically: tilting the sleeve to the right rolls
  //   the lamp reflection leftwards across the plastic; tilting
  //   the top toward the viewer sends the reflection downward.
  //   That "reflection lagging behind the tilt" is what reads as
  //   shrink-wrap rather than flat card.
  const cardRef = useRef<HTMLAnchorElement>(null);
  const handleCursorMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const tiltY = (nx - 0.5) * 14;
    const tiltX = -(ny - 0.5) * 14;
    // Base near mid-upper, with wide inverse travel so the shine
    // can sweep across roughly 70% × 55% of the sleeve as the
    // cursor moves. Earlier anchoring to (22%, 18%) trapped the
    // highlight in the upper-left corner — a real shrink-wrapped
    // sleeve tilted under a lamp has the reflection travelling
    // much further across the surface as it pivots.
    const specX = 50 - (nx - 0.5) * 70;
    const specY = 38 - (ny - 0.5) * 55;
    el.style.setProperty('--tilt-x', `${tiltX}deg`);
    el.style.setProperty('--tilt-y', `${tiltY}deg`);
    el.style.setProperty('--spec-x', `${specX}%`);
    el.style.setProperty('--spec-y', `${specY}%`);
  };
  const handleCursorLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--spec-x', '50%');
    el.style.setProperty('--spec-y', '38%');
  };

  // Upgrade the wall cover to the 500px tier before handing it to
  // CoverArt. Derived once per render so mobile + desktop paths
  // reuse the same URL set.
  const wallCoverUrl = upgradeWallCoverUrl(album.coverArtUrl);
  const wallCoverFallbacks = upgradeWallCoverFallbacks(album.coverArtFallbacks);

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
        {MYDIG_VINYL_PEEK_ENABLED && (
          // Vinyl peek — same geometry as the desktop hover state,
          // triggered by the tap-activated `isActive` flag. Behind
          // the feature flag so it can be reinstated alongside the
          // disc color work without untangling the new shine pass.
          <div
            aria-hidden
            className={`absolute inset-0 z-0 origin-bottom transition-transform duration-[280ms] ease-out ${
              isActive ? 'translate-x-[24%] rotate-[6deg] scale-[1.2]' : ''
            }`}
          >
            <VinylDisc size={lpSize} bodyColor={discBodyRgb} />
          </div>
        )}
        <div
          className={`absolute inset-0 z-10 origin-bottom transition-transform duration-[280ms] ease-out ${
            isActive ? 'scale-[1.4]' : ''
          }`}
        >
          <WallLP size={lpSize} seed={position} lampBias={lampBias}>
            <CoverArt
              src={wallCoverUrl}
              fallbacks={wallCoverFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
          </WallLP>
          {/* Static shine — no cursor on touch, so the tap state
              just lights up a fixed diagonal sweep across the
              sleeve to signal "selected". */}
          <div
            aria-hidden
            className={`absolute inset-0 pointer-events-none transition-opacity duration-[280ms] ${
              isActive ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              background:
                'linear-gradient(125deg, rgba(255,245,220,0.35) 0%, rgba(255,245,220,0.08) 24%, transparent 55%)',
              mixBlendMode: 'overlay',
            }}
          />
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
      ref={cardRef}
      to={`/album/${target}`}
      title={`${album.artist} — ${album.title}`}
      className="group relative block hover:z-20"
      onMouseMove={handleCursorMove}
      onMouseLeave={handleCursorLeave}
      style={{
        width: lpSize,
        height: lpSize,
        marginLeft: offsetX,
        textDecoration: 'none',
        // Perspective on the anchor lets the child 3D transforms
        // actually show depth rather than flattening into a 2D
        // skew. 900px is mild — tighter values exaggerate the
        // tilt to the point of looking gimmicky.
        perspective: '900px',
      }}
    >
      {MYDIG_VINYL_PEEK_ENABLED && (
        // Vinyl disc peek — kept around the feature flag so the
        // old "disc slides out to the right" animation can be
        // revived without restructuring WallCell. Hidden flush
        // behind the cover while the flag is off.
        <div
          aria-hidden
          className="absolute inset-0 z-0 origin-bottom transition-transform duration-[280ms] ease-out group-hover:translate-x-[24%] group-hover:rotate-[6deg] group-hover:scale-[1.2]"
        >
          <VinylDisc size={lpSize} bodyColor={discBodyRgb} />
        </div>
      )}

      {/* Scale wrapper — lifts the whole card 1.4× on hover with
          bottom-pinned origin so the sleeve grows upward off the
          rail. Kept separate from the tilt transform so inline
          rotate() doesn't clobber the tailwind scale class. */}
      <div
        className="absolute inset-0 z-10 origin-bottom transition-transform duration-[260ms] ease-out group-hover:scale-[1.4]"
        style={{
          transformOrigin: 'center bottom',
        }}
      >
        {/* Tilt wrapper — reads --tilt-x/--tilt-y set by the
            mousemove handler on the Link above. Short transition
            keeps the follow feel tight without jitter; on leave
            the reset to 0deg eases through the same duration. */}
        <div
          className="w-full h-full transition-transform duration-[140ms] ease-out"
          style={{
            transform:
              'rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg))',
            transformStyle: 'preserve-3d',
            transformOrigin: 'center center',
          }}
        >
          <WallLP size={lpSize} seed={position} lampBias={lampBias}>
            <CoverArt
              src={wallCoverUrl}
              fallbacks={wallCoverFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
          </WallLP>

          {/* Shrink-wrap — two layered passes give the plastic
              its character:
              (a) an SVG `feTurbulence` field crushed to white-ish
                  highlights, which provides the fine ORGANIC
                  wrinkle noise a real stretched plastic has;
              (b) a pair of CSS gradient creases, which give the
                  handful of bold vertical-ish streaks that catch
                  the lamp hardest (the "main wrinkle lines").
              Gated behind MYDIG_SHRINKWRAP_ENABLED — CSS alone
              never convinced; re-enable once we ship a raster
              plastic texture. */}
          {MYDIG_SHRINKWRAP_ENABLED && <>
          <svg
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-70 group-hover:opacity-95 transition-opacity duration-[200ms]"
            style={{
              width: '100%',
              height: '100%',
              // `screen` lightens regardless of base colour, so
              // wrinkle highlights stay visible on dark covers
              // (which overlay would silently swallow — most
              // indie/rock sleeves live in the near-black range).
              mixBlendMode: 'screen',
            }}
            preserveAspectRatio="none"
          >
            <defs>
              {/* baseFrequency X low / Y high → long horizontal
                  cells with tight vertical striation, which is
                  how shrink-wrap actually wrinkles when pulled
                  over a flat sleeve. Color matrix zeroes RGB
                  channels and sets warm-white constants; alpha
                  is ×1.6 − 0.55 so mid-range noise pixels now
                  pass through at 20–50% rather than only the
                  brightest peaks. Combined with `screen` blend
                  this reads as actual stretched plastic catching
                  ambient light, not a faint overlay. */}
              <filter id={`mydig-plastic-${position}`}>
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.018 0.72"
                  numOctaves={2}
                  seed={position * 7 + 13}
                />
                <feColorMatrix
                  values="
                    0 0 0 0 1
                    0 0 0 0 0.97
                    0 0 0 0 0.86
                    0 0 0 1.6 -0.55
                  "
                />
              </filter>
            </defs>
            <rect
              width="100%"
              height="100%"
              filter={`url(#mydig-plastic-${position})`}
            />
          </svg>
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-45 group-hover:opacity-70 transition-opacity duration-[200ms]"
            style={{
              background: [
                `linear-gradient(
                  ${95 + (position % 4)}deg,
                  transparent ${28 + (position % 6)}%,
                  rgba(255,250,235,0.07) ${31 + (position % 6)}%,
                  transparent ${35 + (position % 6)}%,
                  transparent ${64 + (position % 5)}%,
                  rgba(255,250,235,0.055) ${67 + (position % 5)}%,
                  transparent ${71 + (position % 5)}%
                )`,
              ].join(','),
              mixBlendMode: 'overlay',
            }}
          />
          </>}

          {/* Lamp-anchored specular — bright warm halo seated near
              the upper-left pendant at rest, sliding INVERSE to the
              cursor so the reflection appears to "roll" across the
              plastic as the sleeve tilts. Visible at 25% even at
              rest so the shine anchor reads as the ambient lamp
              wash; lifts to 1.0 on hover when the viewer is
              actively playing with the card. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-25 group-hover:opacity-100 transition-opacity duration-[220ms]"
            style={{
              background:
                'radial-gradient(circle at var(--spec-x,22%) var(--spec-y,18%), rgba(255,245,220,0.6) 0%, rgba(255,245,220,0.32) 18%, rgba(255,245,220,0.12) 38%, transparent 62%)',
              mixBlendMode: 'overlay',
            }}
          />

          {/* Fixed rim streak — thin diagonal highlight anchored
              to the scene's upper-left pendant. Present at rest so
              the sleeve never reads flat; lifts on hover to join
              the moving specular for a layered shine pass. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-35 group-hover:opacity-85 transition-opacity duration-[220ms]"
            style={{
              background:
                'linear-gradient(125deg, rgba(255,230,185,0.3) 0%, rgba(255,230,185,0.08) 18%, transparent 42%)',
              mixBlendMode: 'screen',
            }}
          />
        </div>
      </div>

      {userReview && (
        <CommentBubble
          body={userReview.body}
          emoji={userReview.emoji}
          rating={userReview.rating}
          lpSize={lpSize}
          placement="right"
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
  placement = 'top',
}: {
  body: string;
  emoji: string | null;
  rating: string | null;
  lpSize: number;
  // Mobile path: the outer cell is in its tap-activated state and
  // group-hover won't fire on touch. forceShow flips the bubble
  // fully visible without needing :hover on an ancestor.
  forceShow?: boolean;
  // Desktop hover now scales the sleeve 1.4× from its bottom-centre
  // origin, which means the scaled cover grows ~20% past its
  // original top + sides. A top-placed bubble lands inside that
  // new top strip and gets visually eaten. `placement: 'right'`
  // offsets the bubble past the scaled-out right edge instead so
  // the hover interaction stays clean. Mobile keeps 'top' (no hover
  // scale to dodge) so the bubble sits above the cell, centred.
  placement?: 'top' | 'right';
}) {
  const ratingIcon =
    rating === 'up' ? '👍' : rating === 'down' ? '👎' : null;
  const visibilityClasses = forceShow
    ? 'opacity-100 scale-100'
    : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100';
  // `right` placement needs to clear the 1.4× scale overflow on
  // the right edge (0.2·lpSize), then add a small breathing gap.
  const rightOffsetPx = Math.round(lpSize * 0.22 + 8);
  const outerStyle: React.CSSProperties =
    placement === 'right'
      ? {
          left: `calc(100% + ${rightOffsetPx}px)`,
          top: '50%',
          transform: 'translateY(-50%)',
          transformOrigin: '0 50%',
          width: 'max-content',
          maxWidth: Math.min(260, lpSize * 1.3),
        }
      : {
          bottom: 'calc(100% + 12px)',
          left: '50%',
          transform: 'translateX(-50%)',
          transformOrigin: '50% 100%',
          width: 'max-content',
          maxWidth: Math.min(260, lpSize * 1.5),
        };
  return (
    <div
      aria-hidden
      className={`absolute z-40 pointer-events-none transition-all duration-[220ms] ease-out ${visibilityClasses}`}
      style={outerStyle}
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
        {placement === 'right' ? (
          // Classic CSS-border triangle pointing left toward the
          // cover. Cleaner than the rotated-square clipPath trick
          // the top placement uses — no shadow bleed on the edges
          // facing away from the sleeve.
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: -6,
              marginTop: -6,
              width: 0,
              height: 0,
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderRight: '6px solid #f5e8c8',
              filter: 'drop-shadow(-2px 2px 2px rgba(0,0,0,0.35))',
            }}
          />
        ) : (
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
        )}
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
// Cover Art Archive exposes `/front-250`, `/front-500`, `/front-1200`
// and full-size variants of every sleeve. Server-side storage uses
// front-250 for the home grid / album page where sleeves render at
// ~120–200px. The mydig wall renders at up to 168px and scales 1.4×
// on hover (~235px effective), which turns front-250 sources into
// visibly soft upscales. Upgrading to front-500 on the client side —
// only for the wall — keeps home grid bandwidth untouched while the
// hovered wall stays crisp. Non-CAA hosts (Spotify 640, Last.fm
// originals, admin custom covers) are already large enough and pass
// through unchanged.
function upgradeWallCoverUrl(url: string | null): string | null {
  if (!url) return url;
  if (!url.includes('coverartarchive.org/')) return url;
  return url.replace('/front-250', '/front-500');
}
function upgradeWallCoverFallbacks(urls: string[] | undefined): string[] | undefined {
  if (!urls || urls.length === 0) return urls;
  return urls.map((u) => upgradeWallCoverUrl(u) ?? u);
}

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

