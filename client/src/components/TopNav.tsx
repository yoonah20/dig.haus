import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginButton from './LoginButton';
import UsernameModal from './UsernameModal';
import SearchBar from './SearchBar';
import { useAuth } from '../contexts/AuthContext';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useHomeState } from '../contexts/HomeStateContext';

export default function TopNav() {
  const { user } = useAuth();
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const { open: searchOpen, initialQuery, openOverlay, closeOverlay } = useSearchOverlay();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { setPage } = useHomeState();

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
      <nav className="sticky top-0 z-40 bg-[#120c05]/95 backdrop-blur-sm border-b border-[#e8a020]/15 px-3 sm:px-4 py-3">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
            <Link
              to="/"
              onClick={handleLogoClick}
              className="text-[#e8a020] text-2xl md:text-3xl lowercase tracking-tight leading-none shrink-0 cursor-pointer"
              style={{ fontFamily: "'Syne', 'Inter', sans-serif", fontWeight: 700, letterSpacing: '-0.03em' }}
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
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* "+" album-register nav button is gone — registration
                happens inline in the search overlay now. Typing an
                album that isn't in dig.haus yet shows MB/Discogs
                candidates with a per-row [+] button; admins also get
                a [⚡] that registers + kicks off auto-curation. Less
                nav chrome, fewer surfaces to maintain. */}
            <button
              onClick={() => (searchOpen ? closeOverlay() : openOverlay())}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
              title="검색"
              aria-label="검색"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-[18px] h-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
            </button>
            {/* Sort trigger lives inline above the album grid now
                (Home.tsx's SortTrigger). Keeping the nav cluster
                down to "find / my store / login" — everything about
                how the feed is arranged belongs to the feed itself. */}
            {/* 내 가게 entry. Storefront icon (awning + shop body)
                instead of a house — the house glyph read as "go home"
                and collided with the logo's behaviour. First click
                with no username set opens the UsernameModal; on save
                the modal navigates. Later clicks go straight to
                /my/:username. Hidden for guests. */}
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
                title="내 가게"
                aria-label="내 가게"
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
            className="absolute left-0 right-0 top-full bg-[#0f0f0f] border-b border-white/5 px-4 py-4 animate-[slideDown_150ms_ease-out]"
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
