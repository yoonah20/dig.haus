// Per-wall visual constants for the hero carousel — backdrop image
// + sampled wall/ink/shadow tokens. Lives in code rather than DB
// because nothing about it is admin-tunable at runtime: the operator
// ships a new hero_*.avif, eyeballs the dominant tone, and updates
// this file. Previously these four fields lived as columns on
// home_walls and were populated by an offline extract-hero-theme
// script — meaning every backdrop swap required running the script
// once locally and once against the prod Railway DB. Code-driven means
// one commit ships the visual change everywhere.
//
// Keys match the seed home_walls.id values (1, 2, 3). The home_walls
// row still owns admin-tunable copy + tuner geometry; this module
// only owns the four fields that have no UI behind them.
//
// Symmetric flip rule for ink/shadow (matches what the old script
// derived): dark wall (lum < 0.5) → cream ink #f5e6c8 + dark shadow;
// light wall → dark brown ink #1a1208 + soft cream shadow. wallColor
// is the dominant hex from the backdrop's brick / wall surface.

export interface HeroWallVisual {
  backdropFile: string;
  wallColor: string;
  inkColor: string;
  shadowCss: string;
}

const BRICK: HeroWallVisual = {
  backdropFile: 'hero_brick.avif',
  wallColor: '#7c4434',
  inkColor: '#f5e6c8',
  shadowCss: '0 1px 2px rgba(0, 0, 0, 0.45)',
};

export const HERO_WALL_VISUALS: Record<number, HeroWallVisual> = {
  1: BRICK,
  2: BRICK,
  3: BRICK,
};

export function getWallVisual(wallId: number): HeroWallVisual {
  // Fallback to wall 1's visual for any unknown id so a stray DB row
  // (e.g. someone seeded a fourth wall but forgot this map) still
  // renders something instead of crashing the carousel.
  return HERO_WALL_VISUALS[wallId] ?? HERO_WALL_VISUALS[1]!;
}
