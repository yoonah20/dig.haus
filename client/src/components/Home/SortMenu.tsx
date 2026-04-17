import { useState, useRef, useEffect, useMemo } from 'react';
import { SORT_OPTIONS, type SortValue } from '../../lib/homeSort';
import { useAuth } from '../../contexts/AuthContext';
import { useHomeState } from '../../contexts/HomeStateContext';

// Compact sort trigger that lives in the TopNav on the home page.
// Owns its own popover; the sort state itself lives in
// HomeStateContext (React state + localStorage persistence) so
// clicking an option no longer touches the address bar.
export default function SortMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const { sort, setSort } = useHomeState();

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

  const handleChange = (v: SortValue) => {
    setSort(v);
    setOpen(false);
  };

  const currentLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? '';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer"
        title={`정렬: ${currentLabel}`}
        aria-label={`정렬: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* Three lines of decreasing length — universal sort/list affordance */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-4 h-4 shrink-0"
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
        {/* Hide the label on very narrow viewports so the nav row
            still fits beside search + register. Icon alone is enough
            on mobile; full label returns at sm. */}
        <span className="hidden sm:inline text-xs font-medium whitespace-nowrap">
          {currentLabel}
        </span>
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
