import type { PriceTagLink } from '../../types';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// Pre-designed price tag — tag2.webp lays out three slots:
//   - top-left:  baked-in dig.haus + NEW wordmark
//   - top-right: empty white slot to the right of "NEW", price lands here
//   - bottom:    full-width mint band, artist + album title stacked here
// Asset is 500×142 (aspect ~3.52:1). Source-px coordinates below project
// into rendered px via the layout percentages. The earlier release-date
// stamp slot is gone — the date no longer renders on the tag at all.

const TAG_BG = '/textures/tag2.webp';
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

interface Props {
  link: PriceTagLink;
  // Wall LP size in px; sticker width derives from this so it scales
  // with the cover.
  lpSize: number;
  // Album metadata stacked on the tag's mint band — artist on top,
  // album title underneath. Both are single-line ellipsis-clipped so
  // arbitrarily long values won't overflow into neighbouring covers.
  albumTitle: string;
  albumArtist: string;
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
  albumTitle,
  albumArtist,
  seed,
}: Props) {
  const isSoldout = link.status === 'soldout';
  // Width ratio: 0.42 (was 0.378 → +11%). The tag now carries
  // artist + album text on the mint band, so it earns a bit more
  // of the cover's width to keep that text legible at small lpSize.
  const width = Math.round(lpSize * 0.42);
  const height = Math.round(width / TAG_ASPECT);
  // Price font sized to fill the top-right slot top-to-bottom — the
  // slot itself is ~50% of tag height (sits above the horizontal
  // divider baked into the asset). 0.42 lands the digits flush
  // against the slot's vertical bounds without nudging the
  // baked-in NEW glyph or crossing the divider.
  const priceFontSize = Math.max(9, Math.round(height * 0.42));
  // Artist + album collapsed into a single "artist·album" line on
  // the mint band. Ratio 0.34 (walked 0.40 → 0.36 → 0.34) — Hangul
  // glyphs read denser than the Latin originals, and the
  // transliteration payload is dominated by the longer side
  // (titleKo) which keeps pushing past the slot's right edge. 0.34
  // lands ~16 chars before ellipsis without compromising
  // legibility at the rendered home-grid sizes.
  const titleFontSize = Math.max(7, Math.round(height * 0.34));
  // Hand-applied tilt clamped to ±1°.
  const rot = seed ? (hashStr(seed) % 201) / 100 - 1 : 0;

  return (
    <div
      aria-hidden
      // No z-index: the sticker now lives in WallHoverCard's
      // priceTagOverlay slot, which renders before the shrink-wrap
      // raster + shine layers in DOM order. With z-auto on both,
      // paint order wins and the wrap visibly textures the tag —
      // "stuck to the sleeve, sealed under the plastic". The
      // earlier z-10 was lifting the tag back above the wrap,
      // defeating the slot split.
      className="absolute pointer-events-none"
      style={{
        // top: 3 (halved from 6 after visual review) pulls the tag
        // back up toward the sleeve's upper edge. right: 0 keeps
        // the tag inside the sleeve — the negative-right experiment
        // pushed it past the shrink-wrap edge, which broke the
        // "sealed under the plastic" composition.
        top: 3,
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
      {/* Price overlay — empty white slot to the right of the
          baked-in NEW glyph. Top + bottom hug the divider edges
          (2% / 52%) so the digits visually fill the slot floor-to-
          ceiling; left: 65% lands the start position just past
          the NEW glyph's right edge in the source image. Right-
          aligned so the digits sit flush against the tag's right
          edge regardless of length. */}
      <div
        className="absolute flex items-center justify-end leading-none"
        style={{
          top: '2%',
          bottom: '52%',
          left: '65%',
          right: '3%',
          fontFamily: GRAFFITI_FONT_STACK,
          fontSize: priceFontSize,
          color: '#1a1a1a',
          letterSpacing: '-0.02em',
          textDecoration: isSoldout ? 'line-through' : 'none',
          textDecorationThickness: isSoldout ? 1.5 : undefined,
        }}
      >
        {formatPrice(link.price, link.currency)}
      </div>
      {/* Artist·album band — mint bottom half (top 54%, bottom 4)
          carries a single "artist·album" line. Middle-dot separator
          with no surrounding spaces — the tilde was hard to spot at
          the rendered size, but a bare middle-dot lands cleanly
          between the two strings without padding bloat. Long values
          clip with text-overflow: ellipsis so anything past the
          tag's right edge resolves to "...". Inner span owns the
          ellipsis rules; outer flex handles vertical centring (flex
          on the ellipsis element itself doesn't always honour the
          clip). */}
      <div
        className="absolute flex items-center"
        style={{
          left: '2%',
          right: '4%',
          top: '54%',
          bottom: 4,
        }}
      >
        <span
          style={{
            width: '100%',
            textAlign: 'left',
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize: titleFontSize,
            fontWeight: 400,
            color: '#1a3a18',
            // -0.04em (walked -0.01em → -0.03em → -0.04em) tightens
            // Hangul intercharacter spacing close to the safe limit.
            // Hangul tolerates negative tracking better than Latin
            // because most glyphs end on a baseline-rooted jamo with
            // built-in side bearing; -0.05em is where adjacent
            // characters start to collide visually, so this stops a
            // hair above that.
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {`${albumArtist}·${albumTitle}`}
        </span>
      </div>
    </div>
  );
}
