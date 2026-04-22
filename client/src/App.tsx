import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SearchOverlayProvider } from './contexts/SearchOverlayContext';
import { HomeStateProvider } from './contexts/HomeStateContext';
import { CurationProgressProvider } from './contexts/CurationProgressContext';
import TopNav from './components/TopNav';
import SiteFooter from './components/SiteFooter';
import CurationProgressPanel from './components/CurationProgressPanel';

const Home = lazy(() => import('./pages/Home'));
const Album = lazy(() => import('./pages/Album'));
const Admin = lazy(() => import('./pages/Admin'));
const Profile = lazy(() => import('./pages/Profile'));
const MyDig = lazy(() => import('./pages/MyDig'));
const MyDigPreview = lazy(() => import('./pages/MyDigPreview'));
const MyDigSnapshot = lazy(() => import('./pages/MyDigSnapshot'));
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
  // Routes under `/my/:username` (including snapshots) get the
  // painted wall backdrop across the full page, nav to footer.
  // `/my-preview` is a separate design-iteration route that does
  // not share the backdrop.
  const isMydig = location.pathname.startsWith('/my/');
  return (
    <AuthProvider>
      <SearchOverlayProvider>
        <HomeStateProvider>
          <CurationProgressProvider>
            <div
              className="min-h-screen flex flex-col bg-[#0a0703] text-gray-100 relative"
              // isolation:isolate creates a fresh stacking context
              // so the z-index:-1 backdrop layer stays behind this
              // app tree's content without escaping to compete with
              // anything rendered outside the app root.
              style={{ isolation: 'isolate' }}
            >
              {isMydig && (
                <>
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      // zIndex:-1 puts the backdrop behind the
                      // in-flow content (nav + route + footer) without
                      // blocking any of them. Filter is applied here
                      // so the image's cream/beige tone is pulled
                      // into the dark walnut range; filter stays
                      // scoped to this div and doesn't cascade to
                      // page content.
                      zIndex: -1,
                      backgroundImage: "url('/backdrops/wall2.webp')",
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                      filter: 'brightness(0.45) saturate(0.85)',
                    }}
                  />
                  {/* Warm lamp pool — a soft radial from upper-left
                      biased over the darkened backdrop, blended via
                      `screen` so it only lightens (never darkens)
                      whatever's beneath. Gives the scene a "pendant
                      lamp is on" focal point; previously the page
                      read as uniformly dim ("밋밋"). Kept at low
                      alpha so it doesn't wash out the wall texture. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      background:
                        'radial-gradient(ellipse 70% 60% at 25% 15%, rgba(255, 200, 130, 0.28) 0%, rgba(255, 180, 110, 0.10) 40%, transparent 70%)',
                      mixBlendMode: 'screen',
                    }}
                  />
                  {/* Bottom-right ambient lift so the opposite corner
                      from the lamp doesn't sink into pure black. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      background:
                        'radial-gradient(ellipse 50% 40% at 80% 85%, rgba(232, 160, 80, 0.14) 0%, transparent 65%)',
                      mixBlendMode: 'screen',
                    }}
                  />
                </>
              )}
              <TopNav />
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/album/:slug" element={<Album />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/admin/curation" element={<Admin />} />
                  <Route path="/admin/api" element={<Admin />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/my-preview" element={<MyDigPreview />} />
                  <Route path="/my/:username" element={<MyDig />} />
                  <Route path="/my/:username/snap/:slug" element={<MyDigSnapshot />} />
                  <Route path="/admin/api-console" element={<ApiConsole />} />
                  <Route path="/admin/compare" element={<LlmCompare />} />
                </Routes>
              </Suspense>
              <SiteFooter />
              <CurationProgressPanel />
            </div>
          </CurationProgressProvider>
        </HomeStateProvider>
      </SearchOverlayProvider>
    </AuthProvider>
  );
}
