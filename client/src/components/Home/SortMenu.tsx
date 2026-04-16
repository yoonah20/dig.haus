import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SORT_OPTIONS,
  DEFAULT_SORT,
  type SortValue,
  isSortValue,
} from '../../lib/homeSort';

// Compact sort trigger that lives in the TopNav on the home page.
// Owns its own popover; the URL is the single source of truth, so
// Home.tsx's existing sort/state effects pick up the change without
// any prop-drilling. localStorage mirroring also stays in Home.tsx
// for the same reason — this component just writes the URL.
export default function SortMenu() {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);

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
          {SORT_OPTIONS.map((opt) => {
            const isCurrent = opt.value === sort;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => handleChange(opt.value)}
                className={`block w-full text-left px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                  isCurrent ? 'text-[#e8a020] font-semibold' : 'text-gray-300'
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
