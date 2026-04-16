import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SORT_OPTIONS,
  DEFAULT_SORT,
  SORT_STORAGE_KEY,
  type SortValue,
  isSortValue,
} from '../../lib/homeSort';
import { useAuth } from '../../contexts/AuthContext';

// Compact sort trigger that lives in the TopNav on the home page.
// Owns its own popover; the URL is the single source of truth, so
// Home.tsx's existing sort/state effects pick up the change without
// any prop-drilling. localStorage mirroring also stays in Home.tsx
// for the same reason — this component just writes the URL.
export default function SortMenu() {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  // adminOnly options ([등록 요청작]) hide for non-admins so the
  // dropdown stays clean; regular users never see they exist.
  const visibleOptions = useMemo(
    () => SORT_OPTIONS.filter((o) => !o.adminOnly || isAdmin),
    [isAdmin]
  );

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sort: SortValue = (() => {
    const raw = searchParams.get('sort') || '';
    return isSortValue(raw) ? raw : DEFAULT_SORT;
  })();

  const handleChange = (v: SortValue) => {
    // Sync localStorage up-front. Home.tsx has a mirror effect that
    // writes localStorage from `sort`, but the rehydrate effect (on
    // mount) reads localStorage too — and after React Router navigation
    // back to `/`, if localStorage still says 'release_date_desc' while
    // the user just reverted to the default, rehydrate can push the
    // stale value back into the URL and make it look like "default
    // sort doesn't stick". Writing synchronously here closes that
    // window.
    try {
      if (v === DEFAULT_SORT) localStorage.removeItem(SORT_STORAGE_KEY);
      else localStorage.setItem(SORT_STORAGE_KEY, v);
    } catch {
      // storage blocked in private mode etc. — mirror effect still tries.
    }
    const next = new URLSearchParams(searchParams);
    if (v === DEFAULT_SORT) next.delete('sort');
    else next.set('sort', v);
    next.delete('page'); // restart at page 1 whenever the order changes
    setSearchParams(next);
    setOpen(false);
  };

  const currentLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? '';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
        title={`정렬: ${currentLabel}`}
        aria-label={`정렬: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* Three lines of decreasing length — universal sort/list affordance */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h10M4 18h6"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50"
        >
          {visibleOptions.map((opt) => {
            const isCurrent = opt.value === sort;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => handleChange(opt.value as SortValue)}
                className={`block w-full text-left px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                  isCurrent
                    ? 'text-[#e8a020] font-semibold'
                    : opt.adminOnly
                      ? 'text-[#e8a020]/80 italic'
                      : 'text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
