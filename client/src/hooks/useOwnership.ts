import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { OwnershipState } from '../types';

interface OwnershipResponse {
  state: OwnershipState;
  ownedCount: number;
  wantedCount: number;
}

// Single mutation covering all state transitions on an album. Pass
// 'owned' to add to the 샀음 collection, 'wanted' for the 살거 wantlist,
// or null to clear both. Server enforces mutual exclusivity. React
// Query cache updates are broad (album detail + home list + user
// popover) because the counts appear in several surfaces at once.
export function useSetOwnership(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (state: OwnershipState) => {
      const { data } = await axios.put<OwnershipResponse>(
        `/api/albums/${encodeURIComponent(albumId)}/ownership`,
        { state }
      );
      return data;
    },
    onSuccess: () => {
      // Album detail page owns the authoritative userOwnership.
      qc.invalidateQueries({ queryKey: ['album', albumId] });
      // Home grid shows the counts on card backs; the logged-in user's
      // own state isn't exposed there in v1 so a plain list invalidate
      // is enough.
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
      // Profile page counts + user hover-card counts.
      qc.invalidateQueries({ queryKey: ['me-collection'] });
      qc.invalidateQueries({ queryKey: ['me-wantlist'] });
      qc.invalidateQueries({ queryKey: ['user-public'] });
    },
  });
}

interface CollectionItem {
  slug: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
  addedAt: string;
}

export function useMyCollection(enabled = true) {
  return useQuery<{ items: CollectionItem[] }>({
    queryKey: ['me-collection'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/collection');
      return data;
    },
    enabled,
    staleTime: 1000 * 60,
  });
}

export function useMyWantlist(enabled = true) {
  return useQuery<{ items: CollectionItem[] }>({
    queryKey: ['me-wantlist'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/wantlist');
      return data;
    },
    enabled,
    staleTime: 1000 * 60,
  });
}
