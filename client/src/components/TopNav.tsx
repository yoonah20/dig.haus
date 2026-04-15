import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import LoginButton from './LoginButton';
import RegisterAlbumModal from './RegisterAlbumModal';
import SearchBar from './SearchBar';
import { useAuth } from '../contexts/AuthContext';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';

export default function TopNav() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [registerOpen, setRegisterOpen] = useState(false);
  const { open: searchOpen, initialQuery, openOverlay, closeOverlay } = useSearchOverlay();
  const panelRef = useRef<HTMLDivElement>(null);

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
      <nav className="sticky top-0 z-40 bg-[#24180a]/90 backdrop-blur-sm border-b border-[#e8a020]/30 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <Link
              to="/"
              className="text-[#e8a020] text-3xl lowercase tracking-tight leading-none"
              style={{ fontFamily: "'Syne', 'Inter', sans-serif", fontWeight: 700, letterSpacing: '-0.03em' }}
            >
              dig.haus
            </Link>
            <span
              className="hidden sm:inline whitespace-nowrap"
              style={{
                fontFamily: "'Syne', 'Inter', sans-serif",
                fontWeight: 600,
                fontSize: '13px',
                letterSpacing: '-0.01em',
                color: '#d4c090',
                opacity: 0.9,
              }}
            >
              dig by cover, find by feel
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={() => setRegisterOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
                title="앨범 등록"
                aria-label="앨범 등록"
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
      />
    </>
  );
}
