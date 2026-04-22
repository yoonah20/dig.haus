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

// Floating dust motes — decorative particles that drift over the
// mydig painted-wall scene. Each spec is a hand-seeded layout
// point so positions stay deterministic across renders (no jarring
// re-randomisation). The animation itself (drift vector + alpha
// envelope) lives in index.css `@keyframes dustDrift`; here we
// just feed per-particle offsets via CSS custom properties.
const DUST_MOTES: Array<{
  left: string;
  top: string;
  size: number;
  duration: number; // seconds per drift cycle
  delay: number;
  dx: string;
  dy: string;
  alpha: number;
}> = [
  { left: '12%', top: '82%', size: 2, duration: 32, delay: 0, dx: '6vw', dy: '-70vh', alpha: 0.55 },
  { left: '28%', top: '68%', size: 1.5, duration: 40, delay: 4, dx: '-3vw', dy: '-55vh', alpha: 0.4 },
  { left: '42%', top: '88%', size: 2.5, duration: 28, delay: 8, dx: '5vw', dy: '-80vh', alpha: 0.6 },
  { left: '58%', top: '74%', size: 1.5, duration: 36, delay: 2, dx: '-4vw', dy: '-60vh', alpha: 0.45 },
  { left: '72%', top: '90%', size: 2, duration: 30, delay: 10, dx: '3vw', dy: '-75vh', alpha: 0.5 },
  { left: '84%', top: '62%', size: 1.2, duration: 44, delay: 6, dx: '-5vw', dy: '-50vh', alpha: 0.35 },
  { left: '18%', top: '54%', size: 1.8, duration: 38, delay: 12, dx: '7vw', dy: '-40vh', alpha: 0.4 },
  { left: '66%', top: '46%', size: 1.5, duration: 42, delay: 14, dx: '-6vw', dy: '-35vh', alpha: 0.38 },
  { left: '36%', top: '40%', size: 1.3, duration: 46, delay: 3, dx: '4vw', dy: '-30vh', alpha: 0.3 },
  { left: '92%', top: '78%', size: 2, duration: 34, delay: 18, dx: '-8vw', dy: '-65vh', alpha: 0.5 },
];

function DustMotes() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: -1 }}
    >
      {DUST_MOTES.map((m, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            background: 'radial-gradient(circle, rgba(255, 224, 170, 0.9) 0%, rgba(255, 210, 150, 0.5) 45%, transparent 75%)',
            opacity: 0,
            animation: `dustDrift ${m.duration}s ${m.delay}s infinite ease-in-out`,
            // Custom properties consumed by the keyframe — per-
            // particle drift direction and alpha so motion feels
            // varied across the swarm.
            ['--dust-dx' as any]: m.dx,
            ['--dust-dy' as any]: m.dy,
            ['--dust-alpha' as any]: m.alpha,
          }}
        />
      ))}
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
                  {/* Warm lamp pool — soft radial from upper-right
                      biased over the darkened backdrop, blended via
                      `screen` so it only lightens (never darkens)
                      whatever's beneath. Direction was flipped from
                      upper-left so the lamp sits on the opposite
                      side of the baked wall-glow, creating a small
                      cross-light instead of piling on the same
                      corner. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      background:
                        'radial-gradient(ellipse 70% 60% at 75% 15%, rgba(255, 200, 130, 0.28) 0%, rgba(255, 180, 110, 0.10) 40%, transparent 70%)',
                      mixBlendMode: 'screen',
                    }}
                  />
                  {/* Bottom-left ambient lift — counter-balance to
                      the upper-right lamp, keeps the opposite corner
                      from sinking into pure black. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      background:
                        'radial-gradient(ellipse 50% 40% at 20% 85%, rgba(232, 160, 80, 0.14) 0%, transparent 65%)',
                      mixBlendMode: 'screen',
                    }}
                  />
                  {/* Floating dust motes — slow-drifting warm
                      specks that add life to the scene. Each
                      particle has its own position, size, and
                      animation offset so motion never feels
                      synchronised. Pointer-events none keeps
                      clicks flowing through. */}
                  <DustMotes />
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
