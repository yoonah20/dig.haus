import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface TrackedLabel {
  id: number;
  spotify_label_name: string;
  display_name: string | null;
  is_active: number;
  created_at: string;
  last_polled_at: string | null;
  pending_count: number;
}

export interface LabelFeedItem {
  id: number;
  tracked_label_id: number;
  spotify_album_id: string;
  artist_name: string;
  album_name: string;
  release_date: string | null;
  cover_art_url: string | null;
  spotify_url: string | null;
  album_type: string | null;
  total_tracks: number | null;
  first_seen_at: string;
  spotify_label_name: string;
  display_name: string | null;
}

export interface LabelPreview {
  count: number;
  samples: Array<{
    artist: string;
    title: string;
    releaseDate: string;
    coverArtUrl: string | null;
  }>;
}

export interface LabelFeedRegisterResult {
  ok: boolean;
  matched: 'mb' | 'spotify';
  mbid: string;
  slug: string;
}

export function useTrackedLabels(enabled: boolean) {
  return useQuery<{ labels: TrackedLabel[] }>({
    queryKey: ['admin-tracked-labels'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/tracked-labels');
      return data;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useLabelFeed(enabled: boolean) {
  return useQuery<{ items: LabelFeedItem[] }>({
    queryKey: ['admin-label-feed'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/label-feed');
      return data;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function usePreviewLabel() {
  return useMutation<LabelPreview, unknown, string>({
    mutationFn: async (name: string) => {
      const { data } = await axios.post('/api/admin/tracked-labels/preview', { name });
      return data;
    },
  });
}

export function useAddTrackedLabel() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; id: number; initialPoll: { found: number; inserted: number } | null },
    unknown,
    { name: string; displayName?: string }
  >({
    mutationFn: async ({ name, displayName }) => {
      const { data } = await axios.post('/api/admin/tracked-labels', {
        name,
        displayName,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
      qc.invalidateQueries({ queryKey: ['admin-label-feed'] });
    },
  });
}

export function useToggleTrackedLabel() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { id: number; isActive: boolean }>({
    mutationFn: async ({ id, isActive }) => {
      await axios.patch(`/api/admin/tracked-labels/${id}`, { isActive });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
    },
  });
}

export function useDeleteTrackedLabel() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, number>({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/admin/tracked-labels/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
      qc.invalidateQueries({ queryKey: ['admin-label-feed'] });
    },
  });
}

export function usePollTrackedLabel() {
  const qc = useQueryClient();
  return useMutation<{ found: number; inserted: number }, unknown, number>({
    mutationFn: async (id: number) => {
      const { data } = await axios.post(`/api/admin/tracked-labels/${id}/poll`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
      qc.invalidateQueries({ queryKey: ['admin-label-feed'] });
    },
  });
}

export function useDismissLabelFeedItem() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, number>({
    mutationFn: async (id: number) => {
      await axios.post(`/api/admin/label-feed/${id}/dismiss`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-label-feed'] });
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
    },
  });
}

export function useRegisterLabelFeedItem() {
  const qc = useQueryClient();
  return useMutation<LabelFeedRegisterResult, unknown, number>({
    mutationFn: async (id: number) => {
      const { data } = await axios.post(`/api/admin/label-feed/${id}/register`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-label-feed'] });
      qc.invalidateQueries({ queryKey: ['admin-tracked-labels'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}
