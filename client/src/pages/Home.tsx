import { useEffect, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
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
  { value: 'registered_asc', label: '등록 오래된순' },
  { value: 'release_date_desc', label: '발매일 최신순' },
  { value: 'release_date_asc', label: '발매일 오래된순' },
  { value: 'artist_az', label: '아티스트 A-Z' },
  { value: 'score_desc', label: '리뷰 평점 높은순' },
  { value: 'score_asc', label: '리뷰 평점 낮은순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'price_desc', label: '가격 높은순' },
  { value: 'upvotes_desc', label: '굿굿 많은순' },
  { value: 'downvotes_desc', label: '별루 많은순' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];
const DEFAULT_SORT: SortValue = 'registered_desc';

function isSortValue(v: string): v is SortValue {
  return SORT_OPTIONS.some((o) => o.value === v);
}

function useAlbumList(sort: SortValue, page: number) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page],
    queryFn: async () => {
      const { data } = await axios.get('/api/albums', {
        params: { sort, page },
      });
      return data;
    },
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
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

  useEffect(() => {
    document.title = 'Home | dig.haus';
  }, []);

  const sort: SortValue = useMemo(() => {
    const raw = searchParams.get('sort') || '';
    return isSortValue(raw) ? raw : DEFAULT_SORT;
  }, [searchParams]);

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

  const { data, isLoading } = useAlbumList(sort, page);
  const albums = data?.albums || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

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
                <span className="text-gray-600 mx-2">·</span>
                <span className="text-gray-300 font-medium">{page}</span>
                <span className="text-gray-500">/{totalPages} 페이지</span>
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

        {totalPages > 1 && (
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
