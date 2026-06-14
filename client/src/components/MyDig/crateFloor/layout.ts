// Default-flow placement for records the owner hasn't manually
// positioned yet. Lays them in a loose grid (5 columns, top-down),
// then jitters each cell deterministically by album id so the result
// reads as "spread on the floor" rather than a strict grid.
//
// All output coordinates are normalised to [0, 1] floor space — the
// renderer multiplies by the actual floor pixel size, so layout
// survives viewport resize.
//
// Bounds are SHARED across viewport sizes (operator decision 2026-
// 05-18): owner-placed positions should look identical regardless
// of where the page is viewed. Per-viewport bounds were tried
// earlier but broke the "same arrangement everywhere" contract —
// a record placed at the centre on desktop would shift sideways
// on mobile if the bounds didn't match.

export const FLOOR_COLS = 5;
export const FLOOR_ROWS = 4; // 5 × 4 = 20 = floor cap from the server (2026-05-17)

// Default-flow placement bounds, in [0, 1] normalised carpet space.
// Tight — records fill close to the carpet edges so the layout
// reads as "a floor full of records" rather than a centred grid
// floating inside a frame. CLAMP envelope sits a couple of percent
// past the placement range so jitter can't push a record over the
// visible edge.
const X_MIN = 0.13;
const X_MAX = 0.87;
const Y_MIN = 0.13;
const Y_MAX = 0.87;
const X_CLAMP_MIN = 0.11;
const X_CLAMP_MAX = 0.89;
const Y_CLAMP_MIN = 0.11;
const Y_CLAMP_MAX = 0.89;

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
  // scattered. Owner can still drag any record into a freer position.
  const jx = jitter(albumId, 1) * colSpan * 0.06;
  const jy = jitter(albumId, 2) * rowSpan * 0.05;
  // Initial rotation — deterministic ±2° per album so a never-
  // touched carpet still has the slightly-tossed look. Each drag-
  // and-drop overrides this with a fresh random value (see the
  // pointerup handler in CrateFloor) so the act of placing a
  // record re-rolls its angle, mimicking handling it physically.
  const rotation = jitter(albumId, 7) * 2;

  return {
    positionX: Math.max(X_CLAMP_MIN, Math.min(X_CLAMP_MAX, X_MIN + col * colSpan + jx)),
    positionY: Math.max(Y_CLAMP_MIN, Math.min(Y_CLAMP_MAX, Y_MIN + row * rowSpan + jy)),
    rotation,
  };
}

// Snap a normalised floor coordinate back to its nearest default-flow
// grid cell index. Used to mark which cells owner-placed records sit
// on so a freshly added (not-yet-placed) record can flow into a
// genuinely empty cell instead of stacking on top of whatever already
// occupies the top-left — the server returns items created_at DESC,
// so without this the newest record always resolves to cell 0.
export function nearestCell(x: number, y: number): number {
  const colSpan = (X_MAX - X_MIN) / (FLOOR_COLS - 1);
  const rowSpan = (Y_MAX - Y_MIN) / (FLOOR_ROWS - 1);
  const col = Math.round((x - X_MIN) / colSpan);
  const row = Math.round((y - Y_MIN) / rowSpan);
  const c = Math.max(0, Math.min(FLOOR_COLS - 1, col));
  const r = Math.max(0, Math.min(FLOOR_ROWS - 1, row));
  return r * FLOOR_COLS + c;
}
