import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

interface AlbumBase {
  album: {
    mbid: string;
    slug: string | null;
    title: string;
    artist: string;
    artistMbid: string | null;
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
    ownedCount?: number;
    wantedCount?: number;
    userOwnedFormats?: Array<'Vinyl' | 'CD' | 'Cassette'>;
    userWantedFormats?: Array<'Vinyl' | 'CD' | 'Cassette'>;
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
