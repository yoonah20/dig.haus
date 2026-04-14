import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { PurchaseLink } from '../types';

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
    mutationFn: async (payload: {
      url: string;
      price: number | null;
      currency: string;
      format: string | null;
      note: string | null;
    }) => {
      const { data } = await axios.post(`/api/albums/${albumId}/purchase-links`, payload);
      return data.purchaseLink as PurchaseLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-links', albumId] });
      // Homepage album grid shows top price-tag stickers — refetch so
      // newly added links appear without a hard reload.
      qc.invalidateQueries({ queryKey: ['album-list'] });
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
      qc.invalidateQueries({ queryKey: ['album-list'] });
    },
  });
}
