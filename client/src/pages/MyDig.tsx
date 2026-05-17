import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMyDig } from '../hooks/useMyDig';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { useDocumentHead } from '../hooks/useDocumentHead';
import UserHoverCard from '../components/UserHoverCard';
import FollowButton from '../components/FollowButton';
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
        />
        {username && <CrateFloor username={username} isOwner={isOwner} />}
      </main>
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────
// One-line signature + follow + share. Significantly slimmer than
// the old graffiti-block ProfileHeader — the floor below is the
// expressive surface now, so the header just sets identity.
function Header({
  username,
  displayLabel,
  userId,
  isOwner,
  viewerLoggedIn,
}: {
  username: string;
  displayLabel: string;
  userId: number | null;
  isOwner: boolean;
  viewerLoggedIn: boolean;
}) {
  const publicData = useUserPublic(userId, !!userId);
  const viewerIsFollowing = !!publicData.data?.followingByViewer;

  const signature =
    userId != null ? (
      <UserHoverCard userId={userId}>
        <span className="cursor-help hover:text-ink transition-colors">
          {displayLabel}의 마이딕
        </span>
      </UserHoverCard>
    ) : (
      <span>{displayLabel}의 마이딕</span>
    );

  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <h1 className="text-[18px] md:text-[22px] text-gray-200 font-semibold">
        {signature}
      </h1>
      <div className="flex items-center gap-2">
        {!isOwner && userId != null && viewerLoggedIn && (
          <FollowButton
            targetUserId={userId}
            following={viewerIsFollowing}
          />
        )}
        {/* Page share moved into the right-column toaster cluster
            inside CrateFloor (2026-05-18) — header stays minimal. */}
      </div>
    </div>
  );
}
