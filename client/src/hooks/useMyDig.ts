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
  vinylWallTheme: string | null;
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

export function useUpdateVinylWallTheme(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; theme: string | null }, unknown, string | null>({
    mutationFn: async (theme) => {
      const { data } = await axios.patch('/api/mydig/vinyl-wall/theme', { theme });
      return data;
    },
    onSuccess: () => {
      if (username) qc.invalidateQueries({ queryKey: ['mydig', username] });
    },
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

// ─── Vinyl-wall snapshots ─────────────────────────────────────

export interface VinylWallSnapshotSummary {
  id: number;
  slug: string;
  name: string;
  isPublic: boolean;
  createdAt: string;
  itemCount: number;
}

export interface VinylWallSnapshotDetail {
  snapshot: {
    id: number;
    slug: string;
    name: string;
    isPublic: boolean;
    createdAt: string;
  };
  user: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isOwner: boolean;
  };
  items: Array<{
    position: number;
    album: MyDigAlbum | null;
  }>;
}

export function useVinylWallSnapshots(username: string | undefined) {
  return useQuery<{ snapshots: VinylWallSnapshotSummary[] }>({
    queryKey: ['mydig-snapshots', username],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/mydig/${encodeURIComponent(username!)}/snapshots`
      );
      return data;
    },
    enabled: !!username,
    staleTime: 10_000,
  });
}

export function useVinylWallSnapshot(
  username: string | undefined,
  slug: string | undefined
) {
  return useQuery<VinylWallSnapshotDetail>({
    queryKey: ['mydig-snapshot', username, slug],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/mydig/${encodeURIComponent(username!)}/snapshots/${encodeURIComponent(slug!)}`
      );
      return data;
    },
    enabled: !!username && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateVinylWallSnapshot(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<
    VinylWallSnapshotSummary,
    unknown,
    { name?: string; isPublic?: boolean }
  >({
    mutationFn: async (body) => {
      const { data } = await axios.post('/api/mydig/vinyl-wall/snapshots', body);
      return data;
    },
    onSuccess: () => {
      if (username) qc.invalidateQueries({ queryKey: ['mydig-snapshots', username] });
    },
  });
}

export function useUpdateVinylWallSnapshot(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<
    VinylWallSnapshotSummary,
    unknown,
    { id: number; name?: string; isPublic?: boolean }
  >({
    mutationFn: async ({ id, ...body }) => {
      const { data } = await axios.patch(
        `/api/mydig/vinyl-wall/snapshots/${id}`,
        body
      );
      return data;
    },
    onSuccess: (_data, { id }) => {
      if (username) {
        qc.invalidateQueries({ queryKey: ['mydig-snapshots', username] });
        qc.invalidateQueries({ queryKey: ['mydig-snapshot', username] });
      }
      // no-op on id param — kept for the type system
      void id;
    },
  });
}

export function useDeleteVinylWallSnapshot(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, unknown, number>({
    mutationFn: async (id) => {
      const { data } = await axios.delete(
        `/api/mydig/vinyl-wall/snapshots/${id}`
      );
      return data;
    },
    onSuccess: () => {
      if (username) qc.invalidateQueries({ queryKey: ['mydig-snapshots', username] });
    },
  });
}
