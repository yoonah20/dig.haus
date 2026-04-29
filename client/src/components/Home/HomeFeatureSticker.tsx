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

// "2025-04-24" → "25-04-24". Year-only ("2025") collapses to "25"
// so we still render something legible without faking month/day.
// Anything that doesn't match either shape returns null and the
// date overlay just doesn't render.
function formatReleaseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const full = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (full) return `${full[1].slice(2)}-${full[2]}-${full[3]}`;
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

export default function HomeFeatureSticker({
  link,
  lpSize,
  releaseDate,
  seed,
}: Props) {
  const isSoldout = link.status === 'soldout';
  // Width ratio bumped from 0.17 (the old square-ish sticker) to
  // 0.42 because the tag is 3.5× wider than tall — same visual
  // height-budget would render at a height where the two text rows
  // collapse into illegible. 0.42 lands the rendered tag at roughly
  // 2.7× the old footprint, which still leaves the cover readable.
  const width = Math.round(lpSize * 0.42);
  const height = Math.round(width / TAG_ASPECT);
  // Top "white strip" (date area) and bottom "mint area" (price) are
  // each ~50% of the tag height in the source asset. Date sits
  // smaller because it's secondary; price gets the heavier weight.
  const dateFontSize = Math.max(7, Math.round(height * 0.28));
  const priceFontSize = Math.max(9, Math.round(height * 0.42));
  // Hand-applied tilt: hash → 0..400 → 0.00..4.00 → -2.00..+2.00.
  const rot = seed ? (hashStr(seed) % 401) / 100 - 2 : 0;
  const dateText = formatReleaseDate(releaseDate ?? null);

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none"
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
        backgroundImage: `url('${TAG_BG}')`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        transform: rot ? `rotate(${rot.toFixed(2)}deg)` : undefined,
        transformOrigin: 'top right',
      }}
    >
      {/* Date overlay — white strip between dig.haus wordmark
          (baked-in, left ~30%) and the NEW SEALED stamp (baked-in,
          right ~35%). Right-aligned so the digits sit flush against
          the stamp edge regardless of whether the date renders as
          "25-04-24" or just "25". */}
      {dateText && (
        <span
          className="absolute leading-none"
          style={{
            top: '14%',
            left: '32%',
            right: '38%',
            textAlign: 'right',
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize: dateFontSize,
            color: '#1a1a1a',
            letterSpacing: '-0.01em',
          }}
        >
          {dateText}
        </span>
      )}
      {/* Price overlay — mint-green bottom area, centred. The hand-
          written font reads as a price scrawled by the shop owner
          on top of the printed tag, instead of the prior
          mono-printed look. */}
      <span
        className="absolute leading-none flex items-center justify-center"
        style={{
          left: 0,
          right: 0,
          bottom: '8%',
          height: '40%',
          fontFamily: GRAFFITI_FONT_STACK,
          fontSize: priceFontSize,
          color: '#1a3a18',
          letterSpacing: '-0.01em',
          textDecoration: isSoldout ? 'line-through' : 'none',
          textDecorationThickness: isSoldout ? 1.5 : undefined,
        }}
      >
        {formatPrice(link.price, link.currency)}
      </span>
    </div>
  );
}
