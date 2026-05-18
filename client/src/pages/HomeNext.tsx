import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import HomeNextHero from '../components/Home/HomeNextHero';
import HomeNextHeroMobile from '../components/Home/HomeNextHeroMobile';
import { useHomeFeatures, type HomeWall } from '../hooks/useHomeFeatures';
import { GRAFFITI_FONT_STACK } from '../components/MyDig/GraffitiSnapshotList';
import {
  useInfiniteUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import {
  useInfiniteRecentAlbums,
  useRecentReleases,
} from '../hooks/useRecentAlbums';
import AlbumCard, { isRecentRelease } from '../components/AlbumCard';
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

// Hero collapse — the carousel updates rarely (operator-curated
// walls, 1-3 rotations a week at most), so a returning visitor
// might want the page to skip the tall painted strip and jump
// straight to the activity feed. Persisted in localStorage so the
// choice survives reloads; default is expanded so first-time
// visitors still see the carousel as the page's primary surface.
const HERO_COLLAPSED_KEY = 'dig.haus:hero-collapsed';
// Mirrors HomeNextHero / HomeNextHeroMobile's ACTIVE_WALL_STORAGE_KEY.
// Kept as a duplicate constant rather than exporting from the hero
// modules so the collapsed bar can read the last-active wall without
// pulling in the carousel itself.
const ACTIVE_WALL_STORAGE_KEY = 'dig.haus:home-active-wall-idx';

function useHeroCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(HERO_COLLAPSED_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (collapsed) {
      window.localStorage.setItem(HERO_COLLAPSED_KEY, '1');
    } else {
      window.localStorage.removeItem(HERO_COLLAPSED_KEY);
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

// Per-visitor watermark of the last hero curation update the
// visitor has already seen. Compared against the server's
// lastContentUpdateAt so the collapsed bar can show a NEW badge
// only when a real curation change has landed since the visitor's
// last view. First-time visitors (seenAt = null) get the current
// server timestamp written as their baseline so the badge doesn't
// fire on initial arrival — NEW means "different from before",
// not "never seen".
const HERO_SEEN_UPDATE_KEY = 'dig.haus:hero-seen-update-at';

function useHeroSeenUpdate(lastContentUpdateAt: string | null | undefined) {
  const [seenAt, setSeenAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(HERO_SEEN_UPDATE_KEY);
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (seenAt === null && lastContentUpdateAt) {
      window.localStorage.setItem(HERO_SEEN_UPDATE_KEY, lastContentUpdateAt);
      setSeenAt(lastContentUpdateAt);
    }
  }, [seenAt, lastContentUpdateAt]);
  const markSeen = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!lastContentUpdateAt) return;
    window.localStorage.setItem(HERO_SEEN_UPDATE_KEY, lastContentUpdateAt);
    setSeenAt(lastContentUpdateAt);
  }, [lastContentUpdateAt]);
  const hasUpdate =
    !!lastContentUpdateAt && !!seenAt && lastContentUpdateAt > seenAt;
  return { hasUpdate, markSeen, seenAt };
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
// stable id for React keying. The 'snapshot' kind was retired
// 2026-05-17 along with the home-feed snapshot pin (mydig redesign
// no longer surfaces vinyl-wall snapshots — they're DB-only legacy).
type FeedItem =
  | { kind: 'album'; createdAt: string; key: string; album: AlbumSearchResult }
  | { kind: 'review'; createdAt: string; key: string; review: UserReviewFeedItem };

// Page size for the infinite-scroll streams (albums + reviews).
// Each fetchNextPage pulls this many items from each stream; the
// chronological merge happens client-side over all pages. 30 keeps
// the first-paint cost manageable while giving the scroll observer
// roughly five rows of runway before the next page is needed on
// the densest 7-col xl layout.
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

// Per-cell renderer. Pulled out so the row map below stays
// scannable; the union of FeedItem variants gets discriminated here.
function renderFeedCell(item: FeedItem) {
  if (item.kind === 'album') {
    // Reuse /dig's AlbumCard chrome (sticker stack + release-date
    // label + price tags). The admin ⚠️ pending badge is suppressed
    // here so the top-right corner is free for TimeChip — admin
    // still sees ⚠️ on /dig where TimeChip isn't shown.
    //
    // `n=feed` marks the click as originating from the home
    // registered-order feed so the album page resolves prev/next
    // by registration order rather than the default release-date
    // sort — the user expects in-feed-order neighbours when they
    // came in via this surface.
    return (
      <AlbumCard
        key={item.key}
        album={item.album}
        hidePendingBadge
        showPickSticker
        linkSearch="n=feed"
        topRightChip={
          item.album.createdAt ? <TimeChip iso={item.album.createdAt} /> : null
        }
      />
    );
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

  // Albums + reviews are paged via useInfiniteQuery so the feed
  // grows as the visitor scrolls. (Snapshots were pinned into
  // every row's last slot until 2026-05-17 — pulled out with the
  // mydig redesign since snapshots are no longer surfaced anywhere.)
  const recentAlbums = useInfiniteRecentAlbums(true, FEED_SIZE);
  const reviews = useInfiniteUserReviewsFeed(true, FEED_SIZE);
  const recentReleases = useRecentReleases(true, 60);
  const isMobile = useIsMobileHero();
  const [heroCollapsed, setHeroCollapsed] = useHeroCollapsed();
  const { data: homeFeatures } = useHomeFeatures();
  const lastContentUpdateAt = homeFeatures?.lastContentUpdateAt ?? null;
  const { markSeen, seenAt } = useHeroSeenUpdate(lastContentUpdateAt);
  // While the hero is expanded the visitor is looking at the
  // carousel directly — keep their seenAt baseline current so
  // collapsing later doesn't surface a stale NEW badge for content
  // they've already seen on this visit.
  useEffect(() => {
    if (!heroCollapsed && lastContentUpdateAt) {
      markSeen();
    }
  }, [heroCollapsed, lastContentUpdateAt, markSeen]);

  const ACTIVITY_COLS = { base: 3, sm: 3, md: 4, lg: 5, xl: 7 };
  const activityCols = useGridCols(ACTIVITY_COLS);

  // "최근 발매 목록" — release_date_desc fetch from the server,
  // filtered through isRecentRelease (the same 30-day past-only
  // window the NEW sticker uses) so the strip can't drift from the
  // sticker. Row count adapts to viewport: mobile (cols < 4, 3-col
  // grid) gets 3 rows = 9 covers so the strip carries enough visual
  // weight on a narrow viewport, desktop sticks at 2 rows since the
  // wider grid (4-7 cols) already shows 8-14 covers per row pair. If
  // the filtered count is smaller, the trailing grid cells stay
  // empty rather than the section getting hidden — operator
  // decision: heading should always be visible even on the rare
  // empty day.
  const recentReleaseAlbums = useMemo<AlbumSearchResult[]>(() => {
    const all = recentReleases.data?.albums ?? [];
    const rows = activityCols < 4 ? 3 : 2;
    return all
      .filter((a) => isRecentRelease(a.releaseDate))
      .slice(0, activityCols * rows);
  }, [recentReleases.data, activityCols]);

  // Flatten every fetched page from each infinite stream, then plain
  // time-merge. Same merge rule as before — chronological DESC, no
  // quota, no priority weighting. As the visitor scrolls and more
  // pages land, this re-runs and grows the feed.
  const allReviewItems = useMemo<UserReviewFeedItem[]>(
    () => reviews.data?.pages.flatMap((p) => p.items) ?? [],
    [reviews.data]
  );
  const allAlbumItems = useMemo<AlbumSearchResult[]>(
    () => recentAlbums.data?.pages.flatMap((p) => p.albums) ?? [],
    [recentAlbums.data]
  );
  const baseFeed = useMemo<{ albums: FeedItem[]; reviews: FeedItem[] }>(() => {
    const reviewItems: FeedItem[] = allReviewItems.map((review) => ({
      kind: 'review',
      createdAt: review.createdAt,
      key: `review-${review.id}`,
      review,
    }));
    const albumItems: FeedItem[] = allAlbumItems
      .filter((a) => a.createdAt)
      .map((album) => ({
        kind: 'album',
        createdAt: album.createdAt as string,
        key: `album-${album.mbid}`,
        album,
      }));

    // Cap the visible feed at whichever stream's loaded tail is more
    // recent. Without this cap, an admin-batch day (30 albums all on
    // the same date) followed by a sparse-review window produced a
    // long "comment-only" stretch below the batch — reviews page 1
    // covered ~2 weeks while albums page 1 covered ~1 day, so every
    // row below the album tail was reviews-solo until album page 2
    // landed. Items older than the cap stay in cache and surface as
    // soon as the lagging stream pages forward (sentinel triggers
    // fetchNextPage on both streams). hasNextPage=false drops a
    // stream out of the cap so the other can run alone to its end.
    const tailTimeOf = (items: FeedItem[]) =>
      items.length > 0
        ? parseServerTimestamp(items[items.length - 1].createdAt).getTime()
        : Number.NEGATIVE_INFINITY;
    const albumTail = recentAlbums.hasNextPage
      ? tailTimeOf(albumItems)
      : Number.NEGATIVE_INFINITY;
    const reviewTail = reviews.hasNextPage
      ? tailTimeOf(reviewItems)
      : Number.NEGATIVE_INFINITY;
    const cutoff = Math.max(albumTail, reviewTail);

    const keep = (it: FeedItem) =>
      parseServerTimestamp(it.createdAt).getTime() >= cutoff;

    // Preserve each stream's intra-stream chronological order. The
    // row builder below pulls from these two queues with a per-row
    // review cap, so we keep them split rather than merging here.
    return {
      albums: albumItems.filter(keep),
      reviews: reviewItems.filter(keep),
    };
  }, [
    allReviewItems,
    allAlbumItems,
    recentAlbums.hasNextPage,
    reviews.hasNextPage,
  ]);

  const feed = useMemo<FeedItem[]>(() => {
    const result: FeedItem[] = [];
    const cols = activityCols;
    // Per-row review cap. Pure time-merge produced "comment-only"
    // rows whenever a stretch of reviews happened with no album
    // registrations between them — particularly noticeable when one
    // user wrote many reviews in the same week. The cap shifts
    // overflow reviews into the next row(s) (intra-stream order
    // preserved), pulling albums forward to fill the freed cells so
    // the visual mix stays steady. ~33% of base cells per row,
    // floor=1 so the cap never goes to zero on narrow grids.
    const reviewCapPerRow = Math.max(1, Math.ceil(cols / 3));
    const albumQ = [...baseFeed.albums];
    const reviewQ = [...baseFeed.reviews];
    const tsOf = (it: FeedItem) =>
      parseServerTimestamp(it.createdAt).getTime();
    while (albumQ.length + reviewQ.length > 0) {
      const startedRow = result.length;
      let rowReviews = 0;
      let filled = 0;
      while (filled < cols) {
        if (albumQ.length === 0 && reviewQ.length === 0) break;
        let pickAlbum: boolean;
        if (albumQ.length === 0) {
          pickAlbum = false;
        } else if (reviewQ.length === 0) {
          pickAlbum = true;
        } else if (rowReviews >= reviewCapPerRow) {
          pickAlbum = true;
        } else {
          pickAlbum = tsOf(albumQ[0]) >= tsOf(reviewQ[0]);
        }
        if (pickAlbum) {
          result.push(albumQ.shift()!);
        } else {
          result.push(reviewQ.shift()!);
          rowReviews++;
        }
        filled++;
      }
      if (filled < cols) {
        // Couldn't fill the row — drop the partial.
        result.length = startedRow;
        break;
      }
    }
    return result;
  }, [baseFeed, activityCols]);

  const trimmed = useMemo(
    () => trimToFullRows(feed, activityCols),
    [feed, activityCols]
  );

  const isLoading = recentAlbums.isLoading || reviews.isLoading;

  // Infinite-scroll sentinel — when this div enters the viewport
  // (with a 600px rootMargin so prefetch happens before the visitor
  // sees the bottom), trigger fetchNextPage on whichever stream
  // still has more pages. Both streams advance together so the
  // chronological merge stays balanced — fetching only one would
  // skew the feed toward whichever stream got ahead.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (recentAlbums.hasNextPage && !recentAlbums.isFetchingNextPage) {
          recentAlbums.fetchNextPage();
        }
        if (reviews.hasNextPage && !reviews.isFetchingNextPage) {
          reviews.fetchNextPage();
        }
      },
      { rootMargin: '600px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [recentAlbums, reviews]);

  const stillFetchingMore =
    recentAlbums.isFetchingNextPage || reviews.isFetchingNextPage;
  const reachedEnd = !recentAlbums.hasNextPage && !reviews.hasNextPage;

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Hero ───────────────────────────────────────────────────
          Desktop: painted basement strip with LPs sitting on the
          baked shelves. Mobile: concrete wall sim + dynamic SVG
          rails + 2×5 LP layout. isMobile null on first render
          (SSR/hydration safety) — render the desktop hero in
          that brief window since it's the more common case;
          the mobile swap kicks in once matchMedia resolves.
          Collapse toggle wraps both variants so desktop + mobile
          share one preference; the 접기 chip overlays the hero
          when expanded, the CollapsedHeroBar replaces it when
          collapsed (a single-line strip that still names the
          last-viewed wall so the carousel doesn't disappear
          without trace). */}
      {heroCollapsed ? (
        <CollapsedHeroBar
          walls={homeFeatures?.walls ?? []}
          seenAt={seenAt}
          onExpand={() => {
            markSeen();
            setHeroCollapsed(false);
          }}
        />
      ) : (
        <div className="relative">
          {isMobile ? <HomeNextHeroMobile /> : <HomeNextHero />}
          <button
            type="button"
            onClick={() => setHeroCollapsed(true)}
            aria-label="히어로 접기"
            title="히어로 접기"
            className="absolute top-3 right-3 lg:right-auto lg:left-1/2 lg:-translate-x-1/2 z-30 text-[11px] text-gray-200 bg-black/60 hover:bg-black/80 hover:text-white border border-white/15 rounded-full px-2.5 py-1 transition-colors flex items-center gap-1"
          >
            <span aria-hidden>▲</span>
            <span>접기</span>
          </button>
        </div>
      )}

      {/* pt tightens when the hero is collapsed — the strip is short
          enough that pt-12 reads as a deliberate void below it
          instead of breathing room around the painted band. Half
          the gap restores the "the bar is part of the page header"
          read. */}
      <div
        className={`bg-background px-4 md:px-8 lg:px-12 xl:px-16 pb-8 ${
          heroCollapsed ? 'pt-5' : 'pt-12'
        }`}
      >
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-10">
          {/* ── 최근 발매 목록 ─────────────────────────────────────
              Past-only 30-day window keyed off release_date — the
              same gate the NEW sticker on AlbumCard uses, so the
              section is in lockstep with what the cover sticker
              already says is "recently released". Sized to exactly
              two rows of the activity grid (cols × 2) so the strip
              never grows/shrinks past the visual budget the
              operator allocated. Heading stays mounted even when
              the filtered list is empty — operator note: in
              practice there's always something within 30 days, but
              the section is supposed to be a fixture not a
              conditional. */}
          {!recentReleases.isLoading && (
            <section>
              <SectionTitle
                variant="tape"
                className="!mb-3"
                meta={
                  <img
                    src="/textures/digman_excited.webp"
                    alt=""
                    aria-hidden
                    draggable={false}
                    width={80}
                    height={80}
                    className="block -ml-2 select-none"
                    style={{ width: 80, height: 80, maxWidth: 'none' }}
                  />
                }
              >
                최근 발매 목록
              </SectionTitle>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${activityCols}, minmax(0, 1fr))`,
                }}
              >
                {recentReleaseAlbums.map((album) => (
                  <AlbumCard
                    key={album.mbid}
                    album={album}
                    hidePendingBadge
                    showPickSticker
                  />
                ))}
              </div>
            </section>
          )}
          {/* ── 최근 굴착 활동 ─────────────────────────────────────
              Plain time-merge of newly registered albums + 50자 평,
              sorted by createdAt DESC. Streams paginate via
              useInfiniteQuery — IntersectionObserver on the sentinel
              below the grid pages in more rows as the visitor
              scrolls. Only snapshots get reserved slots — every
              row's last cell on desktop, every-other-row on mobile.
              Card types are visually distinguished (full AlbumCard
              chrome / blurred-cover review card / 5+1 cover-grid
              snapshot card). */}
          {!isLoading && trimmed.length > 0 && (
            <section>
              {/* digman mascot pairs with the section heading instead
                  of the nav. The tape label reads as a hand-placed
                  marker on a shop counter; the mascot beside it is
                  the shop's "digger" — they share the same crate-
                  digging metaphor so they belong to this section
                  rather than the global chrome. digman_feed.webp is
                  a 160×160 source rendered at an 80×80 display
                  target (down from 100×100 — at 100 the mascot
                  read as too dominant against the tape-label
                  heading). The 2× downscale lands cleanly on
                  retina screens. Explicit width/height + maxWidth:
                  none locks the size so future asset swaps don't
                  drift the heading row. Negative margin pulls it
                  inside the h2's gap-3 so the mascot sits visually
                  attached to the tape label rather than floating
                  beside it. */}
              <SectionTitle
                variant="tape"
                className="!mb-3"
                meta={
                  <img
                    src="/textures/digman_listening.webp"
                    alt=""
                    aria-hidden
                    draggable={false}
                    width={80}
                    height={80}
                    className="block -ml-2 select-none"
                    style={{ width: 80, height: 80, maxWidth: 'none' }}
                  />
                }
              >
                최근 굴착 활동
              </SectionTitle>
              {/* Uniform row grid. The earlier snapshot-pin special
                  case (custom template + spacer column) went out
                  2026-05-17 along with snapshots themselves. */}
              <div className="flex flex-col gap-3">
                {chunk(trimmed, activityCols).map((row, ri) => (
                  <div
                    key={ri}
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns: `repeat(${activityCols}, minmax(0, 1fr))`,
                    }}
                  >
                    {row.map(renderFeedCell)}
                  </div>
                ))}
              </div>
              {/* Infinite-scroll sentinel. The IntersectionObserver
                  above watches this element and pages in more
                  albums/reviews as the visitor approaches the
                  bottom. The /dig link stays as a "release-date-
                  sorted catalog" alternative — different sort key
                  than the home feed's recency merge, so it's not
                  redundant once paging is automatic. */}
              <div
                ref={sentinelRef}
                aria-hidden
                style={{ height: 1, marginTop: 16 }}
              />
              <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                <span aria-live="polite">
                  {stillFetchingMore
                    ? '더 불러오는 중…'
                    : reachedEnd
                      ? '여기까지'
                      : ''}
                </span>
                <Link
                  to="/dig"
                  className="text-gray-400 hover:text-accent transition-colors"
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

// Collapsed-hero replacement — a single-line strip that rotates
// through the same walls the expanded carousel shows, advancing
// every COLLAPSED_BAR_ADVANCE_MS so the section keeps signalling
// "there's more than one wall here" even when collapsed. Init
// idx comes from sessionStorage written by the carousel (or the
// previous rotation) so opening the page lands on the wall the
// visitor was last looking at; each advance writes back so
// expanding picks up wherever the rotation is. The whole strip
// is the click target — affordance reads as "the bar is the
// button". Per-wall contentUpdatedAt drives the M/D 업데이트
// subtitle; NEW prefixes the date only when that specific wall's
// content has changed since the visitor's seenAt watermark.
//
// Pauses on hover / touch so a visitor reading the current wall's
// theme doesn't get snapped to the next one mid-glance; respects
// prefers-reduced-motion (inert when the OS asks for it).
const COLLAPSED_BAR_ADVANCE_MS = 7500;
function CollapsedHeroBar({
  walls,
  seenAt,
  onExpand,
}: {
  walls: HomeWall[];
  seenAt: string | null;
  onExpand: () => void;
}) {
  const [idx, setIdx] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const raw = window.sessionStorage.getItem(ACTIVE_WALL_STORAGE_KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  // Clamp the stored idx whenever walls.length shrinks (or starts
  // at 0 while data is loading) — keeps the array access below safe
  // without forcing a setIdx render-loop.
  const safeIdx = walls.length > 0 ? idx % walls.length : 0;
  const [paused, setPaused] = useState(false);
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reducedMotion) return;
    if (paused) return;
    if (walls.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((prev) => (prev + 1) % walls.length);
    }, COLLAPSED_BAR_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused, reducedMotion, walls.length]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(ACTIVE_WALL_STORAGE_KEY, String(safeIdx));
  }, [safeIdx]);
  const wall = walls[safeIdx] ?? walls[0];
  const theme = wall?.theme?.trim() || null;
  const wallUpdate = wall?.contentUpdatedAt ?? null;
  const hasUpdate = !!wallUpdate && !!seenAt && wallUpdate > seenAt;
  return (
    <button
      type="button"
      onClick={onExpand}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      aria-label="히어로 펼치기"
      className="relative w-full bg-panel-strong border-b border-white/10 hover:bg-panel-strong/80 transition-colors flex items-center justify-center py-2.5 group/herobar"
    >
      {/* Theme + update info + 펼치기 chevron travel together as a
          single centred cluster — same vertical-centre treatment the
          expanded-state 접기 chip uses at top-center of the hero, so
          the two states' toggle controls share a visual anchor. The
          bar's own click target covers the whole row so the off-
          centre date / chevron don't need to be aimed at. */}
      <span key={wall?.id ?? 0} className="flex items-center gap-3">
        {/* Chevron sits before the theme so it leads the cluster
            the same way the expanded-state 접기 chip leads with ▲,
            and the row reads as a disclosure widget ("▼ tap to
            open more below"). The whole row is the click target,
            so the chevron is a label rather than the aim. The
            "펼치기" word is gone — the bar itself communicates
            "this is a button", and the chevron alone is enough
            to signal direction. */}
        <span
          aria-hidden
          className="text-xs text-gray-400 group-hover/herobar:text-accent transition-colors"
        >
          ▼
        </span>
        {theme && (
          <span
            className="text-base text-gray-200"
            style={{
              fontFamily: GRAFFITI_FONT_STACK,
              letterSpacing: '0.02em',
            }}
          >
            {theme}
          </span>
        )}
        {wallUpdate && (
          <span className="flex items-center gap-1.5 text-[11px]">
            {hasUpdate && (
              <span className="bg-accent text-black font-bold px-1.5 py-0.5 rounded">
                NEW
              </span>
            )}
            <span className="text-gray-400">
              {formatHeroUpdateDate(wallUpdate)} 업데이트
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

// Format the server's UTC timestamp into a short M/D label for
// the collapsed-bar update date ("5/14 업데이트"). Parses
// ISO-or-SQLite-datetime strings — the server emits SQLite's
// `datetime('now')` shape (no TZ suffix) so we treat it as UTC
// by appending Z before parsing.
function formatHeroUpdateDate(iso: string): string {
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const withZ = normalised.endsWith('Z') ? normalised : `${normalised}Z`;
  const d = new Date(withZ);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
      className="rounded-full bg-avatar-bg text-accent flex items-center justify-center shrink-0 border border-white/10 font-semibold"
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
//
// backface-visibility is set directly on this element (not just on
// an enclosing wrapper) because absolute + z-index gets promoted to
// its own compositor layer on iOS Safari, and backface-visibility
// is a per-layer property — applying it to an outer wrapper alone
// leaves this layer rotating into a visible mirrored chip on the
// back face when AlbumCard flips. translateZ(0) makes the
// layer-isation explicit so the property lands consistently across
// browsers rather than being a layer-promotion accident. (The
// BlurredReviewCard card no longer flips, but AlbumCard does and
// it accepts TimeChip via topRightChip, so the defense stays.)
function TimeChip({ iso }: { iso: string }) {
  const label = formatRelativeKo(iso);
  if (!label) return null;
  return (
    <span
      className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 text-[10px] font-medium text-gray-200 bg-black/60 backdrop-blur-sm rounded-md leading-none pointer-events-none"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
      }}
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
      className={`${stripBase} hover:bg-accent/15 hover:text-accent`}
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
    <div className="review-card-outer group/card relative aspect-square flex flex-col rounded-lg overflow-hidden border border-accent/25 hover:border-accent/60 transition-colors bg-ink">
      <TimeChip iso={item.createdAt} />
      <Link
        to={albumHref}
        className="relative block flex-[4_1_0%] min-h-0 overflow-hidden bg-ink"
        onTouchStart={tap.handlers.onTouchStart}
        onTouchMove={tap.handlers.onTouchMove}
        onTouchCancel={tap.handlers.onTouchCancel}
        onTouchEnd={(e) =>
          tap.handlers.onTouchEnd(e, () => navigate(albumHref))
        }
        onClick={tap.handlers.onClick}
      >
        {/* Cover wash that gradually sharpens on hover: blur 10→5px,
            brightness 0.55→0.85 over 700ms. 5px stops the cover from
            reading too "revealed" — the album identity stays a tease,
            in line with the original 8/4px flip's intent. The text +
            gradient above fade out faster (300ms) so the comment gets
            out of the way before the cover finishes surfacing —
            staged rather than a single-beat reveal. Replaces an
            earlier 3D flip whose before/after both showed a blurred
            cover, making the payoff hard to read. */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-[filter] duration-700 ease-out ${
            tap.isActive
              ? '[filter:blur(5px)_brightness(0.85)]'
              : '[filter:blur(10px)_brightness(0.55)] group-hover/card:[filter:blur(5px)_brightness(0.85)]'
          }`}
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
            <div className="w-full h-full bg-ink" />
          )}
        </div>
        <div
          className={`absolute inset-0 transition-opacity duration-300 ease-out ${
            tap.isActive
              ? 'opacity-0'
              : 'opacity-100 group-hover/card:opacity-0'
          }`}
        >
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

