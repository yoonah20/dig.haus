// Lofi Bedroom palette — a Korean vinyl collector's bedroom at night.
// Inspired by lofi hip hop radio stills (warm tungsten desk lamp from
// upper-left + cool cyan-purple neon leaking from an off-screen window
// on the right). Replaces the earlier "Hongdae Dusk" shop-interior
// palette; rationale for the mood pivot is in
// docs/phase3-storefront-decisions.md.
//
// Two-source lighting is the palette's defining property: warm amber
// on the left fading to cool cyan-purple on the right, meeting in a
// horizontal gradient across the middle. The wall base color is a
// warm grey-brown, lighter than the shop-interior revision so the
// album covers pop without having to fight an already-dark ground.

export const ROOM = {
  // wall — painted concrete/drywall bedroom wall, warm grey-brown
  wallTop: '#4a3a2a',
  wallMid: '#3a3028',
  wallBot: '#2e2620',
  wallShadow: 'rgba(0, 0, 0, 0.4)',
  wallLight: 'rgba(255, 200, 130, 0.42)',
  plasterGrain: 'rgba(255, 220, 170, 0.1)',

  // neon leak — cool cyan-purple glow from the off-screen right-side
  // window. Layered on top of the wall as a right-to-left gradient.
  neonPeak: 'rgba(120, 180, 220, 0.22)',
  neonPurple: 'rgba(180, 130, 220, 0.18)',
  neonEdge: 'rgba(100, 200, 230, 0.32)',

  // floor — warm walnut planks, one-point perspective
  floor: '#3a2614',
  floorHi: '#4a3020',
  floorLo: '#1a0f08',
  floorPlank: '#2a1a0d',
  baseboard: '#1a120a',
  baseboardHi: '#5a3f2a',

  // wood (rails, console, crates) — warm mid-tone wood, lighter than
  // floor so furniture pops against it
  woodTop: '#8a5e36',
  woodFace: '#7a5230',
  woodBot: '#5a3a22',
  woodGrain: 'rgba(30, 15, 5, 0.5)',
  woodHi: 'rgba(255, 218, 175, 0.45)',
  woodScuff: 'rgba(255, 220, 180, 0.35)',

  // crate interior — dark void inside wooden record crates; keeps
  // the LP top edges that sit inside from fading into the wood
  crateInterior: '#1a0f08',
  crateShadow: 'rgba(0, 0, 0, 0.55)',

  // shelf cubby interior — legacy keys still referenced by the
  // ShelfUnit / Cubby primitives used by the live /my/:username
  // page. WoodenCrate replaces ShelfUnit in the preview storefront,
  // but both primitives coexist until /my/:username switches over,
  // so these colors can't go away yet. Same dark-void range as
  // crateInterior above; the two sets were separated originally
  // because the shelf had a visible front lip in its own wood tone.
  cubbyTop: '#15090a',
  cubbyBot: '#0a0503',
  cubbyLip: '#3a2513',

  // masking tape — cream/beige, warm under the lamp
  tapeTop: '#f5e8c8',
  tapeMid: '#e8d6a8',
  tapeBot: '#c9b488',
  tapeFiber: 'rgba(80, 60, 30, 0.5)',
  ink: '#2a1a0d',

  // text — light on the warm wall
  headingInk: '#f5e8c8',
  bodyInk: '#d9c4a0',
  mutedInk: '#a88a60',
  accentInk: '#e8a020',
  hairline: 'rgba(245, 232, 200, 0.12)',

  // sticky notes — faded yellow, pinned to wall as lived-in detail
  stickyBg: '#e8d898',
  stickyInk: '#3a2c1c',
  stickyShadow: 'rgba(0, 0, 0, 0.3)',

  // polaroid — old photo tape-stuck to wall
  polaroidBg: '#e8dcc4',
  polaroidBorder: '#c4b494',
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
