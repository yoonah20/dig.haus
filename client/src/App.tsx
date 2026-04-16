import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SearchOverlayProvider } from './contexts/SearchOverlayContext';
import { HomeStateProvider } from './contexts/HomeStateContext';
import TopNav from './components/TopNav';

const Home = lazy(() => import('./pages/Home'));
const Album = lazy(() => import('./pages/Album'));
const Admin = lazy(() => import('./pages/Admin'));
const Profile = lazy(() => import('./pages/Profile'));

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-700 border-t-[#e8a020] rounded-full animate-spin" />
    </div>
  );
}

// Noise params we never want lingering in the address bar:
//   - auth=ok / auth=failed / auth=not_configured — OAuth callback
//     lands here; the redirect happens, AuthContext fetches /auth/me,
//     and the param has served its purpose. Leaving it visible made
//     every subsequent URL change read as "?auth=ok&sort=…" which
//     the user flagged as ugly.
//   - sort / page / seed — used to be React-Router state; migrated
//     to HomeStateContext so the bar stays at '/'. If someone shares
//     an old bookmarked link with these, strip them on load.
//
// `q=` is deliberately NOT stripped here — Home.tsx's own effect
// consumes the external-deep-link value (opens the search overlay)
// and then clears it.
const URL_NOISE = ['auth', 'sort', 'page', 'seed'];

function useStripUrlNoise() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    for (const key of URL_NOISE) {
      if (params.has(key)) {
        params.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    const query = params.toString();
    // replaceState — doesn't push a history entry and doesn't notify
    // React Router (which we no longer lean on for these params).
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash
    );
  }, []);
}

export default function App() {
  useStripUrlNoise();
  return (
    <AuthProvider>
      <SearchOverlayProvider>
        <HomeStateProvider>
          <div className="min-h-screen flex flex-col bg-[#0a0703] text-gray-100">
            <TopNav />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/album/:slug" element={<Album />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/profile" element={<Profile />} />
              </Routes>
            </Suspense>
          </div>
        </HomeStateProvider>
      </SearchOverlayProvider>
    </AuthProvider>
  );
}
