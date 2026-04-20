// Hongdae Dusk palette — evening shop interior. Dark warm-brown
// wall (painted wood panel feel) with a strong upper-left lamp wash
// pooling warm light in the center of the scene. The palette's
// rationale changed between versions: the original Claude Design
// output landed on a *light* amber plaster wall, which read well
// in isolation but made the /my-preview page jump brightness
// against the rest of dig.haus's dark chrome. This revision pulls
// walls down into dark wood-panel territory so the scene reads as
// "a lit shop interior seen from a dim street" rather than
// "suddenly a different website."
//
// Values that didn't need to flip (rails, shelf carcass, cubby
// interior, fake cover sleeves, masking tape) are unchanged —
// the lamp wash does enough work to make the warm wood feel
// continuous with the old palette where it matters.

export const ROOM = {
  // wall — dark warm-brown wood panel / matte paint
  wallTop: '#3a2c1c',
  wallMid: '#2e2214',
  wallBot: '#241a0f',
  wallShadow: 'rgba(0, 0, 0, 0.45)',
  wallLight: 'rgba(255, 220, 150, 0.38)',
  plasterGrain: 'rgba(90, 55, 25, 0.18)',

  // floor — walnut stays (same wood it was, just slightly lighter
  // than wall now, which reads as the lamp pool spilling onto it).
  floor: '#3a2614',
  floorHi: '#4a311d',
  floorLo: '#1a0f08',
  floorPlank: '#2a1a0d',
  baseboard: '#120a04',
  baseboardHi: '#4a311d',

  // wood (rails, shelf carcass) — same mid-tone wood; now reads
  // clearly against the darker wall behind it.
  woodTop: '#7a5230',
  woodFace: '#6b4628',
  woodBot: '#4a311d',
  woodGrain: 'rgba(20, 10, 5, 0.55)',
  woodHi: 'rgba(255, 218, 175, 0.45)',
  woodScuff: 'rgba(255, 220, 180, 0.35)',

  // shelf cubby interior — still the darkest thing in the scene so
  // records sitting at the front of a cubby pop against the void
  // behind them.
  cubbyTop: '#15090a',
  cubbyBot: '#0a0503',
  cubbyLip: '#3a2513',

  // masking tape — still cream/beige; tape wraps warm under lamp.
  tapeTop: '#f5e8c8',
  tapeMid: '#e8d6a8',
  tapeBot: '#c9b488',
  tapeFiber: 'rgba(80, 60, 30, 0.5)',
  ink: '#2a1a0d',

  // text — flipped for dark wall background
  headingInk: '#f5e8c8',
  bodyInk: '#d9c4a0',
  mutedInk: '#a88a60',
  accentInk: '#e8a020',
  hairline: 'rgba(245, 232, 200, 0.12)',
} as const;

// Korean handwriting first — Gaegu + Nanum Pen Script have Hangul
// glyphs; Caveat is the Latin fallback. Bradley Hand / cursive are
// web-safe final fallbacks for very old browsers.
export const FONT_HEAD = '"Fraunces", Georgia, serif';
export const FONT_HAND = '"Gaegu", "Nanum Pen Script", "Caveat", "Bradley Hand", cursive';
export const FONT_LABEL = '"Courier Prime", "Courier New", monospace';

// Fake cover background palette. Kept alongside ROOM because the
// sleeves are part of the scene's visual identity (ECM / Factory /
// 23 Envelope / early Warp anchors — minimal, not photorealistic).
export const CBG = {
  bone: '#efe4c8',
  cream: '#e8dcb8',
  paper: '#d9c9a0',
  amber: '#d9a24a',
  ochre: '#b88a3a',
  bordeaux: '#6e2230',
  sage: '#7a8a6a',
  seagreen: '#3a6b5e',
  slate: '#4a5560',
  charcoal: '#1a1a18',
  ink: '#0e0c08',
  rust: '#b04a2a',
  olive: '#5a5a2a',
} as const;
