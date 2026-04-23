import { useEffect, useSyncExternalStore } from 'react';

// Global track-preview player. A single shared <audio> element
// lives at the module level so clicking one cover's play chip
// stops whatever was playing on another cover — exactly the
// behaviour you want on a wall full of candidates. State is
// exposed via useSyncExternalStore so every WallCell can reflect
// its own playing state (play icon ↔ stop icon) without prop
// drilling.
//
// Preview URLs come from Spotify's `preview_url` field — 30
// seconds, no auth, plain mp3 over HTTPS. Browsers block
// autoplay without a user gesture so playback only starts from
// a click; hover reveals the chip, click triggers the audio.

type Listener = () => void;

interface State {
  playingUrl: string | null;
}

const state: State = { playingUrl: null };
const listeners = new Set<Listener>();
let audio: HTMLAudioElement | null = null;

function notify() {
  for (const l of listeners) l();
}

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('ended', () => {
    state.playingUrl = null;
    notify();
  });
  audio.addEventListener('error', () => {
    state.playingUrl = null;
    notify();
  });
  audio.addEventListener('pause', () => {
    // Don't clear playingUrl on pause fired by our own stop()
    // path — the setter below already cleared it. But if the
    // browser pauses for any other reason (tab backgrounded,
    // external control), we still want the UI to reflect it.
    if (audio && audio.paused && state.playingUrl) {
      state.playingUrl = null;
      notify();
    }
  });
  return audio;
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): string | null {
  return state.playingUrl;
}

// Read-only hook: returns the currently playing URL so any cell
// can check `playingUrl === myPreviewUrl` to decide whether it's
// the active one. Also starts/stops via the imperative helpers
// below.
export function usePlayingPreviewUrl(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function playPreview(url: string) {
  const el = ensureAudio();
  if (!el) return;
  if (state.playingUrl === url && !el.paused) return;
  try {
    el.src = url;
    el.currentTime = 0;
    // play() returns a Promise; swallow rejections silently so a
    // blocked autoplay (first click? no — browser usually allows
    // this one since it's user-gesture-driven) doesn't throw into
    // the React render.
    void el.play().catch(() => {
      state.playingUrl = null;
      notify();
    });
    state.playingUrl = url;
    notify();
  } catch {
    state.playingUrl = null;
    notify();
  }
}

export function stopPreview() {
  const el = audio;
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
  } catch {
    // ignore
  }
  state.playingUrl = null;
  notify();
}

// Convenience: stop the player when the component unmounts so
// navigating away from /my/:username doesn't leave music playing.
export function useStopPreviewOnUnmount() {
  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);
}
