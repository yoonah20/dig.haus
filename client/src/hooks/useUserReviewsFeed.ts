import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';

// One row in the homepage comment ticker. Covers everything the ticker
// needs to render without a follow-up request per item — body + user +
// album-for-navigation + cover-for-blur.
export interface UserReviewFeedItem {
  id: number;
  body: string;
  emoji: string | null;
  rating: 'up' | 'down' | 'soso' | null;
  createdAt: string;
  // null when the author has deleted their account, or when the
  // user hasn't claimed a /my/:username slug yet.
  userId: number | null;
  userName: string | null;
  userUsername: string | null;
  userAvatar: string | null;
  userUpvoteCount: number;
  userDownvoteCount: number;
  albumSlug: string;
  albumTitle: string;
  albumArtist: string | null;
  albumCoverUrl: string | null;
  albumCoverFallbacks: string[];
}

export function useUserReviewsFeed(enabled = true, limit = 30) {
  return useQuery<{ items: UserReviewFeedItem[] }>({
    queryKey: ['user-reviews-feed', limit],
    queryFn: async () => {
      const { data } = await axios.get('/api/user-reviews/feed', {
        params: { limit },
      });
      return data;
    },
    enabled,
    // 2-minute freshness — the ticker doesn't need to be minute-by-minute
    // real-time, but we also don't want a 5-minute-old cache to hide a
    // brand-new comment the author is likely to look for.
    staleTime: 1000 * 60 * 2,
  });
}
