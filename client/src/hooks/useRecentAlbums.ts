import { useQuery } from '@tanstack/react-query';
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
