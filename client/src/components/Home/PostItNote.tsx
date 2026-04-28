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

// Five real-photo masking-tape strips with cut-out alpha. Each tape
// is 100×~36 px PNG; when rendered at noteWidth × 0.55 it lands at
// roughly the right scale next to the post-it body. Deterministic
// per-slot pick via mbid hash so successive notes don't share the
// same tape pattern.
const TAPE_TEXTURES = [
  '/textures/masking07.png',
  '/textures/masking17.png',
  '/textures/masking34.png',
  '/textures/masking94.png',
  '/textures/masking96.png',
];

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
   *  rotation + tape pick stays deterministic across renders but
   *  varied across slots. */
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
  // Pick one of the five masking-tape textures by mbid hash.
  const tapeSrc = TAPE_TEXTURES[(h >>> 8) % TAPE_TEXTURES.length];
  const tapeWidth = Math.round(noteWidth * 0.55);
  // Tape PNGs are ~100×36 average; preserve aspect ratio when scaling.
  const tapeHeight = Math.round(tapeWidth * 0.36);
  // Per-slot horizontal nudge in [-12%, +12%] of note width so the
  // tape doesn't sit dead-centre on every note.
  const tapeOffset = ((((h >>> 16) % 25) - 12) / 100) * noteWidth;
  // Per-slot tape rotation in [-4°, +4°] independent of the note's
  // own rotation — real masking tape is rarely applied perfectly
  // parallel to the paper edge.
  const tapeRot = (((h >>> 24) % 81) / 10 - 4).toFixed(1);

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
        zIndex: 1,
        // Slight downward push so the tape (which sits *above* the
        // top edge with negative top) has room to render without
        // getting clipped by the slot's wrapper.
        marginTop: Math.round(tapeHeight * 0.4),
      }}
    >
      {/* Paper body — canary-yellow Post-It. Top edge is lifted a
          touch toward white to suggest a bend / paper grain; the
          dominant tone matches the reference photo (#fcdc2c family). */}
      <div
        className="relative"
        style={{
          background:
            'linear-gradient(180deg, #ffe54a 0%, #fcdc2c 38%, #f5cc18 100%)',
          boxShadow:
            '0 2px 4px rgba(0, 0, 0, 0.32), 0 1px 1px rgba(0, 0, 0, 0.2)',
          padding: `${Math.round(noteWidth * 0.13)}px ${Math.round(noteWidth * 0.12)}px`,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize,
            lineHeight: 1.25,
            color: '#1a1208',
            letterSpacing: '0.005em',
            wordBreak: 'keep-all',
            overflowWrap: 'break-word',
          }}
        >
          {text}
        </p>
      </div>

      {/* Masking-tape strip — real PNG with alpha cutout. Sits
          across the top edge of the note, tilted independently from
          the note's own rotation so the tape reads as hand-applied.
          Negative top so part of the tape extends above the paper
          edge, like a strip stuck on partly off the page. */}
      <img
        src={tapeSrc}
        alt=""
        aria-hidden
        className="absolute pointer-events-none select-none"
        style={{
          top: -Math.round(tapeHeight * 0.55),
          left: noteWidth / 2 - tapeWidth / 2 + tapeOffset,
          width: tapeWidth,
          height: tapeHeight,
          transform: `rotate(${tapeRot}deg)`,
          transformOrigin: 'center center',
          // Drop max-width override from tailwind preflight so the
          // tape isn't capped by the parent's bounds.
          maxWidth: 'none',
        }}
      />
    </div>
  );
}
