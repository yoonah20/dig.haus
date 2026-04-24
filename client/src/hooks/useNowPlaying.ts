import { useEffect, useSyncExternalStore } from 'react';

// Global "now playing" state for the site-wide Spotify embed. Two
// independent stores share this module:
//   - `currentAlbum` : which album is playing (or null). Written by
//                      wall cells on ▶ click.
//   - `anchorEl`     : the DOM element whose on-screen position the
//                      player should track. Written by whatever page
//                      renders a <NowPlayingAnchor />. When null, the
//                      player falls back to a fixed bottom-centre
//                      floating position.
//
// The persistent player in App.tsx reads both stores, hosts a single
// <iframe> (via Spotify's iFrame API) that never unmounts, and moves
// its CSS coordinates in sync with whichever anchor is currently
// registered. That's what lets the embed survive route changes with
// playback uninterrupted — the iframe DOM node stays put while its
// apparent location migrates between page layouts.

export interface NowPlayingAlbum {
  albumId: number;
  spotifyUrl: string;
  title: string;
  artist: string;
}

type Listener = () => void;

const state: {
  currentAlbum: NowPlayingAlbum | null;
  anchorEl: HTMLElement | null;
} = { currentAlbum: null, anchorEl: null };

const albumListeners = new Set<Listener>();
const anchorListeners = new Set<Listener>();

function notifyAlbum() {
  for (const l of albumListeners) l();
}
function notifyAnchor() {
  for (const l of anchorListeners) l();
}

function subscribeAlbum(l: Listener) {
  albumListeners.add(l);
  return () => {
    albumListeners.delete(l);
  };
}
function subscribeAnchor(l: Listener) {
  anchorListeners.add(l);
  return () => {
    anchorListeners.delete(l);
  };
}

function getAlbumSnapshot(): NowPlayingAlbum | null {
  return state.currentAlbum;
}
function getAnchorSnapshot(): HTMLElement | null {
  return state.anchorEl;
}

export function useNowPlaying(): NowPlayingAlbum | null {
  return useSyncExternalStore(subscribeAlbum, getAlbumSnapshot, getAlbumSnapshot);
}

export function useNowPlayingAnchor(): HTMLElement | null {
  return useSyncExternalStore(subscribeAnchor, getAnchorSnapshot, getAnchorSnapshot);
}

export function setNowPlaying(album: NowPlayingAlbum | null) {
  state.currentAlbum = album;
  notifyAlbum();
}

export function clearNowPlaying() {
  state.currentAlbum = null;
  notifyAlbum();
}

// Mount-time hook for pages that want the player to dock against a
// specific element (e.g. mydig's in-wall placeholder). Registers the
// element on mount, clears on unmount — last registration wins, and
// nothing enforces uniqueness, so only one anchor should be alive at
// a time (enforced by route gating, not by this hook).
export function useRegisterNowPlayingAnchor(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    state.anchorEl = el;
    notifyAnchor();
    return () => {
      if (state.anchorEl === el) {
        state.anchorEl = null;
        notifyAnchor();
      }
    };
  }, [el]);
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
