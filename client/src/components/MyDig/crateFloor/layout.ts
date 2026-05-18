// Default-flow placement for records the owner hasn't manually
// positioned yet. Lays them in a loose grid (5 columns, top-down),
// then jitters each cell deterministically by album id so the result
// reads as "spread on the floor" rather than a strict grid.
//
// All output coordinates are normalised to [0, 1] floor space — the
// renderer multiplies by the actual floor pixel size, so layout
// survives viewport resize.
//
// Bounds are parameterised (FlowBounds) because the carpet's edge
// padding differs between desktop (inset gold frame leaves a few
// percent of breathing room) and mobile (no frame — records run
// edge-to-edge so the floor reads as a single block of LPs rather
// than a centred grid floating inside a border).

export const FLOOR_COLS = 5;
export const FLOOR_ROWS = 4; // 5 × 4 = 20 = floor cap from the server (2026-05-17)

export interface FlowBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  // Hard clamp envelope — keeps jitter from kicking records past the
  // visible carpet edge. Set a few percent past xMin/xMax.
  xClampMin: number;
  xClampMax: number;
  yClampMin: number;
  yClampMax: number;
}

// Desktop default — corner records sit cleanly inside the carpet's
// gold inner frame instead of bleeding into it. Half-record at
// recordSize≈16% of floor width = 8% of width; we add ~4% padding.
export const DESKTOP_BOUNDS: FlowBounds = {
  xMin: 0.12,
  xMax: 0.88,
  yMin: 0.16,
  yMax: 0.84,
  xClampMin: 0.10,
  xClampMax: 0.90,
  yClampMin: 0.14,
  yClampMax: 0.86,
};

// Mobile — no gold frame, no edge padding. Records use the full
// floor area so a phone-width carpet doesn't waste 24% of its
// horizontal real estate on margins. Half-record fraction is larger
// on a narrow viewport (recordSize / floorWidth ≈ 0.19), so we
// bias the centre points slightly in from the absolute edge to
// keep records from clipping.
export const MOBILE_BOUNDS: FlowBounds = {
  xMin: 0.13,
  xMax: 0.87,
  yMin: 0.13,
  yMax: 0.87,
  xClampMin: 0.11,
  xClampMax: 0.89,
  yClampMin: 0.11,
  yClampMax: 0.89,
};

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
// same default spot when re-spilled. Caller picks bounds based on
// viewport class.
export function defaultFlowPosition(
  index: number,
  albumId: number,
  bounds: FlowBounds = DESKTOP_BOUNDS
): FlowPosition {
  const col = index % FLOOR_COLS;
  const row = Math.floor(index / FLOOR_COLS);

  const colSpan = (bounds.xMax - bounds.xMin) / (FLOOR_COLS - 1);
  const rowSpan = (bounds.yMax - bounds.yMin) / (FLOOR_ROWS - 1);

  // Per-cell jitter magnitude — kept tiny (~6% / cell) so the first
  // spill reads as "organised, slightly handmade" instead of
  // scattered. Owner can still drag any record into a freer position.
  // Rotation stays 0 (rotation prop kept on FlowPosition for layout-
  // data shape compatibility only).
  const jx = jitter(albumId, 1) * colSpan * 0.06;
  const jy = jitter(albumId, 2) * rowSpan * 0.05;

  return {
    positionX: Math.max(bounds.xClampMin, Math.min(bounds.xClampMax, bounds.xMin + col * colSpan + jx)),
    positionY: Math.max(bounds.yClampMin, Math.min(bounds.yClampMax, bounds.yMin + row * rowSpan + jy)),
    rotation: 0,
  };
}
