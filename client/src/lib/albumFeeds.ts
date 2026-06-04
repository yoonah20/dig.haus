import type { QueryClient } from '@tanstack/react-query';

// Album feeds live under two separate query-key namespaces: the /dig
// catalog (['album-list', …] / ['album-list-infinite', …]) and the home
// page (['home-recent-albums', …] / ['home-recent-albums-infinite', …] /
// ['home-recent-releases', …]). The home keys were split out in the
// Apr-30 home rewrite (d9fc42d); call sites that registered/removed an
// album kept busting only the 'album-list' keys, so the home "new album"
// feed silently stopped refreshing and needed a hard reload. Bust every
// feed namespace together so the home grid and /dig stay in sync.
export function invalidateAlbumFeeds(qc: QueryClient): void {
  const keys = [
    ['album-list'],
    ['album-list-infinite'],
    ['home-recent-albums'],
    ['home-recent-albums-infinite'],
    ['home-recent-releases'],
  ];
  for (const queryKey of keys) {
    qc.invalidateQueries({ queryKey });
  }
}
