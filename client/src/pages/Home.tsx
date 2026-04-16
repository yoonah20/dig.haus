import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import AlbumRequestCard from '../components/Home/AlbumRequestCard';
import CommentTicker from '../components/Home/CommentTicker';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { useAuth } from '../contexts/AuthContext';
import { useAlbumRequests } from '../hooks/useAlbumRequests';
import type { AlbumSearchResult } from '../types';
import {
  type SortValue,
  DEFAULT_SORT,
  SORT_STORAGE_KEY,
  isSortValue,
  readStoredSort,
} from '../lib/homeSort';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Mobile/desktop split: desktop sticks with classic numbered pagination
// (18 per page — 3 rows × 6 cols at lg; leaves room under the grid for
// the comment ticker). Mobile uses infinite scroll in 10-item batches.
// Tailwind `md` breakpoint = 768px, so anything below counts as mobile
// here.
const MOBILE_QUERY = '(max-width: 767px)';
const DESKTOP_PAGE_SIZE = 18;
const MOBILE_PAGE_SIZE = 10;

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

function useDesktopAlbumList(
  sort: SortValue,
  page: number,
  enabled: boolean,
  seed?: number
) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page, DESKTOP_PAGE_SIZE, seed ?? null],
    queryFn: () => fetchAlbumPage(sort, page, DESKTOP_PAGE_SIZE, seed),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useMobileAlbumList(sort: SortValue, enabled: boolean, seed?: number) {
  return useInfiniteQuery<AlbumListResponse>({
    queryKey: ['album-list-infinite', sort, MOBILE_PAGE_SIZE, seed ?? null],
    queryFn: ({ pageParam }) =>
      fetchAlbumPage(sort, pageParam as number, MOBILE_PAGE_SIZE, seed),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    staleTime: 1000 * 60 * 5,
    enabled,
  });
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
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  useDocumentHead({
    title: 'Home | dig.haus',
    description: '앨범 커버로 파고, 감으로 찾는 레코드 컬렉터의 음악 리서치 허브.',
    url: 'https://dig.haus/',
    type: 'website',
  });

  const sort: SortValue = useMemo(() => {
    const raw = searchParams.get('sort') || '';
    if (isSortValue(raw)) return raw;
    return readStoredSort() ?? DEFAULT_SORT;
  }, [searchParams]);

  // Rehydrate URL from stored sort on initial mount so pagination, share-links,
  // and back-nav all see a canonical URL. Only runs when the URL is missing a
  // sort and localStorage has a non-default pick.
  useEffect(() => {
    if (searchParams.get('sort')) return;
    const stored = readStoredSort();
    if (!stored || stored === DEFAULT_SORT) return;
    const next = new URLSearchParams(searchParams);
    next.set('sort', stored);
    setSearchParams(next, { replace: true });
    // Intentional: only on first mount — avoids a feedback loop with handleSortChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror sort selection into localStorage so it survives sessions and any
  // edge case where the URL param is lost during navigation.
  useEffect(() => {
    try {
      if (sort === DEFAULT_SORT) localStorage.removeItem(SORT_STORAGE_KEY);
      else localStorage.setItem(SORT_STORAGE_KEY, sort);
    } catch {
      // ignore storage errors
    }
  }, [sort]);

  const page = useMemo(() => {
    const raw = parseInt(searchParams.get('page') || '1', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }, [searchParams]);

  // Random sort needs a per-session seed so pagination / infinite scroll
  // don't show the same album twice (server uses the seed to shuffle
  // deterministically). The seed sits in the URL so a page reload or share
  // link keeps showing the same shuffle; switching sort away clears it.
  const seed = useMemo(() => {
    if (sort !== 'random') return undefined;
    const raw = parseInt(searchParams.get('seed') || '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  }, [sort, searchParams]);

  useEffect(() => {
    if (sort === 'random' && seed === undefined) {
      const fresh = Math.floor(Math.random() * 1_000_000);
      const next = new URLSearchParams(searchParams);
      next.set('seed', String(fresh));
      setSearchParams(next, { replace: true });
    } else if (sort !== 'random' && searchParams.get('seed')) {
      const next = new URLSearchParams(searchParams);
      next.delete('seed');
      setSearchParams(next, { replace: true });
    }
  }, [sort, seed, searchParams, setSearchParams]);

  // Deep-link: /?q=artist opens the nav search overlay and clears the param
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      openOverlay(q);
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openOverlay]);

  // When sort=random we wait for the seed effect to write a fresh value to
  // the URL before firing a query — otherwise the first render would hit
  // the server without a seed (seed=0 deterministic ordering) and then
  // refetch a moment later with the real seed, wasting a round trip.
  const seedReady = sort !== 'random' || seed !== undefined;

  // `request_pending` (admin-only sort) switches the grid's data
  // source from the main album list to the pending-request queue.
  // Enabled flag on the regular queries flips off so we don't burn
  // useless fetches on the other endpoint while admin is in request-
  // review mode. Non-admins can't reach this branch because SortMenu
  // hides the option, but the isAdmin gate here is belt-and-suspenders
  // in case someone crafts the URL manually.
  const isRequestMode = sort === 'request_pending' && isAdmin;
  const requestsQuery = useAlbumRequests(isRequestMode);

  const desktopQuery = useDesktopAlbumList(
    sort,
    page,
    !isMobile && seedReady && !isRequestMode,
    seed
  );
  const mobileQuery = useMobileAlbumList(
    sort,
    isMobile && seedReady && !isRequestMode,
    seed
  );

  const albums: AlbumSearchResult[] = isMobile
    ? (mobileQuery.data?.pages.flatMap((p) => p.albums) ?? [])
    : (desktopQuery.data?.albums ?? []);
  const firstPage = isMobile
    ? mobileQuery.data?.pages[0]
    : desktopQuery.data;
  const total = firstPage?.total ?? 0;
  const totalPages = firstPage?.totalPages ?? 1;
  const isLoading = isRequestMode
    ? requestsQuery.isLoading
    : isMobile
      ? mobileQuery.isLoading
      : desktopQuery.isLoading;
  const requests = requestsQuery.data?.requests ?? [];

  // Mobile: bottom sentinel that pulls the next page in when it scrolls into
  // view. Observer is created exactly once (after the first batch mounts)
  // — `mobileQuery` is read through a ref so the callback always sees fresh
  // hasNextPage / fetchNextPage.
  //
  // Small deliberate pause before each fetch so the feed feels like batches
  // of 10 landing one after another, not a bottomless waterfall. Combined
  // with the tight rootMargin it reads as "finish reading these 10 → brief
  // loading blink → next 10 appears", which the user described as less
  // overwhelming than the old instant-preload behaviour.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mobileQueryRef = useRef(mobileQuery);
  useEffect(() => {
    mobileQueryRef.current = mobileQuery;
  });
  const hasAlbums = albums.length > 0;
  const [nextBatchPending, setNextBatchPending] = useState(false);
  useEffect(() => {
    if (!isMobile || !hasAlbums) return;
    const node = sentinelRef.current;
    if (!node) return;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const q = mobileQueryRef.current;
        if (!q.hasNextPage || q.isFetchingNextPage) return;
        if (pendingTimer) return;
        setNextBatchPending(true);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          const q2 = mobileQueryRef.current;
          if (q2.hasNextPage && !q2.isFetchingNextPage) {
            q2.fetchNextPage();
          }
          setNextBatchPending(false);
        }, 450);
      },
      { rootMargin: '100px 0px' }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [isMobile, hasAlbums]);

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    updateParams({ page: p === 1 ? null : String(p) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const items = paginationItems(page, totalPages);

  return (
    <div className="flex-1 flex flex-col px-4 pt-8">
      <section className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] mx-auto">
        {/* Top bar (count / page info / sort) was removed — sort lives
            in TopNav as an icon, count moved into the footer below.
            Grid is the first thing on the page. */}
        {isRequestMode ? (
          // Admin-only pending-requests grid. Same column layout as
          // the main grid so cards visually align; AlbumRequestCard
          // handles its own approve/discard UI.
          isLoading && requests.length === 0 ? (
            <div className="text-center py-20 text-sm text-gray-500">불러오는 중...</div>
          ) : requests.length === 0 ? (
            <div className="text-center py-20 text-sm text-gray-500">
              대기 중인 등록 요청이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
              {requests.map((req) => (
                <AlbumRequestCard key={req.mbid} request={req} />
              ))}
            </div>
          )
        ) : isLoading && albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">불러오는 중...</div>
        ) : albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">등록된 앨범이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
            {albums.map((album) => (
              <AlbumCard key={album.mbid} album={album} />
            ))}
          </div>
        )}

        {/* Mobile infinite-scroll sentinel + status. Desktop renders the
            numbered pagination nav below instead. */}
        {isMobile && albums.length > 0 && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-1" />
            <div className="mt-6 mb-4 text-center text-xs text-gray-600">
              {nextBatchPending || mobileQuery.isFetchingNextPage
                ? '더 불러오는 중…'
                : mobileQuery.hasNextPage
                  ? null
                  : '마지막 앨범까지 봤습니다.'}
            </div>
          </>
        )}

        {/* Desktop-only comment ticker. Sits between the grid and the
            pagination so the community voice plays as a reading rest
            and pagination ends up right above the footer (the spot
            users instinctively reach for to advance the page).
            Intentionally gated with !isMobile (not CSS `hidden md:…`)
            so the feed query doesn't fire on phones at all — mobile
            interleaves comments into the infinite scroll separately.
            Also hidden in request-review mode so admin's attention
            stays on the pending queue. */}
        {!isMobile && !isRequestMode && albums.length > 0 && <CommentTicker />}

        {!isMobile && totalPages > 1 && (
          <nav className="mt-12 flex items-center justify-center gap-1 flex-wrap" aria-label="Pagination">
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
                <span key={idx} className="px-1 text-gray-600 select-none">…</span>
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
      </section>

      <footer className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] mx-auto mt-auto pt-8 pb-4 text-center text-gray-600 text-xs">
        dig.haus &copy; 2026
        {total > 0 && (
          <>
            {' · '}
            총 {total.toLocaleString()}개 앨범 취급 중
          </>
        )}
        {' · '}
        <a href="/privacy.html" className="hover:text-amber-500">개인정보처리방침</a>
        {' · '}
        <a href="/terms.html" className="hover:text-amber-500">서비스 약관</a>
      </footer>
    </div>
  );
}
