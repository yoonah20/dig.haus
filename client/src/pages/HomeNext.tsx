import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import HomeNextHero from '../components/Home/HomeNextHero';
import HomeNextHeroMobile from '../components/Home/HomeNextHeroMobile';
import AlbumCard from '../components/AlbumCard';
import { SectionTitle } from '../components/ui';
import {
  useHomeSnapshots,
  type HomeSnapshot,
} from '../hooks/useHomeSnapshots';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import { useNavigate } from 'react-router-dom';
import CoverArt from '../components/CoverArt';
import UserHoverCard from '../components/UserHoverCard';
import { useTapActivate } from '../hooks/useTapActivate';
import { useGridCols, trimToFullRows } from '../hooks/useGridCols';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { resolveApiUrl } from '../utils/apiUrl';
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

// HomeNext is a scratch composition for the next iteration of /. The
// live home is a single-viewport storefront wall — visually settled
// but functionally thin (no new-release feed, no activity surfaces).
// This page stitches the storefront wall to the rest of the store so
// scrolling reveals "what's just landed" + "what people remember" +
// "what people are saying" beneath the hero. Once the proportions
// and section transitions feel right, this layout replaces Home.tsx
// and the temp route comes off.

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 30-day window matches the NEW! sticker's recent-release rule on
// AlbumCard. Anything outside the window or with a future
// releaseDate (D-XX pre-orders) gets filtered out client-side
// after the server returns its release_date_desc-sorted page.
const RECENT_DAYS = 30;

function isWithinRecentWindow(
  releaseDate: string | null | undefined
): boolean {
  if (!releaseDate) return false;
  const match = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const ts = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  if (Number.isNaN(ts)) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= RECENT_DAYS;
}

// Fetch a generous slice from the server so the 30-day client
// filter doesn't starve the 21-target render even if the latest
// release_date_desc page is mostly older / future-dated stock.
function useRecentReleases(fetchLimit = 60) {
  return useQuery<AlbumListResponse>({
    queryKey: ['home-next', 'recent-releases', fetchLimit],
    queryFn: async () => {
      const { data } = await axios.get<AlbumListResponse>('/api/albums', {
        params: {
          sort: 'release_date_desc',
          page: 1,
          pageSize: fetchLimit,
        },
      });
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export default function HomeNext() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 신보 + 기억 + 50자 평',
    type: 'website',
  });

  const releases = useRecentReleases(60);
  const snapshots = useHomeSnapshots(true, 14);
  const reviews = useUserReviewsFeed(true, 21);
  const isMobile = useIsMobileHero();

  // Per-section col maps drive the responsive grid + the
  // trim-to-full-rows behaviour below. The 새 앨범 section runs
  // a denser layout that starts at 3 cols on mobile (album cards
  // are smaller / chrome-lighter), the activity sections start
  // at 2 since their square cards need more room to breathe.
  const RELEASE_COLS = { base: 3, sm: 4, md: 5, lg: 6, xl: 7 };
  const ACTIVITY_COLS = { base: 2, sm: 3, md: 4, lg: 5, xl: 7 };
  const releaseCols = useGridCols(RELEASE_COLS);
  const activityCols = useGridCols(ACTIVITY_COLS);

  // Filter to released-and-recent only; cap at 21 (7 cols × 3 rows)
  // matching the unified grid below. Memoised so we don't re-run
  // the filter on every render — the server response is stable
  // across renders most of the time.
  const recentReleased = useMemo(() => {
    const all = releases.data?.albums ?? [];
    return all.filter((a) => isWithinRecentWindow(a.releaseDate)).slice(0, 21);
  }, [releases.data]);

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
        {/* Unified 6-col flow — three card types stacked back-to-
            back with no headings, only their ring colour to
            distinguish:
              · 최신 발매작 → sky (#5aa9e6 family — matches the NEW
                sticker)
              · 요즘 평 → amber (#e8a020 — the brand accent)
              · 새로 남긴 기억 → violet (#b48cdc — added for this
                surface; keeps memories distinct from active
                comment chatter)
            All three grids share the same column count and gap so
            the rows queue up as one continuous "6 across, scrolling
            forever" sheet. Cap counts are tuned so the band of
            each type takes 1–3 rows: releases get the most space
            (3 rows = 18), reviews medium (2 rows = 12), snapshots
            compact (1 row = 6). */}
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-6">
          {/* ── 최신 발매작 (sky ring) ─────────────────────────── */}
          {!releases.isLoading && recentReleased.length > 0 && (
            <section>
              <SectionTitle variant="tape" className="!mb-2">
                새 앨범 파 보기
              </SectionTitle>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${releaseCols}, minmax(0, 1fr))`,
                }}
              >
                {trimToFullRows(recentReleased, releaseCols).map((album) => (
                  <div
                    key={album.mbid}
                    className="rounded-xl ring-1 ring-sky-400/25 hover:ring-sky-400/60 transition-[box-shadow]"
                  >
                    <AlbumCard
                      album={album}
                      hidePendingBadge
                      bigDateSticker
                      showPickSticker
                    />
                  </div>
                ))}
              </div>
              {/* Footer link → /dig for browsing beyond the
                  21-card recency window. mt-1 keeps the link
                  hugging the grid so the section's bottom edge
                  doesn't drift further from the next section
                  than the inter-section gap-10 already gives. */}
              <div className="mt-1 text-right">
                <Link
                  to="/dig"
                  className="text-sm text-gray-400 hover:text-[#e8a020] transition-colors"
                >
                  앨범 더 보러가기 →
                </Link>
              </div>
            </section>
          )}

          {/* ── 새로 남긴 기억 (violet ring) ──────────────────── */}
          {!snapshots.isLoading &&
            (snapshots.data?.snapshots ?? []).length > 0 && (
              <section>
                <SectionTitle variant="tape" className="!mb-2">
                  유저 기억으로 파 보기
                </SectionTitle>
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${activityCols}, minmax(0, 1fr))`,
                  }}
                >
                  {trimToFullRows(
                    (snapshots.data?.snapshots ?? []).slice(0, 14),
                    activityCols
                  ).map((snap) => (
                    <SnapshotMiniCard key={snap.id} snap={snap} />
                  ))}
                </div>
              </section>
            )}

          {/* ── 요즘 평 (amber ring) ──────────────────────────── */}
          {!reviews.isLoading && (reviews.data?.items ?? []).length > 0 && (
            <section>
              <SectionTitle variant="tape" className="!mb-2">
                50자 평으로 파 보기
              </SectionTitle>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${activityCols}, minmax(0, 1fr))`,
                }}
              >
                {trimToFullRows(
                  (reviews.data?.items ?? []).slice(0, 21),
                  activityCols
                ).map((item) => (
                  <BlurredReviewCard key={item.id} item={item} />
                ))}
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

