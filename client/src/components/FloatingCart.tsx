import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCart, useClearCart, useRemoveFromCart } from '../hooks/useCart';
import CoverArt from './CoverArt';

// Floating 바구니 (basket) — the shopping-cart-style widget pinned to
// the bottom-right corner, mounted once at App root so it rides along
// across every route. Collapsed it's a basket button with an item
// count; expanded it lists what's been quick-added from the grid, with
// per-item remove and a 비우기 (clear all). The persistent Spotify
// player sits bottom-CENTER, so the two never collide.
//
// Only rendered for logged-in users, and only when the basket has
// something in it (or the panel is open) — an always-on empty basket
// reads as clutter; it materialises the moment the first record drops
// in, exactly like a real cart.

function BasketIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8 L12 4 L20 8 L12 12 Z" />
      <path d="M4 8 V17 L12 21 V12" />
      <path d="M20 8 V17 L12 21" />
    </svg>
  );
}

export default function FloatingCart() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useCart(!!user);
  const remove = useRemoveFromCart();
  const clear = useClearCart();

  const items = data?.items ?? [];
  const count = items.length;

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to show: logged out, or an empty & closed basket.
  if (!user) return null;
  if (count === 0 && !open) return null;

  return (
    <div
      ref={containerRef}
      className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2"
      aria-label="바구니"
    >
      {open && (
        <div className="w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-white/15 bg-panel-strong shadow-[0_12px_36px_rgba(0,0,0,0.6)] overflow-hidden animate-[fadeInUp_200ms_ease-out]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2 text-gray-100">
              <BasketIcon size={18} />
              <span className="font-semibold text-sm">바구니</span>
              <span className="text-xs text-gray-400 tabular-nums">{count}장</span>
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
                className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40 cursor-pointer"
              >
                비우기
              </button>
            )}
          </div>

          {count === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              바구니가 비었어요.
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto py-1">
              {items.map((item) => (
                <div
                  key={item.mbid}
                  className="group/row flex items-center gap-3 px-3 py-2 hover:bg-white/5"
                >
                  <Link
                    to={`/album/${item.slug || item.mbid}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-panel shrink-0">
                      <CoverArt
                        src={item.coverArtUrl}
                        fallbacks={item.coverArtFallbacks}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {item.artist}
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove.mutate(item.slug || item.mbid)}
                    aria-label={`${item.title} 바구니에서 빼기`}
                    title="빼기"
                    className="shrink-0 w-6 h-6 rounded-full text-gray-500 hover:text-gray-200 hover:bg-white/10 flex items-center justify-center cursor-pointer text-base leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {count > 0 && user.mydigUsername && (
            <div className="px-4 py-2.5 border-t border-white/10">
              <Link
                to={`/my/${user.mydigUsername}`}
                onClick={() => setOpen(false)}
                className="text-xs text-accent hover:underline"
              >
                마이딕에서 크레이트로 정리하기 →
              </Link>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`바구니 ${count}장`}
        className="relative w-14 h-14 rounded-full border-2 border-accent bg-panel-strong text-accent hover:bg-accent hover:text-panel-strong shadow-[0_8px_24px_rgba(0,0,0,0.55)] flex items-center justify-center transition-colors cursor-pointer"
      >
        <BasketIcon size={24} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-accent text-panel-strong text-[11px] font-bold flex items-center justify-center tabular-nums shadow">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
