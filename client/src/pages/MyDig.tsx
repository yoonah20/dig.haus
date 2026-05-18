import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMyDig } from '../hooks/useMyDig';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { useDocumentHead } from '../hooks/useDocumentHead';
import UserHoverCard from '../components/UserHoverCard';
import FollowButton from '../components/FollowButton';
import FollowingDropdown from '../components/FollowingDropdown';
import { useUserPublic } from '../hooks/useMe';
import { useAuth } from '../contexts/AuthContext';
import { resolveApiUrl } from '../utils/apiUrl';
import { useNowPlaying } from '../hooks/useNowPlaying';
import CrateFloor from '../components/MyDig/crateFloor/CrateFloor';

// mydig page — crate-floor redesign (2026-05-17). Vinyl wall +
// painted storefront backdrop retired in favour of a single surface:
// the owner's crates lined up at the bottom, the active one's
// records spilled flat on the floor above. Drag re-arranges; drag
// onto another crate adds membership.
//
// The earlier wall + snapshot UI is gone here. Snapshot data still
// lives in the DB (URL-reachable for share-link backwards compat —
// step 3 of the redesign drops it). The legacy /my/:u/snap/:s
// route lands on this page too; for now we rewrite it to the bare
// /my/:u and the visitor sees the live floor.

export default function MyDig() {
  const { username, slug: pathSlug } = useParams<{
    username: string;
    slug?: string;
  }>();
  const navigate = useNavigate();
  const { user: viewer } = useAuth();

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

  const headDisplayName = data?.user.displayName || username || '';
  // og:image still points at the legacy toaster endpoint — the asset
  // is generated from vinyl_wall_items which we no longer render but
  // keep populated. Step 3 rebuilds the toaster on crates, at which
  // point this URL updates with it.
  const ogImagePath = username
    ? `/api/mydig/${encodeURIComponent(username)}/toaster.png`
    : null;
  const ogImageUrl = resolveApiUrl(ogImagePath);
  useDocumentHead({
    title: headDisplayName
      ? `${headDisplayName}의 마이딕 | dig.haus`
      : '마이딕 | dig.haus',
    description: headDisplayName
      ? `${headDisplayName}의 음반 상자 — dig.haus에서 발굴한 추천 앨범`
      : 'dig.haus의 사용자 마이딕',
    url: username ? `https://dig.haus/my/${username}` : undefined,
    image: ogImageUrl,
    type: 'website',
  });

  // Persistent player overlays the viewport bottom; pad to clear it
  // on mobile so the crate bar isn't covered.
  const playerActive = !!useNowPlaying();

  // Legacy /my/:u/snap/:s URLs no longer route to a snapshot view —
  // rewrite to the bare /my/:u path so refresh/share are consistent.
  useEffect(() => {
    if (pathSlug && username) {
      navigate(`/my/${encodeURIComponent(username)}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathSlug, username]);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg">이 페이지를 불러오지 못했어요.</p>
          <Link
            to="/"
            className="text-accent mt-4 inline-block hover:underline"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  const userId = data.user.id ?? null;
  const displayLabel = data.user.displayName || data.user.username;
  const isOwner = !!data.user.isOwner;

  return (
    <div className="flex-1">
      <main
        className="max-w-[1280px] mx-auto px-4 md:px-6 pt-4 pb-8 md:pb-16 space-y-3"
        style={
          isMobile && playerActive
            ? { paddingBottom: 'calc(140px + env(safe-area-inset-bottom))' }
            : undefined
        }
      >
        <Header
          username={data.user.username}
          displayLabel={displayLabel}
          userId={userId}
          isOwner={isOwner}
          viewerLoggedIn={!!viewer}
          viewerId={viewer?.id ?? null}
          avatarUrl={data.user.avatarUrl}
        />
        {username && <CrateFloor username={username} isOwner={isOwner} />}
      </main>
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────
// Avatar on the left, signature + page-user stats stacked on the
// right of it, actions cluster (chip + follow) on the far right.
// Redesigned 2026-05-18: the prior single-line layout read too
// thin against the carpet below it; this version gives the page
// owner's identity visible weight without ballooning into a hero
// strip.
function Header({
  username: _username,
  displayLabel,
  userId,
  isOwner,
  viewerLoggedIn,
  viewerId,
  avatarUrl,
}: {
  username: string;
  displayLabel: string;
  userId: number | null;
  isOwner: boolean;
  viewerLoggedIn: boolean;
  viewerId: number | null;
  avatarUrl: string | null;
}) {
  // Two fetches: page-user (drives follow button + the page-user
  // stats strip), viewer's own (drives the "내 팔로잉" chip count
  // on visitors). When isOwner the two queries dedupe via the
  // same ['user-public', id] key in React Query.
  const pagePublic = useUserPublic(userId, !!userId);
  const viewerPublic = useUserPublic(
    viewerId,
    !!viewerId && viewerId !== userId
  );
  const viewerIsFollowing = !!pagePublic.data?.followingByViewer;
  const viewerFollowingCount = isOwner
    ? (pagePublic.data?.stats.followingCount ?? 0)
    : (viewerPublic.data?.stats.followingCount ?? 0);
  const pageStats = pagePublic.data?.stats;
  const [followingOpen, setFollowingOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const initial = (displayLabel || '?').trim().charAt(0).toUpperCase();

  // Signature — dotted underline at rest as a "hoverable" cue,
  // hover:text-accent for legible hover (the prior hover:text-ink
  // collapsed against the dark mydig bg).
  const signature =
    userId != null ? (
      <UserHoverCard userId={userId}>
        <span className="cursor-help text-gray-100 hover:text-accent underline decoration-dotted decoration-white/15 hover:decoration-accent/50 underline-offset-4 transition-colors">
          {displayLabel}의 마이딕
        </span>
      </UserHoverCard>
    ) : (
      <span>{displayLabel}의 마이딕</span>
    );

  const showFollowingChip =
    viewerLoggedIn && viewerId != null && viewerFollowingCount > 0;

  const openFollowing = () => {
    if (chipRef.current) {
      setAnchorRect(chipRef.current.getBoundingClientRect());
    }
    setFollowingOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-3 md:gap-4 px-2 py-3 rounded-lg bg-panel-strong border border-white/10">
        {/* Avatar — page owner's face. Falls back to an initial chip
            if no avatar is set, same shape as the rest of the app. */}
        <div className="shrink-0">
          {resolvedAvatar ? (
            <img
              src={resolvedAvatar}
              alt=""
              referrerPolicy="no-referrer"
              className="w-12 h-12 md:w-14 md:h-14 rounded-full object-cover border border-white/15"
            />
          ) : (
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-avatar-bg border border-white/15 flex items-center justify-center text-accent text-lg font-semibold">
              {initial}
            </div>
          )}
        </div>
        {/* Title + stats stack. Title size bumps on md+; stats line
            stays a single muted row. */}
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] md:text-[22px] text-gray-100 font-semibold leading-tight">
            {signature}
          </h1>
          {pageStats && (
            <div className="mt-1 text-[12px] text-gray-400 flex items-center gap-x-2 gap-y-1 flex-wrap">
              <span>
                팔로워{' '}
                <span className="tabular-nums text-gray-300">
                  {pageStats.followerCount ?? 0}
                </span>
              </span>
              <span className="text-white/15">·</span>
              <span>
                팔로우{' '}
                <span className="tabular-nums text-gray-300">
                  {pageStats.followingCount ?? 0}
                </span>
              </span>
              <span className="text-white/15">·</span>
              <span>
                등록한 앨범{' '}
                <span className="tabular-nums text-gray-300">
                  {pageStats.submittedAlbumCount ?? 0}
                </span>
              </span>
              <span className="text-white/15">·</span>
              <span>
                박스{' '}
                <span className="tabular-nums text-gray-300">
                  {pageStats.crateCount ?? 0}
                </span>
              </span>
              <span className="text-white/15">·</span>
              <span>
                50자 평{' '}
                <span className="tabular-nums text-gray-300">
                  {pageStats.reviewCount ?? 0}
                </span>
              </span>
            </div>
          )}
        </div>
        {/* Actions — vertical on narrow viewports, inline on md+. */}
        <div className="shrink-0 flex flex-col md:flex-row md:items-center items-end gap-1.5 md:gap-2">
          {showFollowingChip && (
            <button
              ref={chipRef}
              type="button"
              data-following-trigger
              onClick={openFollowing}
              className="text-[11px] text-gray-200 hover:text-accent bg-background/40 border border-white/10 hover:border-accent/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors whitespace-nowrap"
              title="내가 팔로우 중인 디거들"
            >
              <span className="hidden md:inline">🔗 </span>
              내 팔로잉 {viewerFollowingCount}
            </button>
          )}
          {!isOwner && userId != null && viewerLoggedIn && (
            <FollowButton
              targetUserId={userId}
              following={viewerIsFollowing}
            />
          )}
        </div>
      </div>
      {/* Following dropdown — anchored under the chip, lighter
          touch than the full-screen modal it replaced. */}
      {followingOpen && viewerId != null && (
        <FollowingDropdown
          userId={viewerId}
          anchorRect={anchorRect}
          onClose={() => setFollowingOpen(false)}
        />
      )}
    </>
  );
}
