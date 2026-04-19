import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface MyDigAlbum {
  id: number;
  mbid: string;
  slug: string | null;
  title: string;
  artist: string;
  releaseDate?: string | null;
  releaseYear?: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
}

export interface MyDigUser {
  id?: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
}

export interface MyDigWallItem {
  position: number;
  album: MyDigAlbum;
}

export interface MyDigGenre {
  id: number;
  slug: string;
  nameKo: string;
  nameEn: string;
}

export interface MyDigShelfSlot {
  slotId: number;
  position: number;
  genre: MyDigGenre | null;
  items: Array<{ position: number; album: MyDigAlbum }>;
}

export interface MyDigCrate {
  crateId: number;
  position: number;
  title: string;
  description: string | null;
  items: Array<{ position: number; album: MyDigAlbum }>;
}

export interface MyDigData {
  user: MyDigUser;
  isPublic: boolean;
  vinylWall: MyDigWallItem[];
  shelf: MyDigShelfSlot[];
  crates: MyDigCrate[];
}

export function useMyDig(username: string | undefined) {
  return useQuery<MyDigData>({
    queryKey: ['mydig', username],
    queryFn: async () => {
      const { data } = await axios.get(`/api/mydig/${encodeURIComponent(username!)}`);
      return data;
    },
    enabled: !!username,
    staleTime: 30_000,
  });
}
