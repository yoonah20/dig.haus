import type { PriceTagLink } from '../../types';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// Pre-designed price tag — the previous yellow / green sticker pair
// (currency-coded) collapsed into a single horizontal tag asset that
// already carries the dig.haus wordmark + "NEW SEALED" stamp baked
// in. Currency-colour distinction is gone with the visual change;
// price digits land in the mint area at the bottom, release date
// lands in the white strip next to the NEW SEALED stamp.
//
// Asset is 500×142 (aspect ~3.52:1) so the rendered sticker is
// noticeably wider + shorter than the prior 1.82:1 box; the layout
// percentages below are tuned against that geometry.
// Date renders in a tight mono stack rather than the handwritten
// graffiti family that the price uses — at 6-7 px the cursive
// glyphs collapse into illegible scribble, while a clean mono
// reads as a printed date stamp on top of the tag, which fits
// the "shop owner annotated this with a sharpie, but the date
// was already inkjet-printed" mental model.
const DATE_FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const TAG_BG = '/textures/tag.webp';
const TAG_ASPECT = 500 / 142;

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

// "2025-04-24" → "250424". Year-only ("2025") collapses to "25" so
// we still render something legible without faking month/day.
// Anything that doesn't match either shape returns null and the
// date overlay just doesn't render. Compact 6-digit form fits the
// narrow white strip between the dig.haus wordmark and the
// NEW SEALED stamp better than the prior dashed YY-MM-DD.
function formatReleaseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const full = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (full) return `${full[1].slice(2)}${full[2]}${full[3]}`;
  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1].slice(2);
  return null;
}

interface Props {
  link: PriceTagLink;
  // Wall LP size in px; sticker width derives from this so it scales
  // with the cover.
  lpSize: number;
  // ISO release date (YYYY-MM-DD or YYYY). Renders next to the
  // baked-in NEW SEALED stamp in the white strip up top. Falls back
  // to a missing-date layout (empty top strip) when null.
  releaseDate?: string | null;
  // Optional deterministic-rotation seed. Hashes into a -1°..+1°
  // tilt so neighbouring stickers don't sit at the same angle.
  // Range tightened from ±2° to ±1° because the wider tag asset
  // makes a given angle read as more dramatic on the long edge —
  // ±2° on a 3.5:1 strip starts looking like the tag is falling
  // off the cover instead of "stuck on slightly crooked".
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

export default function HomeFeatureSticker({
  link,
  lpSize,
  releaseDate,
  seed,
}: Props) {
  const isSoldout = link.status === 'soldout';
  // Width ratio: 0.378 (was 0.42 → −10%). The new tag still reads
  // as the dominant top-corner accent at this size while leaving
  // a touch more cover real estate clear.
  const width = Math.round(lpSize * 0.378);
  const height = Math.round(width / TAG_ASPECT);
  // Date sits in the narrow white slot to the right of the
  // baked-in NEW SEALED stamp — that slot is only ~25% wide
  // and ~50% tall in source coords, so 6 chars at the larger
  // ratios (0.30, 0.46) of prior iterations overflowed past
  // the right edge of the tag. 0.22 lands "260424" inside the
  // slot at the rendered widths the home grid hits.
  const dateFontSize = Math.max(6, Math.round(height * 0.22));
  // Price font sized to fit cleanly inside the mint bottom half
  // (also ~50% of tag height). Ratio walked 0.62 (overflowed up
  // past the divider) → 0.42 (read as undersized vs the cover) →
  // 0.48 lands the digits at a step bigger than 0.42 while still
  // clearing the divider when centred inside the mint area.
  const priceFontSize = Math.max(11, Math.round(height * 0.48));
  // Hand-applied tilt clamped to ±1°.
  const rot = seed ? (hashStr(seed) % 201) / 100 - 1 : 0;
  const dateText = formatReleaseDate(releaseDate ?? null);

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none"
      style={{
        // Hugged tight to the top-right corner — 1px breathing line
        // off the top, flush against the right edge so the tag sits
        // under the shrink-wrap right where a real shop sticker
        // would land. Prior right:1 left a visible vertical gap at
        // the cover's right edge that read as "tag floating".
        top: 1,
        right: 0,
        width,
        height,
        backgroundImage: `url('${TAG_BG}')`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        transform: rot ? `rotate(${rot.toFixed(2)}deg)` : undefined,
        transformOrigin: 'top right',
      }}
    >
      {/* Date overlay — narrow white slot to the right of the
          baked-in NEW SEALED stamp. Bottom stays above the
          horizontal divider at ~50% so the digits don't collide
          with it. Justify-end so the date sits flush against the
          right edge of the tag. */}
      {dateText && (
        <div
          className="absolute flex items-center justify-end leading-none"
          style={{
            top: '4%',
            bottom: '58%',
            left: '74%',
            right: '3%',
            fontFamily: DATE_FONT_STACK,
            fontWeight: 600,
            fontSize: dateFontSize,
            color: '#1a1a1a',
            letterSpacing: '-0.04em',
          }}
        >
          {dateText}
        </div>
      )}
      {/* Price overlay — mint-green bottom half, centred. Bottom
          padding 4 px (was 2) so the handwritten digits sit
          slightly raised off the sticker base instead of touching
          it. items-center because the price font is now sized to
          fit cleanly inside the mint half — bottom-aligning a
          tightly-fit font would visually push the descender below
          the visible bound; centring it lands the cap-line and
          baseline symmetrically inside the mint area. */}
      <div
        className="absolute flex items-center justify-center leading-none"
        style={{
          left: 0,
          right: 0,
          top: '52%',
          bottom: 4,
          fontFamily: GRAFFITI_FONT_STACK,
          fontSize: priceFontSize,
          color: '#1a3a18',
          letterSpacing: '-0.01em',
          textDecoration: isSoldout ? 'line-through' : 'none',
          textDecorationThickness: isSoldout ? 1.5 : undefined,
        }}
      >
        {formatPrice(link.price, link.currency)}
      </div>
    </div>
  );
}
