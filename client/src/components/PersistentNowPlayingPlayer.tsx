import { useEffect, useRef, useState } from 'react';
import {
  clearNowPlaying,
  extractSpotifyAlbumId,
  useNowPlaying,
  useNowPlayingAnchor,
  useRegisterNowPlayingAnchor,
} from '../hooks/useNowPlaying';

// Single Spotify-embed host mounted once at App root. The iframe
// (created by Spotify's iFrame API inside `hostEl`) never unmounts
// across route transitions — that's the whole point of the "ghost"
// pattern. A <NowPlayingAnchor /> elsewhere in the tree registers
// the element this component should align with; when no anchor is
// registered, the player falls back to a fixed bottom-centre
// mini-player position.
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
  const anchor = useNowPlayingAnchor();

  // Outer wrapper — we mutate its inline style directly on scroll/
  // resize so tracking the anchor rect doesn't cost a React render
  // per frame.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Host div receives Spotify's injected iframe. Callback ref into
  // state so effects that depend on the host element re-run when
  // it mounts.
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const controllerRef = useRef<SpotifyController | null>(null);

  // Init + URI switching via destroy + recreate. `loadUri` would
  // be one network call cheaper, but it triggers Spotify's
  // internal pushState and pollutes browser back-button history —
  // each track change ends up as a history entry the user has to
  // back-press through. Destroying the controller and creating a
  // fresh one (initial iframe load, not a navigation) skips that.
  // Autoplay is preserved because each new controller fires
  // `ready` after init and we immediately `play()` on that event.
  // Trade: ~300–500ms slower first-frame on track change, in
  // exchange for the browser back button going where the user
  // expects.
  useEffect(() => {
    if (!hostEl || !nowPlaying) return;
    const albumId = extractSpotifyAlbumId(nowPlaying.spotifyUrl);
    if (!albumId) return;
    const uri = `spotify:album:${albumId}`;

    let cancelled = false;

    (async () => {
      const api = await loadSpotifyApi();
      if (cancelled) return;

      // Tear down the previous controller (and its iframe) before
      // spinning up the new one. `destroy()` removes the iframe
      // element from the DOM; the next createController appends a
      // brand-new iframe to the host div, which the browser loads
      // as an initial page rather than a navigation.
      if (controllerRef.current) {
        try {
          controllerRef.current.destroy();
        } catch {
          // controller may already be partially torn down in HMR
        }
        controllerRef.current = null;
      }

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

  const mode: 'anchored' | 'floating' = anchor ? 'anchored' : 'floating';

  // Anchored tracking. rAF-throttles rect reads so scroll events
  // don't saturate the main thread. ResizeObserver picks up layout
  // shifts (e.g. mydig header collapse on avatar hover that changes
  // the wall's position). Inline style mutation sidesteps React's
  // render path entirely.
  useEffect(() => {
    if (mode !== 'anchored' || !anchor || !wrapperRef.current) return;
    const wrapper = wrapperRef.current;

    const apply = () => {
      const r = anchor.getBoundingClientRect();
      wrapper.style.left = `${r.left}px`;
      wrapper.style.top = `${r.top}px`;
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
      wrapper.style.width = `${r.width}px`;
      wrapper.style.transform = '';
      wrapper.style.maxWidth = '';
      wrapper.style.minWidth = '';
    };
    apply();

    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        apply();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(anchor);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [mode, anchor]);

  // On switching back to floating, reset the anchor-derived inline
  // styles — otherwise stale left/top/width from the anchored
  // phase would override the default layout.
  useEffect(() => {
    if (mode !== 'floating' || !wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    wrapper.style.left = '50%';
    wrapper.style.top = 'auto';
    wrapper.style.bottom = '16px';
    wrapper.style.right = 'auto';
    wrapper.style.transform = 'translateX(-50%)';
    wrapper.style.width = '70%';
    wrapper.style.maxWidth = '640px';
    wrapper.style.minWidth = '280px';
  }, [mode]);

  // Host stays mounted even when hidden so hostEl is populated
  // before the first ▶ click and so the iframe doesn't get torn
  // down between plays. `visibility: hidden` keeps the DOM subtree
  // alive (vs. display: none which would zero-out the iframe).
  const visible = !!nowPlaying;

  return (
    <div
      ref={wrapperRef}
      className="fixed z-30 pointer-events-none"
      style={{
        visibility: visible ? 'visible' : 'hidden',
        left: '50%',
        bottom: '16px',
        transform: 'translateX(-50%)',
        width: '70%',
        maxWidth: '640px',
        minWidth: '280px',
      }}
      aria-label="지금 재생 중"
      aria-hidden={!visible}
    >
      <div className="pointer-events-auto relative group/np">
        <div
          ref={setHostEl}
          className="rounded-lg bg-[#2a1a0d] border overflow-hidden"
          style={{
            // Walnut tint cascades to the injected iframe — CSS
            // filter applies to descendants. Matches the earlier
            // inline variant's colour shift.
            filter:
              'sepia(0.25) hue-rotate(-18deg) saturate(0.88) brightness(0.94)',
            borderColor: 'rgba(90, 58, 32, 0.55)',
            boxShadow:
              mode === 'floating'
                ? '0 8px 24px rgba(0, 0, 0, 0.55)'
                : undefined,
            minHeight: 80,
          }}
        />
        {/* × button lives INSIDE the player box now so it never
            spills past the embed's right edge into the wall art.
            Hidden at rest, fades in on hover over the player. */}
        <button
          type="button"
          onClick={clearNowPlaying}
          aria-label="재생 닫기"
          title="재생 닫기"
          className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full border border-white/20 bg-[#141008]/85 hover:bg-[#e8a020] hover:text-[#141008] hover:border-[#e8a020] text-gray-200 text-sm leading-none flex items-center justify-center cursor-pointer opacity-0 group-hover/np:opacity-100 transition-opacity duration-150"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Empty placeholder rendered at the position the page wants the
// player to dock against. Registers its element with the global
// anchor store on mount; when no album is currently playing the
// anchor returns null so the page doesn't reserve empty space.
// Height matches the player's 80px iframe + border so layout is
// stable whether the player is visible or not.
export function NowPlayingAnchor({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const nowPlaying = useNowPlaying();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useRegisterNowPlayingAnchor(el);
  if (!nowPlaying) return null;
  return (
    <div
      ref={setEl}
      className={className}
      style={{ height: 82, ...style }}
      aria-hidden
    />
  );
}
