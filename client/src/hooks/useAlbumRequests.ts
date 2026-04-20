import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

// Admin dashboard row: one user-submitted album awaiting review crawl.
// Now backed by the `albums` table directly (reviews_crawled_at IS
// NULL), not the legacy `album_requests` table — so there's exactly
// one requester per row, not a collapsed stack.
export interface AlbumRequestRequester {
  userId: number;
  userName: string | null;
  userAvatar: string | null;
}

export interface AlbumRequest {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
  createdAt: string;
  requester: AlbumRequestRequester | null;
}

// Profile → "내 등록한 앨범". Status is derived from the album's
// reviews_crawled_at server-side.
export interface MyAlbumRequest {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  coverArtUrl: string | null;
  status: 'pending' | 'approved';
  createdAt: string;
  decidedAt: string | null;
  /** Server flag — true iff no foreign engagement (admin review
   *  crawl, others' votes / reviews / collections / purchase links)
   *  has attached to the album since submission, so the requester
   *  is allowed to retract it. Drives the 🗑️ button visibility
   *  in the profile "내 등록 앨범" list. */
  canDelete: boolean;
}

export function useAlbumRequests(enabled: boolean) {
  return useQuery<{ requests: AlbumRequest[] }>({
    queryKey: ['album-requests', 'pending'],
    queryFn: async () => {
      const { data } = await axios.get('/api/album-requests');
      return data;
    },
    enabled,
    staleTime: 1000 * 30,
  });
}

export function useSubmitAlbumRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      mbid: string;
      title: string;
      artist: string;
      year?: number | null;
      coverArtUrl?: string | null;
      notes?: string | null;
    }) => {
      const { data } = await axios.post('/api/album-requests', payload);
      return data;
    },
    onSuccess: () => {
      // Refresh the user's own request list + the admin pending queue
      // (no-op on non-admin clients but cheap).
      qc.invalidateQueries({ queryKey: ['me-album-requests'] });
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      // Also invalidate the home grid — a successful submit creates
      // the album row immediately, and the user expects to see it
      // there when they navigate back (browser-back or /-tap) without
      // needing a manual refresh. Matches the pattern already used
      // by useGenerateReviewSummary / useDeleteAllReviews /
      // useMarkNoReviews for their album-state mutations.
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}

// Admin action — deletes the user-submitted album entirely. Cascade
// FKs wipe purchase_links, user_reviews, votes, reports, etc. Used
// from the "리뷰 수집 대기" panel as the "삭제" button next to
// "승인"; the explicit "reject" button is gone (same outcome, less
// friction).
export function useDeletePendingAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mbid: string) => {
      await axios.delete(`/api/albums/${encodeURIComponent(mbid)}`);
      return mbid;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
      qc.invalidateQueries({ queryKey: ['me-album-requests'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}

export function useMyAlbumRequests(enabled = true) {
  return useQuery<{ requests: MyAlbumRequest[] }>({
    queryKey: ['me-album-requests'],
    queryFn: async () => {
      const { data } = await axios.get('/api/me/album-requests');
      return data;
    },
    enabled,
    staleTime: 1000 * 30,
  });
}
