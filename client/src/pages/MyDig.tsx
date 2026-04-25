import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import GraffitiSnapshotList, {
  GRAFFITI_FONT_STACK,
} from '../components/MyDig/GraffitiSnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
import UserHoverCard from '../components/UserHoverCard';
import FollowButton from '../components/FollowButton';
import { useUserPublic } from '../hooks/useMe';
import { extractSpotifyAlbumId, useNowPlaying } from '../hooks/useNowPlaying';
import PlayChip from '../components/PlayChip';
import {
  setActiveWallCellId,
  useActiveWallCellId,
  useClearActiveWallCellOnOutsideTap,
} from '../hooks/useActiveWallCell';
import { WallLP, WallRail } from '../components/MyDig/storefront/primitives';

// Spotify preview surface. Re-enabled after the raw-mp3 path was
// retired — wall cells now write to useNowPlaying on ▶ click and
// SiteFooter hosts the resulting Spotify embed in the pinned strip.
// No per-album server lookup needed (we already store spotifyUrl),
// no audio element, no preview_url dependency.
const MYDIG_PREVIEW_ENABLED = true;
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
  // NowPlaying state deliberately persists across route changes —
  // the docked variant in App.tsx keeps the embed alive while the
  // viewer navigates to an album detail, the home feed, etc.
  // Clearing only happens via the strip's × button or when another
  // cover overrides it.

  // Active snapshot is taken from either /my/:u/snap/:s (legacy
  // route kept for share-link compatibility) or the #<slug> hash
  // on /my/:u (the canonical shape now that snapshots render
  // in-place instead of a separate page). Hash is URL-encoded at
  // set-time so we decode back here; null means "live wall".
  const hashSlug = location.hash
    ? decodeURIComponent(location.hash.slice(1))
    : null;
  const activeSlug = pathSlug ?? hashSlug;

  // Mobile matchMedia — scopes the adaptive top-padding below to
  // desktop only. On tablets the (100vh-900px)*X formula was
  // firing and pushing the wall unreasonably far from the nav.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const { data, isLoading, error } = useMyDig(username);
  const snapshotsQuery = useVinylWallSnapshots(username);
  const snapshotDetail = useVinylWallSnapshot(
    username,
    activeSlug ?? undefined
  );
  const deleteSnap = useDeleteVinylWallSnapshot(username);

  // PersistentNowPlayingPlayer is fixed to the viewport bottom (16px
  // offset, ~80px height) and overlays the page when active. On
  // mobile the default pb-8 (32px) is not enough headroom — the last
  // wall row sits behind the player iframe. When the player is
  // active, override with ~140px + safe-area-inset-bottom to clear
  // the player and the iOS home indicator. Called above the early
  // returns below so hook order stays consistent across loading /
  // error / loaded renders.
  const playerActive = !!useNowPlaying();

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
    : data.vinylWall ?? [];

  // First-visit onboarding trigger — shown when the owner lands on
  // their own mydig with nothing placed on the live wall yet.
  // Bare rails without a prompt read as "something broken"; the
  // CTA below walks them into the editor with one click.
  const isOnboardingOwner =
    !isSnapshotMode &&
    data.user.isOwner &&
    data.vinylWall.length === 0;

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
      {/* pb-24 on md+ reserves space under the wall so the last row
          clears the fixed `pinned` SiteFooter overlay when the page
          scrolls. On mobile the footer flows at the end of the
          page, so only a small pb is needed. pt is tight so the
          sidebar action cluster (팔로우 · 공유 etc) sits close to
          the nav; the wall gets its own headroom from WallSection's
          top padding. */}
      <main
        className="max-w-[1400px] mx-auto px-4 md:pl-10 md:pr-4 pt-2 pb-8 md:pb-24 space-y-1"
        style={{
          ...(isMobile
            ? {}
            : { paddingTop: 'max(8px, calc((100vh - 900px) * 0.3))' }),
          ...(isMobile && playerActive
            ? { paddingBottom: 'calc(140px + env(safe-area-inset-bottom))' }
            : {}),
        }}
      >
        {isOnboardingOwner ? (
          // First-visit owner path. No wall, no sidebar, no
          // snapshot dropdown — none of it means anything until
          // there's a wall to see. One big centered CTA drops
          // the user straight into the editor.
          <EmptyWallOnboarding onStart={() => setEditingWall(true)} />
        ) : (
          <>
            {/* Mobile header: same handwritten graffiti block as the
                desktop sidebar, rendered above the wall. Hidden on md+
                since the desktop sidebar below owns it there. */}
            <div className="md:hidden">
              <ProfileHeader
                userId={data.user.id ?? null}
                username={data.user.username}
                displayName={data.user.displayName}
                isOwner={data.user.isOwner}
                wallTheme={isSnapshotMode ? snap!.name : data.vinylWallTheme}
                wallDescription={
                  isSnapshotMode
                    ? snap?.description ?? null
                    : data.vinylWallDescription
                }
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
            </div>

            {/* Mobile-only snapshot dropdown — the sidebar graffiti list
                fell BELOW the wall on narrow viewports and got lost in
                the painted-wall backdrop where the lamp light doesn't
                reach (near-black handwriting on a dim brown field
                reads as invisible). A compact button-style disclosure
                above the wall keeps the entry point discoverable on
                mobile without moving the desktop placement. */}
            {username && (
              <div className="md:hidden w-[60%] ml-auto mt-4">
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
                <div className="hidden md:flex md:flex-col md:gap-6">
                  {/* Desktop sidebar: ProfileHeader stacked on top,
                      GraffitiSnapshotList below. Moving the header
                      here frees ~120px above the wall so the painted
                      backdrop's floor is visible on shorter viewports
                      too. */}
                  <ProfileHeader
                    userId={data.user.id ?? null}
                    username={data.user.username}
                    displayName={data.user.displayName}
                    isOwner={data.user.isOwner}
                    wallTheme={isSnapshotMode ? snap!.name : data.vinylWallTheme}
                    wallDescription={
                      isSnapshotMode
                        ? snap?.description ?? null
                        : data.vinylWallDescription
                    }
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
          </>
        )}

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
// One handwritten graffiti block — signature (displayName의), theme
// as the big painted-wall heading, description underneath, optional
// snapshot date/public strip. Actions cluster sits right-aligned at
// the top.
//
// Earlier versions had a horizontal mobile variant with a portrait
// avatar + amber sticker chips; that path was removed so the mobile
// view uses the same handwritten register as the desktop sidebar.
// The nav bar already carries an avatar on every route, so putting
// another portrait under it read as stacked duplicates.
function ProfileHeader({
  userId,
  username,
  displayName,
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
  const displayThemeText = wallTheme || 'my dig';
  const themePlaceholder = !wallTheme;
  const displayLabel = displayName || username;
  // Drive the FollowButton state off the shared user-public cache
  // so the follow toggle stays in sync with the hover card
  // (mutations invalidate 'user-public' globally). The query is
  // gated on userId; visitors on a page whose owner hasn't been
  // resolved yet see no follow chip until the wall data lands.
  const publicData = useUserPublic(userId, !!userId);
  const viewerIsFollowing = !!publicData.data?.followingByViewer;
  // Non-owner viewers get "팔로우 · 공유"; owner viewers get the
  // edit/snapshot controls instead. Follower/following count chips
  // are gone (they disappeared against the painted-wall backdrop),
  // so FollowButton lives here in the top actions cluster.
  function renderActions() {
    return (
      <>
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
            <span className="hidden md:inline">✏️ </span>편집
          </button>
        )}
        {isOwner && mode === 'live' && (
          <button
            type="button"
            onClick={onSaveSnapshot}
            className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
            title="현재 구성을 기억으로 남기기"
          >
            <span className="hidden md:inline">📸 </span>기억<span className="hidden md:inline"> 남기기</span>
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
            {deleteSnapshotPending ? (
              '삭제 중…'
            ) : (
              <>
                <span className="hidden md:inline">🗑 </span>삭제
              </>
            )}
          </button>
        )}
        {!isOwner && userId != null && (
          <FollowButton
            targetUserId={userId}
            following={viewerIsFollowing}
          />
        )}
        <ShareButton url={shareUrl} label="공유" />
      </>
    );
  }

  // Signature line becomes the hover target for UserHoverCard so
  // the page owner's identity surface (avatar, join date, stats,
  // vote counts) is still reachable without a dedicated person
  // card. Userless fallback stays as plain text.
  const signatureText = `${displayLabel}의`;
  const signatureNode =
    userId != null ? (
      <UserHoverCard userId={userId}>
        <span className="inline-block cursor-help hover:text-[#1a1208] transition-colors">
          {signatureText}
        </span>
      </UserHoverCard>
    ) : (
      <span>{signatureText}</span>
    );

  return (
    <div className="relative min-w-0 pt-[25px] md:pt-[50px]">
      {/* Actions — floated top-right absolutely so the handwritten
          block below starts at the very top of the container and
          the signature shares the same y-band as the action
          chips. Non-owner viewers get [팔로우 공유]; owner viewers
          get [편집 · 기억/삭제 · 공유]. */}
      <div className="absolute top-[15px] right-2 md:right-6 z-10 flex items-center gap-2 flex-wrap justify-end">
        {renderActions()}
      </div>

      {/* Wall signature + info — handwritten register. The
          "{displayName}의" line reads as the wall's signed
          author; the theme follows as the main heading, then
          the description. Hover on the signature opens
          UserHoverCard so the nav-bar identity is still
          accessible without a dedicated person card here. */}
      <div
        className="flex flex-col gap-1.5 px-2 font-bold"
        style={{ fontFamily: GRAFFITI_FONT_STACK }}
      >
        <div className="text-[20px] text-[#3a2818] leading-tight">
          {signatureNode}
        </div>
        <div
          className={`text-[30px] leading-[1.15] ${
            themePlaceholder ? 'text-[#5a4838]' : 'text-[#1a1208]'
          }`}
          title={displayThemeText}
        >
          {displayThemeText}
        </div>
        {wallDescription ? (
          <div className="text-[18px] text-[#3a2818] leading-relaxed pt-1">
            {wallDescription}
          </div>
        ) : mode === 'live' && isOwner ? (
          <div className="text-[15px] text-[#5a4838] italic pt-1 font-normal">
            ✏️ 편집에서 간단한 설명을 추가할 수 있어요.
          </div>
        ) : null}
        {mode === 'snapshot' && snapshotMeta && (
          <div
            className="flex items-center gap-2 flex-wrap text-[11px] pt-1 font-semibold"
            style={{ fontFamily: 'sans-serif' }}
          >
            <span className="uppercase tracking-[0.22em] text-[#1a1208]">
              {formatKoreanMemoryDate(snapshotMeta.createdAt)}
            </span>
            <span
              className={
                snapshotMeta.isPublic
                  ? 'uppercase tracking-[0.22em] text-[#1a1208]'
                  : 'uppercase tracking-[0.22em] text-[#4a2810]'
              }
            >
              · {snapshotMeta.isPublic ? 'public' : 'private'}
            </span>
          </div>
        )}
      </div>
    </div>
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
        // Top padding gives the wall headroom below the nav and,
        // at desktop, aligns the wall's top with the sidebar's
        // handwritten block (ProfileHeader's md:pt-[38px] on
        // main's pt-2). Bottom padding trimmed (was 40px) so the
        // snapshot strip beneath sits closer to the wall without
        // a big dead zone between.
        padding: '38px 12px 12px',
      }}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

// ─── Empty-wall onboarding ────────────────────────────────────
// Owner-only first-visit CTA. Replaces the empty VinylWallGrid so
// the page's first impression is an invitation to start rather
// than a row of empty rails that reads as a loading stub. One
// amber button drops the user straight into the scratch editor;
// everything else lives one level deeper (they can still edit
// title / description after the first albums land).
function EmptyWallOnboarding({ onStart }: { onStart: () => void }) {
  return (
    // pt-[100px] lifts the CTA off the nav by ~100px without
    // forcing a tall container — a min-height added a scrollbar
    // on short viewports.
    <div className="pt-[100px] flex flex-col items-center text-center px-4 gap-6 md:gap-8">
      <div
        className="font-bold"
        style={{ fontFamily: GRAFFITI_FONT_STACK }}
      >
        <div className="text-[38px] md:text-[48px] leading-[1.08] text-[#1a1208]">
          첫 마이딕을
          <br />꾸며보세요
        </div>
        <div className="text-[20px] md:text-[22px] text-[#3a2818] mt-3 md:mt-5 leading-snug">
          좋아하는 앨범 15장으로
          <br className="md:hidden" />
          {' '}벽을 채워요.
        </div>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="mt-2 inline-flex items-center gap-2 text-base md:text-lg font-bold rounded-md px-6 py-3 bg-[#e8a020] text-[#141008] hover:bg-[#f5b030] transition-colors cursor-pointer shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
      >
        지금 시작하기 →
      </button>
    </div>
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
  const maxLpSize = mobile ? 144 : 168;
  const gapX = mobile ? 8 : 16;
  const rowGap = mobile ? 24 : 32;
  const overhang = mobile ? 4 : 36;
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
        // Earlier the container carried a `filter: contrast(0.94)
        // saturate(0.88) brightness(0.97)` to harmonise covers with
        // the painted-wall backdrop. Removed because CSS `filter`
        // establishes a containing block for fixed-position
        // descendants AND a stacking context, which (a) anchored the
        // mobile comment toast to the wall instead of the viewport,
        // and (b) appeared to constrain the visual extent of scaled
        // wall cells on mobile Safari (the active LP's 1.26× scale
        // got cut along the wood-rail line of the row above). If the
        // covers read too photo-crisp against the backdrop now, move
        // the same filter onto each WallLP cover instead — that scope
        // doesn't include the toast portal target or the cell scale
        // overflow, so the bug doesn't come back.
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
// One filled slot. Desktop: hover scales the sleeve up 1.26× and
// applies a cursor-tracked 3D tilt + specular streak — the
// "shrink-wrapped LP catching pendant light" read, inspired by
// simeydotme/pokemon-cards-css. Mobile: tap-activate scales up
// without tilt (no cursor on touch). Comment bubble + (when
// enabled) preview chip surface on the active cell either way.
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
  // Spotify album URL drives the ▶ chip. PlayChip self-resolves
  // visibility + isPlaying from the now-playing store, so we just
  // forward the raw URL and let it decide. Gated by
  // MYDIG_PREVIEW_ENABLED so feature-flagging still works.
  const spotifyUrl = MYDIG_PREVIEW_ENABLED ? album.spotifyUrl ?? null : null;
  const spotifyAlbumId = extractSpotifyAlbumId(spotifyUrl);
  const hasPreview = !!spotifyAlbumId;
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
        <div
          className={`absolute inset-0 z-10 origin-bottom transition-transform duration-[280ms] ease-out ${
            isActive ? 'scale-[1.26]' : ''
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
          {hasPreview && (
            <PlayChip
              albumMbid={album.mbid}
              spotifyUrl={spotifyUrl}
              title={album.title}
              artist={album.artist}
              size={Math.round(lpSize * 0.208)}
              alwaysVisible={isActive}
            />
          )}
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
      {/* Scale wrapper — lifts the whole card 1.26× on hover with
          bottom-pinned origin so the sleeve grows upward off the
          rail. Kept separate from the tilt transform so inline
          rotate() doesn't clobber the tailwind scale class. */}
      <div
        className="absolute inset-0 z-10 origin-bottom transition-transform duration-[260ms] ease-out group-hover:scale-[1.26]"
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
        {/* Play chip lives inside the scale wrapper (as a sibling
            of the tilt wrapper) so it grows with the cover on
            hover. Kept outside the tilt wrapper so the button
            itself stays facing forward rather than rotating with
            the card — that way the triangle icon doesn't skew
            under cursor movement. */}
        {hasPreview && (
          <PlayChip
            albumMbid={album.mbid}
            spotifyUrl={spotifyUrl}
            title={album.title}
            artist={album.artist}
            size={Math.round(lpSize * 0.208)}
          />
        )}
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
    </Link>
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
  // group-hover won't fire on touch. forceShow switches the bubble
  // to a viewport-fixed toast (see early return below) so the
  // rightmost-column case can't push past the viewport edge or get
  // clipped by an ancestor's overflow.
  forceShow?: boolean;
  // Desktop hover scales the sleeve 1.26× from its bottom-centre
  // origin, so the scaled cover grows ~13% past its original top +
  // sides. `placement: 'right'` offsets the bubble past the
  // scaled-out right edge so hover stays clean. `top` is kept for
  // any future caller that wants the centred-above variant.
  placement?: 'top' | 'right';
}) {
  const ratingIcon =
    rating === 'up' ? '👍' : rating === 'down' ? '👎' : null;

  // Mobile tap path — render as a viewport-fixed toast above the
  // persistent player. The previous in-cell bubble approach overflowed
  // the viewport for rightmost-column LPs (cell-relative maxWidth +
  // translateX(-50%) couldn't be clamped to the viewport from inside
  // the cell). 120px clears the 80px Spotify embed + 16px bottom
  // offset + breathing room; safe-area-inset-bottom lifts past the
  // iOS home indicator.
  //
  // Portalled to document.body because the VinylWallGrid container has
  // a CSS filter, which establishes a containing block for fixed-
  // position descendants per spec. Without the portal, `bottom: 120px`
  // anchors to that filter parent rather than the viewport — the toast
  // ended up wherever the filter parent's bottom edge happened to be,
  // so on a scrolled page it disappeared off-screen and "나왔다 안나왔다"
  // looked like a render bug.
  if (forceShow) {
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div
        aria-hidden
        className="fixed left-1/2 z-50 pointer-events-none animate-[fadeInUp_220ms_ease-out]"
        style={{
          bottom: 'calc(120px + env(safe-area-inset-bottom))',
          transform: 'translateX(-50%)',
          width: 'min(360px, calc(100vw - 32px))',
        }}
      >
        <div
          className="px-3.5 py-2.5 rounded-xl text-[12px] leading-snug font-serif italic text-center"
          style={{
            background: '#f5e8c8',
            color: '#141008',
            boxShadow:
              '0 8px 20px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(20,14,8,0.2)',
          }}
        >
          {body}
          {ratingIcon && <span className="not-italic ml-1.5">{ratingIcon}</span>}
          {emoji && <span className="not-italic ml-1">{emoji}</span>}
        </div>
      </div>,
      document.body
    );
  }

  const visibilityClasses =
    'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100';
  // `right` placement needs to clear the 1.26× scale overflow on
  // the right edge (0.13·lpSize), then add a small breathing gap.
  const rightOffsetPx = Math.round(lpSize * 0.15 + 8);
  // `top` placement is the mobile path: the cell scales 1.26× from
  // origin-bottom when active, so the sleeve's top extends up by
  // 0.26·lpSize past the container. The bubble must clear that
  // overflow plus a breathing gap or it lands inside the scaled
  // sleeve's top strip.
  const topOffsetPx = Math.round(lpSize * 0.26 + 12);
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
          bottom: `calc(100% + ${topOffsetPx}px)`,
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

// Cover Art Archive exposes `/front-250`, `/front-500`, `/front-1200`
// and full-size variants of every sleeve. Server-side storage uses
// front-250 for the home grid / album page where sleeves render at
// ~120–200px. The mydig wall renders at up to 168px and scales 1.26×
// on hover (~212px effective), which turns front-250 sources into
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

function formatKoreanMemoryDate(input: string | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일의 기억`;
}

// "가입 YYYY년 M월" label for the person card. Month-precision is
// enough for an identity sidebar — day-level detail reads as
// surveillance for a social surface. Returns empty string on null/
// unparseable so the caller can treat the row as absent.
function formatJoinedMonth(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

