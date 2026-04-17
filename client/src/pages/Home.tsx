import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import CommentTicker, { TickerItem } from '../components/Home/CommentTicker';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { useInView } from '../hooks/useInView';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import { useHomeState } from '../contexts/HomeStateContext';
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

// One infinite-scroll batch on mobile — 10 albums (2 × 5 rows) plus a
// pair of ticker cards at the tail. Gated by IntersectionObserver: the
// wave animation only runs once the batch actually enters the
// viewport, so batches fetched eagerly by the sentinel don't burn
// their reveal while the user is still scrolling above them.
const MOBILE_ROW_STAGGER_MS = 90;
function MobileAlbumBatch({
  albums,
  tickerPair,
  batchIdx,
}: {
  albums: AlbumSearchResult[];
  tickerPair: UserReviewFeedItem[];
  batchIdx: number;
}) {
  // rootMargin 0px: fires the moment any part of the batch crosses
  // into the viewport. A pre-fetch margin would defeat the purpose —
  // we'd fire the wave for off-screen batches again.
  const { ref, inView } = useInView<HTMLDivElement>('0px');
  const cardClass = inView ? 'album-reveal' : 'album-reveal-off';

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
                    animationDelay: `${Math.floor(idx / 2) * MOBILE_ROW_STAGGER_MS}ms`,
                  }
                : undefined
            }
          >
            <AlbumCard album={album} />
          </div>
        ))}
      </div>
      {tickerPair.length > 0 && (
        <div className="flex flex-col gap-4">
          {tickerPair.map((item, idx) => (
            <div
              key={`${batchIdx}-${item.id}`}
              className={cardClass}
              style={
                inView
                  ? {
                      animationDelay: `${(5 + idx) * MOBILE_ROW_STAGGER_MS}ms`,
                    }
                  : undefined
              }
            >
              <TickerItem
                item={item}
                fullWidth
                orientation={idx === 0 ? 'left' : 'right'}
              />
            </div>
          ))}
        </div>
      )}
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

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openOverlay } = useSearchOverlay();
  const isMobile = useIsMobile();
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

  const desktopQuery = useDesktopAlbumList(
    sort,
    page,
    !isMobile && seedReady,
    seed
  );
  const mobileQuery = useMobileAlbumList(sort, isMobile && seedReady, seed);

  const albums: AlbumSearchResult[] = isMobile
    ? (mobileQuery.data?.pages.flatMap((p) => p.albums) ?? [])
    : (desktopQuery.data?.albums ?? []);
  const firstPage = isMobile
    ? mobileQuery.data?.pages[0]
    : desktopQuery.data;
  const totalPages = firstPage?.totalPages ?? 1;
  const isLoading = isMobile
    ? mobileQuery.isLoading
    : desktopQuery.isLoading;

  // Mobile-only: pull the same user-reviews feed the desktop ticker uses,
  // so we can interleave one static card below each 10-album batch. The
  // desktop ticker already fetches this on its own render — the shared
  // react-query cache key means desktop keeps working without refetching.
  const feedQuery = useUserReviewsFeed(isMobile && albums.length > 0);
  // Shuffle once per feed payload so successive batches pull different
  // comments without reshuffling on every re-render (and without
  // reshuffling just because the user scrolled another page into view).
  const shuffledFeed = useMemo(() => {
    const src = feedQuery.data?.items ?? [];
    const arr = [...src];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [feedQuery.data?.items]);

  // Desktop reveal: each card drops in at a shuffled delay so the 18
  // tiles don't all land simultaneously — the order reshuffles on every
  // page change (and reseed, and sort change), so flipping through the
  // grid always reads as a new scatter rather than a repeating cascade.
  // Max delay caps the total reveal window at ~400ms so the grid feels
  // lively, not laggy.
  const DESKTOP_STAGGER_MS = 22;
  const desktopRevealDelays = useMemo(() => {
    const arr = Array.from({ length: DESKTOP_PAGE_SIZE }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
    // Reshuffle whenever the rendered page changes. seed is also a dep
    // so a "random" sort's successive refreshes each reveal differently.
  }, [sort, page, seed]);


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
    <div className="flex-1 flex flex-col px-4 pt-8">
      <section className="w-full max-w-[1280px] mx-auto">
        {/* Top bar (count / page info / sort) was removed — sort lives
            in TopNav as an icon, count moved into the footer below.
            Grid is the first thing on the page. */}
        {isLoading && albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">불러오는 중...</div>
        ) : albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">등록된 앨범이 없습니다.</div>
        ) : isMobile ? (
          // Mobile: render each infinite-scroll batch as its own grid, with
          // a single static ticker card sandwiched between batches. The
          // batch boundaries already match the user's reading rhythm
          // (450ms pause + 10 new cards), so a comment slotted in here
          // feels like a natural beat rather than a separate section.
          <div className="flex flex-col gap-5">
            {mobileQuery.data?.pages.map((p, i) => {
              // Two cards per batch, alternating orientation so one
              // leans left (avatar + tail on the left) and the next
              // leans right. Pulls sequential items from the shuffled
              // feed and wraps around if the feed is shorter than
              // (pages × 2).
              const pair =
                shuffledFeed.length > 0
                  ? [
                      shuffledFeed[(i * 2) % shuffledFeed.length],
                      shuffledFeed[(i * 2 + 1) % shuffledFeed.length],
                    ]
                  : [];
              return (
                <MobileAlbumBatch
                  key={i}
                  batchIdx={i}
                  albums={p.albums}
                  tickerPair={pair}
                />
              );
            })}
          </div>
        ) : (
          // Desktop: grid key tracks the actual displayed album list
          // (first + last mbid + length) rather than the query params,
          // so the remount — and the reveal animation — fires only
          // when new data lands, not at the click that requested it.
          // keepPreviousData keeps the previous page visible during
          // fetch; if we keyed on `page` instead, animations would
          // play on the stale page just before it got replaced.
          <div
            key={`desktop-${albums.length}-${albums[0]?.mbid ?? ''}-${albums[albums.length - 1]?.mbid ?? ''}`}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5"
          >
            {albums.map((album, i) => (
              <div
                key={album.mbid}
                className="album-reveal"
                style={{
                  animationDelay: `${(desktopRevealDelays[i] ?? i) * DESKTOP_STAGGER_MS}ms`,
                }}
              >
                <AlbumCard album={album} />
              </div>
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

        {/* Desktop-only comment ticker below pagination. */}
        {!isMobile && albums.length > 0 && <CommentTicker />}
      </section>
    </div>
  );
}
