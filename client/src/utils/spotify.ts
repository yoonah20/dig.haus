/**
 * Extract Spotify album ID from a URL like https://open.spotify.com/album/ALBUM_ID
 */
export function extractSpotifyId(url: string): string | null {
  const match = url.match(/\/album\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Open Spotify album: try app URI first, fallback to web after 1s.
 */
export function openSpotifyAlbum(spotifyUrl: string): void {
  const spotifyId = extractSpotifyId(spotifyUrl);
  if (!spotifyId) {
    window.open(spotifyUrl, '_blank');
    return;
  }
  window.location.href = `spotify:album:${spotifyId}`;
  setTimeout(() => {
    window.open(`https://open.spotify.com/album/${spotifyId}`, '_blank');
  }, 1000);
}
