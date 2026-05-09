import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginButton from './LoginButton';
import UsernameModal from './UsernameModal';
import SearchBar from './SearchBar';
import { useAuth } from '../contexts/AuthContext';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useHomeState } from '../contexts/HomeStateContext';

// md (≥768px) and up gets the inline search input in the nav row;
// below that we keep the button → drop-panel pattern because the
// nav already runs out of horizontal room with the logo + buttons.
// SSR / first-paint defaults to desktop since most visitors are on
// laptops and the desktop layout is the more common case.
function useIsDesktopNav() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export default function TopNav() {
  const { user } = useAuth();
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const { open: searchOpen, initialQuery, openOverlay, closeOverlay } = useSearchOverlay();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { setPage } = useHomeState();
  const isDesktop = useIsDesktopNav();
  // Inline-search seed key + value. External openOverlay(query) calls
  // (DigPage `?q=` redirect, ArtistCredit click) flow through the
  // shared overlay context — on desktop we consume them by re-keying
  // the inline SearchBar so it remounts with the new initialQuery and
  // autoFocuses, mirroring how the mobile drop panel handles the same
  // seed. closeOverlay clears the shared "open" flag so the same
  // query can re-trigger if the user clicks the artist link twice.
  const [inlineSeed, setInlineSeed] = useState({ query: '', key: 0 });
  useEffect(() => {
    if (!isDesktop || !searchOpen) return;
    setInlineSeed((prev) => ({ query: initialQuery, key: prev.key + 1 }));
    closeOverlay();
  }, [isDesktop, searchOpen, initialQuery, closeOverlay]);

  // Clicking the logo always sends the user to the home page's
  // first card. From another route = normal navigation + scroll top.
  // From the home page itself = reset page state (paginated users
  // would otherwise sit on their last page with nothing visible).
  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setPage(1);
    if (location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate('/');
    }
  };

  // ESC to close search
  useEffect(() => {
    if (!searchOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOverlay();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchOpen, closeOverlay]);

  // Outside click to close
  useEffect(() => {
    if (!searchOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeOverlay();
      }
    }
    // Delay attach so the click that opens the panel doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [searchOpen, closeOverlay]);

  return (
    <>
      <nav className="sticky top-0 z-40 bg-[#120c05]/95 backdrop-blur-sm border-b border-[#e8a020]/15 px-3 sm:px-4 py-2.5">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-baseline gap-2 sm:gap-3 min-w-0 shrink">
            <Link
              to="/"
              onClick={handleLogoClick}
              // Thick-bordered amber box around the original Syne
              // wordmark — a CSS-only echo of the sticker logo
              // (logo.webp in /textures) without giving up the
              // typeset font. Reverted from the raster sticker
              // because the typeset version reads cleaner at the
              // small nav size and the digman mascot now lives
              // alongside the home feed heading instead.
              className="inline-flex items-center text-[#e8a020] text-xl md:text-2xl lowercase tracking-tight leading-none shrink-0 cursor-pointer border-2 md:border-[3px] border-[#e8a020] px-1 py-0.5"
              style={{
                fontFamily: "'Syne', 'Inter', sans-serif",
                fontWeight: 700,
                letterSpacing: '-0.03em',
                // Stamp tilt — left side dips, mirrors the
                // hand-applied feel the dig.haus PICK badge has
                // on the hero LPs.
                transform: 'rotate(-3deg)',
                transformOrigin: 'center',
              }}
            >
              dig.haus
            </Link>
            {/* Tagline reads alongside the wordmark on desktop. Hidden
                below md (mobile) because it overflows next to the logo
                + nav controls in the narrow viewport. */}
            <span
              className="hidden md:inline whitespace-nowrap text-[13px] truncate"
              style={{
                fontFamily: "'Syne', 'Inter', sans-serif",
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: '#d4c090',
                opacity: 0.9,
              }}
            >
              No algorithms needed. Keep digging.
            </span>
          </div>
          {/* Desktop-inline search (md+ only). Always mounted so the
              input is a fixture in the nav row — record-shop "search
              the index" affordance, no click-to-expand step. flex-1
              absorbs the slack between the logo cluster and the
              right-side buttons; max-w-md keeps it from sprawling at
              huge viewports. The compact prop on SearchBar shrinks
              the input chrome to nav-button height (~32px). */}
          <div className="hidden md:flex flex-1 max-w-md justify-end px-2 lg:px-4">
            <SearchBar
              key={inlineSeed.key}
              initialQuery={inlineSeed.query}
              autoFocus={inlineSeed.key > 0}
              compact
            />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* "+" album-register nav button is gone — registration
                happens inline in the search overlay now. Typing an
                album that isn't in dig.haus yet shows MB/Discogs
                candidates with a per-row [+] button; admins also get
                a [⚡] that registers + kicks off auto-curation. Less
                nav chrome, fewer surfaces to maintain. */}
            {/* Search + register — the magnifying glass owns this
                affordance on mobile only now; md+ has the inline
                input above. The unified search modal handles both
                "find an album that's already in dig.haus" and "request
                / register one that isn't yet" via the per-row + button
                on MB/Discogs candidates, so search and registration
                share a single nav slot. The shovel is the next
                button over and means "go digging" (link to /dig). */}
            <button
              onClick={() => (searchOpen ? closeOverlay() : openOverlay())}
              className="md:hidden group w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 hover:border-[#e8a020] hover:bg-[#e8a020] transition-colors cursor-pointer"
              title="검색 / 앨범 등록"
              aria-label="검색 / 앨범 등록"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-[18px] h-[18px] text-[#e8a020] group-hover:text-black transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
            </button>
            {/* Digging — the shovel glyph (flaticon shovel-dig.png,
                masked to amber). Links to /dig, the dense album-grid
                browse page that used to live at /. The active verb
                "dig" sits on this button now that home is a curated
                wall destination rather than a catalog. */}
            <Link
              to="/dig"
              className="group w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 hover:border-[#e8a020] hover:bg-[#e8a020] transition-colors cursor-pointer"
              title="디깅하기 — 전체 둘러보기"
              aria-label="디깅하기"
            >
              <span
                aria-hidden
                className="w-[18px] h-[18px] bg-[#e8a020] group-hover:bg-black transition-colors"
                style={{
                  WebkitMaskImage: "url('/icons/shovel-dig.png')",
                  WebkitMaskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskImage: "url('/icons/shovel-dig.png')",
                  maskSize: 'contain',
                  maskRepeat: 'no-repeat',
                  maskPosition: 'center',
                }}
              />
            </Link>
            {/* Sort trigger lives inline above the album grid now
                (Home.tsx's SortTrigger). Keeping the nav cluster
                down to "find / my store / login" — everything about
                how the feed is arranged belongs to the feed itself. */}
            {/* mydig entry. Storefront glyph (Heroicons building-
                storefront — awning + shop body) restored after a run
                of shovel variants. The shovel is now the search
                button since "dig" is the active verb, and mydig is
                the destination — "my record store". First click
                with no username set opens the UsernameModal; later
                clicks navigate to /my/:username. Hidden for guests. */}
            {user && (
              <button
                onClick={() => {
                  if (user.mydigUsername) {
                    navigate(`/my/${user.mydigUsername}`);
                  } else {
                    setUsernameModalOpen(true);
                  }
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
                title="mydig으로"
                aria-label="mydig으로"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-[18px] h-[18px]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"
                  />
                </svg>
              </button>
            )}
            <LoginButton />
          </div>
        </div>

        {searchOpen && (
          <div
            ref={panelRef}
            className="md:hidden absolute left-0 right-0 top-full bg-[#0f0f0f] border-b border-white/5 px-4 py-4 animate-[slideDown_150ms_ease-out]"
          >
            <SearchBar
              initialQuery={initialQuery}
              autoFocus
              onSelect={closeOverlay}
            />
          </div>
        )}
      </nav>
      {/* Conditional mount — when the modal closes we want its state
          (input, query, last search results) gone, so the next open
          is a fresh session rather than picking up where the previous
          one left off. An always-mounted modal preserved useState
          across close/reopen and showed stale result rows for a beat
          before the reset effect could clear them. */}
      <UsernameModal
        open={usernameModalOpen}
        onClose={() => setUsernameModalOpen(false)}
        initialValue={user?.mydigUsername ?? undefined}
        onSaved={(username) => {
          setUsernameModalOpen(false);
          navigate(`/my/${username}`);
        }}
      />
    </>
  );
}
