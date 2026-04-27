import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

// Crate API hooks. Replaces useOwnership after collections + wants
// were absorbed into the unified crate system (post-Phase 3 roadmap
// item 2). The 담기 button on /album/:slug uses these to read the
// caller's crates and toggle membership.

export interface CrateCoverThumb {
  url: string | null;
  fallbacks: string[];
}

export interface CrateSummary {
  id: number;
  title: string;
  description: string | null;
  isPublic: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  coverThumbs: CrateCoverThumb[];
}

export interface CrateItem {
  id: number;
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks: string[];
  addedAt: string;
}

export interface CrateDetail {
  crate: CrateSummary;
  isOwner: boolean;
  items: CrateItem[];
}

// Owner-scoped list. Use for the picker on the album page and the
// owner's view of their own mydig.
export function useMyCrates(enabled = true) {
  return useQuery<{ crates: CrateSummary[] }>({
    queryKey: ['crates', 'me'],
    queryFn: async () => {
      const { data } = await axios.get('/api/mydig/crates');
      return data;
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

// Public list for any user. Returns only is_public=1 crates unless
// the viewer is the owner of the username.
export function useUserCrates(username: string | null | undefined) {
  return useQuery<{ crates: CrateSummary[] }>({
    queryKey: ['crates', 'user', username],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/mydig/users/${encodeURIComponent(username!)}/crates`
      );
      return data;
    },
    enabled: !!username,
    staleTime: 30 * 1000,
  });
}

export function useCrateDetail(crateId: number | null | undefined) {
  return useQuery<CrateDetail>({
    queryKey: ['crates', 'detail', crateId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/mydig/crates/${crateId}`);
      return data;
    },
    enabled: crateId != null,
    staleTime: 15 * 1000,
  });
}

// Per-album lookup: which of the caller's crates already contain
// this album. Drives the checkmarks on the 담기 dropdown so a
// repeat click visibly removes / re-adds.
export function useAlbumCrateMembership(
  albumId: number | null | undefined,
  enabled = true
) {
  return useQuery<{ crateIds: number[] }>({
    queryKey: ['crates', 'membership', albumId],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/mydig/crates/album-membership/${albumId}`
      );
      return data;
    },
    enabled: enabled && albumId != null,
    staleTime: 5 * 1000,
  });
}

export function useCreateCrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      title: string;
      description?: string | null;
      isPublic?: boolean;
    }) => {
      const { data } = await axios.post<{ crate: CrateSummary }>(
        '/api/mydig/crates',
        vars
      );
      return data.crate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}

export function useUpdateCrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      title?: string;
      description?: string | null;
      isPublic?: boolean;
    }) => {
      const { id, ...body } = vars;
      const { data } = await axios.patch<{ crate: CrateSummary }>(
        `/api/mydig/crates/${id}`,
        body
      );
      return data.crate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}

export function useDeleteCrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/mydig/crates/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}

export function useAddToCrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { crateId: number; albumId: number }) => {
      await axios.post(`/api/mydig/crates/${vars.crateId}/items`, {
        albumId: vars.albumId,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['crates'] });
      qc.invalidateQueries({
        queryKey: ['crates', 'membership', vars.albumId],
      });
      // The album page's public crateCount and the home grid's
      // crate_count both pull from these queries.
      qc.invalidateQueries({ queryKey: ['album'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}

export function useRemoveFromCrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { crateId: number; albumId: number }) => {
      await axios.delete(
        `/api/mydig/crates/${vars.crateId}/items/${vars.albumId}`
      );
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['crates'] });
      qc.invalidateQueries({
        queryKey: ['crates', 'membership', vars.albumId],
      });
      qc.invalidateQueries({ queryKey: ['album'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}
