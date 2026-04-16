import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

// One admin-grid row. Multiple user rows collapse into one entry per
// mbid server-side; request_count + requesters power the social-proof
// stack of avatars on the card.
export interface AlbumRequestRequester {
  id: number;
  userId: number | null;
  userName: string | null;
  userAvatar: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AlbumRequest {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  coverArtUrl: string | null;
  firstRequestedAt: string;
  requestCount: number;
  requesters: AlbumRequestRequester[];
}

// Shown in Profile → "내 등록 요청". One row per request (not grouped).
export interface MyAlbumRequest {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  coverArtUrl: string | null;
  status: 'pending' | 'approved' | 'discarded';
  createdAt: string;
  decidedAt: string | null;
}

export function useAlbumRequests(enabled: boolean) {
  return useQuery<{ requests: AlbumRequest[] }>({
    queryKey: ['album-requests', 'pending'],
    queryFn: async () => {
      const { data } = await axios.get('/api/album-requests', {
        params: { status: 'pending' },
      });
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
    },
  });
}

export function useApproveAlbumRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mbid: string) => {
      const { data } = await axios.post(
        `/api/album-requests/${encodeURIComponent(mbid)}/approve`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      // The approved album now exists — bust the homepage list so a
      // sort switch back to the main grid shows it.
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
      qc.invalidateQueries({ queryKey: ['me-album-requests'] });
    },
  });
}

export function useDiscardAlbumRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mbid: string) => {
      const { data } = await axios.post(
        `/api/album-requests/${encodeURIComponent(mbid)}/discard`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      qc.invalidateQueries({ queryKey: ['me-album-requests'] });
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
