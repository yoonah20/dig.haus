// Single source of truth for the hero's backdrop + derived colour
// tokens. Both the desktop hero (HomeNextHero) and the mobile hero
// (HomeNextHeroMobile) read from here so a backdrop swap auto-
// propagates the surface colour and the readable text colour to the
// mobile band, instead of every swap turning into a four-spot
// hand-tune across two files.
//
// The HERO_BACKDROP_FILE constant below is hand-edited when a new
// backdrop ships. Everything inside the AUTO-GENERATED block is
// rewritten by `npm run extract-hero-theme` (see
// server/scripts/extract-hero-theme.ts) — it samples the dominant
// wall colour from the AVIF, then derives ink / shadow tokens that
// stay readable against that wall.
//
// Workflow when swapping the backdrop:
//   1. Drop the new file in client/public/backdrops/
//   2. Update HERO_BACKDROP_FILE below
//   3. Run `npm --prefix server run extract-hero-theme`
//   4. Commit both this file and the asset

// Hand-edited: which backdrop the desktop hero uses today. The
// mobile hero doesn't load this image (it has its own paper
// texture) but inherits the colour analysis derived from it.
export const HERO_BACKDROP_FILE = 'basement_purple.avif';
export const HERO_BACKDROP_URL = `/backdrops/${HERO_BACKDROP_FILE}`;

// === AUTO-GENERATED — do not hand-edit, run extract-hero-theme ===
// Last source: basement_purple.avif
export const HERO_THEME = {
  // Dominant wall colour sampled from the backdrop. Used as the
  // mobile hero's background tone so the mobile band reads as the
  // same room as desktop.
  wall: '#4c3c54',
  // Title ink colour — auto-flipped to stay readable against the
  // wall (light wall → dark ink, dark wall → cream ink).
  ink: '#f5e6c8',
  // Title text-shadow — direction inverts with ink so the halo
  // anchors letters to the surface instead of bleaching them.
  shadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
} as const;
// === END AUTO-GENERATED ===
