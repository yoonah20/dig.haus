// Default-flow placement for records the owner hasn't manually
// positioned yet. Lays them in a loose grid (5 columns, top-down),
// then jitters each cell deterministically by album id so the result
// reads as "spread on the floor" rather than a strict grid.
//
// All output coordinates are normalised to [0, 1] floor space — the
// renderer multiplies by the actual floor pixel size, so layout
// survives viewport resize.
//
// X_MIN / Y_MIN bounds account for the fact that records are anchored
// by their CENTRE: at recordSize ≈ 16% of floor width (the typical
// upper end of the CrateFloor formula) the record's half-width is
// 8% of floor width. The cover is square so its half-height as a
// fraction of floor height (= floor width × 11/16) is ≈ 12%. We add
// a few percent of breathing room past those minimums so corner
// records sit cleanly inside the carpet's gold inner frame instead
// of bleeding into it. Operator iter 2026-05-18: earlier bounds
// (0.08/0.92, 0.10/0.90) put corner records partly outside the
// rendered floor on narrower viewports.

export const FLOOR_COLS = 5;
export const FLOOR_ROWS = 4; // 5 × 4 = 20 = floor cap from the server (2026-05-17)

const X_MIN = 0.12;
const X_MAX = 0.88;
const Y_MIN = 0.16;
const Y_MAX = 0.84;
// Hard clamp — generous over X_MIN/MAX to absorb the jitter without
// re-introducing edge clipping.
const X_CLAMP_MIN = 0.10;
const X_CLAMP_MAX = 0.90;
const Y_CLAMP_MIN = 0.14;
const Y_CLAMP_MAX = 0.86;

// Deterministic [-1, 1] pseudo-random from an integer seed. Good
// enough for visual jitter — no need for cryptographic quality.
function jitter(seed: number, salt: number): number {
  const x = Math.sin(seed * 9301 + salt * 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
}

export interface FlowPosition {
  positionX: number;
  positionY: number;
  rotation: number;
}

// Returns the default position for the i-th record in flow order.
// Album id seeds the jitter so the same record always lands in the
// same default spot when re-spilled.
export function defaultFlowPosition(index: number, albumId: number): FlowPosition {
  const col = index % FLOOR_COLS;
  const row = Math.floor(index / FLOOR_COLS);

  const colSpan = (X_MAX - X_MIN) / (FLOOR_COLS - 1);
  const rowSpan = (Y_MAX - Y_MIN) / (FLOOR_ROWS - 1);

  // Per-cell jitter magnitude — kept tiny (~6% / cell) so the first
  // spill reads as "organised, slightly handmade" instead of
  // scattered. Operator iter (2026-05-17): the earlier 30-35% jitter
  // felt 어수선하다 — the spread was tightened way down. Owner can
  // still drag any record into a freer position; the default just
  // doesn't start it there. Rotation stays 0 (rotation prop kept on
  // FlowPosition for layout-data shape compatibility only).
  const jx = jitter(albumId, 1) * colSpan * 0.06;
  const jy = jitter(albumId, 2) * rowSpan * 0.05;

  return {
    positionX: Math.max(X_CLAMP_MIN, Math.min(X_CLAMP_MAX, X_MIN + col * colSpan + jx)),
    positionY: Math.max(Y_CLAMP_MIN, Math.min(Y_CLAMP_MAX, Y_MIN + row * rowSpan + jy)),
    rotation: 0,
  };
}
