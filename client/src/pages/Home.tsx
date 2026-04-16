import { useEffect, useRef, useState } from 'react';
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
import { useHomeState } from '../contexts/HomeStateContext';
import { useAlbumRequests } from '../hooks/useAlbumRequests';
import type { AlbumSearchResult } from '../types';
import { type SortValue } from '../lib/homeSort';

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
  // sort / page / seed live in HomeStateContext — no URL involvement,
  // so the address bar stays at '/'. See contexts/HomeStateContext.tsx
  // for the persistence rules (localStorage for sort, in-memory for
  // page + seed).
  const { sort, page, setPage, seed } = useHomeState();

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

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const items = paginationItems(page, totalPages);

  return (
    <div className="flex-1 flex flex-col px-4 pt-12">
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
