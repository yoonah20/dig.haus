// Default-flow placement for records the owner hasn't manually
// positioned yet. Lays them in a loose grid (5 columns, top-down),
// then jitters each cell deterministically by album id so the result
// reads as "spread on the floor" rather than a strict grid.
//
// All output coordinates are normalised to [0, 1] floor space — the
// renderer multiplies by the actual floor pixel size, so layout
// survives viewport resize. The grid stays inside [0.06, 0.94] on
// both axes to give edge records breathing room and a place for the
// record's shadow + slight overflow to live.

export const FLOOR_COLS = 5;
export const FLOOR_ROWS = 6; // 5 × 6 = 30 = floor cap from the server

const X_MIN = 0.08;
const X_MAX = 0.92;
const Y_MIN = 0.10;
const Y_MAX = 0.90;

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

  // Per-cell jitter magnitude — small enough that records don't
  // collide hard, large enough that the grid disappears at a glance.
  const jx = jitter(albumId, 1) * colSpan * 0.35;
  const jy = jitter(albumId, 2) * rowSpan * 0.30;
  const rot = jitter(albumId, 3) * 8; // ±8°

  return {
    positionX: Math.max(0.04, Math.min(0.96, X_MIN + col * colSpan + jx)),
    positionY: Math.max(0.04, Math.min(0.96, Y_MIN + row * rowSpan + jy)),
    rotation: rot,
  };
}
