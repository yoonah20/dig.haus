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
