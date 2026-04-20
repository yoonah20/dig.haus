// Hongdae Dusk palette — warm amber plaster wall, dark walnut floor,
// evening lamp from upper-left. Ported from the Claude Design
// prototype (api.anthropic.com/v1/design/h/EJGHFcN0…). This is
// deliberately a different visual universe from the rest of dig.haus
// — the /my/:username storefront is a "record shop that happens to
// exist on the web" scene; the app chrome around it stays dark.
//
// Keep as a flat token object. If we ever introduce a second palette
// (V2 Shimokitazawa Flat, V3 Ghibli Afternoon), each becomes its own
// module exporting the same shape.

export const ROOM = {
  // wall
  wallTop: '#e0cba6',
  wallMid: '#d9c4a0',
  wallBot: '#c9b08a',
  wallShadow: 'rgba(60, 35, 15, 0.22)',
  wallLight: 'rgba(255, 228, 178, 0.28)',
  plasterGrain: 'rgba(90, 55, 25, 0.07)',

  // floor
  floor: '#5a3c24',
  floorHi: '#6d4a2c',
  floorLo: '#3a2614',
  floorPlank: '#4a311d',
  baseboard: '#3a2614',
  baseboardHi: '#6d4a2c',

  // wood (rails, shelf carcass)
  woodTop: '#7a5230',
  woodFace: '#6b4628',
  woodBot: '#4a311d',
  woodGrain: 'rgba(20, 10, 5, 0.55)',
  woodHi: 'rgba(255, 218, 175, 0.45)',
  woodScuff: 'rgba(255, 220, 180, 0.35)',

  // shelf cubby interior (dark opening)
  cubbyTop: '#2a1a0d',
  cubbyBot: '#1a0f08',
  cubbyLip: '#3a2513',

  // masking tape
  tapeTop: '#f5e8c8',
  tapeMid: '#e8d6a8',
  tapeBot: '#c9b488',
  tapeFiber: 'rgba(80, 60, 30, 0.5)',
  ink: '#2a1a0d',

  // text
  headingInk: '#2a1a0d',
  bodyInk: '#5a3c24',
  mutedInk: '#8b7355',
  accentInk: '#c65a3a',
  hairline: 'rgba(42, 26, 13, 0.25)',
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
