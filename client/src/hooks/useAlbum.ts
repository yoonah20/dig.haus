import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import type { ArtistCreditEntry } from '../types';

export type AutoCurationPhase =
  | 'queued'
  | 'discovering'
  | 'scraping'
  | 'summarizing';

export interface AutoCurationProgress {
  mbid: string;
  phase: AutoCurationPhase;
  urlsFound: number;
  urlsSaved: number;
  startedAt: string;
}

// Poll auto-curation progress for an album whose reviews are still
// pending. Returns the live progress snapshot (phase + counters) or
// null when nothing is in flight for this mbid. Enabled is controlled
// by the caller (Album.tsx) so polling only runs while it's relevant
// — once reviews_crawled_at flips to non-null the caller drops out.
//
// Refresh behaviour: when the response transitions from a non-null
// progress to null, we invalidate the album + reviews queries so the
// page picks up the freshly-stamped reviews_crawled_at and the
// collected reviews without the user having to reload. The transition
// is detected via a ref tracking the previous response — invalidating
// inside refetchInterval would race with React Query's own cache write.
export function useAutoCurationStatus(id: string, enabled: boolean) {
  const qc = useQueryClient();
  const previousRef = useRef<AutoCurationProgress | null>(null);
  const query = useQuery<{ progress: AutoCurationProgress | null }>({
    queryKey: ['auto-curation-status', id],
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/albums/${encodeURIComponent(id)}/auto-curation-status`
      );
      return data;
    },
    enabled: !!id && enabled,
    // 3s matches the rate at which urlsSaved meaningfully ticks during
    // a scrape — chunk size 12 with ~3-6s per chunk means at most one
    // increment per poll interval, which is what the UI needs to feel
    // alive without flickering numbers.
    refetchInterval: enabled ? 3000 : false,
    // Skip the standard staleTime so each interval call hits the
    // network instead of returning cached state.
    staleTime: 0,
  });
  useEffect(() => {
    const current = query.data?.progress ?? null;
    const prev = previousRef.current;
    // Edge detection: we just observed the curation finish. Invalidate
    // the family of album-keyed queries the same way Curation
    // ProgressContext does on the admin side, so the page picks up
    // the new reviews + cleared pending state on its next render.
    if (prev && !current) {
      qc.invalidateQueries({ queryKey: ['album'] });
      qc.invalidateQueries({ queryKey: ['album-reviews'] });
      qc.invalidateQueries({ queryKey: ['album-similar'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    }
    previousRef.current = current;
  }, [query.data, qc]);
  return query.data?.progress ?? null;
}

interface AlbumBase {
  album: {
    /** Numeric DB pkey — used by crate endpoints. */
    id?: number;
    mbid: string;
    slug: string | null;
    title: string;
    artist: string;
    artistMbid: string | null;
    /** Multi-artist credit array. Server always returns at least
     *  a 1-element array (legacy single-artist rows synthesise one
     *  from `artist`). HeaderSection renders each entry as its
     *  own clickable element via the shared ArtistCredit
     *  component. */
    artistCredit: ArtistCreditEntry[];
    releaseDate: string;
    label: string | null;
    genres: string[];
    coverArtUrl: string | null;
    coverArtFallbacks?: string[];
    artistKo?: string;
    titleKo?: string;
    titleMeaning?: string;
    upvotes?: number;
    downvotes?: number;
    userVote?: 'up' | 'down' | null;
    /** NULL when the album is user-submitted and admin hasn't yet
     *  triggered the review-crawl pipeline. */
    reviewsCrawledAt: string | null;
    /** Distinct users with this album in any of their PUBLIC
     *  crates. Replaces the prior ownedCount + wantedCount fields. */
    crateCount?: number;
  };
  streaming: {
    spotify: string | null;
    appleMusic: string | null;
    appleMusicEmbedUrl: string | null;
    youtube: string | null;
    bandcamp: string | null;
  };
  buy: {
    discogsUrl: string | null;
    formats: Array<{
      format: string;
      lowestPrice: number | null;
      lowestPriceKrw?: number | null;
      copiesForSale: number;
      sellUrl: string;
    }>;
    bandcampUrl: string | null;
  };
  discography: Array<{
    mbid: string;
    title: string;
    year: string;
    primaryType: string;
    coverArtUrl: string;
  }>;
}

interface ReviewsData {
  reviews: Array<{
    id: number;
    source: string;
    score: number | null;
    scoreMax: number | null;
    excerpt: string | null;
    excerptKo: string | null;
    url: string | null;
    isManualScore: boolean;
  }>;
  koreanSummary: string | null;
  averageScore: number | null;
  artistKo: string | null;
  titleKo: string | null;
}

interface SimilarData {
  similarAlbums: Array<{
    title: string;
    artist: string;
    mbid: string | null;
    reason: string | null;
    imageUrl: string | null;
    discogsUrl: string | null;
    spotifyUrl: string | null;
    youtubeUrl: string | null;
    bandcampUrl: string | null;
  }>;
}

export function useAlbumBase(id: string) {
  return useQuery<AlbumBase>({
    queryKey: ['album', id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/albums/${id}`);
      return data;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 60,
  });
}

/**
 * Reviews + similar queries wait for base to complete,
 * because the server needs cached album data (artist/title) to search.
 */
export function useAlbumReviews(id: string, baseReady: boolean) {
  return useQuery<ReviewsData>({
    queryKey: ['album-reviews', id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/albums/${id}/reviews`);
      return data;
    },
    enabled: !!id && baseReady,
    staleTime: 1000 * 60 * 60,
  });
}

export function useAlbumSimilar(id: string, baseReady: boolean) {
  return useQuery<SimilarData>({
    queryKey: ['album-similar', id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/albums/${id}/similar`);
      return data;
    },
    enabled: !!id && baseReady,
    staleTime: 1000 * 60 * 60,
  });
}

interface AlbumNeighbor {
  slug: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
}

interface NeighborsData {
  prev: AlbumNeighbor | null;
  next: AlbumNeighbor | null;
}

export function useAlbumNeighbors(id: string, sort: string, enabled: boolean) {
  return useQuery<NeighborsData>({
    queryKey: ['album-neighbors', id, sort],
    queryFn: async () => {
      const { data } = await axios.get('/api/albums/neighbors', {
        params: { id, sort },
      });
      return data;
    },
    enabled: !!id && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// Admin action: take the album's already-cached reviews (manually
// scraped via /reviews/add-url, typically) and ask Sonnet for the
// Korean summary that normally comes out of Step 3 of the full
// review pipeline. Stamps reviews_crawled_at on success so the card
// un-dims on the home grid. Cheap path (~$0.01) for when admin
// doesn't want to trigger the $0.10 web-search pipeline.
export function useGenerateReviewSummary(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(
        `/api/albums/${encodeURIComponent(id)}/reviews/generate-summary`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album', id] });
      qc.invalidateQueries({ queryKey: ['album-reviews', id] });
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}

// Admin action: wipe every cached review + the derived korean_summary
// for an album, reverting it to the un-crawled state. The album row
// itself stays (use ⚙️ 관리 → 삭제 on the album page for that).
export function useDeleteAllReviews(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.delete(
        `/api/reviews/album/${encodeURIComponent(id)}`
      );
      return data as { ok: boolean; deleted: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album', id] });
      qc.invalidateQueries({ queryKey: ['album-reviews', id] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}

// Admin-only URL discovery via Serper (Google SERP proxy) — returns
// 0–5 editorial review URL candidates for this album. No DB writes;
// the caller uses the URLs to populate the URL-batch textarea so
// admin can review / edit / save through the existing add-url flow.
export function useDiscoverReviewUrls(id: string) {
  return useMutation<{
    urls: string[];
    message?: string;
    whitelistedCount?: number;
    alreadySavedCount?: number;
  }>({
    mutationFn: async () => {
      const { data } = await axios.post(
        `/api/albums/${encodeURIComponent(id)}/reviews/discover`
      );
      return data;
    },
  });
}

// Admin escape hatch for albums too obscure to have any review
// coverage anywhere. Stamps reviews_crawled_at without any Claude
// call so the pending badge disappears from the home grid and the
// detail page swaps to the "no reviews" empty state for visitors.
export function useMarkNoReviews(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(
        `/api/albums/${encodeURIComponent(id)}/reviews/mark-none`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album', id] });
      qc.invalidateQueries({ queryKey: ['album-reviews', id] });
      qc.invalidateQueries({ queryKey: ['album-requests', 'pending'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
    },
  });
}
