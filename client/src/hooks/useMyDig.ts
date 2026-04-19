import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface MyDigAlbum {
  id: number;
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  releaseDate?: string | null;
  releaseYear?: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
}

export interface MyDigUser {
  id?: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
}

export interface MyDigWallItem {
  position: number;
  album: MyDigAlbum;
}

export interface MyDigGenre {
  id: number;
  slug: string;
  nameKo: string;
  nameEn: string;
}

export interface MyDigShelfSlot {
  slotId: number;
  position: number;
  genre: MyDigGenre | null;
  items: Array<{ position: number; album: MyDigAlbum }>;
}

export interface MyDigCrate {
  crateId: number;
  position: number;
  title: string;
  description: string | null;
  items: Array<{ position: number; album: MyDigAlbum }>;
}

export interface MyDigData {
  user: MyDigUser;
  isPublic: boolean;
  vinylWall: MyDigWallItem[];
  shelf: MyDigShelfSlot[];
  crates: MyDigCrate[];
}

export function useMyDig(username: string | undefined) {
  return useQuery<MyDigData>({
    queryKey: ['mydig', username],
    queryFn: async () => {
      const { data } = await axios.get(`/api/mydig/${encodeURIComponent(username!)}`);
      return data;
    },
    enabled: !!username,
    staleTime: 30_000,
  });
}

export type MyDigCandidateSource = 'all' | 'collection' | 'wantlist' | 'crate';

export interface MyDigCandidate {
  id: number;
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
}

export function useMyDigCandidates(
  source: MyDigCandidateSource,
  q: string,
  enabled: boolean
) {
  return useQuery<{ albums: MyDigCandidate[] }>({
    queryKey: ['mydig-candidates', source, q],
    queryFn: async () => {
      const { data } = await axios.get('/api/mydig/candidates', {
        params: { source, q: q || undefined },
      });
      return data;
    },
    enabled,
    staleTime: 15_000,
  });
}

export function useSaveVinylWall(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; count: number },
    unknown,
    Array<{ position: number; albumId: number }>
  >({
    mutationFn: async (items) => {
      const { data } = await axios.put('/api/mydig/vinyl-wall/items', { items });
      return data;
    },
    onSuccess: () => {
      // The saved state belongs to the owner — invalidate their mydig
      // page so the read-view reflects the new placement.
      if (username) qc.invalidateQueries({ queryKey: ['mydig', username] });
    },
  });
}
