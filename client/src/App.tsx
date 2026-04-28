import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SearchOverlayProvider } from './contexts/SearchOverlayContext';
import { HomeStateProvider } from './contexts/HomeStateContext';
import { CurationProgressProvider } from './contexts/CurationProgressContext';
import TopNav from './components/TopNav';
import SiteFooter from './components/SiteFooter';
import PersistentNowPlayingPlayer from './components/PersistentNowPlayingPlayer';
import CurationProgressPanel from './components/CurationProgressPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { HERO_THEME } from './lib/heroTheme';

const Home = lazy(() => import('./pages/HomeNext'));
const DigPage = lazy(() => import('./pages/DigPage'));
const Album = lazy(() => import('./pages/Album'));
const Admin = lazy(() => import('./pages/Admin'));
const Profile = lazy(() => import('./pages/Profile'));
const MyDig = lazy(() => import('./pages/MyDig'));
const ApiConsole = lazy(() => import('./pages/ApiConsole'));
const LlmCompare = lazy(() => import('./pages/LlmCompare'));

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
  const location = useLocation();

  // Reset scroll on route change. Without this, navigating from
  // a deep-scrolled / to /dig (or any other route) inherits the
  // previous page's scroll position, which on mobile in particular
  // dropped users into the middle of the album feed instead of
  // its header. Skip when the path is unchanged but the query
  // string changes (search overlay, q= deep-link cleanup) so
  // scroll surveys stay put.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [location.pathname]);
  // Routes under `/my/:username` (including snapshots) get the
  // full painted-wall backdrop across the full page, nav to
  // footer. The home grid also gets a dimmer version of the same
  // wall as a backdrop texture — no lamp pools, no dust motes,
  // just the darkened painting behind the album grid.
  const isMydig = location.pathname.startsWith('/my/');
  const isDig = location.pathname === '/dig';
  // Home tints the app-root bg the same warm-dark as the nav so
  // the strip below the activity sections (where the footer
  // shows through) doesn't read as a separate, darker band. Other
  // routes keep the deeper page bg unchanged.
  const isHome = location.pathname === '/';
  return (
    <AuthProvider>
      <SearchOverlayProvider>
        <HomeStateProvider>
          <CurationProgressProvider>
            <div
              className={`min-h-screen flex flex-col text-gray-100 relative ${
                isHome ? 'bg-[#120c05]' : 'bg-[#0a0703]'
              }`}
              // isolation:isolate creates a fresh stacking context
              // so the z-index:-1 backdrop layer stays behind this
              // app tree's content without escaping to compete with
              // anything rendered outside the app root.
              style={{ isolation: 'isolate' }}
            >
              {isDig && (
                <div
                  aria-hidden
                  // /dig (catalog browse) sits on a flat dark wash —
                  // the dense album grid is the surface visitors are
                  // there to read, and any backdrop image pulls the
                  // eye away from the covers. Mobile and desktop
                  // share the same flat tone here.
                  className="absolute inset-0 pointer-events-none"
                  style={{ zIndex: -1, backgroundColor: '#1a1a1a' }}
                />
              )}
              {isMydig && (
                <>
                  {/* Solid wall colour base. HERO_THEME.wall ties
                      mydig's surface tone to the home hero, so a
                      future backdrop swap propagates here too. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      backgroundColor: HERO_THEME.wall,
                    }}
                  />
                  {/* Paper-grain texture — same approach the mobile
                      home hero uses. repeat-y + 100% width auto-tiles
                      down the full page height, so the backdrop never
                      clips when the wall + snapshot strip + footer
                      stack grows past one viewport. soft-light blend
                      lets the wall colour drive luminance/hue and the
                      texture only contributes surface noise. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      backgroundImage: "url('/textures/mobild_drop.webp')",
                      backgroundSize: '100% auto',
                      backgroundRepeat: 'repeat-y',
                      backgroundPosition: 'top center',
                      mixBlendMode: 'soft-light',
                      opacity: 0.6,
                    }}
                  />
                </>
              )}
              <TopNav />
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/dig" element={<DigPage />} />
                  <Route path="/album/:slug" element={<Album />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/admin/curation" element={<Admin />} />
                  <Route path="/admin/api" element={<Admin />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/my/:username" element={<MyDig />} />
                  {/* Snapshot viewing is now in-page via #<slug>
                      hash on /my/:username — the separate route
                      is a back-compat redirect so old share links
                      (/my/:u/snap/:s) still land on the right
                      snapshot. */}
                  <Route
                    path="/my/:username/snap/:slug"
                    element={<MyDig />}
                  />
                  <Route path="/admin/api-console" element={<ApiConsole />} />
                  <Route path="/admin/compare" element={<LlmCompare />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
              {/* Footer on mydig is `pinned` — fixed to the viewport
                  bottom so it tracks the backdrop's bottom anchor no
                  matter how the wall + snapshot strip change length.
                  Other routes keep the flow-layout sticky-footer. */}
              <SiteFooter pinned={isMydig} />
              {/* Persistent Spotify player — a single iframe mounted
                  once at App root and never unmounted. Fixed to the
                  viewport at bottom-center. The stable DOM node is
                  what keeps Spotify playback alive through route
                  changes. */}
              <PersistentNowPlayingPlayer />
              <CurationProgressPanel />
            </div>
          </CurationProgressProvider>
        </HomeStateProvider>
      </SearchOverlayProvider>
    </AuthProvider>
  );
}
