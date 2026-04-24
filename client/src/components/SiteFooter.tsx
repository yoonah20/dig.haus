import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';

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
// at md+ (matches the backdrop's bottom anchor), compact padding,
// and overlays scroll instead of flowing with it. On mobile the
// pinned mode falls back to flow layout so the footer only appears
// once the user has scrolled the page to the end — the small
// viewport doesn't have room for a permanent footer strip. The
// page reserves its own bottom padding on desktop so last-row
// content clears the overlay. The mydig Spotify embed lives inline
// inside the wall section, so the footer no longer hosts it.
export default function SiteFooter({ pinned = false }: { pinned?: boolean }) {
  const { data } = useSiteStats();
  const users = data?.users ?? 0;
  const albums = data?.albums ?? 0;

  const layoutClasses = pinned
    ? 'mt-auto pt-10 pb-5 md:mt-0 md:pt-3 md:pb-3 md:fixed md:bottom-0 md:left-0 md:right-0 md:z-10 md:pointer-events-none'
    : 'mt-auto pt-10 pb-5';

  return (
    <footer
      className={`w-full max-w-[1280px] mx-auto ${layoutClasses} px-4 text-center text-gray-600 text-xs`}
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
          className={`hover:text-amber-500 ${pinned ? 'md:pointer-events-auto' : ''}`}
        >
          개인정보처리방침
        </a>
        {' · '}
        <a
          href="/terms.html"
          className={`hover:text-amber-500 ${pinned ? 'md:pointer-events-auto' : ''}`}
        >
          서비스 약관
        </a>
      </div>
    </footer>
  );
}
