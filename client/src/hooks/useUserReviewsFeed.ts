import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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

// Infinite-scroll variant for the home feed. Uses `order=recent` on
// the server (created_at DESC + OFFSET) — deterministic ordering
// required for safe pagination. The above weighted-random hook stays
// in place for the CommentTicker, which wants surface-old-comments
// behaviour and only fetches a single bounded page.
export function useInfiniteUserReviewsFeed(enabled = true, pageSize = 30) {
  return useInfiniteQuery<{ items: UserReviewFeedItem[] }>({
    queryKey: ['user-reviews-feed-infinite', pageSize],
    queryFn: async ({ pageParam = 0 }) => {
      const { data } = await axios.get('/api/user-reviews/feed', {
        params: { order: 'recent', limit: pageSize, offset: pageParam },
      });
      return data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      // No more pages once a fetch returns less than pageSize — that's
      // the natural end-of-data signal without needing a `total` field.
      lastPage.items.length < pageSize ? undefined : allPages.length * pageSize,
    enabled,
    staleTime: 1000 * 60 * 2,
  });
}
