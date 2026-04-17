import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface UserReview {
  id: number;
  body: string;
  emoji: string | null;
  rating: 'up' | 'down' | 'soso' | null;
  // userId is null when the review's author has deleted their account —
  // the row is preserved (via ON DELETE SET NULL) but anonymised.
  userId: number | null;
  userName: string | null;
  userAvatar: string | null;
  /** 굿굿 / 별루 tallies for the author across all albums. */
  userUpvoteCount: number;
  userDownvoteCount: number;
}

export function useUserReviews(albumId: string, enabled = true) {
  return useQuery<{ userReviews: UserReview[] }>({
    queryKey: ['user-reviews', albumId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/albums/${albumId}/user-reviews`);
      return data;
    },
    enabled: !!albumId && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpsertUserReview(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { body: string; emoji: string | null; rating: 'up' | 'down' | 'soso' }) => {
      const { data } = await axios.post(`/api/albums/${albumId}/user-reviews`, payload);
      return data.userReview as UserReview;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-reviews', albumId] });
      // Review's thumbs selection also updates the album's 굿굿/별루 vote counts.
      qc.invalidateQueries({ queryKey: ['album', albumId] });
    },
  });
}

export function useDeleteUserReview(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: number) => {
      await axios.delete(`/api/user-reviews/${reviewId}`);
      return reviewId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-reviews', albumId] });
      // Deleting a review also withdraws the author's 굿굿/별루 vote, so the
      // album's up/down counts and the user's own vote state change.
      qc.invalidateQueries({ queryKey: ['album', albumId] });
    },
  });
}
