import type { PriceTagLink } from '../../types';

// Webp sticker assets — yellow for USD prices, green for any other
// currency. Reads as the visual code most digger-shops use locally
// (where USD-priced imports get a different colour tag than
// domestic-currency stock); the previous status-driven mapping
// (upcoming = green) collapsed into status-agnostic strikethrough
// for soldout instead.
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
  const isUsd = link.currency === 'USD';
  const isSoldout = link.status === 'soldout';
  const bg = isUsd ? STICKER_YELLOW : STICKER_GREEN;
  // ~20% of LP width — small corner accent, not a full badge.
  // Aspect ratio matches the asset's natural price-tag shape. Font
  // multiplier dropped one step (0.24 → 0.21) so longer prices like
  // ₩30,000 sit inside the tag rather than spilling out; floor 6px
  // is the smallest size mono digits stay legible at.
  const width = Math.round(lpSize * 0.2);
  const height = Math.round(width * 0.55);
  const fontSize = Math.max(6, Math.round(width * 0.21));

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none flex items-center justify-center"
      style={{
        // 2px breathing space off the top-right corner — fully
        // tight against (0, 0) read as clipped to the sleeve edge
        // rather than stuck on it. Bottom-right stays reserved for
        // the ▶ play chip. Drop shadow omitted: the plastic-wrap
        // overlay sits a few px past the sleeve edge so the sticker
        // reads as adhered to the wrap.
        top: 2,
        right: 2,
        width,
        height,
        backgroundImage: `url('${bg}')`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <span
        className={`font-mono font-bold leading-none ${
          isUsd ? 'text-[#3a2a08]' : 'text-[#1a3a18]'
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
