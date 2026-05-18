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
// "dig.haus 2026 · …" line at the bottom. Flows at the end of the
// page on every route — `mt-auto` inside the App's flex-column root
// pushes it to the bottom of the viewport on short pages and lands
// it after content on tall ones.
export default function SiteFooter() {
  const { data } = useSiteStats();
  const users = data?.users ?? 0;
  const albums = data?.albums ?? 0;

  return (
    <footer
      className="w-full max-w-[1280px] mx-auto mt-auto pt-6 pb-5 px-4 text-center text-gray-600 text-xs"
    >
      {/* Line 1: site identity + live counts. Counts append as they
          become available so the line shapes around whatever
          /api/stats/site returns. */}
      <div>
        dig.haus &copy; 2026
        {users > 0 && (
          <>
            {' · '}
            {users.toLocaleString()}명이 파는 중
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
          than the counts so they read as the secondary pair. */}
      <div className="mt-1.5 text-gray-700">
        <a href="/privacy.html" className="hover:text-amber-500">
          개인정보처리방침
        </a>
        {' · '}
        <a href="/terms.html" className="hover:text-amber-500">
          서비스 약관
        </a>
      </div>
    </footer>
  );
}
