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
// "dig.haus 2026 · …" line at the bottom. Used to live inside Home.tsx
// only — short pages on /album/:slug, /profile, /admin, etc. felt
// hollow at the bottom without it.
export default function SiteFooter() {
  const { data } = useSiteStats();
  const users = data?.users ?? 0;
  const albums = data?.albums ?? 0;

  return (
    <footer className="w-full max-w-[1280px] mx-auto mt-auto pt-10 pb-5 px-4 text-center text-gray-600 text-xs">
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
      {' · '}
      <a href="/privacy.html" className="hover:text-amber-500">
        개인정보처리방침
      </a>
      {' · '}
      <a href="/terms.html" className="hover:text-amber-500">
        서비스 약관
      </a>
    </footer>
  );
}
