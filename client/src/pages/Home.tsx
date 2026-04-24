import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import ActivityRail from '../components/Home/ActivityRail';
import CommentTicker, { TickerItem } from '../components/Home/CommentTicker';
import SnapshotCard from '../components/Home/SnapshotCard';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { useHomeState, type DensityValue } from '../contexts/HomeStateContext';
import { useAuth } from '../contexts/AuthContext';
import { useHomeSnapshots, type HomeSnapshot } from '../hooks/useHomeSnapshots';
import { useInView } from '../hooks/useInView';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import type { AlbumSearchResult } from '../types';
import { type SortValue, SORT_OPTIONS } from '../lib/homeSort';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Per-density page sizes. Single table regardless of rail state —
// the grid column counts at lg/xl also stay constant per density,
// so page_size is always an exact multiple of the xl col count
// (comfortable 6×3, dense 8×4, ultra 10×5) and the last row fills
// at the primary desktop breakpoints. What DOES change with rail
// state is card size (main is ~77% width when the rail is open),
// which is an acceptable trade for keeping the ticker's y-position
// fixed when the user toggles density.
const MOBILE_QUERY = '(max-width: 767px)';
const PAGE_SIZE_BY_DENSITY: Record<string, number> = {
  comfortable: 18,
  dense: 32,
  ultra: 50,
};
// Mobile infinite-scroll batch size. 10 = 5 rows of the 2-col
// mobile grid. Each batch ends with a snapshot card + 2 comment
// cards so the stream reads as an activity-rich unified feed
// rather than a pure cover catalog.
const MOBILE_PAGE_SIZE = 10;

// Desktop-only: rail toggle + density switcher + reveal animation all
// key off whether the viewport is wide enough to benefit from them.
// Grid data itself runs the same pagination on every viewport, so
// isMobile no longer gates any query — only UI chrome.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

async function fetchAlbumPage(
  sort: SortValue,
  page: number,
  pageSize: number,
  seed?: number
) {
  const { data } = await axios.get<AlbumListResponse>('/api/albums', {
    params: { sort, page, pageSize, ...(seed != null ? { seed } : {}) },
  });
  return data;
}

function useAlbumList(
  sort: SortValue,
  page: number,
  pageSize: number,
  enabled: boolean,
  seed?: number
) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page, pageSize, seed ?? null],
    queryFn: () => fetchAlbumPage(sort, page, pageSize, seed),
    staleTime: 1000 * 60 * 5,
    // Always refetch when the user lands on Home, not just when the
    // cache is past staleTime. Without this, returning to / via
    // browser back after registering an album or running review
    // summary would keep showing the old grid (no ⚠️ badge clearing,
    // no newly-registered album appearing) until a manual refresh —
    // invalidation from those mutations alone wasn't reliably waking
    // the inactive query. The extra page fetch is cheap.
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
    enabled,
  });
}

// Mobile infinite-scroll query. Separate from the paginated desktop
// query so the two code paths own their own cache keys and
// queryFns — flipping viewport mid-session reuses whichever cache
// is already warm rather than re-fetching. Gated by `enabled` so
// the query stays idle while the albums tab is backgrounded or the
// viewport is desktop.
function useMobileAlbumList(
  sort: SortValue,
  enabled: boolean,
  seed?: number
) {
  return useInfiniteQuery<AlbumListResponse>({
    queryKey: ['album-list-infinite', sort, MOBILE_PAGE_SIZE, seed ?? null],
    queryFn: ({ pageParam }) =>
      fetchAlbumPage(sort, pageParam as number, MOBILE_PAGE_SIZE, seed),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    staleTime: 1000 * 60 * 5,
    // Same rationale as the desktop query — guarantee a fresh first
    // page on every Home mount so back-nav after mutations shows
    // updated state without the user having to reload.
    refetchOnMount: 'always',
    enabled,
  });
}

// One infinite-scroll batch on mobile — 10 albums (2 × 5 rows)
// followed by one snapshot card and two comment cards. The
// snapshot + comments anchor each batch as a mini activity
// interlude so the stream isn't just a flat album grid. Reveal
// animation gated by IntersectionObserver so batches the sentinel
// fetched eagerly don't burn their wave while the user is still
// scrolling above them.
const MOBILE_ROW_STAGGER_MS = 90;
const MOBILE_COLS = 2;
function MobileUnifiedBatch({
  albums,
  snapshot,
  comments,
}: {
  albums: AlbumSearchResult[];
  snapshot: HomeSnapshot | null;
  comments: UserReviewFeedItem[];
}) {
  // rootMargin 0px: fires the moment any part of the batch crosses
  // into the viewport. A pre-fetch margin would defeat the purpose —
  // we'd fire the wave for off-screen batches.
  const { ref, inView } = useInView<HTMLDivElement>('0px');
  const cardClass = inView ? 'album-reveal' : 'album-reveal-off';

  // Activity block (snapshot + two comment cards) gets a little
  // extra breathing above and below vs the album grid's tight
  // row rhythm, so the interlude reads as "here's a break from
  // scrolling covers" rather than another row of the catalog.
  const hasActivity = snapshot != null || comments.length > 0;
  return (
    <div ref={ref} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        {albums.map((album, idx) => (
          <div
            key={album.mbid}
            className={cardClass}
            style={
              inView
                ? {
                    animationDelay: `${Math.floor(idx / MOBILE_COLS) * MOBILE_ROW_STAGGER_MS}ms`,
                  }
                : undefined
            }
          >
            <AlbumCard album={album} />
          </div>
        ))}
      </div>
      {hasActivity && (
        <div className="flex flex-col gap-5 mt-9 mb-9">
          {snapshot && <SnapshotCard snap={snapshot} tinted />}
          {comments.map((c, i) => (
            <TickerItem
              key={c.id}
              item={c}
              fullWidth
              orientation={i % 2 === 0 ? 'left' : 'right'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Deterministic PRNG so each batch's comment picks stay stable
// across re-renders (scrolling up and back down shows the same
// picks rather than reshuffling). Seeded with the batch index.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Snapshots cycle in recency order. Batch 0 gets the freshest
// snapshot, batch N loops back to start when snapshots are
// exhausted. Server caps the list at 20; 21st batch reuses the
// first snapshot, which is fine — the intent is a steady drip
// of memories, not uniqueness across the whole session.
function pickSnapshot(
  snapshots: HomeSnapshot[] | undefined,
  batchIndex: number
): HomeSnapshot | null {
  if (!snapshots || snapshots.length === 0) return null;
  return snapshots[batchIndex % snapshots.length];
}

// Comments pick 2 items per batch from the top 20 most-recent
// reviews, using a PRNG seeded by the batch index. "Recent
// focused" emerges from sampling only the top slice; full random
// within that slice keeps each batch's pair feeling fresh rather
// than predictable.
function pickComments(
  pool: UserReviewFeedItem[] | undefined,
  batchIndex: number,
  count = 2
): UserReviewFeedItem[] {
  if (!pool || pool.length === 0) return [];
  const top = pool.slice(0, Math.min(20, pool.length));
  if (top.length <= count) return top;
  const rng = mulberry32(batchIndex * 37 + 1);
  const chosen: number[] = [];
  while (chosen.length < count) {
    const i = Math.floor(rng() * top.length);
    if (!chosen.includes(i)) chosen.push(i);
  }
  return chosen.map((i) => top[i]);
}

function paginationItems(current: number, total: number): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) items.push('ellipsis-left');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push('ellipsis-right');
  items.push(total);
  return items;
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openOverlay } = useSearchOverlay();
  const isMobile = useIsMobile();
  // sort / page / seed live in HomeStateContext — no URL involvement,
  // so the address bar stays at '/'. See contexts/HomeStateContext.tsx
  // for the persistence rules (localStorage for sort, in-memory for
  // page + seed).
  const {
    sort,
    setSort,
    page,
    setPage,
    seed,
    density,
    setDensity,
    railOpen,
    setRailOpen,
  } = useHomeState();

  useDocumentHead({
    title: 'Home | dig.haus',
    description: '앨범 커버로 파고, 감으로 찾는 레코드 컬렉터의 음악 리서치 허브.',
    url: 'https://dig.haus/',
    type: 'website',
  });

  // Deep-link: /?q=artist opens the nav search overlay and clears the
  // param. This is the one URL param Home still touches — external
  // inbound links use it so a friend can share `dig.haus/?q=artist`.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      openOverlay(q);
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openOverlay]);

  // With the seed owned by the context, it's set synchronously when
  // the sort becomes 'random' — no async round-trip like the old
  // URL-based seed-effect used to have. So seedReady is always true
  // for non-random sorts, and true for random once the provider
  // finishes its first render (which it has by the time Home's
  // effects run).
  const seedReady = sort !== 'random' || seed !== undefined;
  const pageSize =
    PAGE_SIZE_BY_DENSITY[density] ?? PAGE_SIZE_BY_DENSITY.comfortable;

  // Desktop keeps the original rail + pagination layout. Mobile
  // runs a single unified infinite-scroll feed — albums in 30-per
  // batches, each batch ending with a snapshot card and two
  // comment cards. No tabs, no separate activity view.
  const desktopQuery = useAlbumList(
    sort,
    page,
    pageSize,
    seedReady && !isMobile,
    seed
  );
  const mobileQuery = useMobileAlbumList(
    sort,
    seedReady && isMobile,
    seed
  );
  const albums: AlbumSearchResult[] = isMobile
    ? mobileQuery.data?.pages.flatMap((p) => p.albums) ?? []
    : desktopQuery.data?.albums ?? [];
  const totalPages = desktopQuery.data?.totalPages ?? 1;
  const isLoading = isMobile ? mobileQuery.isLoading : desktopQuery.isLoading;

  // Data for the mobile unified feed's inter-batch cards. Fetched
  // once and sampled per batch — snapshots cycle in order,
  // comments pick 2 at random from the top 20 most-recent.
  const mobileSnapshotsQuery = useHomeSnapshots(isMobile, 20);
  const mobileCommentsQuery = useUserReviewsFeed(isMobile, 60);

  // Shuffle the reveal delays per page so the (up to 50) tiles don't
  // all land in a single sweep. Reshuffles whenever the rendered page
  // changes — page click, sort change, reseed on random sort, density
  // tier change — so flipping through the grid reads as a new scatter
  // each time rather than a repeating cascade. Max delay caps the
  // total reveal window at ~400ms so the grid feels lively, not
  // laggy.
  const STAGGER_MS = 22;
  const revealDelays = useMemo(() => {
    const arr = Array.from({ length: pageSize }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [sort, page, seed, pageSize]);

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Mobile infinite-scroll sentinel. Fires fetchNextPage when the
  // tail div enters the viewport (with a generous 400px pre-fetch
  // margin so the next batch is ready before the user reaches the
  // bottom). A short `nextBatchPending` pause throttles consecutive
  // fires so the reader registers each batch landing as its own
  // arrival — matches the "앨범 20개씩 로딩 + 약간 포즈 + 계속"
  // cadence we ran before the rail rework replaced this feed.
  //
  // Callback-ref on `sentinelEl` (via useState) is deliberate — the
  // sentinel is only mounted once the first batch arrives, and a
  // plain useRef wouldn't re-trigger the effect when that happens.
  // Using state forces the effect to re-run when the node finally
  // enters the DOM, which is what wires the observer up correctly.
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const [nextBatchPending, setNextBatchPending] = useState(false);
  const nextBatchPendingRef = useRef(nextBatchPending);
  useEffect(() => {
    nextBatchPendingRef.current = nextBatchPending;
  }, [nextBatchPending]);
  const mobileQueryRef = useRef(mobileQuery);
  useEffect(() => {
    mobileQueryRef.current = mobileQuery;
  }, [mobileQuery]);
  useEffect(() => {
    if (!isMobile || !sentinelEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const q = mobileQueryRef.current;
        if (
          !q.hasNextPage ||
          q.isFetchingNextPage ||
          nextBatchPendingRef.current
        )
          return;
        setNextBatchPending(true);
        q.fetchNextPage().finally(() => {
          setTimeout(() => setNextBatchPending(false), 400);
        });
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [isMobile, sentinelEl]);

  const items = paginationItems(page, totalPages);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? '';

  // Density → grid-cols + gap map. One unified table regardless of
  // rail state — keeping the lg/xl column counts constant means the
  // grid's row count per density doesn't shift when the user toggles
  // the rail, which in turn keeps the ticker below the grid at a
  // stable y. Card size shrinks proportionally when the rail is
  // open (main gets 77% of viewport instead of 100%), which is a
  // visible but expected consequence of the layout change.
  //
  // xs grids use 3 cols at every density (previously 2 at comfortable)
  // so a mobile wall is 3 × page-size/3 = 3×6 for comfortable, which
  // the user found the sweet spot for phone browsing — denser packs
  // covers below comfortable tap-target size and more-per-row added
  // visual noise.
  //
  // lg and xl share the same col count per density so the grid
  // height is stable across that whole desktop breakpoint band.
  const DESKTOP_GRID_CLASSES: Record<DensityValue, string> = {
    comfortable:
      'grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6',
    dense:
      'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 xl:grid-cols-8',
    ultra:
      'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 xl:grid-cols-10',
  };
  const DESKTOP_GAP_CLASSES: Record<DensityValue, string> = {
    // Comfortable row-gap (vertical) is 17px — a single-px bump
    // from col-gap's 16px (gap-x-4) so the rows breathe without
    // making the grid read as loose. Dense and ultra stay
    // uniformly tight, their whole purpose being density.
    comfortable: 'gap-x-4 gap-y-[17px]',
    dense: 'gap-2.5',
    ultra: 'gap-1.5',
  };
  const desktopGridCols = DESKTOP_GRID_CLASSES[density];
  const desktopGap = DESKTOP_GAP_CLASSES[density];

  return (
    <div
      className="flex-1 flex flex-col px-4 md:px-8 lg:px-12 xl:px-16 pt-4"
      // Adaptive top padding only on desktop — mobile viewports
      // don't get tall enough to need adaptive spread, and on
      // tablets the 900px threshold was firing and pushing
      // content unreasonably far from the nav.
      style={
        isMobile
          ? undefined
          : { paddingTop: 'max(16px, calc((100vh - 900px) * 0.2))' }
      }
    >
      <section className="w-full max-w-[1280px] mx-auto">
        {isMobile ? (
          // ─── Mobile: single unified infinite-scroll feed ────
          // 30 albums per batch (3 cols × 10 rows), each batch
          // punctuated by one snapshot card and two comment cards
          // so scrolling reads as a steady mix of catalog browsing
          // and peripheral activity. No tabs — the activity
          // signals are interleaved inline.
          <>
            {albums.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                <SortTrigger
                  sort={sort}
                  onChange={setSort}
                  label={currentSortLabel}
                />
              </div>
            )}
            {isLoading && albums.length === 0 ? (
              <div className="text-center py-20 text-sm text-gray-500">
                불러오는 중...
              </div>
            ) : albums.length === 0 ? (
              <div className="text-center py-20 text-sm text-gray-500">
                등록된 앨범이 없습니다.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {mobileQuery.data?.pages.map((pg, i) => (
                  <MobileUnifiedBatch
                    key={i}
                    albums={pg.albums}
                    snapshot={pickSnapshot(
                      mobileSnapshotsQuery.data?.snapshots,
                      i
                    )}
                    comments={pickComments(
                      mobileCommentsQuery.data?.items,
                      i
                    )}
                  />
                ))}
                <div
                  ref={setSentinelEl}
                  className="py-6 text-center text-xs text-gray-500"
                >
                  {nextBatchPending || mobileQuery.isFetchingNextPage
                    ? '더 불러오는 중…'
                    : mobileQuery.hasNextPage
                      ? '계속 스크롤해 주세요'
                      : '끝까지 다 봤어요!'}
                </div>
              </div>
            )}
          </>
        ) : (
          // ─── Desktop: original grid + rail + ticker ─────────
          // Preserves the pre-tab layout. Two-column: album grid
          // on the left, ActivityRail (snapshot feed) on the
          // right, collapsible via the inline chevron next to
          // density. CommentTicker marquee spans the full width
          // below. The tab UI is deliberately mobile-only — this
          // viewport has the real estate to show both roles
          // simultaneously without tabs.
          <>
            <div
              // Gap is driven off a CSS variable so it transitions
              // from 40px to 0 in lockstep with the column collapse.
              // Before, lg:gap-10 was static — closing the rail left
              // a permanent 40px dead strip on the right of the grid
              // which read as a "pop" at the end of the animation.
              // Below lg we stay flex-col with gap-6 (the variable
              // class only applies at lg+).
              className="flex flex-col gap-6 lg:grid lg:gap-[var(--rail-gap,40px)] lg:items-stretch lg:transition-[grid-template-columns,gap] lg:duration-300 lg:ease-out"
              style={{
                gridTemplateColumns: railOpen
                  ? 'minmax(0, 7.7fr) minmax(0, 2.3fr)'
                  : 'minmax(0, 7.7fr) minmax(0, 0fr)',
                ['--rail-gap' as string]: railOpen ? '40px' : '0px',
              }}
            >
              <main className="order-1 min-w-0">
                {albums.length > 0 && (
                  <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                    <SortTrigger
                      sort={sort}
                      onChange={setSort}
                      label={currentSortLabel}
                    />
                    <div className="flex items-center gap-3">
                      <DensitySwitcher
                        density={density}
                        onChange={setDensity}
                      />
                      {!railOpen && (
                        <OpenRailHandle onClick={() => setRailOpen(true)} />
                      )}
                    </div>
                  </div>
                )}
                {isLoading && albums.length === 0 ? (
                  <div className="text-center py-20 text-sm text-gray-500">
                    불러오는 중...
                  </div>
                ) : albums.length === 0 ? (
                  <div className="text-center py-20 text-sm text-gray-500">
                    등록된 앨범이 없습니다.
                  </div>
                ) : (
                  <div
                    key={`grid-${albums.length}-${albums[0]?.mbid ?? ''}-${albums[albums.length - 1]?.mbid ?? ''}`}
                    className={`grid ${desktopGridCols} ${desktopGap}`}
                  >
                    {albums.map((album, i) => (
                      <div
                        key={album.mbid}
                        className="album-reveal"
                        style={{
                          animationDelay: `${(revealDelays[i] ?? i) * STAGGER_MS}ms`,
                        }}
                      >
                        <AlbumCard album={album} compact={density === 'ultra'} />
                      </div>
                    ))}
                  </div>
                )}
              </main>
              <div
                id="home-activity-rail"
                // Just a fade. The earlier translate-x-full on close
                // was 100% of the element's own width — and the
                // element's width was collapsing at the same time,
                // so translate-x was interpolating against a moving
                // reference, which read as a jitter/pop rather than
                // a clean slide. The column collapse alone carries
                // the slide-out feel; opacity softens the finish.
                className={`order-2 min-w-0 overflow-hidden lg:transition-opacity lg:duration-300 lg:ease-out ${
                  railOpen
                    ? 'lg:opacity-100'
                    : 'lg:opacity-0 lg:pointer-events-none'
                }`}
              >
                <ActivityRail onClose={() => setRailOpen(false)} />
              </div>
            </div>

            {totalPages > 1 && (
              <nav
                className="flex items-center justify-center gap-1 flex-wrap"
                style={{ marginTop: 'max(8px, calc((100vh - 900px) * 0.15))' }}
                aria-label="Pagination"
              >
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-[#e8a020] disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="이전 페이지"
                >
                  ←
                </button>
                {items.map((it, idx) =>
                  typeof it === 'number' ? (
                    <button
                      key={idx}
                      onClick={() => goToPage(it)}
                      className={`min-w-[2rem] px-2.5 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
                        it === page
                          ? 'text-[#e8a020] font-semibold'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
                      }`}
                      aria-current={it === page ? 'page' : undefined}
                    >
                      {it}
                    </button>
                  ) : (
                    <span
                      key={idx}
                      className="px-1 text-gray-600 select-none"
                    >
                      …
                    </span>
                  )
                )}
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-[#e8a020] disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="다음 페이지"
                >
                  →
                </button>
              </nav>
            )}

            {/* Ticker tied to rail visibility — when the rail closes,
                the ticker slides down + fades out and its row height
                collapses so the page doesn't leave a silent band of
                empty space at the bottom. grid-template-rows 0fr→1fr
                is the modern auto-height animation trick (needs
                Chrome 117+ / Firefox 122+ / Safari 17+; older
                browsers just jump without animation). */}
            {albums.length > 0 && (
              <div
                aria-hidden={!railOpen}
                className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
                  railOpen
                    ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                    : 'grid-rows-[0fr] opacity-0 translate-y-6 pointer-events-none'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <CommentTicker />
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// Small open-rail handle. Only renders when the rail is collapsed
// on desktop — the rail's own close button (inside its section
// header) handles the other direction. Styled identically to the
// close button so the two affordances feel like a paired set
// rather than two unrelated glyphs.
function OpenRailHandle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={false}
      aria-controls="home-activity-rail"
      title="활동 레일 펴기"
      aria-label="활동 레일 펴기"
      className="inline-flex items-center justify-center w-5 h-5 rounded-md border border-white/15 bg-[#1a130a]/40 hover:border-[#e8a020]/60 hover:bg-[#e8a020]/10 text-gray-400 hover:text-[#e8a020] transition-colors cursor-pointer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3 h-3"
        aria-hidden
      >
        <path d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
    </button>
  );
}

// Inline sort trigger — text-style ("정렬: 발매 최신순 ▾") with an
// overlay dropdown of SORT_OPTIONS. Lives above the album grid
// instead of in the nav, so discovery of "how is this feed ordered"
// and the mechanism to change it sit together where the user is
// looking. Admin-only sort options (e.g. "등록 요청작") are filtered
// out for non-admins so the dropdown stays clean.
function SortTrigger({
  sort,
  onChange,
  label,
}: {
  sort: SortValue;
  onChange: (v: SortValue) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const visibleOptions = useMemo(
    () => SORT_OPTIONS.filter((o) => !o.adminOnly || isAdmin),
    [isAdmin]
  );

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 tabular-nums text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        정렬: <span className="text-gray-300">{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-3 h-3 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-1 w-44 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50"
        >
          {visibleOptions.map((opt) => {
            const isCurrent = opt.value === sort;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  onChange(opt.value as SortValue);
                  setOpen(false);
                }}
                className={`block w-full text-left px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                  isCurrent
                    ? 'text-[#e8a020] font-semibold'
                    : opt.adminOnly
                      ? 'text-[#e8a020]/80 italic'
                      : 'text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 3-step density slider: comfortable / dense / ultra. A range input
// with three stops (0 = comfortable, 1 = dense, 2 = ultra) — replaces
// the earlier 3-button dot-matrix toggle. A slider reads more
// naturally as a "continuous smaller → bigger" gesture, even though
// we snap to three discrete values. Dot-matrix glyphs on either end
// (2×2 ↔ 4×4) serve as the smaller/bigger labels — the same icons
// that sat on the previous button triplet, now re-purposed as the
// slider's endpoints. Lives above the desktop grid only — mobile
// density is fixed at 2 cols, adjusting it would pack covers too
// small to tap.
const DENSITY_STEPS: DensityValue[] = ['comfortable', 'dense', 'ultra'];
const DENSITY_LABELS: Record<DensityValue, string> = {
  comfortable: '넉넉하게',
  dense: '빽빽하게',
  ultra: '더 빽빽하게',
};

// Dot-matrix glyph. Used as the smaller/bigger endpoint icons on the
// slider; also reads as a visual cue for "this is what density looks
// like" at a glance. `active` lights up the dots in amber when the
// slider rests on that endpoint; otherwise they stay muted.
function DensityGlyph({ dots, active }: { dots: number; active: boolean }) {
  return (
    <span
      className="inline-grid gap-[2px]"
      style={{
        gridTemplateColumns: `repeat(${dots}, 3px)`,
        gridTemplateRows: `repeat(${dots}, 3px)`,
      }}
      aria-hidden
    >
      {Array.from({ length: dots * dots }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] h-[3px] rounded-sm ${
            active ? 'bg-[#e8a020]' : 'bg-gray-500'
          }`}
        />
      ))}
    </span>
  );
}

function DensitySwitcher({
  density,
  onChange,
}: {
  density: DensityValue;
  onChange: (v: DensityValue) => void;
}) {
  const current = DENSITY_STEPS.indexOf(density);
  return (
    <div className="density-slider inline-flex items-center gap-2">
      <DensityGlyph dots={2} active={density === 'comfortable'} />
      <div className="relative flex items-center">
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={current >= 0 ? current : 0}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            const next = DENSITY_STEPS[idx];
            if (next) onChange(next);
          }}
          title={`크기: ${DENSITY_LABELS[density]}`}
          aria-label={`크기 조정: ${DENSITY_LABELS[density]}`}
          aria-valuetext={DENSITY_LABELS[density]}
          className="density-slider-input"
        />
        {/* Tick marks — three dots behind the thumb, aligned with the
            0 / 1 / 2 stops. Decorative: the real value is on the
            <input>. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-[7px]">
          {DENSITY_STEPS.map((s) => (
            <span
              key={s}
              aria-hidden
              className={`w-[2px] h-[2px] rounded-full ${
                s === density ? 'bg-[#e8a020]' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>
      <DensityGlyph dots={4} active={density === 'ultra'} />
    </div>
  );
}
