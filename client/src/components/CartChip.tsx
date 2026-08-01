import { useAuth } from '../contexts/AuthContext';
import { useAddToCart, useCartRefs, useRemoveFromCart, type CartItem } from '../hooks/useCart';
import type { AlbumSearchResult } from '../types';

// One-click "바구니에 담기" chip — the record-shop-basket sibling of
// PlayChip. Lives on the AlbumCard back face just left of the ▶ chip.
// Click toggles the album in/out of the caller's private default
// basket; the floating widget (FloatingCart) reflects it live. Logged-
// out click routes to login, same as the album-page 담기 button.
//
// State is read from the single shared cart query (useCartRefs), so
// the fill/outline reflects membership with no per-card fetch. Styling
// mirrors PlayChip (circle, accent border, fill-on-active) so the two
// chips read as one family in the corner.

// The home feed's `album.year` comes down as a string ("2024"); the
// type says number. Coerce defensively for the widget's display line.
function toYear(v: AlbumSearchResult['year']): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toCartItem(album: AlbumSearchResult): CartItem {
  return {
    id: album.id ?? 0,
    mbid: album.mbid,
    slug: null,
    title: album.title,
    artist: album.artist,
    releaseYear: toYear(album.year),
    coverArtUrl: album.coverArtUrl,
    coverArtFallbacks: album.coverArtFallbacks ?? [],
    spotifyUrl: album.spotifyUrl ?? null,
    addedAt: new Date().toISOString(),
  };
}

interface Props {
  album: AlbumSearchResult;
  /** Visual diameter in px. Matches the sibling PlayChip's size. */
  size?: number;
  /** Positioning override merged onto the absolute chip — callers set
   *  the corner inset so the chip sits beside ▶. */
  style?: React.CSSProperties;
}

export default function CartChip({ album, size = 26, style }: Props) {
  const { user, login } = useAuth();
  const cartRefs = useCartRefs(!!user);
  const inCart = cartRefs.has(album.mbid);
  const add = useAddToCart();
  const remove = useRemoveFromCart();

  const handleClick = (e: React.MouseEvent) => {
    // Chip lives inside the card's <Link> — stop the navigation.
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      login();
      return;
    }
    if (inCart) {
      remove.mutate(album.mbid);
    } else {
      add.mutate(toCartItem(album));
    }
  };

  const iconSize = Math.round(size * 0.5);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={inCart ? `${album.title} 바구니에서 빼기` : `${album.title} 바구니에 담기`}
      aria-pressed={inCart}
      title={inCart ? '바구니에서 빼기' : '바구니에 담기'}
      style={{
        width: size,
        height: size,
        right: '6%',
        bottom: '6%',
        // Anchored to the same bottom-right corner as ▶, then shifted
        // fully left of it (own width + gap) so the two chips sit side
        // by side without hardcoding a px-vs-% mix.
        transform: 'translateX(calc(-100% - 8px))',
        ...style,
      }}
      className={`absolute z-20 rounded-full border-2 border-accent flex items-center justify-center shadow-[0_6px_20px_rgba(0,0,0,0.55)] transition-all duration-200 cursor-pointer opacity-100 ${
        inCart
          ? 'bg-accent text-panel-strong'
          : 'bg-panel-strong/85 text-accent hover:bg-accent hover:text-panel-strong'
      }`}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Open crate/box outline shared by both states. */}
        <path d="M4 8 L12 4 L20 8 L12 12 Z" />
        <path d="M4 8 V17 L12 21 V12" />
        <path d="M20 8 V17 L12 21" />
        {inCart ? (
          // Added → check tucked in the box face.
          <path d="M8.5 13.5 L11 15.5 L15.5 11.5" />
        ) : (
          // Empty → plus, "put one in".
          <path d="M12 13.5 V17 M10.25 15.25 H13.75" />
        )}
      </svg>
    </button>
  );
}
