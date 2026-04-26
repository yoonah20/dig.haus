import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { PriceTagLink } from '../types';

// Admin-curated 5-album rail on the home page. Mirrors the mydig
// wall's data shape (album object per slot) minus the user_id —
// single global rail, not per-user. GET is public; PUT bulk-replace
// is admin-only and falls through to a 401 / 403 if the request
// arrives without an admin session.

export interface HomeFeatureAlbum {
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
  coverDominantColor?: string | null;
  spotifyUrl?: string | null;
  releaseDate?: string | null;
  // Aggregated review score (0-100, integer) and the number of
  // *scored* reviews behind it. Powers the dig.haus PICK sticker
  // gate on the home wall — show only when averageScore is at the
  // pick threshold AND reviewCount clears MIN_SCORED_FOR_AVG so a
  // single high-scoring review can't promote an album.
  averageScore?: number | null;
  reviewCount?: number;
  // Top purchase-link sticker (≤1 entry). Server picks soldout-last,
  // then ascending KRW; empty array when no purchase links registered.
  priceTagLinks?: PriceTagLink[];
}

export interface HomeFeatureItem {
  position: number;
  note: string | null;
  album: HomeFeatureAlbum;
}

export interface HomeMeta {
  theme: string | null;
  description: string | null;
  // Handwritten header position knobs — px offsets from the wall
  // section's top-left, rotation in degrees. Server fills defaults
  // when the columns are null, so these are always numbers in the
  // payload even though the underlying SQL columns are nullable.
  headerTopPx: number;
  headerLeftPx: number;
  headerRotationDeg: number;
  // Plastic-wrap raster overlay tuning — scale_pct = how much larger
  // than the cover (15 = 15% larger), offsets in px (positive x =
  // right, positive y = down). blend_mode controls how the texture
  // composites onto the cover (screen/overlay/soft-light etc).
  plasticScalePct: number;
  plasticOffsetXPx: number;
  plasticOffsetYPx: number;
  plasticBlendMode: string;
  // Hero LP / title tuner — moved off per-admin localStorage so
  // saving from the in-page tuner publishes globally. All values
  // live in source-image px (the basement5 coord space).
  lpSize: number;
  lpGap: number;
  upperLpXStart: number;
  lowerLpXStart: number;
  upperLpY: number;
  lowerLpY: number;
  titleFontSize: number;
  titleRotationDeg: number;
}

export function useHomeFeatures() {
  return useQuery<{ items: HomeFeatureItem[]; meta: HomeMeta }>({
    queryKey: ['home-features'],
    queryFn: async () => {
      const { data } = await axios.get('/api/home/features');
      return data;
    },
    staleTime: 30_000,
  });
}

// Each field is optional — the server treats missing keys as
// "don't touch", so the editor can PATCH only what changed.
export interface HomeMetaPatch {
  theme?: string | null;
  description?: string | null;
  headerTopPx?: number;
  headerLeftPx?: number;
  headerRotationDeg?: number;
  plasticScalePct?: number;
  plasticOffsetXPx?: number;
  plasticOffsetYPx?: number;
  plasticBlendMode?: string;
  lpSize?: number;
  lpGap?: number;
  upperLpXStart?: number;
  lowerLpXStart?: number;
  upperLpY?: number;
  lowerLpY?: number;
  titleFontSize?: number;
  titleRotationDeg?: number;
}

export function useUpdateHomeMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (meta: HomeMetaPatch) => {
      const { data } = await axios.patch('/api/home/meta', meta);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home-features'] });
    },
  });
}

export interface HomeFeatureItemPut {
  position: number;
  mbid: string;
  note?: string | null;
}

export function useReplaceHomeFeatures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: HomeFeatureItemPut[]) => {
      const { data } = await axios.put('/api/home/features/items', { items });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home-features'] });
    },
  });
}
