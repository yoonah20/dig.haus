import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginButton from './LoginButton';
import RegisterAlbumModal from './RegisterAlbumModal';
import SearchBar from './SearchBar';
import SortMenu from './Home/SortMenu';
import { useAuth } from '../contexts/AuthContext';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useAlbumRequests } from '../hooks/useAlbumRequests';

export default function TopNav() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [registerOpen, setRegisterOpen] = useState(false);
  const { open: searchOpen, initialQuery, openOverlay, closeOverlay } = useSearchOverlay();
  const navigate = useNavigate();
  const requestsQuery = useAlbumRequests(isAdmin);
  const pendingCount = requestsQuery.data?.requests.length ?? 0;
  const panelRef = useRef<HTMLDivElement>(null);
  // Sort only makes sense on the home album list, so the trigger is
  // gated on path. Anywhere else (album/artist/profile/admin) it's
  // hidden so it doesn't suggest controls that don't apply.
  const location = useLocation();
  const isHome = location.pathname === '/';

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
      <nav className="sticky top-0 z-40 bg-[#120c05]/95 backdrop-blur-sm border-b border-[#e8a020]/15 px-4 py-3">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
            <Link
              to="/"
              className="text-[#e8a020] text-2xl md:text-3xl lowercase tracking-tight leading-none shrink-0"
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
              dig by cover, find by feel
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* The "+" affordance opens the same modal for both admin
                and logged-in users — mode changes the submit action:
                admin directly registers; a user creates a request row
                that admin approves later. Hidden for guests. */}
            {user && (
              <button
                onClick={() => setRegisterOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
                title={isAdmin ? '앨범 등록' : '앨범 등록 요청'}
                aria-label={isAdmin ? '앨범 등록' : '앨범 등록 요청'}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )}
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
            {/* Sort sits next to search so the whole "find" cluster
                (add? → search → sort) reads as one group with login
                anchored at the right edge. */}
            {isHome && <SortMenu />}
            {isAdmin && pendingCount > 0 && (
              <button
                onClick={() => navigate('/admin')}
                className="relative w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
                title={`등록 요청 ${pendingCount}건`}
                aria-label={`등록 요청 ${pendingCount}건`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <span className="absolute -bottom-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1">
                  {pendingCount}
                </span>
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
      <RegisterAlbumModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        mode={isAdmin ? 'register' : 'request'}
      />
    </>
  );
}
