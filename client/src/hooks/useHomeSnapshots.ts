import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';

// One entry in the homepage snapshot rail — a publicly-published
// wall snapshot by some user. Items is the positional list that
// was captured at snapshot time; individual `album` may be null
// if the album was deleted after the snapshot (rare, but we let
// the client render an empty slot for it rather than silently
// compacting the list).
export interface HomeSnapshotItem {
  position: number;
  album: {
    id: number;
    mbid: string | null;
    slug: string | null;
    title: string;
    artist: string | null;
    coverArtUrl: string | null;
    coverArtFallbacks: string[];
  } | null;
}

export interface HomeSnapshot {
  id: number;
  slug: string;
  name: string;
  createdAt: string;
  user: {
    id: number;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  items: HomeSnapshotItem[];
}

export function useHomeSnapshots(enabled = true, limit = 6) {
  return useQuery<{ snapshots: HomeSnapshot[] }>({
    queryKey: ['home-snapshots', limit],
    queryFn: async () => {
      const { data } = await axios.get('/api/home/snapshots', {
        params: { limit },
      });
      return data;
    },
    enabled,
    // Same 2-min freshness as the comment feed — the rail moves in
    // the same rhythm, and a snapshot publish is infrequent enough
    // that a slightly stale list is fine between polls.
    staleTime: 1000 * 60 * 2,
  });
}
