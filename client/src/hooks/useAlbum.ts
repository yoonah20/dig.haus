import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

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
