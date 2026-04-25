import type { PriceTagLink } from '../../types';

// Webp sticker assets — yellow for in-stock / sold-out, green for
// upcoming releases. The yellow asset has a price-tag silhouette
// (rounded rectangle with notches), the green is a flatter solid
// shape. Both are 200px wide; we render at ~45% of the LP size.
const STICKER_YELLOW = '/textures/sticker17.webp';
const STICKER_GREEN = '/textures/sticker16.webp';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  JPY: '¥',
  GBP: '£',
  EUR: '€',
  KRW: '₩',
};

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return '-';
  const sym = CURRENCY_SYMBOL[currency] || '';
  if (currency === 'JPY' || currency === 'KRW') {
    return `${sym}${Math.round(price).toLocaleString()}`;
  }
  return `${sym}${price.toFixed(2)}`;
}

interface Props {
  link: PriceTagLink;
  // Wall LP size in px; sticker width derives from this so it scales
  // with the cover.
  lpSize: number;
}

export default function HomeFeatureSticker({ link, lpSize }: Props) {
  const isUpcoming = link.status === 'upcoming';
  const isSoldout = link.status === 'soldout';
  const bg = isUpcoming ? STICKER_GREEN : STICKER_YELLOW;
  // ~25% of LP width — small accent in the corner, not a full badge.
  // Aspect ratio matches the asset's natural price-tag shape. Text
  // size below is derived from lpSize directly (not from `width`) so
  // bumping the sticker size doesn't drag the price digits along
  // with it.
  const width = Math.round(lpSize * 0.25);
  const height = Math.round(width * 0.55);
  const fontSize = Math.max(9, Math.round(lpSize * 0.225 * 0.22));

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none flex items-center justify-center"
      style={{
        // Top-right placement with a small inset so the sticker hangs
        // just inside the cover edge. Bottom-right is reserved for
        // the ▶ play chip so we use top-right. No rotation — the
        // smaller size already reads as a corner accent. Drop shadow
        // intentionally omitted: the plastic-wrap overlay sits a few
        // px past the sleeve edge, so the sticker is conceptually
        // adhered to the wrap, not floating above it.
        top: '4%',
        right: '4%',
        width,
        height,
        backgroundImage: `url('${bg}')`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <span
        className={`font-mono font-bold leading-none ${
          isUpcoming ? 'text-[#1a3a18]' : 'text-[#3a2a08]'
        }`}
        style={{
          fontSize,
          textDecoration: isSoldout ? 'line-through' : 'none',
          textDecorationThickness: isSoldout ? 1.5 : undefined,
          letterSpacing: '-0.01em',
        }}
      >
        {formatPrice(link.price, link.currency)}
      </span>
    </div>
  );
}
