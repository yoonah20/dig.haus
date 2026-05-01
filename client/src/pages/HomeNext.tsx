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
import { SectionTitle } from '../components/ui';
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

// HomeNext is the canonical home composition. Hero on top, then a
// single "최근 굴착 활동" feed beneath — albums + reviews merged by
// createdAt with no quota or priority weighting (whatever happened
// most recently wins) and rendered in a per-row grid. Snapshots
// are the only stream that gets reserved slots: density adapts to
// viewport — desktop (cols >= 4) pins one snapshot to every row's
// last slot, mobile (cols < 4) thins to one snapshot per 2 rows so
// a 3-cell row doesn't read as half-snapshot. The earlier
// horizontal strip experiment (2026-05-01) was pulled because the
// strip read as visually disconnected from the rest of the page.

// Discriminated union keyed by `kind` — each card type renders from
// its own source data but they all share the createdAt sort key + a
// stable id for React keying.
type FeedItem =
  | { kind: 'album'; createdAt: string; key: string; album: AlbumSearchResult }
  | { kind: 'snapshot'; createdAt: string; key: string; snap: HomeSnapshot }
  | { kind: 'review'; createdAt: string; key: string; review: UserReviewFeedItem };

const FEED_SIZE = 30;

// Split a flat list into rows of fixed size. Last row may be
// shorter, but the feed builder + trimToFullRows currently keeps
// everything to whole rows of `size`.
function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

// Per-cell renderer shared between rows that end with a snapshot
// (custom column template + spacer placeholder) and uniform rows.
// Pulled out so the row map below stays scannable; the union of
// FeedItem variants gets discriminated here.
function renderFeedCell(item: FeedItem) {
  if (item.kind === 'album') {
    // Reuse /dig's AlbumCard chrome (sticker stack + release-date
    // label + price tags). The admin ⚠️ pending badge is suppressed
    // here so the top-right corner is free for TimeChip — admin
    // still sees ⚠️ on /dig where TimeChip isn't shown.
    return (
      <div key={item.key} className="relative">
        <AlbumCard album={item.album} hidePendingBadge />
        {item.album.createdAt && <TimeChip iso={item.album.createdAt} />}
      </div>
    );
  }
  if (item.kind === 'snapshot') {
    return <SnapshotMiniCard key={item.key} snap={item.snap} />;
  }
  return <BlurredReviewCard key={item.key} item={item.review} />;
}

export default function HomeNext() {
  useDocumentHead({
    title: 'Home | dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디거들의 활동 피드',
    type: 'website',
  });

  // Albums + reviews share the chronological merge; snapshots are
  // fetched at a higher limit because one is pinned per row of the
  // grid (the last slot of every row is reserved for the next-most-
  // recent snapshot, padding-falls-back to base items when snapshots
  // run out). 8 covers ~5 rows on the densest 7-col xl layout.
  const recentAlbums = useRecentAlbums(true, FEED_SIZE);
  const snapshots = useHomeSnapshots(true, 8);
  const reviews = useUserReviewsFeed(true, FEED_SIZE);
  const isMobile = useIsMobileHero();

  const ACTIVITY_COLS = { base: 3, sm: 3, md: 4, lg: 5, xl: 7 };
  const activityCols = useGridCols(ACTIVITY_COLS);

  // Plain time-merge — every review and every album the APIs return
  // are pushed in as-is and sorted by createdAt DESC. No quota, no
  // priority weighting, no per-stream cap. Whatever happened most
  // recently wins, full stop. Snapshots are the only stream that
  // gets reserved slots (handled by the row builder below).
  const baseFeed = useMemo<FeedItem[]>(() => {
    const reviewItems: FeedItem[] = (reviews.data?.items ?? []).map(
      (review) => ({
        kind: 'review',
        createdAt: review.createdAt,
        key: `review-${review.id}`,
        review,
      })
    );
    const albumItems: FeedItem[] = (recentAlbums.data?.albums ?? [])
      .filter((a) => a.createdAt)
      .map((album) => ({
        kind: 'album',
        createdAt: album.createdAt as string,
        key: `album-${album.mbid}`,
        album,
      }));

    const items = [...reviewItems, ...albumItems];
    items.sort((a, b) => {
      const ta = parseServerTimestamp(a.createdAt).getTime();
      const tb = parseServerTimestamp(b.createdAt).getTime();
      return tb - ta;
    });

    return items;
  }, [recentAlbums.data, reviews.data]);

  // Snapshot density adapts to viewport width:
  //   • Desktop (cols >= 4) — per-row pinning. Each row's last slot
  //     is reserved for a snapshot, falling back to a base item if
  //     snapshots run out. Wide rows have room for one snapshot
  //     without crowding the album/review stream.
  //   • Mobile (cols < 4) — every-other-row pinning. With only 3
  //     cells per row, per-row pinning reads as half-snapshot/half-
  //     everything-else; thinning to one snap per 2 rows preserves
  //     visibility without dominating the feed.
  const recentSnapshots = snapshots.data?.snapshots ?? [];
  const feed = useMemo<FeedItem[]>(() => {
    const result: FeedItem[] = [];
    const cols = activityCols;
    const perRowSnaps = cols >= 4;
    let bi = 0;
    let si = 0;
    let row = 0;
    while (bi < baseFeed.length && result.length < FEED_SIZE) {
      const isSnapRow = perRowSnaps ? true : row % 2 === 1;
      const baseInRow = isSnapRow ? cols - 1 : cols;
      const startedRow = result.length;
      for (
        let i = 0;
        i < baseInRow && bi < baseFeed.length && result.length < FEED_SIZE;
        i++
      ) {
        result.push(baseFeed[bi++]);
      }
      const filledBase = result.length - startedRow;
      if (filledBase < baseInRow) break; // partial row — drop it
      if (isSnapRow && result.length < FEED_SIZE) {
        if (si < recentSnapshots.length) {
          const snap = recentSnapshots[si++];
          result.push({
            kind: 'snapshot',
            createdAt: snap.createdAt,
            key: `snap-${snap.id}`,
            snap,
          });
        } else if (bi < baseFeed.length) {
          result.push(baseFeed[bi++]);
        } else {
          // Drop the partial snap-row entirely — last cell would
          // otherwise be empty and break the grid template.
          result.length = startedRow;
          break;
        }
      }
      row++;
    }
    return result;
  }, [baseFeed, recentSnapshots, activityCols]);

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
          {/* ── 최근 굴착 활동 ─────────────────────────────────────
              Plain time-merge of newly registered albums + 50자 평,
              sorted by createdAt DESC, capped at FEED_SIZE cells.
              Only snapshots get reserved slots — every row's last
              cell on desktop, every-other-row on mobile. Card types
              are visually distinguished (full AlbumCard chrome /
              blurred-cover review card / 5+1 cover-grid snapshot
              card). */}
          {!isLoading && trimmed.length > 0 && (
            <section>
              {/* digman mascot pairs with the section heading instead
                  of the nav. The tape label reads as a hand-placed
                  marker on a shop counter; the mascot beside it is
                  the shop's "digger" — they share the same crate-
                  digging metaphor so they belong to this section
                  rather than the global chrome. digman_feed.webp
                  is a purpose-cropped head+shoulders icon prepared
                  at its intended display size, so it renders at
                  native pixel dimensions without a CSS crop wrapper
                  — every previous attempt to size or crop the
                  general digman.webp here drifted off the target.
                  Negative margin pulls it inside the h2's gap-3 so
                  the mascot sits visually attached to the tape
                  label rather than floating beside it. */}
              <SectionTitle
                variant="tape"
                className="!mb-3"
                meta={
                  <img
                    src="/textures/digman_feed.webp"
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="block -ml-2 select-none"
                  />
                }
              >
                최근 굴착 활동
              </SectionTitle>
              {/* Row-by-row grids instead of one big auto-flow grid.
                  Rows that end with a snapshot use a custom column
                  template `repeat(cols-1, 1fr) 0.25rem 1fr` — the
                  0.25rem spacer column + grid gap-3 on each side
                  yields ~28px visible separation before the
                  snapshot, vs the 12px gap elsewhere, producing the
                  "6 / 1" read on a 7-col row. The snapshot card
                  itself stays a 1fr cell so its square footprint
                  matches the other cards exactly. Rows without a
                  trailing snapshot use the uniform `repeat(cols,
                  1fr)` template so the spacer doesn't force every
                  row's last cell to feel set-apart. */}
              <div className="flex flex-col gap-3">
                {chunk(trimmed, activityCols).map((row, ri) => {
                  const last = row[row.length - 1];
                  const lastIsSnap =
                    row.length === activityCols && last?.kind === 'snapshot';
                  const head = lastIsSnap ? row.slice(0, -1) : row;
                  return (
                    <div
                      key={ri}
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: lastIsSnap
                          ? `repeat(${activityCols - 1}, minmax(0, 1fr)) 0.25rem minmax(0, 1fr)`
                          : `repeat(${activityCols}, minmax(0, 1fr))`,
                      }}
                    >
                      {head.map(renderFeedCell)}
                      {lastIsSnap && <div aria-hidden />}
                      {lastIsSnap && last && renderFeedCell(last)}
                    </div>
                  );
                })}
              </div>
              {/* Catalog browse fallback. The home feed is recency-
                  weighted and only surfaces FEED_SIZE cards; users
                  who want the full release-date-sorted catalog go
                  to /dig. */}
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

// Square snapshot card for the merged feed grid. Same aspect-square
// footprint as the album / review cards so it slots cleanly into the
// "last cell of every row" pinned position. Title sits *below* the
// 3×2 cover preview rather than above so it doesn't fight the
// top-right TimeChip; rose ring distinguishes the card from album
// (no ring) and review (amber ring) at a glance.
function SnapshotMiniCard({ snap }: { snap: HomeSnapshot }) {
  const filledItems = snap.items.filter((it) => it.album != null);
  const total = filledItems.length;
  const visible = filledItems.slice(0, 5);
  const overflow = total - 5;
  const showOverflow = overflow > 0;
  const displayName = snap.user.displayName || snap.user.username;
  const mydigUrl = `/my/${snap.user.username}`;

  return (
    <div className="group/card relative aspect-square flex flex-col rounded-lg overflow-hidden border border-rose-400/45 hover:border-rose-400/75 transition-colors bg-[#110b04]">
      <TimeChip iso={snap.createdAt} />
      <Link
        to={`${mydigUrl}/snap/${snap.slug}`}
        className="relative flex-[4_1_0%] min-h-0 flex flex-col gap-1.5 p-2 hover:[&_.snap-name]:text-[#e8a020]"
      >
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
        <div className="snap-name text-[12px] text-gray-200 font-medium leading-tight line-clamp-1 transition-colors">
          {snap.name}
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
