import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { AlbumSearchResult } from '../types';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Recently registered albums — sorted by id DESC server-side
// (registered_desc), which is a stable proxy for created_at since
// auto-increment ids are monotonic. The home unified feed merges this
// stream with snapshots + 50자 평 and sorts by createdAt across all
// three, so the response must include the createdAt field (added to
// ALBUM_ROW_SELECT for this purpose).
export function useRecentAlbums(enabled = true, limit = 30) {
  return useQuery<AlbumListResponse>({
    queryKey: ['home-recent-albums', limit],
    queryFn: async () => {
      const { data } = await axios.get<AlbumListResponse>('/api/albums', {
        params: {
          sort: 'registered_desc',
          page: 1,
          pageSize: limit,
        },
      });
      return data;
    },
    enabled,
    staleTime: 1000 * 60 * 2,
  });
}

// Infinite-scroll variant for the home feed. The /api/albums endpoint
// already returns page / totalPages, so getNextPageParam can drive
// page-by-page fetching without a separate cursor mechanism.
export function useInfiniteRecentAlbums(enabled = true, pageSize = 30) {
  return useInfiniteQuery<AlbumListResponse>({
    queryKey: ['home-recent-albums-infinite', pageSize],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await axios.get<AlbumListResponse>('/api/albums', {
        params: {
          sort: 'registered_desc',
          page: pageParam,
          pageSize,
        },
      });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled,
    staleTime: 1000 * 60 * 2,
  });
}
