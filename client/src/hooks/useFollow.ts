import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

// Follow mutations + list reads. Mutations optimistically flip the
// `followingByViewer` flag + adjust the follower/following counts
// on whatever cached copies of the target user's public profile
// are in React Query so the button state and the "팔로워 N" label
// stay in sync without waiting for the refetch to come back.

export interface FollowListUser {
  id: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followingByViewer: boolean;
}

export interface FollowList {
  count: number;
  users: FollowListUser[];
}

export function useFollowers(userId: number | null | undefined) {
  return useQuery<FollowList>({
    queryKey: ['follow-list', 'followers', userId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/users/${userId}/followers`);
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useFollowing(userId: number | null | undefined) {
  return useQuery<FollowList>({
    queryKey: ['follow-list', 'following', userId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/users/${userId}/following`);
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

// Mutation shape: caller passes the target userId + the desired
// end state (true = follow, false = unfollow). The optimistic
// update nudges the `user-public` cache entry for the target so
// the button flips right away.
export function useFollowMutation() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; following: boolean },
    unknown,
    { userId: number; follow: boolean },
    { prev: any }
  >({
    mutationFn: async ({ userId, follow }) => {
      if (follow) {
        const { data } = await axios.post(`/api/users/${userId}/follow`);
        return data;
      }
      const { data } = await axios.delete(`/api/users/${userId}/follow`);
      return data;
    },
    onMutate: async ({ userId, follow }) => {
      await qc.cancelQueries({ queryKey: ['user-public', userId] });
      const prev = qc.getQueryData(['user-public', userId]);
      qc.setQueryData(['user-public', userId], (old: any) => {
        if (!old) return old;
        const prevCount = old.stats?.followerCount ?? 0;
        const prevFollowing = !!old.followingByViewer;
        // Guard against double-clicks landing the same state twice.
        const delta = follow === prevFollowing ? 0 : follow ? 1 : -1;
        return {
          ...old,
          followingByViewer: follow,
          stats: {
            ...old.stats,
            followerCount: Math.max(0, prevCount + delta),
          },
        };
      });
      return { prev };
    },
    onError: (_err, { userId }, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(['user-public', userId], ctx.prev);
      }
    },
    onSettled: (_data, _err, { userId }) => {
      qc.invalidateQueries({ queryKey: ['user-public', userId] });
      qc.invalidateQueries({ queryKey: ['follow-list'] });
    },
  });
}
