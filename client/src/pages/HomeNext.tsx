import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import HomeNextHero from '../components/Home/HomeNextHero';
import HomeNextHeroMobile from '../components/Home/HomeNextHeroMobile';
import {
  useHomeSnapshots,
  type HomeSnapshot,
} from '../hooks/useHomeSnapshots';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import { useRecentAlbums } from '../hooks/useRecentAlbums';
import AlbumCard from '../components/AlbumCard';
import CoverArt from '../components/CoverArt';
import UserHoverCard from '../components/UserHoverCard';
import { useTapActivate } from '../hooks/useTapActivate';
import { useGridCols, trimToFullRows } from '../hooks/useGridCols';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { resolveApiUrl } from '../utils/apiUrl';
import { formatRelativeKo, parseServerTimestamp } from '../utils/relativeTime';
import type { AlbumSearchResult } from '../types';

// Below this width the desktop hero (asset-driven painted basement
// strip + width-locked LP coordinates) starts to fail — narrow
// viewports clip the painted alley and shrink LPs past readable
// size. Mobile branch swaps to a CSS-simulated concrete wall +
// dynamic SVG rails + 2×5 LP layout instead.
const MOBILE_HERO_BREAKPOINT_PX = 1024;

function useIsMobileHero() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(
      `(max-width: ${MOBILE_HERO_BREAKPOINT_PX - 1}px)`
    );
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// HomeNext is the canonical home composition: operator's storefront
// hero on top, then a single time-ordered activity feed below that
// interleaves three streams — newly registered albums, snapshots, and
// 50자 평. The previous "신보 → 기억 → 평" stacked sections were
// replaced 2026-04-30 because the operator-curated hero already
// front-loaded operator voice; doubling that with a 21-card 신보 grid
// pushed other diggers' activity below the fold. /dig still owns
// the release-date-sorted catalog browse.

// Discriminated union keyed by `kind` — each card type renders from
// its own source data but they all share the createdAt sort key + a
// stable id for React keying. The merge below is type-narrowing on
// `kind`, so all three card components stay strict about their props.
type FeedItem =
  | { kind: 'album'; createdAt: string; key: string; album: AlbumSearchResult }
  | { kind: 'snapshot'; createdAt: string; key: string; snap: HomeSnapshot }
  | { kind: 'review'; createdAt: string; key: string; review: UserReviewFeedItem };

const FEED_SIZE = 30;

export default function HomeNext() {
  useDocumentHead({
    title: 'Home | dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디거들의 활동 피드',
    type: 'website',
  });

  // Per-stream fetch limit matches the merged feed cap so a single
  // stream can fully populate the home feed when its activity
  // outpaces the others. No artificial per-kind throttling — the
  // chronological merge below is the only ordering rule.
  const recentAlbums = useRecentAlbums(true, FEED_SIZE);
  const snapshots = useHomeSnapshots(true, FEED_SIZE);
  const reviews = useUserReviewsFeed(true, FEED_SIZE);
  const isMobile = useIsMobileHero();

  const ACTIVITY_COLS = { base: 2, sm: 3, md: 4, lg: 5, xl: 7 };
  const activityCols = useGridCols(ACTIVITY_COLS);

  // Merge → sort by createdAt DESC → cap at FEED_SIZE. Each source
  // is fetched at FEED_SIZE so the worst-case input is bounded; the
  // cap here is what surfaces on the home grid before the user has
  // to click through to per-stream pages (/dig for albums, the
  // album page for 50자 평).
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    for (const album of recentAlbums.data?.albums ?? []) {
      if (!album.createdAt) continue;
      items.push({
        kind: 'album',
        createdAt: album.createdAt,
        key: `album-${album.mbid}`,
        album,
      });
    }
    for (const snap of snapshots.data?.snapshots ?? []) {
      items.push({
        kind: 'snapshot',
        createdAt: snap.createdAt,
        key: `snap-${snap.id}`,
        snap,
      });
    }
    for (const review of reviews.data?.items ?? []) {
      items.push({
        kind: 'review',
        createdAt: review.createdAt,
        key: `review-${review.id}`,
        review,
      });
    }

    items.sort((a, b) => {
      const ta = parseServerTimestamp(a.createdAt).getTime();
      const tb = parseServerTimestamp(b.createdAt).getTime();
      return tb - ta;
    });

    return items.slice(0, FEED_SIZE);
  }, [recentAlbums.data, snapshots.data, reviews.data]);

  const trimmed = useMemo(
    () => trimToFullRows(feed, activityCols),
    [feed, activityCols]
  );

  const isLoading =
    recentAlbums.isLoading || snapshots.isLoading || reviews.isLoading;

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Hero ───────────────────────────────────────────────────
          Desktop: painted basement strip with LPs sitting on the
          baked shelves. Mobile: concrete wall sim + dynamic SVG
          rails + 2×5 LP layout. isMobile null on first render
          (SSR/hydration safety) — render the desktop hero in
          that brief window since it's the more common case;
          the mobile swap kicks in once matchMedia resolves. */}
      {isMobile ? <HomeNextHeroMobile /> : <HomeNextHero />}

      <div className="bg-[#120c05] px-4 md:px-8 lg:px-12 xl:px-16 pt-12 pb-8">
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-6">
          {!isLoading && trimmed.length > 0 && (
            <section>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${activityCols}, minmax(0, 1fr))`,
                }}
              >
                {trimmed.map((item) => {
                  if (item.kind === 'album') {
                    // Reuse /dig's AlbumCard chrome (sticker stack +
                    // release-date label + price tags). The admin ⚠️
                    // pending badge is suppressed here so the
                    // top-right corner is free for TimeChip — admin
                    // still sees ⚠️ on /dig where TimeChip isn't
                    // shown.
                    return (
                      <div key={item.key} className="relative">
                        <AlbumCard album={item.album} hidePendingBadge />
                        {item.album.createdAt && (
                          <TimeChip iso={item.album.createdAt} />
                        )}
                      </div>
                    );
                  }
                  if (item.kind === 'snapshot') {
                    return <SnapshotMiniCard key={item.key} snap={item.snap} />;
                  }
                  return (
                    <BlurredReviewCard key={item.key} item={item.review} />
                  );
                })}
              </div>
              {/* Catalog browse fallback. The home feed is recency-
                  weighted across three streams and only surfaces
                  FEED_SIZE cards; users who want the full release-
                  date-sorted catalog go to /dig. */}
              <div className="mt-3 text-right">
                <Link
                  to="/dig"
                  className="text-sm text-gray-400 hover:text-[#e8a020] transition-colors"
                >
                  앨범 더 보러가기 →
                </Link>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact avatar shared between the review and snapshot mini
// cards. 18px keeps it readable at the smaller card size without
// dominating the footer line. Falls back to initial-letter when
// no avatar URL is on file or the image 404s.
function MiniAvatar({
  src,
  name,
  size = 18,
}: {
  src: string | null;
  name: string | null;
  size?: number;
}) {
  const resolved = resolveApiUrl(src);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        aria-hidden
        className="rounded-full object-cover shrink-0 border border-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center shrink-0 border border-white/10 font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

// 굿굿 / 별루 / so-so → thumb glyph mirroring CommentTicker's
// rating badge. Kept inline rather than imported from CommentTicker
// because that component is internal and the dependency would be
// brittle.
const RATING_THUMB: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

// Small dark pill anchored top-right of every feed card's cover
// area. Reads as "X분 전" / "어제" — the visible signal that the
// grid is a chronological feed, not a random shuffle.
function TimeChip({ iso }: { iso: string }) {
  const label = formatRelativeKo(iso);
  if (!label) return null;
  return (
    <span
      className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 text-[10px] font-medium text-gray-200 bg-black/60 backdrop-blur-sm rounded-md leading-none pointer-events-none"
      aria-hidden
    >
      {label}
    </span>
  );
}

// Bottom 20% of every activity card — fixed identity strip with
// avatar + username. The full strip is a <Link> to /my/{username}
// (uniform amber on hover), and UserHoverCard is nested inside
// with !flex/!w-full/!h-full so the popover trigger covers the
// strip edge-to-edge instead of leaving inline-flex shrink-to-
// fit gaps that read as darker corners. Anonymous / unclaimed
// accounts (no mydig URL) fall back to a non-clickable plain row.
function AuthorStrip({
  userId,
  mydigUrl,
  avatarSrc,
  displayName,
}: {
  userId: number | null;
  mydigUrl: string | null;
  avatarSrc: string | null;
  displayName: string;
}) {
  const inner = (
    <>
      <MiniAvatar src={avatarSrc} name={displayName} size={20} />
      <span className="text-[12px] text-gray-100 font-medium truncate">
        {displayName}
      </span>
    </>
  );
  const stripBase =
    'flex-[1_1_0%] min-h-0 flex items-center gap-2 pl-2 pr-2.5 border-t border-white/10 bg-black/55 transition-colors';

  if (mydigUrl == null) {
    return <div className={stripBase}>{inner}</div>;
  }

  const trigger =
    userId != null ? (
      <UserHoverCard
        userId={userId}
        className="!flex !w-full !h-full items-center gap-2 cursor-pointer"
      >
        {inner}
      </UserHoverCard>
    ) : (
      inner
    );

  return (
    <Link
      to={mydigUrl}
      aria-label={`${displayName}의 마이딕`}
      className={`${stripBase} hover:bg-[#e8a020]/15 hover:text-[#e8a020]`}
    >
      {trigger}
    </Link>
  );
}

function BlurredReviewCard({ item }: { item: UserReviewFeedItem }) {
  const navigate = useNavigate();
  const isAnon = item.userId == null;
  const displayName = isAnon ? '탈퇴한 사용자' : item.userName || '익명';
  const ratingThumb = item.rating ? RATING_THUMB[item.rating] : null;
  const feelingEmoji = item.emoji;
  const hasBadges = !!(ratingThumb || feelingEmoji);
  const mydigUrl = item.userUsername ? `/my/${item.userUsername}` : null;

  // Touch devices get a two-tap gesture: first tap flips the card
  // to reveal the cover; second tap navigates to the album page.
  // Hover devices keep the normal Link behaviour (instant nav on
  // click, flip on hover).
  const albumHref = `/album/${item.albumSlug}`;
  const tap = useTapActivate({
    cardId: `review-${item.id}`,
    outsideSelector: '.review-card-outer',
  });

  return (
    <div className="review-card-outer group/card relative aspect-square flex flex-col rounded-lg overflow-hidden border border-[#e8a020]/25 hover:border-[#e8a020]/60 transition-colors bg-[#1a1208]">
      <TimeChip iso={item.createdAt} />
      <Link
        to={albumHref}
        className="relative block flex-[4_1_0%] min-h-0"
        style={{ perspective: '1000px' }}
        onTouchStart={tap.handlers.onTouchStart}
        onTouchMove={tap.handlers.onTouchMove}
        onTouchCancel={tap.handlers.onTouchCancel}
        onTouchEnd={(e) =>
          tap.handlers.onTouchEnd(e, () => navigate(albumHref))
        }
        onClick={tap.handlers.onClick}
      >
        <div
          className={`relative w-full h-full [transform-style:preserve-3d] transition-transform duration-500 ease-out group-hover/card:[transform:rotateY(180deg)] ${
            tap.isActive ? '[transform:rotateY(180deg)]' : ''
          }`}
        >
          {/* Front: letterboxed blurred cover + comment. Same
              object-contain treatment as the back face so the
              cover doesn't get top/bottom-cropped on non-square
              art. The blur is heavier here (8 px vs 4) since
              the cover's job up front is to be a colour wash
              behind the comment, not a recognisable image. */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center bg-[#1a1208]"
              style={{ filter: 'blur(8px) saturate(1.1) brightness(0.55)' }}
              aria-hidden
            >
              {item.albumCoverUrl ? (
                <CoverArt
                  src={item.albumCoverUrl}
                  fallbacks={item.albumCoverFallbacks}
                  alt=""
                  className="max-w-full max-h-full w-auto h-auto object-contain"
                />
              ) : (
                <div className="w-full h-full bg-[#1a1208]" />
              )}
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/55" />
            <div className="relative h-full flex items-center px-2.5">
              <p className="text-[12px] md:text-[13px] text-gray-50 font-medium leading-snug line-clamp-4">
                {item.body}
                {hasBadges && (
                  <span className="whitespace-nowrap" aria-hidden>
                    {' '}
                    {ratingThumb && (
                      <span className="leading-none">{ratingThumb}</span>
                    )}
                    {feelingEmoji && (
                      <span className="leading-none">{feelingEmoji}</span>
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Back: full cover with the same 4-px blur the front
              face wears. object-contain keeps the cover from
              being top/bottom-cropped by the square frame; the
              blur stays so the album identity remains a tease
              rather than a giveaway. The flip's payoff is
              "comment fades, cover surfaces" — not "album
              revealed". */}
          <div
            className="absolute inset-0 overflow-hidden bg-[#1a1208] flex items-center justify-center"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            {item.albumCoverUrl && (
              <div
                className="flex items-center justify-center w-full h-full"
                style={{ filter: 'blur(4px) brightness(0.85)' }}
              >
                <CoverArt
                  src={item.albumCoverUrl}
                  fallbacks={item.albumCoverFallbacks}
                  alt=""
                  className="max-w-full max-h-full w-auto h-auto object-contain"
                />
              </div>
            )}
          </div>
        </div>
      </Link>

      <AuthorStrip
        userId={item.userId}
        mydigUrl={mydigUrl}
        avatarSrc={item.userAvatar}
        displayName={displayName}
      />
    </div>
  );
}

function SnapshotMiniCard({ snap }: { snap: HomeSnapshot }) {
  const filledItems = snap.items.filter((it) => it.album != null);
  const total = filledItems.length;
  const visible = filledItems.slice(0, 5);
  const overflow = total - 5;
  const showOverflow = overflow > 0;
  const displayName = snap.user.displayName || snap.user.username;
  const mydigUrl = `/my/${snap.user.username}`;

  // Same 80/20 vertical split as the review card. Top region
  // (snapshot covers + memory name caption) → snapshot detail.
  // Bottom strip (avatar + username) → /my/{username}. Memory
  // name moves into a small caption above the cover grid since
  // the bottom strip is now reserved for identity.
  return (
    <div className="group/card relative aspect-square flex flex-col rounded-lg overflow-hidden border border-violet-400/30 hover:border-violet-400/60 transition-colors bg-[#110b04]">
      <TimeChip iso={snap.createdAt} />
      <Link
        to={`${mydigUrl}/snap/${snap.slug}`}
        className="relative flex-[4_1_0%] min-h-0 flex flex-col gap-1 p-2 hover:[&_.snap-name]:text-[#e8a020]"
      >
        <div className="snap-name text-[13px] text-gray-200 font-medium leading-tight line-clamp-1 transition-colors">
          {snap.name}
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 6 }, (_, i) => {
            if (i < 5) {
              const item = visible[i];
              return (
                <div
                  key={i}
                  className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden"
                >
                  {item?.album?.coverArtUrl && (
                    <CoverArt
                      src={item.album.coverArtUrl}
                      fallbacks={item.album.coverArtFallbacks}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              );
            }
            if (showOverflow) {
              return (
                <div
                  key={i}
                  className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden flex items-center justify-center text-[12px] font-medium text-[#c9a060] tabular-nums"
                  aria-label={`${overflow}개 더`}
                >
                  +{overflow}
                </div>
              );
            }
            return (
              <div
                key={i}
                className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden"
              />
            );
          })}
        </div>
      </Link>

      <AuthorStrip
        userId={snap.user.id}
        mydigUrl={mydigUrl}
        avatarSrc={snap.user.avatarUrl}
        displayName={displayName}
      />
    </div>
  );
}
