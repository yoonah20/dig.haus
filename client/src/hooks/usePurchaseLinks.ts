import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { PurchaseLink, PurchaseLinkStatus } from '../types';

export interface PurchaseLinkPayload {
  url: string;
  price: number | null;
  currency: string;
  format: string | null;
  note: string | null;
  status: PurchaseLinkStatus | null;
}

export function usePurchaseLinks(albumId: string, enabled = true) {
  return useQuery<{ purchaseLinks: PurchaseLink[] }>({
    queryKey: ['purchase-links', albumId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/albums/${albumId}/purchase-links`);
      return data;
    },
    enabled: !!albumId && enabled,
    staleTime: 1000 * 60 * 30,
  });
}

export function useCreatePurchaseLink(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PurchaseLinkPayload) => {
      const { data } = await axios.post(`/api/albums/${albumId}/purchase-links`, payload);
      return data.purchaseLink as PurchaseLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-links', albumId] });
      // refetchType 'all' refreshes the Home listing even while it's
      // unmounted, so a browser-back to the home page shows the edit
      // immediately instead of the pre-edit cached snapshot.
      qc.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
    },
  });
}

export function useUpdatePurchaseLink(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: PurchaseLinkPayload & { id: number }) => {
      const { data } = await axios.patch(`/api/purchase-links/${id}`, payload);
      return data.purchaseLink as PurchaseLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-links', albumId] });
      // refetchType 'all' refreshes the Home listing even while it's
      // unmounted, so a browser-back to the home page shows the edit
      // immediately instead of the pre-edit cached snapshot.
      qc.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
    },
  });
}

export function useDeletePurchaseLink(albumId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: number) => {
      await axios.delete(`/api/purchase-links/${linkId}`);
      return linkId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-links', albumId] });
      // refetchType 'all' refreshes the Home listing even while it's
      // unmounted, so a browser-back to the home page shows the edit
      // immediately instead of the pre-edit cached snapshot.
      qc.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
    },
  });
}

export type PurchaseLinkReportReason = 'soldout' | 'price' | 'expired';

export function useReportPurchaseLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      linkId,
      reason,
    }: {
      linkId: number;
      reason: PurchaseLinkReportReason;
    }) => {
      await axios.post(`/api/purchase-links/${linkId}/report`, { reason });
      return linkId;
    },
    onSuccess: () => {
      // Admin dashboard sees the new report on next refetch.
      qc.invalidateQueries({ queryKey: ['purchase-link-reports'] });
    },
  });
}

// Admin-only: report list for the dashboard. Returns one row per
// report (so the same link can appear multiple times if multiple users
// flagged it, which is the right signal for prioritising action).
export interface ReportedLink {
  id: number;
  reason: PurchaseLinkReportReason;
  createdAt: string;
  linkId: number;
  linkUrl: string;
  linkStore: string | null;
  linkPrice: number | null;
  linkCurrency: string | null;
  linkStatus: PurchaseLinkStatus | null;
  albumSlug: string;
  albumTitle: string;
  albumArtist: string | null;
  reporterId: number | null;
  reporterName: string | null;
  linkUserId: number | null;
  linkUserName: string | null;
}

export function useReportedPurchaseLinks(enabled = true) {
  return useQuery<{ reports: ReportedLink[] }>({
    queryKey: ['purchase-link-reports'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/purchase-link-reports');
      return data;
    },
    enabled,
    staleTime: 1000 * 60,
  });
}

export function useDismissPurchaseLinkReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: number) => {
      await axios.delete(`/api/admin/purchase-link-reports/${reportId}`);
      return reportId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-link-reports'] });
    },
  });
}

// Admin-level delete — the existing useDeletePurchaseLink is album-
// scoped (invalidates that album's list). From the reports dashboard
// we don't know the caller's current album context, so invalidate
// every purchase-links query plus the report list.
export function useAdminDeletePurchaseLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: number) => {
      await axios.delete(`/api/purchase-links/${linkId}`);
      return linkId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-link-reports'] });
      qc.invalidateQueries({ queryKey: ['purchase-links'] });
      qc.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
    },
  });
}
