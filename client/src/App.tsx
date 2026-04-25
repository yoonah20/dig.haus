import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SearchOverlayProvider } from './contexts/SearchOverlayContext';
import { HomeStateProvider } from './contexts/HomeStateContext';
import { CurationProgressProvider } from './contexts/CurationProgressContext';
import TopNav from './components/TopNav';
import SiteFooter from './components/SiteFooter';
import PersistentNowPlayingPlayer from './components/PersistentNowPlayingPlayer';
import CurationProgressPanel from './components/CurationProgressPanel';

const Home = lazy(() => import('./pages/Home'));
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

// Floating dust motes — decorative particles that drift over the
// mydig painted-wall scene. Each spec is a hand-seeded layout
// point so positions stay deterministic across renders (no jarring
// re-randomisation). The animation itself (drift vector + alpha
// envelope) lives in index.css `@keyframes dustDrift`; here we
// just feed per-particle offsets via CSS custom properties.
//
// Two tiers: ~10 "foreground" motes (bigger, brighter, noticeable)
// and ~10 "background" motes (smaller, fainter, for depth). Mix
// makes the air look populated without every particle demanding
// attention.
const DUST_MOTES: Array<{
  left: string;
  top: string;
  size: number;
  duration: number; // seconds per drift cycle
  delay: number;
  dx: string;
  dy: string;
  alpha: number;
  glow?: boolean; // larger soft halo for the chunkier particles
}> = [
  // Foreground — bigger, brighter
  { left: '12%', top: '82%', size: 4, duration: 30, delay: 0, dx: '7vw', dy: '-70vh', alpha: 0.85, glow: true },
  { left: '28%', top: '68%', size: 3, duration: 36, delay: 4, dx: '-3vw', dy: '-55vh', alpha: 0.75, glow: true },
  { left: '42%', top: '88%', size: 5, duration: 26, delay: 8, dx: '5vw', dy: '-80vh', alpha: 0.9, glow: true },
  { left: '58%', top: '74%', size: 3, duration: 34, delay: 2, dx: '-4vw', dy: '-60vh', alpha: 0.8, glow: true },
  { left: '72%', top: '90%', size: 4, duration: 28, delay: 10, dx: '3vw', dy: '-75vh', alpha: 0.85, glow: true },
  { left: '84%', top: '62%', size: 3, duration: 40, delay: 6, dx: '-5vw', dy: '-50vh', alpha: 0.7, glow: true },
  { left: '18%', top: '54%', size: 3.5, duration: 34, delay: 12, dx: '7vw', dy: '-40vh', alpha: 0.75, glow: true },
  { left: '66%', top: '46%', size: 3, duration: 38, delay: 14, dx: '-6vw', dy: '-35vh', alpha: 0.72, glow: true },
  { left: '36%', top: '40%', size: 4, duration: 42, delay: 3, dx: '4vw', dy: '-30vh', alpha: 0.75, glow: true },
  { left: '92%', top: '78%', size: 3.5, duration: 32, delay: 18, dx: '-8vw', dy: '-65vh', alpha: 0.8, glow: true },
  // Background — smaller, fainter, different timings so the two
  // tiers never pulse in unison
  { left: '6%', top: '70%', size: 1.5, duration: 45, delay: 1, dx: '5vw', dy: '-60vh', alpha: 0.45 },
  { left: '22%', top: '88%', size: 1.8, duration: 33, delay: 5, dx: '-2vw', dy: '-75vh', alpha: 0.5 },
  { left: '48%', top: '60%', size: 1.5, duration: 50, delay: 9, dx: '6vw', dy: '-45vh', alpha: 0.42 },
  { left: '62%', top: '82%', size: 2, duration: 36, delay: 13, dx: '-3vw', dy: '-70vh', alpha: 0.5 },
  { left: '78%', top: '56%', size: 1.5, duration: 44, delay: 16, dx: '-7vw', dy: '-40vh', alpha: 0.45 },
  { left: '88%', top: '86%', size: 1.8, duration: 30, delay: 7, dx: '-5vw', dy: '-72vh', alpha: 0.5 },
  { left: '30%', top: '50%', size: 1.5, duration: 48, delay: 11, dx: '3vw', dy: '-35vh', alpha: 0.4 },
  { left: '54%', top: '92%', size: 2, duration: 32, delay: 15, dx: '4vw', dy: '-80vh', alpha: 0.55 },
];

function DustMotes() {
  return (
    <div
      aria-hidden
      // zIndex:5 puts the dust layer above the in-flow page
      // content (records, rails, header) so motes actually float
      // in front of the scene. Still well below the nav (z-40)
      // and any mydig modals (z-40/50) so clicks and overlays
      // work as before. pointer-events:none keeps everything
      // clickable underneath.
      //
      // hidden sm:block — motes tuned for desktop viewports; on
      // a phone screen the same particle sizes read as oversized
      // specks and crowd the already-tight scene. Gated via the
      // 640px Tailwind sm breakpoint.
      className="pointer-events-none absolute inset-0 overflow-hidden hidden sm:block"
      style={{ zIndex: 5 }}
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
            background:
              'radial-gradient(circle, rgba(255, 235, 190, 1) 0%, rgba(255, 215, 160, 0.85) 35%, rgba(255, 200, 140, 0.4) 65%, transparent 90%)',
            // Foreground particles get a soft warm halo so they
            // read clearly against the wall without relying on
            // the radial gradient alone to sell the "glowing
            // speck" effect.
            boxShadow: m.glow
              ? '0 0 6px rgba(255, 220, 160, 0.55), 0 0 12px rgba(255, 200, 140, 0.3)'
              : undefined,
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
  // full painted-wall backdrop across the full page, nav to
  // footer. The home grid also gets a dimmer version of the same
  // wall as a backdrop texture — no lamp pools, no dust motes,
  // just the darkened painting behind the album grid.
  const isMydig = location.pathname.startsWith('/my/');
  const isHome = location.pathname === '/';
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
              {isHome && (
                <div
                  aria-hidden
                  // Mobile-only flat dark-gray wash. Replaces the
                  // painted-wall backdrop on narrow viewports —
                  // the wall peeking in and out behind gaps read
                  // as noise, and a clean neutral slate lets the
                  // mobile feed's dense covers do the talking.
                  className="md:hidden absolute inset-0 pointer-events-none"
                  style={{ zIndex: -1, backgroundColor: '#1a1a1a' }}
                />
              )}
              {isHome && (
                <div
                  aria-hidden
                  // Hidden below md — the mobile feed's dense
                  // covers already carry plenty of visual texture,
                  // and the wall peeking in and out behind gaps
                  // reads as noise on a narrow viewport.
                  className="hidden md:block absolute inset-0 pointer-events-none"
                  style={{
                    // Store-interior backdrop, authored at the same
                    // 0.686× of 3500×2000 dimensions as the older
                    // wall2.webp so the placement settings carry
                    // over unchanged. Brightness + saturation match
                    // mydig's backdrop pass — the home page now sits
                    // at the same atmospheric register as mydig
                    // rather than the darker wash it had under
                    // wall2.webp.
                    zIndex: -1,
                    backgroundImage: "url('/backdrops/store.webp')",
                    backgroundSize: '2401px 1372px',
                    backgroundPosition: 'center bottom',
                    backgroundRepeat: 'no-repeat',
                    filter: 'brightness(0.55) saturate(0.85)',
                  }}
                />
              )}
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
                      // Fixed pixel size at 0.686× the 3500×2000 source,
                      // not `cover`. The painted wall was composed at
                      // a specific scale; letting cover stretch it to
                      // every viewport distorts the rail spacing and
                      // stereo proportions. We accept letterboxing on
                      // very wide/tall viewports (the parent's #0a0703
                      // fills the gap) in exchange for consistent
                      // scale everywhere.
                      backgroundSize: '2401px 1372px',
                      // Anchor to the bottom so the floor/baseboard
                      // of the painted wall stays visible at every
                      // viewport height — a shorter window clips the
                      // top of the image instead of the footer area,
                      // matching how you'd look at a real shop wall
                      // (eye level stays at the bottom).
                      backgroundPosition: 'center bottom',
                      backgroundRepeat: 'no-repeat',
                      filter: 'brightness(0.55) saturate(0.85)',
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
                  {/* Vignette — dark edges fading toward the
                      center. Subtle depth cue that makes the scene
                      feel like it's lit from within rather than
                      uniformly flat. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      background:
                        'radial-gradient(ellipse 110% 95% at center, transparent 45%, rgba(0,0,0,0.45) 100%)',
                    }}
                  />
                  {/* Film grain — fine static noise pulled low via
                      mix-blend-mode: overlay. Breaks the rendered
                      backdrop out of its too-clean digital feel so
                      covers + wall share a common "painted over
                      coarse paper" texture. Kept subtle (opacity
                      0.08) so it reads as atmosphere, not a filter
                      on top of everything. */}
                  <svg
                    aria-hidden
                    className="absolute inset-0 pointer-events-none w-full h-full"
                    style={{
                      zIndex: -1,
                      opacity: 0.12,
                      mixBlendMode: 'overlay',
                    }}
                  >
                    <defs>
                      <filter id="mydigFilmGrain">
                        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" />
                        <feColorMatrix values="0 0 0 0 0.9  0 0 0 0 0.82  0 0 0 0 0.68  0 0 0 1 0" />
                      </filter>
                    </defs>
                    <rect width="100%" height="100%" filter="url(#mydigFilmGrain)" />
                  </svg>
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
