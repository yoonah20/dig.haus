/**
 * Extract Spotify album ID from a URL like https://open.spotify.com/album/ALBUM_ID
 */
export function extractSpotifyId(url: string): string | null {
  const match = url.match(/\/album\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Desktop-only: open the native Spotify app via the spotify: protocol,
 * with a web-player fallback for machines without the app. Call this from
 * a Spotify anchor's onClick — if it returns true, preventDefault the
 * anchor so the browser doesn't also navigate to the web URL.
 *
 * Mobile is deliberately left to the anchor's default https navigation:
 * there iOS/Android universal & app links open the native app straight
 * from the tap, and a deferred window.open trips iOS Safari's pop-up
 * allow/deny prompt (the app opens fine, then the frozen fallback fires
 * on return). Desktop has no universal-link equivalent — the https URL
 * just opens the web player — so there we need the protocol hand-off to
 * reach the desktop app, and desktop's window.open doesn't show the iOS
 * prompt. The media query keeps the two paths apart: mouse-primary
 * (hover + fine pointer) is treated as desktop, touch devices are not.
 */
export function tryOpenSpotifyDesktopApp(spotifyUrl: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!isDesktop) return false;
  const spotifyId = extractSpotifyId(spotifyUrl);
  if (!spotifyId) return false;
  window.location.href = `spotify:album:${spotifyId}`;
  setTimeout(() => {
    window.open(`https://open.spotify.com/album/${spotifyId}`, '_blank');
  }, 1000);
  return true;
}
