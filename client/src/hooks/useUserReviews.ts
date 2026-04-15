import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface UserReview {
  id: number;
  body: string;
  userId: number;
  userName: string | null;
  userAvatar: string | null;
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
    mutationFn: async (body: string) => {
      const { data } = await axios.post(`/api/albums/${albumId}/user-reviews`, { body });
      return data.userReview as UserReview;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-reviews', albumId] });
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
    },
  });
}
