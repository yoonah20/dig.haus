import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// Sticky note overlay on hero-wall LP covers. Renders the effective
// comment for that slot (home_features.note ?? user_reviews.body of
// admin), styled as a cream/yellow post-it with a single masking-tape
// strip across the top, slight per-slot rotation hashed off the seed
// so each note sits at a different angle.
//
// Visual stack:
//   1. Drop-shadow under the post-it (lifts it off the cover)
//   2. Cream paper background with subtle inner gradient (paper grain
//      effect — not a real texture, just a vertical hue shift)
//   3. Masking-tape strip across the top, slightly off-centre + tinted
//      slightly more transparent than the paper
//   4. Handwritten Korean comment via GRAFFITI_FONT_STACK
//
// Sizing: percentage of the LP cover so the note scales with the
// carousel's responsive lpSize. ~48% of LP width on desktop, ~58% on
// mobile (smaller phones benefit from a bigger note relative to the
// cover so the text stays readable).
//
// Position: bottom-right corner of the LP, with a small overflow off
// the right edge so the note reads as "stuck on" rather than "drawn
// inside".

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export default function PostItNote({
  text,
  lpSize,
  seed,
  isMobile = false,
}: {
  text: string;
  /** Source LP size in px so the note can scale relative to the
   *  cover. The component computes its own width / font-size off
   *  this single value. */
  lpSize: number;
  /** Stable per-slot seed (typically the album mbid) so the per-note
   *  rotation + tape offset is deterministic across renders but
   *  varied across slots. */
  seed: string;
  /** Mobile slides shrink lpSize aggressively, so the percentage
   *  cap shifts up to keep text readable. */
  isMobile?: boolean;
}) {
  const widthPct = isMobile ? 0.58 : 0.48;
  const noteWidth = Math.round(lpSize * widthPct);
  // Font size scales with note width — 11% of width keeps Korean
  // 50자 readable on small phones (≈14px at lpSize 144) and not
  // overwhelming on desktop (≈16-17px at lpSize 336).
  const fontSize = Math.max(11, Math.round(noteWidth * 0.11));

  const h = hashStr(seed);
  // Rotation in [-3°, +3°] from a seed-derived 0..1 value.
  const rot = (((h % 601) / 100) - 3).toFixed(2);
  // Masking-tape horizontal offset: ±15% of note width. Keeps the
  // strip off the exact centre so successive notes don't read as a
  // template.
  const tapeOffset = ((((h >> 8) % 31) - 15) / 100) * noteWidth;
  const tapeWidth = Math.round(noteWidth * 0.5);

  // Bottom-right anchoring with a slight overflow so the note hangs
  // off the LP's right edge (the "stuck on" illusion). Numbers are
  // px — small enough that the overflow stays inside the carousel
  // slide's overflow-hidden bounds even at extreme rotations.
  const overflowX = Math.round(lpSize * 0.08);
  const overflowY = Math.round(lpSize * 0.04);

  return (
    <div
      aria-hidden
      className="absolute pointer-events-none select-none z-20"
      style={{
        right: -overflowX,
        bottom: -overflowY,
        width: noteWidth,
        // Height auto-grows with text content. minHeight keeps very
        // short notes (e.g. "최고") from shrinking to a single line
        // and looking like a label rather than a note.
        minHeight: noteWidth * 0.55,
        transform: `rotate(${rot}deg)`,
        transformOrigin: 'bottom right',
      }}
    >
      {/* Drop-shadow layer — slight blur, offset down-right so the
          note reads as physically resting on the cover. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, #fff5b8 0%, #f4e89a 100%)',
          boxShadow:
            '0 2px 4px rgba(0, 0, 0, 0.25), 0 1px 1px rgba(0, 0, 0, 0.15)',
          borderRadius: 1,
        }}
      />

      {/* Masking-tape strip — semi-transparent so the underlying
          cover tone shows through faintly. Slight downward shift so
          a sliver hangs off the top of the note (real masking tape
          doesn't sit flush). */}
      <div
        className="absolute"
        style={{
          top: -Math.round(noteWidth * 0.05),
          left: noteWidth / 2 - tapeWidth / 2 + tapeOffset,
          width: tapeWidth,
          height: Math.round(noteWidth * 0.13),
          background:
            'linear-gradient(180deg, rgba(232, 215, 175, 0.85) 0%, rgba(208, 188, 145, 0.78) 100%)',
          boxShadow: '0 1px 1px rgba(0, 0, 0, 0.18)',
          // Subtle saw-tooth / fiber texture via repeating gradient
          // — not an asset, just a stripe pattern that reads as
          // tape fiber when small.
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0px, transparent 3px, rgba(120, 95, 50, 0.08) 3px, rgba(120, 95, 50, 0.08) 4px)',
        }}
      />

      {/* Comment text. Padding is generous on top to clear the
          masking-tape strip; bottom padding is smaller because long
          notes can extend below the box's auto height anyway. */}
      <p
        className="relative"
        style={{
          margin: 0,
          paddingTop: Math.round(noteWidth * 0.18),
          paddingBottom: Math.round(noteWidth * 0.1),
          paddingLeft: Math.round(noteWidth * 0.08),
          paddingRight: Math.round(noteWidth * 0.08),
          fontFamily: GRAFFITI_FONT_STACK,
          fontSize,
          lineHeight: 1.25,
          color: '#3a2818',
          letterSpacing: '0.005em',
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
        }}
      >
        {text}
      </p>
    </div>
  );
}
