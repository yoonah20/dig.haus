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
  // baked-in NEW SEALED stamp. Font ratio bumped 0.30 → 0.46 so
  // the 6-digit YYMMDD fills the slot edge-to-edge instead of
  // floating in a small box up top.
  const dateFontSize = Math.max(8, Math.round(height * 0.46));
  // Price font ratio 0.42 → 0.62 with edge-to-edge box so the
  // handwritten digits dominate the mint half rather than
  // floating in a small centred box.
  const priceFontSize = Math.max(11, Math.round(height * 0.62));
  // Hand-applied tilt clamped to ±1°.
  const rot = seed ? (hashStr(seed) % 201) / 100 - 1 : 0;
  const dateText = formatReleaseDate(releaseDate ?? null);

  return (
    <div
      aria-hidden
      className="absolute z-10 pointer-events-none"
      style={{
        // Hugged closer to the corner (was 4px, now 1px) — visitor
        // feedback was that the prior 4px gap made the tag look
        // detached from the sleeve edge. 1px keeps a thin breathing
        // line so it's not visually fused with the cover frame.
        top: 1,
        right: 1,
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
          baked-in NEW SEALED stamp (the stamp ends ~73% in; right
          edge of the asset is at 100%). Box bottom stays well
          above the horizontal divider line baked into the tag at
          ~50% so the handwritten glyphs (which can extend below
          the visible-text bound due to descender metrics) don't
          collide with the divider — the prior placement straddled
          it and the divider read as a strikethrough on the date.
          Justify-end so digits sit flush against the right edge. */}
      {dateText && (
        <div
          className="absolute flex items-center justify-end leading-none"
          style={{
            top: '4%',
            bottom: '52%',
            left: '73%',
            right: '2%',
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize: dateFontSize,
            color: '#1a1a1a',
            letterSpacing: '-0.02em',
          }}
        >
          {dateText}
        </div>
      )}
      {/* Price overlay — mint-green bottom half, edge-to-edge with
          a 2px breathing line at the very bottom. Items-end so the
          handwritten digits sit at the bottom of the box (visually
          near the sticker base) instead of floating mid-area; the
          font's natural top whitespace acts as the breathing room
          between the divider line and the digits. */}
      <div
        className="absolute flex items-end justify-center leading-none"
        style={{
          left: 0,
          right: 0,
          top: '52%',
          bottom: 2,
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
