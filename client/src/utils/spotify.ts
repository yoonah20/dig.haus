/**
 * Extract Spotify album ID from a URL like https://open.spotify.com/album/ALBUM_ID
 */
export function extractSpotifyId(url: string): string | null {
  const match = url.match(/\/album\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Open Spotify album: try the app URI first, fall back to the web player
 * after 1s for devices without the app.
 *
 * The web fallback must NOT run when the app actually opened, or the
 * deferred window.open fires with no user gesture behind it and trips the
 * popup allow/deny prompt when the user returns to the browser. We detect
 * the app takeover three ways, because no single signal is reliable
 * everywhere:
 *   - visibilitychange → hidden (most mobile browsers background the tab)
 *   - pagehide (iOS Safari fires this instead when handing off to the app)
 *   - frozen-timer overshoot: a backgrounded tab freezes the timer, so on
 *     return the real elapsed time far exceeds the delay. This is the only
 *     signal that survives Korean in-app browsers (KakaoTalk / Naver /
 *     Instagram webviews), which routinely open the external app WITHOUT
 *     firing visibilitychange or pagehide.
 * Desktop without the app is unaffected: the tab never hides, the timer
 * fires on schedule, and the web player opens in a new tab as before.
 */
export function openSpotifyAlbum(spotifyUrl: string): void {
  const spotifyId = extractSpotifyId(spotifyUrl);
  if (!spotifyId) {
    window.open(spotifyUrl, '_blank');
    return;
  }

  const webUrl = `https://open.spotify.com/album/${spotifyId}`;
  const DELAY = 1000;
  const startedAt = Date.now();
  let handled = false;

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', markHandled);
  };
  const markHandled = () => {
    handled = true;
    cleanup();
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') markHandled();
  };

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', markHandled);

  setTimeout(() => {
    cleanup();
    if (
      handled ||
      document.visibilityState === 'hidden' ||
      Date.now() - startedAt > DELAY + 400
    ) {
      return;
    }
    window.open(webUrl, '_blank');
  }, DELAY);

  window.location.href = `spotify:album:${spotifyId}`;
}
