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
  // Optional deterministic-rotation seed. Hashes into a -2°..+2°
  // tilt so neighbouring stickers don't sit at the same angle —
  // reads as hand-applied rather than CSS-perfect. The same seed
  // always picks the same angle so re-renders don't reshuffle.
  seed?: string;
}

// FNV-1a 32-bit hash — same one the hero's plastic-texture picker
// uses. Inlined here to keep this component self-contained.
function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export default function HomeFeatureSticker({ link, lpSize, seed }: Props) {
  const isUsd = link.currency === 'USD';
  const isSoldout = link.status === 'soldout';
  const bg = isUsd ? STICKER_YELLOW : STICKER_GREEN;
  // ~17% of LP width (was 20%) — trimmed -15% so the tag sits as
  // a smaller corner accent and doesn't visually compete with the
  // hero's date sticker on the opposite corner. Font multiplier
  // bumped 0.21 → 0.27 to keep the digits' on-screen size close
  // to where they read at the larger sticker; longer prices
  // (₩30,000) still fit because the box height also grew slightly
  // via the 0.27 ratio. Floor 7px keeps mono digits legible at
  // the tightest LP sizes.
  const width = Math.round(lpSize * 0.17);
  const height = Math.round(width * 0.55);
  const fontSize = Math.max(7, Math.round(width * 0.24));
  // Hand-applied tilt: hash → 0..400 → 0.00..4.00 → -2.00..+2.00.
  const rot = seed ? (hashStr(seed) % 401) / 100 - 2 : 0;

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none flex items-center justify-center"
      style={{
        // Nudged a few px off the top-right corner so the tag
        // breathes against the sleeve edge instead of looking
        // glued to the corner pixel. Bottom-right still reserved
        // for the ▶ play chip. Drop shadow omitted: the plastic-
        // wrap overlay sits a few px past the sleeve edge so the
        // sticker reads as adhered to the wrap.
        top: 4,
        right: 4,
        width,
        height,
        backgroundImage: `url('${bg}')`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        transform: rot ? `rotate(${rot.toFixed(2)}deg)` : undefined,
        transformOrigin: 'top right',
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
