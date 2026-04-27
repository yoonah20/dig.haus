import { useEffect, useRef, useState } from 'react';
import {
  clearNowPlaying,
  extractSpotifyAlbumId,
  useNowPlaying,
} from '../hooks/useNowPlaying';

// Single Spotify-embed host mounted once at App root. The iframe
// (created by Spotify's iFrame API inside `hostEl`) never unmounts
// across route transitions — that's what keeps playback alive
// through navigation.
//
// Layout is dead simple: fixed to the viewport at bottom-center,
// 70% width capped at 640px. No anchor tracking, no docked /
// floating mode switching.
//
// Spotify iFrame API reference:
//   window.onSpotifyIframeApiReady = (IFrameAPI) => {
//     IFrameAPI.createController(el, { uri, width, height }, (Ctrl) => {
//       Ctrl.addListener('ready', () => Ctrl.play());
//       Ctrl.loadUri('spotify:album:newId');  // subsequent changes
//     });
//   };

const SCRIPT_ID = 'spotify-iframe-api';
const SCRIPT_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

type SpotifyAPI = {
  createController: (
    el: HTMLElement,
    options: { uri: string; width: number | string; height: number | string },
    cb: (controller: SpotifyController) => void
  ) => void;
};
type SpotifyController = {
  loadUri: (uri: string) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  addListener: (event: string, cb: (e: any) => void) => void;
  removeListener: (event: string, cb: (e: any) => void) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    __dighausSpotifyAPI?: SpotifyAPI;
    onSpotifyIframeApiReady?: (api: SpotifyAPI) => void;
  }
}

// Cached IFrameAPI instance on the window so HMR / route re-mounts
// reuse one loaded script rather than re-adding it. Match Spotify's
// global-callback pattern so their script finds our handler wherever
// the load completes.
function loadSpotifyApi(): Promise<SpotifyAPI> {
  if (window.__dighausSpotifyAPI) return Promise.resolve(window.__dighausSpotifyAPI);
  return new Promise((resolve) => {
    const existing = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api: SpotifyAPI) => {
      window.__dighausSpotifyAPI = api;
      if (existing) existing(api);
      resolve(api);
    };
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = SCRIPT_SRC;
      s.async = true;
      document.body.appendChild(s);
    }
  });
}

export default function PersistentNowPlayingPlayer() {
  const nowPlaying = useNowPlaying();

  // Host div receives Spotify's injected iframe. Callback ref into
  // state so effects that depend on the host element re-run when
  // it mounts.
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const controllerRef = useRef<SpotifyController | null>(null);

  // Init + URI switching. First nowPlaying creates the controller;
  // every change after calls loadUri + play. The 180ms delay lets
  // Spotify's iframe register the new URI before play() fires —
  // calling play() immediately after loadUri is a race.
  useEffect(() => {
    if (!hostEl || !nowPlaying) return;
    const albumId = extractSpotifyAlbumId(nowPlaying.spotifyUrl);
    if (!albumId) return;
    const uri = `spotify:album:${albumId}`;

    let cancelled = false;

    (async () => {
      const api = await loadSpotifyApi();
      if (cancelled) return;

      if (controllerRef.current) {
        controllerRef.current.loadUri(uri);
        setTimeout(() => {
          if (!cancelled) controllerRef.current?.play();
        }, 180);
      } else {
        api.createController(
          hostEl,
          { uri, width: '100%', height: 80 },
          (controller) => {
            if (cancelled) {
              controller.destroy();
              return;
            }
            controllerRef.current = controller;
            controller.addListener('ready', () => {
              controller.play();
            });
          }
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // `albumMbid` is the stable identity — the NowPlayingAlbum
    // object can be re-created with the same mbid on unrelated
    // state changes, so we depend on the string value not the
    // reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostEl, nowPlaying?.albumMbid]);

  // Pause when the user dismisses the player. Keeps the controller
  // alive so the next ▶ click reuses it without a fresh init.
  useEffect(() => {
    if (!nowPlaying && controllerRef.current) {
      try {
        controllerRef.current.pause();
      } catch {
        // controller may be mid-teardown on HMR; ignore
      }
    }
  }, [nowPlaying]);

  // Host stays mounted even when hidden so hostEl is populated
  // before the first ▶ click and so the iframe doesn't get torn
  // down between plays. `visibility: hidden` keeps the DOM subtree
  // alive (vs. display: none which would zero-out the iframe).
  const visible = !!nowPlaying;

  return (
    <div
      className="fixed z-30 pointer-events-none"
      style={{
        visibility: visible ? 'visible' : 'hidden',
        left: '50%',
        bottom: '16px',
        transform: 'translateX(-50%)',
        width: '70%',
        maxWidth: 500,
        minWidth: 280,
      }}
      aria-label="지금 재생 중"
      aria-hidden={!visible}
    >
      <div className="pointer-events-auto relative group/np">
        <div
          ref={setHostEl}
          className="rounded-lg overflow-hidden"
          style={{
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
            minHeight: 80,
          }}
        />
        {/* × button sits just outside the player's right edge,
            anchored to the top so the chip lines up with the
            embed's header band rather than floating mid-side.
            Lifted out of the iframe-clip wrapper so it floats free
            on the right; absolute positioning is relative to the
            outer relative div, not the rounded iframe host below,
            so the chip isn't clipped by the host's overflow-
            hidden. Amber-on-dark always-visible chip with a small
            drop shadow — the previous dark-on-dark + hover-fade
            treatment was hard to spot since the chip's own colour
            matched both the player and the page bg. */}
        <button
          type="button"
          onClick={clearNowPlaying}
          aria-label="재생 닫기"
          title="재생 닫기"
          className="absolute top-0 left-full ml-1.5 z-10 w-7 h-7 rounded-full border border-[#141008]/40 bg-[#e8a020] hover:bg-[#f0b040] text-[#141008] text-base leading-none flex items-center justify-center cursor-pointer transition-colors duration-150 shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
