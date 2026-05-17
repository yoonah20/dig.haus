import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import { Popover } from '../components/ui';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { useHomeState, type DensityValue } from '../contexts/HomeStateContext';
import { useAuth } from '../contexts/AuthContext';
import { useInView } from '../hooks/useInView';
import type { AlbumSearchResult } from '../types';
import { type SortValue, SORT_OPTIONS } from '../lib/homeSort';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Per-density column counts at the primary desktop breakpoint
// (lg+) and approximate row heights — used by the adaptive
// pageSize so the grid fills as much of the viewport as the
// current density wants, with row count growing on taller
// monitors and shrinking on laptop screens. Row heights are
// eyeballed against the live grid: comfortable shows the largest
// covers + title/artist text below them, dense drops the title
// chrome to its compact form, ultra is cover-only.
const MOBILE_QUERY = '(max-width: 767px)';
const COLS_AT_XL_BY_DENSITY: Record<DensityValue, number> = {
  comfortable: 6,
  dense: 8,
  ultra: 10,
};
// Row heights computed against the actual rendered cell at the
// 1280-max-width xl layout. AlbumCard is aspect-square with no
// title/artist chrome below the cover (the metadata only shows
// on the flip-back), so the row's vertical footprint is just the
// cell width + the y-gap. Earlier estimates over-budgeted by
// ~30-40 px each, which made comfortable + ultra sit one row
// short of what the viewport could actually fit.
const ROW_H_BY_DENSITY: Record<DensityValue, number> = {
  // comfortable: 6 cols on a 1152-px inner → ~178 px cell, gap-y-17 → 195
  comfortable: 195,
  // dense: 8 cols → ~135 px cell, gap-2.5 (10) → 145
  dense: 145,
  // ultra: 10 cols → ~110 px cell, gap-1.5 (6) → 116
  ultra: 116,
};
// Reserved viewport space outside the grid: nav + sort header +
// pagination + page paddings. Trimmed from the earlier 280 so
// the formula returns more rows where the fold actually has
// room — over-budgeting the reserved area was making each
// density look like it skipped a tier of viewport-height
// adaptation.
const GRID_RESERVED_H = 220;
function computeAdaptivePageSize(
  density: DensityValue,
  viewportH: number
): number {
  const cols = COLS_AT_XL_BY_DENSITY[density];
  const rowH = ROW_H_BY_DENSITY[density];
  const available = Math.max(rowH, viewportH - GRID_RESERVED_H);
  const rows = Math.max(2, Math.floor(available / rowH));
  return cols * rows;
}
// Mobile infinite-scroll batch size. 9 = 3 rows of the 3-col
// mobile grid. Each batch ends with a snapshot card + 2 comment
// cards so the stream reads as an activity-rich unified feed
// rather than a pure cover catalog.
const MOBILE_PAGE_SIZE = 9;

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
  seed?: number,
  lens?: string
) {
  const { data } = await axios.get<AlbumListResponse>('/api/albums', {
    params: {
      sort,
      page,
      pageSize,
      ...(seed != null ? { seed } : {}),
      ...(lens ? { lens } : {}),
    },
  });
  return data;
}

function useAlbumList(
  sort: SortValue,
  page: number,
  pageSize: number,
  enabled: boolean,
  seed?: number,
  lens?: string
) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page, pageSize, seed ?? null, lens ?? null],
    queryFn: () => fetchAlbumPage(sort, page, pageSize, seed, lens),
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
  seed?: number,
  lens?: string
) {
  return useInfiniteQuery<AlbumListResponse>({
    queryKey: [
      'album-list-infinite',
      sort,
      MOBILE_PAGE_SIZE,
      seed ?? null,
      lens ?? null,
    ],
    queryFn: ({ pageParam }) =>
      fetchAlbumPage(sort, pageParam as number, MOBILE_PAGE_SIZE, seed, lens),
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

// One infinite-scroll batch on mobile — 10 albums (2 × 5 rows).
// The earlier "snapshot + two comment cards" interlude got
// pulled out: home now owns activity surfaces (요즘 평 / 새 기억
// sections), and /dig is the pure browsing surface across both
// breakpoints. Reveal animation gated by IntersectionObserver
// so batches the sentinel fetched eagerly don't burn their wave
// while the user is still scrolling above them.
const MOBILE_ROW_STAGGER_MS = 90;
const MOBILE_COLS = 3;
function MobileUnifiedBatch({ albums }: { albums: AlbumSearchResult[] }) {
  // rootMargin 0px: fires the moment any part of the batch crosses
  // into the viewport. A pre-fetch margin would defeat the purpose —
  // we'd fire the wave for off-screen batches.
  const { ref, inView } = useInView<HTMLDivElement>('0px');
  const cardClass = inView ? 'album-reveal' : 'album-reveal-off';

  return (
    <div ref={ref} className="grid grid-cols-3 gap-3">
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
  );
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

type LensType = 'label' | 'year';
type ActiveLens = { type: LensType; value: string };

interface LensOptions {
  labels: Array<{ name: string; count: number }>;
  years: Array<{ year: number; count: number }>;
}

// Parse the URL's ?lens=label:5 / ?lens=year:1979 into a typed shape.
// Anything malformed returns null — the server applies the same
// "drop silently" policy, so an invalid lens behaves identically to no
// lens at both layers.
function parseLensParam(raw: string | null): ActiveLens | null {
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;
  const type = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  if (type !== 'label' && type !== 'year') return null;
  if (!value) return null;
  return { type, value };
}

export default function DigPage() {
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
  } = useHomeState();

  // Track viewport height so the adaptive pageSize updates when
  // the user resizes / opens devtools / rotates the device.
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === 'undefined' ? 900 : window.innerHeight
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
  const pageSize = computeAdaptivePageSize(density, viewportH);

  // Active lens — read straight off the URL so /dig?lens=label:5 from
  // a shared link or an album-page link works on first paint without
  // any context plumbing. The serialized form is what we pass to the
  // server, so we keep it as a single string in addition to the
  // structured shape used for chip rendering.
  const lensParamRaw = searchParams.get('lens');
  const activeLens = useMemo(() => parseLensParam(lensParamRaw), [lensParamRaw]);
  const lensSerialized = activeLens
    ? `${activeLens.type}:${activeLens.value}`
    : undefined;

  // Reset to page 1 whenever the active lens changes — otherwise a
  // user landing on /dig?lens=label:5 from /dig page 4 would query
  // page 4 of the (much smaller) lensed result set and likely see an
  // empty grid.
  useEffect(() => {
    if (page !== 1) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensSerialized]);

  // Desktop keeps the original rail + pagination layout. Mobile
  // runs a single unified infinite-scroll feed — albums in 30-per
  // batches, each batch ending with a snapshot card and two
  // comment cards. No tabs, no separate activity view.
  const desktopQuery = useAlbumList(
    sort,
    page,
    pageSize,
    seedReady && !isMobile,
    seed,
    lensSerialized
  );
  const mobileQuery = useMobileAlbumList(
    sort,
    seedReady && isMobile,
    seed,
    lensSerialized
  );
  const albums: AlbumSearchResult[] = isMobile
    ? mobileQuery.data?.pages.flatMap((p) => p.albums) ?? []
    : desktopQuery.data?.albums ?? [];
  const totalPages = desktopQuery.data?.totalPages ?? 1;
  const isLoading = isMobile ? mobileQuery.isLoading : desktopQuery.isLoading;

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
          setTimeout(() => {
            setNextBatchPending(false);
            // Force the IO to re-emit the sentinel's current
            // intersection state. Without this, infinite-scroll
            // silently stops after one batch on phone-tall
            // viewports: a single mobile batch is ~3 rows ≈
            // 400-450 px tall, and the rootMargin below is 400 px,
            // so the new batch's height matches the margin almost
            // exactly — the sentinel ends up still inside the
            // extended viewport (isIntersecting stays TRUE) and
            // IntersectionObserver only fires on state TRANSITIONS,
            // never on "still true". unobserve + observe re-emits
            // the initial state for the target, which immediately
            // fires the callback again if the sentinel is still in
            // view, otherwise sits idle until the user scrolls.
            if (sentinelEl) {
              observer.unobserve(sentinelEl);
              observer.observe(sentinelEl);
            }
          }, 400);
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

  // Lens change helpers — both `setLens` and `clearLens` flow through
  // setSearchParams so the address bar stays the source of truth.
  // `replace: false` (the default) keeps lens changes in browser
  // history so back-nav restores the previous lens state — matches
  // how a user would think about "go back to the previous view".
  const setLens = (type: LensType, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('lens', `${type}:${value}`);
    setSearchParams(next);
  };
  const clearLens = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('lens');
    setSearchParams(next);
  };

  return (
    <div className="flex-1 flex flex-col px-4 md:px-8 lg:px-12 xl:px-16 pt-4">
      <section className="w-full max-w-[1280px] mx-auto">
        {isMobile ? (
          // ─── Mobile: single unified infinite-scroll feed ────
          // 30 albums per batch (3 cols × 10 rows), each batch
          // punctuated by one snapshot card and two comment cards
          // so scrolling reads as a steady mix of catalog browsing
          // and peripheral activity. No tabs — the activity
          // signals are interleaved inline.
          <>
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
              <SortTrigger
                sort={sort}
                onChange={setSort}
                label={currentSortLabel}
              />
              <LensControl
                activeLens={activeLens}
                onSet={setLens}
                onClear={clearLens}
              />
            </div>
            {isLoading && albums.length === 0 ? (
              <div className="text-center py-20 text-sm text-gray-500">
                불러오는 중...
              </div>
            ) : albums.length === 0 ? (
              <div className="text-center py-20 text-sm text-gray-500">
                {activeLens
                  ? '이 렌즈로 보이는 앨범이 없습니다.'
                  : '등록된 앨범이 없습니다.'}
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {mobileQuery.data?.pages.map((pg, i) => (
                  <MobileUnifiedBatch key={i} albums={pg.albums} />
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
          // ─── Desktop: full-width grid ─────────
          // Single-column album grid that fills the viewport.
          // Adaptive pageSize (computed off viewportH × density)
          // means tall monitors get more rows on first paint;
          // /dig used to reserve the right rail for ActivityRail
          // and ran a comment ticker below, but the home page
          // now surfaces both kinds of activity in dedicated
          // sections, so /dig can be the pure browsing surface.
          <>
            <main className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                <div className="flex items-center gap-3">
                  <SortTrigger
                    sort={sort}
                    onChange={setSort}
                    label={currentSortLabel}
                  />
                  <LensControl
                    activeLens={activeLens}
                    onSet={setLens}
                    onClear={clearLens}
                  />
                </div>
                <DensitySwitcher density={density} onChange={setDensity} />
              </div>
              {isLoading && albums.length === 0 ? (
                <div className="text-center py-20 text-sm text-gray-500">
                  불러오는 중...
                </div>
              ) : albums.length === 0 ? (
                <div className="text-center py-20 text-sm text-gray-500">
                  {activeLens
                    ? '이 렌즈로 보이는 앨범이 없습니다.'
                    : '등록된 앨범이 없습니다.'}
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

            {totalPages > 1 && (
              <nav
                className="mt-6 flex items-center justify-center gap-1 flex-wrap"
                aria-label="Pagination"
              >
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-accent disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
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
                          ? 'text-accent font-semibold'
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
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-accent disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="다음 페이지"
                >
                  →
                </button>
              </nav>
            )}

          </>
        )}
      </section>
    </div>
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
        <Popover
          role="menu"
          strong={false}
          radius="lg"
          pad="none"
          shadow="2xl"
          className="absolute left-0 mt-1 w-44 py-1 z-50"
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
                    ? 'text-accent font-semibold'
                    : opt.adminOnly
                      ? 'text-accent/80 italic'
                      : 'text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </Popover>
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
            active ? 'bg-accent' : 'bg-gray-500'
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
                s === density ? 'bg-accent' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>
      <DensityGlyph dots={4} active={density === 'ultra'} />
    </div>
  );
}

// Lens picker data — labels with album counts + distinct years. The
// list rarely changes (new label arrives only when admin registers an
// album from a previously-unseen Spotify label) so a long staleTime
// keeps the popover instant on second open.
function useLensOptions() {
  return useQuery<LensOptions>({
    queryKey: ['lens-options'],
    queryFn: async () => {
      const { data } = await axios.get<LensOptions>('/api/albums/lens-options');
      return data;
    },
    staleTime: 1000 * 60 * 10,
  });
}

// Single trigger that renders either the empty "+ 렌즈" button or the
// active "◉ Blue Note ✕" chip, and owns the picker popover. Folding
// both states into one component avoids the parent juggling visibility
// state — the trigger button always sits in the same flex slot and the
// chip simply replaces the label when a lens is active.
function LensControl({
  activeLens,
  onSet,
  onClear,
}: {
  activeLens: ActiveLens | null;
  onSet: (type: LensType, value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LensType>('label');
  const ref = useRef<HTMLDivElement>(null);
  const options = useLensOptions();

  // Resolve a human label for the active lens chip. Year renders the
  // numeric value with the 년 suffix; label is already the human name
  // (the URL carries the label_name string directly — labels.id isn't
  // populated in practice). No lookup round-trip.
  const activeChipLabel = useMemo(() => {
    if (!activeLens) return null;
    if (activeLens.type === 'year') return `${activeLens.value}년`;
    return activeLens.value;
  }, [activeLens]);

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
      {activeLens ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 border border-accent/40 px-2.5 py-1 text-xs text-accent">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 cursor-pointer hover:text-accent/80 transition-colors"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span aria-hidden>◉</span>
            <span className="font-medium">{activeChipLabel}</span>
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-accent/70 hover:text-accent cursor-pointer leading-none"
            aria-label="렌즈 해제"
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          렌즈
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
      )}
      {open && (
        <Popover
          role="dialog"
          strong={false}
          radius="lg"
          pad="none"
          shadow="2xl"
          className="absolute right-0 mt-1 w-64 z-50"
        >
          <div className="flex items-center gap-1 border-b border-white/10 px-2 pt-2">
            {(['label', 'year'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs rounded-t-md cursor-pointer transition-colors ${
                  tab === t
                    ? 'text-accent bg-white/5'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t === 'label' ? '레이블' : '연도'}
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {options.isLoading ? (
              <div className="px-4 py-3 text-xs text-gray-500">
                불러오는 중...
              </div>
            ) : tab === 'label' ? (
              options.data?.labels.length ? (
                options.data.labels.map((l) => {
                  const isCurrent =
                    activeLens?.type === 'label' &&
                    activeLens.value === l.name;
                  return (
                    <button
                      key={l.name}
                      onClick={() => {
                        onSet('label', l.name);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                        isCurrent
                          ? 'text-accent font-semibold'
                          : 'text-gray-300'
                      }`}
                    >
                      <span className="truncate">{l.name}</span>
                      <span className="text-xs text-gray-500 ml-2 tabular-nums">
                        {l.count}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-3 text-xs text-gray-500">
                  등록된 레이블이 없습니다.
                </div>
              )
            ) : options.data?.years.length ? (
              options.data.years.map((y) => {
                const isCurrent =
                  activeLens?.type === 'year' &&
                  activeLens.value === String(y.year);
                return (
                  <button
                    key={y.year}
                    onClick={() => {
                      onSet('year', String(y.year));
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                      isCurrent
                        ? 'text-accent font-semibold'
                        : 'text-gray-300'
                    }`}
                  >
                    <span className="tabular-nums">{y.year}년</span>
                    <span className="text-xs text-gray-500 ml-2 tabular-nums">
                      {y.count}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-3 text-xs text-gray-500">
                연도 정보가 없습니다.
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
