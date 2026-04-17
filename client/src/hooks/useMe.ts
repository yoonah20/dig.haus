import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { AuthUser } from '../types';

export interface MyProfileStats {
  reviewCount: number;
  upvoteCount: number;
  downvoteCount: number;
}

export interface MyProfile {
  user: AuthUser & { createdAt: string | null };
  stats: MyProfileStats;
}

export interface MyReview {
  id: number;
  body: string;
  emoji: string | null;
  rating: 'up' | 'down' | 'soso' | null;
  createdAt: string;
  updatedAt: string;
  albumSlug: string;
  albumTitle: string;
  albumArtist: string;
  albumCoverUrl: string | null;
  albumCoverFallbacks: string[];
}

export interface MyUpvote {
  slug: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks: string[];
  votedAt: string;
}

export function useMyProfile() {
  return useQuery<MyProfile>({
    queryKey: ['me-profile'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/profile');
      return data;
    },
    staleTime: 1000 * 60,
  });
}

// Any profile change should refresh the per-album comment lists so the
// user's updated name/avatar shows up on cards they've already posted.
// Also touches the hover-card cache and the auth/me snapshot.
function invalidateNameOrAvatarDependants(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['me-profile'] });
  qc.invalidateQueries({ queryKey: ['auth-me'] });
  qc.invalidateQueries({ queryKey: ['user-reviews'] });
  qc.invalidateQueries({ queryKey: ['user-public'] });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      displayName?: string | null;
      instagramHandle?: string | null;
    }) => {
      const { data } = await axios.patch('/api/me/profile', patch);
      return data;
    },
    onSuccess: () => invalidateNameOrAvatarDependants(qc),
  });
}

export function useUploadMyAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('avatar', file);
      // Intentionally NO explicit Content-Type — axios infers it with the
      // correct multipart boundary from the FormData instance. Setting
      // "multipart/form-data" manually strips the boundary and the server
      // fails to parse the body.
      const { data } = await axios.post('/api/me/avatar', fd);
      return data;
    },
    onSuccess: () => invalidateNameOrAvatarDependants(qc),
  });
}

export function useResetMyAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.delete('/api/me/avatar');
      return data;
    },
    onSuccess: () => invalidateNameOrAvatarDependants(qc),
  });
}

export function useMyReviews() {
  return useQuery<{ reviews: MyReview[] }>({
    queryKey: ['me-reviews'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/reviews');
      return data;
    },
    staleTime: 1000 * 30,
  });
}

export function useDeleteMyReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/user-reviews/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-reviews'] });
      qc.invalidateQueries({ queryKey: ['me-profile'] });
      // Touch the per-album review lists — they may be on screen elsewhere.
      qc.invalidateQueries({ queryKey: ['user-reviews'] });
      qc.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
    },
  });
}

export function useDeleteMyAccount() {
  return useMutation({
    mutationFn: async () => {
      await axios.delete('/api/me');
    },
  });
}

export function useMyUpvotes() {
  return useQuery<{ upvotes: MyUpvote[] }>({
    queryKey: ['me-upvotes'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/upvotes');
      return data;
    },
    staleTime: 1000 * 30,
  });
}

// ─── Public user card (hover popover on comment avatars) ─────────────────

export interface UserPublic {
  user: {
    id: number;
    name: string | null;
    avatarUrl: string | null;
    instagramHandle: string | null;
    createdAt: string | null;
  };
  stats: {
    reviewCount: number;
    upvoteCount: number;
    downvoteCount: number;
    upvotePct: number | null;
    downvotePct: number | null;
    ownedCount?: number;
    wantedCount?: number;
  };
}

export function useUserPublic(id: number | null | undefined, enabled = true) {
  return useQuery<UserPublic>({
    queryKey: ['user-public', id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/users/${id}/public`);
      return data;
    },
    enabled: !!id && enabled,
    staleTime: 1000 * 60 * 5,
  });
}
