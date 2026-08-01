import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { CrateSummary } from './useCrates';

// The 바구니 (basket) — a per-user private default crate used as a
// record-shop-style staging bin. Quick-add from the home grid cover
// chip, review/clear from the floating widget, then move keepers into
// named crates. Server keeps exactly one is_default box per user; the
// client never touches the crate id — every endpoint keys off the
// caller's default box.

export interface CartItem {
  // Numeric album.id. 0 on an optimistic insert until the refetch
  // fills the real value in — never used as a lookup key client-side.
  id: number;
  // slug-or-mbid ref. Membership + remove both key off this; the home
  // card's `album.mbid` is also a slug-or-mbid, so they line up.
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks: string[];
  spotifyUrl: string | null;
  addedAt: string;
}

export interface CartData {
  crate: CrateSummary;
  items: CartItem[];
}

const CART_KEY = ['cart'] as const;

export function useCart(enabled = true) {
  return useQuery<CartData>({
    queryKey: CART_KEY,
    queryFn: async () => {
      const { data } = await axios.get('/api/mydig/cart');
      return data;
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

// Flat set of every ref (both mbid and slug) currently in the basket,
// so a card can answer "am I in the 바구니?" from the single shared
// cart query without a per-card round-trip.
export function useCartRefs(enabled = true): Set<string> {
  const { data } = useCart(enabled);
  const set = new Set<string>();
  for (const it of data?.items ?? []) {
    set.add(it.mbid);
    if (it.slug) set.add(it.slug);
  }
  return set;
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    // Takes the whole item so the optimistic insert can render the
    // cover immediately; only the ref is sent to the server.
    mutationFn: async (item: CartItem) => {
      await axios.post('/api/mydig/cart/items', {
        album: item.slug || item.mbid,
      });
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: CART_KEY });
      const prev = qc.getQueryData<CartData>(CART_KEY);
      if (prev && !prev.items.some((i) => i.mbid === item.mbid)) {
        qc.setQueryData<CartData>(CART_KEY, {
          ...prev,
          items: [item, ...prev.items],
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CART_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CART_KEY });
      // Album-page 담기 membership counts private crates too, so keep
      // it in sync after a basket add/remove.
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}

export function useRemoveFromCart() {
  const qc = useQueryClient();
  return useMutation({
    // ref is a slug-or-mbid — matches either field on the stored item.
    mutationFn: async (ref: string) => {
      await axios.delete(`/api/mydig/cart/items/${encodeURIComponent(ref)}`);
    },
    onMutate: async (ref) => {
      await qc.cancelQueries({ queryKey: CART_KEY });
      const prev = qc.getQueryData<CartData>(CART_KEY);
      if (prev) {
        qc.setQueryData<CartData>(CART_KEY, {
          ...prev,
          items: prev.items.filter((i) => i.mbid !== ref && i.slug !== ref),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CART_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CART_KEY });
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}

export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await axios.delete('/api/mydig/cart');
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: CART_KEY });
      const prev = qc.getQueryData<CartData>(CART_KEY);
      if (prev) qc.setQueryData<CartData>(CART_KEY, { ...prev, items: [] });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CART_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CART_KEY });
      qc.invalidateQueries({ queryKey: ['crates'] });
    },
  });
}
