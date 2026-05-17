import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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

const Home = lazy(() => import('./pages/HomeNext'));
const DigPage = lazy(() => import('./pages/DigPage'));
const Album = lazy(() => import('./pages/Album'));
const Admin = lazy(() => import('./pages/Admin'));
const Profile = lazy(() => import('./pages/Profile'));
const MyDig = lazy(() => import('./pages/MyDig'));
const ApiConsole = lazy(() => import('./pages/ApiConsole'));
const LlmCompare = lazy(() => import('./pages/LlmCompare'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Suspense fallback for lazy-loaded routes. The amber spinner was
// the placeholder while every chunk in the app was small — once the
// MyDig + Admin chunks grew this fallback became visible long enough
// that a faceless spinner felt cold. Swapped to the digman mascot
// (digging pose — the "I'm working on it" expression for an
// in-flight chunk load) with a slow pulse so the in-between state
// stays on-brand. Wrapper is square + object-contain so the full
// portrait renders at any breakpoint.
function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-64 h-64 overflow-hidden opacity-70 animate-pulse">
        <img
          src="/textures/digman_digging.webp"
          alt=""
          aria-hidden
          className="block w-full h-full object-contain select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}

// Noise params we never want lingering in the address bar:
//   - auth=ok / auth=failed / auth=not_configured / auth=pending —
//     OAuth callback lands here; the redirect happens, AuthContext
//     fetches /auth/me, and the param has served its purpose. Leaving
//     it visible made every subsequent URL change read as
//     "?auth=ok&sort=…" which the user flagged as ugly.
//   - sort / page / seed — used to be React-Router state; migrated
//     to HomeStateContext so the bar stays at '/'. If someone shares
//     an old bookmarked link with these, strip them on load.
//
// `q=` is deliberately NOT stripped here — Home.tsx's own effect
// consumes the external-deep-link value (opens the search overlay)
// and then clears it.
const URL_NOISE = ['auth', 'sort', 'page', 'seed'];

type AuthOutcome = 'ok' | 'failed' | 'pending' | 'not_configured';

// Capture the auth=… outcome on mount before stripping, so the App
// can act on it (currently: show the awaiting-approval modal when
// outcome=pending). Other outcomes still strip silently — success and
// failure flows are already telegraphed elsewhere in the UI (logged-in
// state for success, generic OAuth retry for failure).
function useAuthOutcomeAndStripNoise(): AuthOutcome | null {
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    if (
      auth === 'ok' ||
      auth === 'failed' ||
      auth === 'pending' ||
      auth === 'not_configured'
    ) {
      setOutcome(auth);
    }
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
  return outcome;
}

// Modal shown after a Google login attempt by an un-invited email.
// Phrasing avoids naming the operator address — the server-side
// notification is opaque from the user's perspective; they just need
// to know the request landed and approval will follow. "확인" dismisses
// without retrying anything.
function PendingApprovalModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-2xl bg-panel border border-white/10 shadow-2xl p-6 text-center">
        <h2 className="text-lg font-semibold text-white mb-2">
          조금만 기다려 주세요
        </h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          dig.haus는 초대받은 분만 입장하실 수 있어요.
          <br />
          가입 신청이 운영자에게 전달됐고, 검토 후 입장하실 수 있도록
          알려드릴게요.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 inline-flex items-center justify-center rounded-md bg-accent hover:bg-accent-hover text-panel-strong font-bold px-5 py-2 text-sm cursor-pointer transition-colors"
        >
          확인
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const authOutcome = useAuthOutcomeAndStripNoise();
  const [pendingDismissed, setPendingDismissed] = useState(false);
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
  // mydig — page-level backdrop intentionally absent. The earlier
  // painted-wall + lamp + vignette + mobile pattern stack went out
  // with the 2026-05-17 crate-floor redesign (the carpet inside
  // CrateFloor is the only "surface" the new design needs). Flag
  // is kept because SiteFooter pinning still reads it below.
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
                isHome ? 'bg-background' : 'bg-panel-strong'
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
                  style={{ zIndex: -1, backgroundColor: 'var(--color-panel)' }}
                />
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
                  {/* Catch-all 404. Has to sit last so explicit
                      routes match first; the digman page reads as
                      "this hole is blocked" rather than the React
                      Router default of a blank screen. */}
                  <Route path="*" element={<NotFound />} />
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
              {authOutcome === 'pending' && !pendingDismissed && (
                <PendingApprovalModal
                  onDismiss={() => setPendingDismissed(true)}
                />
              )}
            </div>
          </CurationProgressProvider>
        </HomeStateProvider>
      </SearchOverlayProvider>
    </AuthProvider>
  );
}
