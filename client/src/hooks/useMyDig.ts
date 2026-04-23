import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
  // "r,g,b" string extracted server-side once per album. Null on
  // first load until the server finishes async extraction; drives
  // the coloured-vinyl tint under the cover on the mydig wall.
  coverDominantColor?: string | null;
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
  // Full 50자 평 the page owner wrote for this album, null when
  // they have no review. Shown inside a hover-only speech bubble
  // that pops up alongside the cover's hover-scale + vinyl peek.
  userReview?: {
    body: string;
    emoji: string | null;
    rating: string | null;
  } | null;
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
  vinylWallDescription: string | null;
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

export type MyDigCandidateSource =
  | 'all'
  | 'collection'
  | 'wantlist'
  | 'upvote';

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

interface CandidatePage {
  albums: MyDigCandidate[];
  // Server-supplied cursor for the next page; null = no more.
  nextOffset: number | null;
}

export function useMyDigCandidates(
  source: MyDigCandidateSource,
  q: string,
  enabled: boolean
) {
  return useInfiniteQuery<CandidatePage>({
    queryKey: ['mydig-candidates', source, q],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data } = await axios.get('/api/mydig/candidates', {
        params: {
          source,
          q: q || undefined,
          offset: pageParam ?? 0,
        },
      });
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled,
    staleTime: 15_000,
  });
}

export function useUpdateVinylWallTheme(username: string | undefined) {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; theme?: string | null; description?: string | null },
    unknown,
    // Either field can be omitted — the server treats missing as
    // "don't touch". Null = clear back to default.
    { theme?: string | null; description?: string | null }
  >({
    mutationFn: async (body) => {
      const { data } = await axios.patch('/api/mydig/vinyl-wall/theme', body);
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
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  itemCount: number;
}

export interface VinylWallSnapshotDetail {
  snapshot: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
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
    // Owner's 50자 평 for this album (if any) — surfaced so the
    // snapshot renders the same hover bubble the live wall does.
    // Lives outside the snapshot row on the server, so it always
    // reflects the current review, not what was written at
    // snapshot time.
    userReview: {
      body: string;
      emoji: string | null;
      rating: string | null;
    } | null;
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
    {
      name?: string;
      description?: string | null;
      isPublic?: boolean;
      // Optional explicit item list — when present the server
      // snapshots this arrangement instead of the owner's live
      // wall. Used by the editor's "scratch" flow so the draft
      // can be saved without first committing it to the live wall.
      items?: Array<{ position: number; albumId: number }>;
    }
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
    { id: number; name?: string; description?: string | null; isPublic?: boolean }
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

export function useSaveVinylWallSnapshotItems(
  username: string | undefined,
  snapshotId: number | null,
  slug: string | null
) {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; count: number },
    unknown,
    Array<{ position: number; albumId: number }>
  >({
    mutationFn: async (items) => {
      if (!snapshotId) {
        throw new Error('snapshot id missing');
      }
      const { data } = await axios.put(
        `/api/mydig/vinyl-wall/snapshots/${snapshotId}/items`,
        { items }
      );
      return data;
    },
    onSuccess: () => {
      // Refetch the snapshot detail (what the snapshot page renders)
      // + the owner's snapshot list (item count rollup). Invalidates
      // with just `username` as the second key so every slug scoped
      // to this user refetches — simpler than juggling the active
      // slug through the mutation.
      if (username) {
        qc.invalidateQueries({ queryKey: ['mydig-snapshot', username] });
        qc.invalidateQueries({ queryKey: ['mydig-snapshots', username] });
      }
      // Silence unused — slug is kept in the hook signature so the
      // caller's query key can stay in sync if we ever want per-slug
      // granularity here.
      void slug;
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
