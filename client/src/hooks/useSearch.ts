import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { SearchResults } from '../types';

// DB-only search over registered albums. Used by the homepage SearchBar.
export function useSearch(query: string) {
  return useQuery<SearchResults>({
    queryKey: ['album-db-search', query],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/albums/search?q=${encodeURIComponent(query)}`
      );
      return data;
    },
    enabled: query.length >= 1,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

// External search (MusicBrainz + Discogs). Admin-only on the server —
// non-admin callers fall back to DB search transparently.
export function useExternalSearch(query: string, enabled = true) {
  return useQuery<SearchResults>({
    queryKey: ['external-search', query],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/search?q=${encodeURIComponent(query)}`
      );
      return data;
    },
    enabled: enabled && query.length >= 2,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });
}

// External search for the album-request flow — available to any
// logged-in user, rate-limited on the server (30/min). Hits a
// dedicated endpoint instead of /api/search so the nav search bar
// stays DB-only for non-admins.
export function useRequestSearch(query: string, enabled = true) {
  return useQuery<SearchResults>({
    queryKey: ['album-request-search', query],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/album-requests/search?q=${encodeURIComponent(query)}`
      );
      return data;
    },
    enabled: enabled && query.length >= 2,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });
}
