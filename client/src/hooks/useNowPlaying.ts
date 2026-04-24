import { useSyncExternalStore } from 'react';

// Global "now playing" state for the site-wide strip at the bottom
// of the viewport. The strip lives in SiteFooter; wall cells write
// to it via setNowPlaying so clicking one ▶ chip swaps whatever
// was in the strip for the newly-clicked album.
//
// Unlike the earlier raw-mp3 player (useTrackPreview), nothing in
// this module actually plays audio — we hand a Spotify embed URL
// to an <iframe> and let Spotify's own player handle the audio.
// That's why there's no play/pause/scrubber logic here.

export interface NowPlayingAlbum {
  albumId: number;
  spotifyUrl: string;
  title: string;
  artist: string;
}

type Listener = () => void;

const state: { current: NowPlayingAlbum | null } = { current: null };
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): NowPlayingAlbum | null {
  return state.current;
}

export function useNowPlaying(): NowPlayingAlbum | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setNowPlaying(album: NowPlayingAlbum | null) {
  state.current = album;
  notify();
}

export function clearNowPlaying() {
  state.current = null;
  notify();
}

// Extract the album id from any Spotify album URL shape we might
// have stored — `https://open.spotify.com/album/{id}[?...]` is the
// canonical form, but we've seen the id on its own and with
// `intl-xx/` locale prefixes in older records.
export function extractSpotifyAlbumId(url: string | null | undefined): string | null {
  if (!url) return null;
  // Bare 22-char id fallback — cheap guard before trying URL parse.
  if (/^[A-Za-z0-9]{22}$/.test(url)) return url;
  const m = url.match(/album\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

