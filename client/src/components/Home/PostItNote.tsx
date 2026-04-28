import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// Sticky note rendered below each hero-wall LP, on/around the rail
// rather than on the cover itself. Mounted by ShelfRow / Mobile
// FeatureCell as a sibling to the LP, so it sits in the rail region
// without competing with the play chip + cover stickers.
//
// Default size keeps the handwriting small enough that the visitor
// reads it intentionally, not at a glance — hovering the LP slot
// (group/slot on the parent) expands the note to readable size.
// transformOrigin = top center so the scale grows downward, into
// the gap between LP rows, never over the LP cover above it.
//
// No masking-tape strip in this revision — the operator judged it
// distracting against the painted-wall backdrops at small size.
// The note reads as a paper label hanging from the rail instead.

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
   *  rotation is deterministic across renders but varied across
   *  slots. */
  seed: string;
  /** Mobile slides shrink lpSize aggressively, so the percentage
   *  cap shifts up to keep text legible after the hover-scale. */
  isMobile?: boolean;
}) {
  // Default size deliberately small. Hover-scale (1.6×) brings the
  // effective render size into a comfortable read range without the
  // note dominating the wall when no cursor is on it.
  const widthPct = isMobile ? 0.52 : 0.42;
  const noteWidth = Math.round(lpSize * widthPct);
  const fontSize = Math.max(8, Math.round(noteWidth * 0.1));

  const h = hashStr(seed);
  // Rotation in [-2°, +2°] from the seed. Small enough that the
  // note still reads as a label, not a thrown sticker.
  const rot = (((h % 401) / 100) - 2).toFixed(2);

  return (
    <div
      aria-hidden
      className="select-none pointer-events-none transition-transform duration-300 ease-out group-hover/slot:scale-[1.6]"
      style={{
        width: noteWidth,
        transform: `rotate(${rot}deg)`,
        // Top-centre origin so the hover-scale grows the note
        // downward into the rail region, never up over the LP.
        transformOrigin: 'top center',
        // Sit above the painted rail in the backdrop but below the
        // hovered LP if it scales down past its baseline. Tuned so
        // a hover-scaled LP (which grows mostly downward) doesn't
        // hide the post-it underneath.
        zIndex: 1,
      }}
    >
      <div
        className="relative"
        style={{
          background:
            'linear-gradient(180deg, #fff5b8 0%, #f4e89a 100%)',
          // Single subtle drop-shadow now that the masking-tape
          // layer is gone — note reads as a flat paper resting on
          // the rail rather than tape-pinned to it.
          boxShadow:
            '0 2px 4px rgba(0, 0, 0, 0.3), 0 1px 1px rgba(0, 0, 0, 0.18)',
          padding: `${Math.round(noteWidth * 0.13)}px ${Math.round(noteWidth * 0.12)}px`,
        }}
      >
        <p
          style={{
            margin: 0,
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
    </div>
  );
}
