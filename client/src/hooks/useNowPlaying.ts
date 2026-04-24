import { useSyncExternalStore } from 'react';

// Global "now playing" state for the site-wide Spotify embed.
// Written by wall cells / album rows on ▶ click; read by the
// persistent player mounted once at App root.
//
// The persistent player hosts a single <iframe> (via Spotify's
// iFrame API) that never unmounts, so playback survives route
// changes. Layout is fixed bottom-center — no anchor tracking.

export interface NowPlayingAlbum {
  // Stable identity across pages. Numeric `id` isn't universally
  // available in client payloads (album detail endpoint carries
  // mbid + slug but no numeric id), whereas mbid is present on
  // every surface that renders an album. Using it as the key lets
  // the play chip compare "am I the currently-playing album?"
  // from home grid, mydig wall, album detail page — all the same.
  albumMbid: string;
  spotifyUrl: string;
  title: string;
  artist: string;
}

type Listener = () => void;

const state: { currentAlbum: NowPlayingAlbum | null } = { currentAlbum: null };
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
  return state.currentAlbum;
}

export function useNowPlaying(): NowPlayingAlbum | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setNowPlaying(album: NowPlayingAlbum | null) {
  state.currentAlbum = album;
  notify();
}

export function clearNowPlaying() {
  state.currentAlbum = null;
  notify();
}

// Extract the album id from any Spotify album URL shape we might
// have stored — `https://open.spotify.com/album/{id}[?...]` is the
// canonical form, but we've seen the id on its own and with
// `intl-xx/` locale prefixes in older records.
export function extractSpotifyAlbumId(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^[A-Za-z0-9]{22}$/.test(url)) return url;
  const m = url.match(/album\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}
