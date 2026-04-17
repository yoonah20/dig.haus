import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { OwnershipFormat, OwnershipState } from '../types';

interface OwnershipResponse {
  format: OwnershipFormat;
  state: OwnershipState;
  ownedCount: number;
  wantedCount: number;
  userOwnedFormats: OwnershipFormat[];
  userWantedFormats: OwnershipFormat[];
}

// Single mutation for every transition. `format` picks which physical
// format the state applies to; state=null clears that format's entry.
// Mutual exclusivity is scoped to (user, album, format) server-side —
// setting vinyl to owned doesn't touch the CD row.
export function useSetOwnership(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      state: OwnershipState;
      format: OwnershipFormat;
    }) => {
      const { data } = await axios.put<OwnershipResponse>(
        `/api/albums/${encodeURIComponent(albumId)}/ownership`,
        { state: vars.state, format: vars.format }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album', albumId] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
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
  /** Formats this user has for the album — deduped server-side via
   *  GROUP_CONCAT(DISTINCT format). */
  formats: OwnershipFormat[];
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
