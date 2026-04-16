import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import type { AlbumSearchResult } from '../types';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const SORT_OPTIONS = [
  { value: 'registered_desc', label: '등록 최신순' },
  { value: 'release_date_desc', label: '발매 최신순' },
  { value: 'artist_az', label: '아티스트 A-Z' },
  { value: 'score_desc', label: '리뷰 평점순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'upvotes_desc', label: '굿굿 많은순' },
  { value: 'downvotes_desc', label: '별루 많은순' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];
const DEFAULT_SORT: SortValue = 'registered_desc';
const SORT_STORAGE_KEY = 'home:sort';

// Mobile/desktop split: desktop sticks with classic numbered pagination
// (20 per page), mobile switches to infinite scroll (10 per batch). Tailwind
// `md` breakpoint = 768px, so anything below counts as mobile here.
const MOBILE_QUERY = '(max-width: 767px)';
const DESKTOP_PAGE_SIZE = 20;
const MOBILE_PAGE_SIZE = 10;

function isSortValue(v: string): v is SortValue {
  return SORT_OPTIONS.some((o) => o.value === v);
}

function readStoredSort(): SortValue | null {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY) || '';
    return isSortValue(raw) ? raw : null;
  } catch {
    return null;
  }
}

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

async function fetchAlbumPage(sort: SortValue, page: number, pageSize: number) {
  const { data } = await axios.get<AlbumListResponse>('/api/albums', {
    params: { sort, page, pageSize },
  });
  return data;
}

function useDesktopAlbumList(sort: SortValue, page: number, enabled: boolean) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page, DESKTOP_PAGE_SIZE],
    queryFn: () => fetchAlbumPage(sort, page, DESKTOP_PAGE_SIZE),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useMobileAlbumList(sort: SortValue, enabled: boolean) {
  return useInfiniteQuery<AlbumListResponse>({
    queryKey: ['album-list-infinite', sort, MOBILE_PAGE_SIZE],
    queryFn: ({ pageParam }) =>
      fetchAlbumPage(sort, pageParam as number, MOBILE_PAGE_SIZE),
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

  const desktopQuery = useDesktopAlbumList(sort, page, !isMobile);
  const mobileQuery = useMobileAlbumList(sort, isMobile);

  const albums: AlbumSearchResult[] = isMobile
    ? (mobileQuery.data?.pages.flatMap((p) => p.albums) ?? [])
    : (desktopQuery.data?.albums ?? []);
  const firstPage = isMobile
    ? mobileQuery.data?.pages[0]
    : desktopQuery.data;
  const total = firstPage?.total ?? 0;
  const totalPages = firstPage?.totalPages ?? 1;
  const isLoading = isMobile
    ? mobileQuery.isLoading
    : desktopQuery.isLoading;

  // Mobile: bottom sentinel that pulls the next page in when it scrolls into
  // view. The previous setup used a 600px rootMargin AND re-created the
  // observer on every page load — which on a typical phone left the sentinel
  // already inside the observation zone after page 1, immediately auto-firing
  // page 2 (so the user saw 20 albums on first paint).
  //
  // Now: rootMargin is small (200px) so the sentinel is below the
  // observation zone on first paint, and the observer is created exactly
  // once (after the first batch mounts) — `mobileQuery` is read through a
  // ref so the callback always sees fresh hasNextPage / fetchNextPage.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mobileQueryRef = useRef(mobileQuery);
  useEffect(() => {
    mobileQueryRef.current = mobileQuery;
  });
  const hasAlbums = albums.length > 0;
  useEffect(() => {
    if (!isMobile || !hasAlbums) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const q = mobileQueryRef.current;
        if (q.hasNextPage && !q.isFetchingNextPage) {
          q.fetchNextPage();
        }
      },
      { rootMargin: '200px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isMobile, hasAlbums]);

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  function handleSortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as SortValue;
    // Clear storage synchronously — otherwise the sort memo falls back to the
    // stale stored value after we strip the URL param for DEFAULT_SORT.
    try {
      if (v === DEFAULT_SORT) localStorage.removeItem(SORT_STORAGE_KEY);
      else localStorage.setItem(SORT_STORAGE_KEY, v);
    } catch {
      // ignore storage errors
    }
    updateParams({
      sort: v === DEFAULT_SORT ? null : v,
      page: null,
    });
  }

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    updateParams({ page: p === 1 ? null : String(p) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const items = paginationItems(page, totalPages);

  return (
    <div className="flex-1 flex flex-col px-4 pt-8">
      <section className="w-full max-w-6xl mx-auto">
        <div className="flex items-center mb-6 flex-wrap gap-3">
          <div className="text-sm text-gray-500">
            {total > 0 && (
              <>
                총 <span className="text-gray-300 font-medium">{total.toLocaleString()}</span>개 앨범
                {!isMobile && (
                  <>
                    <span className="text-gray-600 mx-2">·</span>
                    <span className="text-gray-300 font-medium">{page}</span>
                    <span className="text-gray-500">/{totalPages} 페이지</span>
                  </>
                )}
              </>
            )}
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-gray-500">정렬</span>
            <select
              value={sort}
              onChange={handleSortChange}
              className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1.5 text-gray-200 focus:border-[#e8a020] focus:outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading && albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">불러오는 중...</div>
        ) : albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">등록된 앨범이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
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
              {mobileQuery.isFetchingNextPage
                ? '더 불러오는 중…'
                : mobileQuery.hasNextPage
                  ? null
                  : '마지막 앨범까지 봤습니다.'}
            </div>
          </>
        )}

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

      <footer className="w-full max-w-6xl mx-auto mt-auto pt-8 pb-4 text-center text-gray-600 text-xs">
        dig.haus &copy; 2026
        {' · '}
        <a href="/privacy.html" className="hover:text-amber-500">개인정보처리방침</a>
        {' · '}
        <a href="/terms.html" className="hover:text-amber-500">서비스 약관</a>
      </footer>
    </div>
  );
}
