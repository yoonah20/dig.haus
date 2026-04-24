import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import {
  clearNowPlaying,
  extractSpotifyAlbumId,
  useNowPlaying,
} from '../hooks/useNowPlaying';

interface SiteStats {
  users: number;
  albums: number;
}

// Single source for the site-wide member + album counts displayed in
// the footer. 10-min staleTime + a global QueryClient cache means
// every page on the site reuses one fetch — fine because the counts
// move at human-curation pace, not real-time.
function useSiteStats() {
  return useQuery<SiteStats>({
    queryKey: ['site-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/stats/site');
      return data;
    },
    staleTime: 1000 * 60 * 10,
  });
}

// Global footer rendered by App.tsx so every route shares the same
// "dig.haus 2026 · …" line at the bottom.
//
// `pinned` — mydig variant: footer is fixed to the viewport bottom
// (matches the backdrop's bottom anchor), compact padding, and
// overlays scroll instead of flowing with it. The page reserves
// its own bottom padding so last-row content clears the overlay.
//
// When a mydig wall cell writes to the global `useNowPlaying`
// store, the same pinned strip swaps its footer content for a
// Spotify embed iframe + close button. The legal + stats line
// slides back in once the user closes the embed. Non-pinned
// (default) mode stays footer-only; we don't let route pages that
// scroll out of view host a floating player.
export default function SiteFooter({ pinned = false }: { pinned?: boolean }) {
  const { data } = useSiteStats();
  const users = data?.users ?? 0;
  const albums = data?.albums ?? 0;
  const nowPlaying = useNowPlaying();
  const activeAlbumId = pinned
    ? extractSpotifyAlbumId(nowPlaying?.spotifyUrl ?? null)
    : null;

  const layoutClasses = pinned
    ? 'fixed bottom-0 left-0 right-0 z-10 pointer-events-none'
    : 'mt-auto pt-10 pb-5';

  if (activeAlbumId && nowPlaying) {
    // Now Playing mode — hosts a Spotify embed iframe spanning the
    // viewport width. Pointer events re-enabled on the inner shell
    // so the embed + close button are interactive; the surrounding
    // strip stays click-through so content scrolling behind the
    // (translucent-edged) wrapper remains reachable.
    return (
      <footer
        aria-label="지금 재생 중"
        className={`${layoutClasses} px-2 pt-2 pb-2`}
      >
        <div className="max-w-[1280px] mx-auto flex items-stretch gap-2 pointer-events-auto">
          <iframe
            key={activeAlbumId}
            title={`${nowPlaying.artist} — ${nowPlaying.title}`}
            src={`https://open.spotify.com/embed/album/${activeAlbumId}?utm_source=generator&theme=0`}
            width="100%"
            height="80"
            frameBorder={0}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="rounded-lg border border-white/10 bg-[#0a0503] flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={clearNowPlaying}
            aria-label="재생 닫기"
            title="재생 닫기"
            className="shrink-0 self-center w-9 h-9 rounded-full border border-white/10 bg-[#1a130a]/80 hover:border-[#e8a020]/50 hover:text-[#e8a020] text-gray-400 text-lg leading-none transition-colors cursor-pointer"
          >
            ×
          </button>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className={`w-full max-w-[1280px] mx-auto ${layoutClasses} ${
        pinned ? 'pt-3 pb-3' : ''
      } px-4 text-center text-gray-600 text-xs`}
    >
      {/* Line 1: site identity + live counts. Counts append as they
          become available so the line shapes around whatever
          /api/stats/site returns. */}
      <div>
        dig.haus &copy; 2026
        {users > 0 && (
          <>
            {' · '}
            {users.toLocaleString()}명이 땅 파는 중
          </>
        )}
        {albums > 0 && (
          <>
            {' · '}
            앨범 {albums.toLocaleString()}개 묻혀 있음
          </>
        )}
      </div>
      {/* Line 2: legal links — broken onto their own row so the
          dense counts line doesn't visually bury them. Dimmer
          than the counts so they read as the secondary pair.
          Links re-enable pointer events in pinned mode so they
          stay clickable while the surrounding footer area is
          click-through to content scrolling beneath. */}
      <div className="mt-1.5 text-gray-700">
        <a
          href="/privacy.html"
          className={`hover:text-amber-500 ${pinned ? 'pointer-events-auto' : ''}`}
        >
          개인정보처리방침
        </a>
        {' · '}
        <a
          href="/terms.html"
          className={`hover:text-amber-500 ${pinned ? 'pointer-events-auto' : ''}`}
        >
          서비스 약관
        </a>
      </div>
    </footer>
  );
}
