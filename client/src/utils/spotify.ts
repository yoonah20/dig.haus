/**
 * Extract Spotify album ID from a URL like https://open.spotify.com/album/ALBUM_ID
 */
export function extractSpotifyId(url: string): string | null {
  const match = url.match(/\/album\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Open Spotify album: try app URI first, fallback to web after 1s.
 *
 * The fallback must be cancelled when the app actually opens: on mobile the
 * tab goes hidden and the timer freezes, then fires on return — at that point
 * there's no user gesture, so window.open trips the popup-blocker prompt.
 */
export function openSpotifyAlbum(spotifyUrl: string): void {
  const spotifyId = extractSpotifyId(spotifyUrl);
  if (!spotifyId) {
    window.open(spotifyUrl, '_blank');
    return;
  }

  const timer = setTimeout(() => {
    cleanup();
    window.open(`https://open.spotify.com/album/${spotifyId}`, '_blank');
  }, 1000);
  const cancel = () => {
    clearTimeout(timer);
    cleanup();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') cancel();
  };
  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', cancel);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  // iOS Safari fires pagehide instead of visibilitychange when the app opens.
  window.addEventListener('pagehide', cancel);

  window.location.href = `spotify:album:${spotifyId}`;
}
