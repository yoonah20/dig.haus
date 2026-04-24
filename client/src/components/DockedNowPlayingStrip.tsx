import { useLocation } from 'react-router-dom';
import {
  clearNowPlaying,
  extractSpotifyAlbumId,
  useNowPlaying,
} from '../hooks/useNowPlaying';

// Docked variant of the mydig Now Playing strip. Lives in App.tsx
// at the root so it renders on every route EXCEPT /my/:username
// (mydig owns its own inline version below the wall, and double-
// rendering would stack two embeds for the same audio). Keeps the
// walnut tint + layout dimensions of the inline variant so the
// player feels like the same element drifting into a floating
// state when the viewer leaves mydig.
//
// Position: fixed to the viewport bottom with a small inset so the
// player reads as a floating mini-player rather than a hard-docked
// player bar (which would conflict visually with the footer). On
// short pages the footer stays below the fold while the player is
// active, which matches every other music app's docked-player UX.
export default function DockedNowPlayingStrip() {
  const location = useLocation();
  const np = useNowPlaying();
  const albumId = extractSpotifyAlbumId(np?.spotifyUrl ?? null);

  // Route gate — mydig renders its own inline strip below the
  // wall; don't also float a docked copy over it.
  const onMydig = location.pathname.startsWith('/my/');
  if (onMydig || !np || !albumId) return null;

  return (
    <div
      aria-label="지금 재생 중"
      className="fixed left-0 right-0 bottom-4 z-30 px-4 pointer-events-none"
    >
      <div className="mx-auto flex items-stretch gap-2 w-[70%] min-w-[280px] max-w-[640px] pointer-events-auto">
        <iframe
          key={albumId}
          title={`${np.artist} — ${np.title}`}
          src={`https://open.spotify.com/embed/album/${albumId}?utm_source=generator&theme=0`}
          width="100%"
          height="80"
          frameBorder={0}
          scrolling="no"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          // Same walnut CSS filter as the mydig inline variant so
          // the floating mini player feels continuous with the one
          // the viewer just left behind on their wall.
          style={{
            filter:
              'sepia(0.25) hue-rotate(-18deg) saturate(0.88) brightness(0.94)',
            borderColor: 'rgba(90, 58, 32, 0.55)',
            // Extra drop-shadow sells the "floating" read on the
            // flat chrome of non-mydig pages.
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
          }}
          className="rounded-lg bg-[#2a1a0d] flex-1 min-w-0 border"
        />
        <button
          type="button"
          onClick={clearNowPlaying}
          aria-label="재생 닫기"
          title="재생 닫기"
          className="shrink-0 self-center w-8 h-8 rounded-full border border-white/10 bg-[#1a130a]/90 hover:border-[#e8a020]/50 hover:text-[#e8a020] text-gray-400 text-base leading-none transition-colors cursor-pointer shadow-lg"
        >
          ×
        </button>
      </div>
    </div>
  );
}
