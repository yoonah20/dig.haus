import { useEffect, useRef, useState } from 'react';
import { CoverDefs } from './FakeCover';
import {
  TurntableConsole,
  WallLP,
  WallRail,
  WoodenCrate,
  type CrateSpec,
} from './primitives';
import { ROOM, FONT_HEAD, FONT_LABEL } from './palettes';

// Wall fill pattern — 10 slots arranged as 5/5 (two rows of five).
// Reduced from the earlier 5-5-6-6 = 22 spec because the lofi-
// bedroom mood pivot turned the page from "collector's shop wall"
// into "my current favorites above the turntable" — 22 felt like
// an archive; 10 reads as a curated room display. If a user wants
// more space to showcase, we expand later; starting at 10 keeps
// the onboarding curation bar low. A couple of empty slots
// scattered so the preview doesn't read as suspiciously uniform.
const WALL_PATTERN: readonly (readonly boolean[])[] = [
  [true, true, false, true, true],
  [true, true, true, false, true],
];

// Deterministic per-slot seeds — stable across reloads so the same
// slot always shows the same fake sleeve. Zero marks the empty
// slot positions from WALL_PATTERN (kept in the array so index
// arithmetic stays trivial).
const WALL_SEEDS = [
  11, 42, 0, 67, 29,
  88, 5, 56, 0, 73,
];

// Floor crate contents — four wooden crates demonstrating the
// range of populated states (packed / sparse / single / dense)
// plus one Korean-label case to verify Hangul handwriting renders.
// Max six per spec; four is a reasonable default for the preview
// so the floor reads as "some crates out, some in the library"
// rather than "everything the user owns."
const CRATES: CrateSpec[] = [
  { label: 'BLACK METAL', count: 30, coverSeed: 3 },
  { label: '비 오는 일요일', count: 8, coverSeed: 13 },
  { label: '최애 ONE', count: 1, coverSeed: 9 },
  { label: 'NEW ACQUISITIONS', count: 50, coverSeed: 7 },
];

// ─── Room background ──────────────────────────────────────────
// Wall plaster + floor planks + baseboard + warm lamp wash +
// vignette. `wallH` is the pixel height of the wall zone (the rest
// is floor). Ported fix: instead of defaulting to 66% of total
// height, the caller passes an explicit wallH so that all wall-tier
// content (3 rows of LPs + rails) sits against plaster and never
// bleeds onto the floor.
function Room({
  width,
  height,
  wallH,
  children,
}: {
  width: number;
  height: number;
  wallH: number;
  children: React.ReactNode;
}) {
  const floorH = Math.max(0, height - wallH);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: ROOM.wallMid,
        overflow: 'hidden',
        fontFamily: FONT_HEAD,
      }}
    >
      {/* wall base gradient — amber plaster, slight variation top→bot */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height: wallH,
          background: `linear-gradient(180deg, ${ROOM.wallTop}, ${ROOM.wallMid} 55%, ${ROOM.wallBot})`,
        }}
      />
      {/* plaster noise — cream-tinted flecks read as aged painted
          wood panel texture on the dark wall. The original dark
          brown noise went invisible once the wall palette went
          dark; these lighter noise values restore the sense of an
          imperfect hand-painted surface. */}
      <svg
        width={width}
        height={wallH}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        <defs>
          <filter id="plasterTex">
            <feTurbulence baseFrequency="0.9" numOctaves="2" seed="3" />
            <feColorMatrix values="0 0 0 0 0.88  0 0 0 0 0.75  0 0 0 0 0.5  0 0 0 0.06 0" />
          </filter>
          <filter id="plasterBig">
            <feTurbulence baseFrequency="0.008" numOctaves="2" seed="7" />
            <feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.82  0 0 0 0 0.58  0 0 0 0.1 0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#plasterBig)" />
        <rect width="100%" height="100%" filter="url(#plasterTex)" />
      </svg>
      {/* warm lamp wash from upper-left */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: width * 0.7,
          height: wallH + 40,
          background: `radial-gradient(ellipse at 15% -10%, ${ROOM.wallLight} 0%, transparent 55%)`,
          pointerEvents: 'none',
        }}
      />
      {/* right-side wall shadow — lamp falls off toward the right edge */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: width * 0.22,
          height: wallH,
          background: `linear-gradient(90deg, transparent, ${ROOM.wallShadow})`,
          pointerEvents: 'none',
        }}
      />

      {/* baseboard molding at the wall/floor transition */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: wallH - 7,
          width,
          height: 7,
          background: ROOM.baseboard,
          boxShadow: `0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 ${ROOM.baseboardHi}`,
          zIndex: 1,
        }}
      />

      {/* floor */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: wallH,
          width,
          height: floorH,
          background: ROOM.floor,
        }}
      >
        <svg
          width={width}
          height={floorH}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <defs>
            <filter id="floorTex">
              <feTurbulence baseFrequency="0.9 0.05" numOctaves="2" seed="4" />
              <feColorMatrix values="0 0 0 0 0.08  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 0.14 0" />
            </filter>
          </defs>
          {/* horizontal plank seams */}
          {Array.from({ length: 5 }).map((_, i) => (
            <line
              key={i}
              x1="0"
              y1={12 + i * 28}
              x2={width}
              y2={12 + i * 28}
              stroke={ROOM.floorLo}
              strokeWidth="0.7"
              opacity="0.5"
            />
          ))}
          {/* occasional perpendicular plank joints */}
          <line
            x1={width * 0.22}
            y1="12"
            x2={width * 0.22}
            y2="40"
            stroke={ROOM.floorLo}
            strokeWidth="0.7"
            opacity="0.45"
          />
          <line
            x1={width * 0.62}
            y1="40"
            x2={width * 0.62}
            y2="68"
            stroke={ROOM.floorLo}
            strokeWidth="0.7"
            opacity="0.45"
          />
          <line
            x1={width * 0.85}
            y1="68"
            x2={width * 0.85}
            y2={floorH}
            stroke={ROOM.floorLo}
            strokeWidth="0.7"
            opacity="0.45"
          />
          <rect width="100%" height="100%" filter="url(#floorTex)" />
        </svg>
        {/* warm floor wash */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 25% 20%, rgba(255,200,130,0.12) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {children}

      {/* overall scene vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 50% 55%, transparent 40%, rgba(20,10,5,0.45) 100%)',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      />
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────
function Header({
  width,
  username,
  mobile = false,
}: {
  width: number;
  username: string;
  mobile?: boolean;
}) {
  return (
    <div
      style={{
        width,
        padding: mobile ? '14px 16px 10px' : '22px 32px 14px',
        position: 'relative',
        zIndex: 3,
        color: ROOM.headingInk,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div
          style={{
            fontFamily: FONT_LABEL,
            fontSize: mobile ? 10 : 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: ROOM.mutedInk,
            marginBottom: 3,
          }}
        >
          dig.haus &nbsp;/&nbsp; my &nbsp;/
        </div>
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontSize: mobile ? 24 : 32,
            fontStyle: 'italic',
            fontWeight: 500,
            letterSpacing: -0.5,
            color: ROOM.headingInk,
            lineHeight: 1.05,
          }}
        >
          @{username}
        </div>
      </div>
      {!mobile && (
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'center',
            fontFamily: FONT_LABEL,
            fontSize: 11,
            color: ROOM.mutedInk,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          <span>est. '24</span>
          <span style={{ opacity: 0.45 }}>·</span>
          <span>104 LP</span>
          <span style={{ opacity: 0.45 }}>·</span>
          <span style={{ color: ROOM.accentInk }}>· open ·</span>
        </div>
      )}
    </div>
  );
}

// ─── Wall tier — 5/5/6/6 bare LPs on wooden rails ─────────────
// Four rows with counts 5, 5, 6, 6 (22 slots total). All LPs share
// `lpSize`; shorter rows get centered against the widest row's
// width so the column alignment reads intentional. Each row has its
// own rail sized to that row (plus a small overhang) — a single
// wall-wide rail would leave awkward stub ends protruding past the
// shorter rows.
function Wall({
  width,
  lpSize,
  gapX,
  rowSpacing,
}: {
  width: number;
  lpSize: number;
  gapX: number;
  rowSpacing: number;
}) {
  // Widest row dictates the centering reference — any other row
  // narrower than that gets centered horizontally under it.
  const maxCols = WALL_PATTERN.reduce((m, r) => Math.max(m, r.length), 0);
  const slotsBefore = WALL_PATTERN.reduce<number[]>((acc, _r, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + WALL_PATTERN[i - 1].length);
    return acc;
  }, []);

  return (
    <div style={{ position: 'relative', width, paddingTop: 12 }}>
      {WALL_PATTERN.map((row, ri) => {
        const rowW = row.length * lpSize + (row.length - 1) * gapX;
        const rowLeft = (width - rowW) / 2;
        return (
          <div key={ri} style={{ position: 'relative', marginBottom: rowSpacing }}>
            {/* LP row — flex + paddingLeft/Right centers against the
                outer Wall width, independent of this row's length. */}
            <div
              style={{
                display: 'flex',
                gap: gapX,
                paddingLeft: rowLeft,
                paddingRight: rowLeft,
                alignItems: 'flex-end',
              }}
            >
              {row.map((filled, ci) => {
                const idx = slotsBefore[ri] + ci;
                return (
                  <WallLP
                    key={ci}
                    size={lpSize}
                    seed={WALL_SEEDS[idx] || idx + 1}
                    coverSeed={WALL_SEEDS[idx] || idx + 1}
                    empty={!filled}
                    // Lamp bias: the upper-left of the scene is lit
                    // strongest. Passing a 0-1 factor based on this
                    // LP's absolute position lets WallLP nudge its
                    // highlight + gap-shadow so the wall reads as a
                    // real room with directional light instead of
                    // flatly-lit tiles.
                    lampBias={1 - Math.min(1, (ri * maxCols + ci) / (WALL_PATTERN.length * maxCols))}
                  />
                );
              })}
            </div>
            {/* Per-row rail — sized to the row (not the full wall).
                A 10px overhang each side so records near the edges
                sit comfortably inside the rail ends. Centered in
                the Wall width via margin: auto. */}
            <div style={{ position: 'relative', marginTop: -1 }}>
              <WallRail
                width={rowW + 20}
                seed={ri * 37 + 13}
                style={{ margin: '0 auto' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Full storefront ──────────────────────────────────────────
// Composition: header → wall tier → shelf tier inside Room.
// `wallH` (the wall-zone height inside Room) is measured from the
// shelf's DOM position, so it's always exactly the height of
// everything above the shelf. This is the fix for the "floor
// bleeds into wall row 3" issue the static 0.66 ratio caused.
export function Storefront({
  width,
  username = 'choedong',
  mobile = false,
}: {
  width: number;
  username?: string;
  mobile?: boolean;
}) {
  // LP size shared by the wall slots. The turntable console + floor
  // crates derive their dimensions from the scene width independently
  // — the "12 inch LP is 12 inch everywhere" rule still applies
  // inside those primitives (crate interior, turntable platter) but
  // the wall LP size doesn't need to match a crate's exterior box.
  const lpSize = mobile ? 96 : 170;
  const wallGapX = mobile ? 8 : 16;
  const wallRowSpacing = mobile ? 16 : 26;
  // Console spans ~75% of the scene width, centered. Crates sit on
  // the floor underneath, sized so four fit across with breathing
  // room. Both scale with the scene width so mobile/desktop layouts
  // share one set of ratios.
  const consoleW = Math.round(width * 0.75);
  const crateW = mobile ? Math.round(width * 0.22) : Math.round(width * 0.15);

  const contentRef = useRef<HTMLDivElement>(null);
  const furnitureRef = useRef<HTMLDivElement>(null);
  // Initial guess — refined to actual measurement on mount. The
  // initial values are just enough to avoid a visible flash before
  // the useEffect settles the true dimensions.
  const [height, setHeight] = useState(mobile ? 1300 : 1050);
  const [wallH, setWallH] = useState(mobile ? 900 : 720);

  useEffect(() => {
    const content = contentRef.current;
    const furniture = furnitureRef.current;
    if (!content || !furniture) return;
    const h = content.scrollHeight;
    if (h && Math.abs(h - height) > 2) setHeight(h);
    // furniture.offsetTop is where the floor zone begins — wall zone
    // ends at that y. Before the pivot this was the shelf; now it's
    // the stacked console-plus-crates block.
    const wallEnd = furniture.offsetTop;
    if (wallEnd && Math.abs(wallEnd - wallH) > 2) setWallH(wallEnd);
  });

  // Deterministic ±3-8° tilt per crate so they look casually placed
  // on the floor rather than mechanically aligned.
  const crateTilt = (i: number) => {
    const hash = Math.abs(((i * 2654435761) >>> 0));
    return ((hash % 10) - 5) * 0.7; // roughly ±3.5°
  };

  return (
    <Room width={width} height={height} wallH={wallH}>
      <CoverDefs />
      <div ref={contentRef} style={{ position: 'relative', zIndex: 2 }}>
        <Header width={width} username={username} mobile={mobile} />
        <div
          style={{
            width: width - (mobile ? 32 : 64),
            margin: '0 auto',
            height: 1,
            background: ROOM.hairline,
            marginBottom: mobile ? 8 : 14,
          }}
        />

        {/* Tier 1 — Wall */}
        <Wall width={width} lpSize={lpSize} gapX={wallGapX} rowSpacing={wallRowSpacing} />

        {/* Transition space between wall and the furniture block.
            furnitureRef anchors the wall/floor boundary Room uses. */}
        <div style={{ height: mobile ? 18 : 26 }} />

        {/* Furniture block — turntable console on top, floor crates
            in a row below. Sits in the floor zone; its top edge is
            the wall/floor boundary. */}
        <div
          ref={furnitureRef}
          style={{
            position: 'relative',
            width,
            paddingBottom: mobile ? 20 : 28,
          }}
        >
          {/* Turntable console — centered, 75% width */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <TurntableConsole width={consoleW} spinningCoverSeed={42} />
          </div>

          {/* Floor crates — four wooden crates spaced across the
              floor. Slight overlap with the console above (negative
              margin pulls them up so the console back-edge reads as
              behind them). */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              alignItems: 'flex-end',
              gap: mobile ? 6 : 12,
              marginTop: mobile ? -20 : -30,
              padding: `0 ${mobile ? 12 : 24}px`,
            }}
          >
            {CRATES.map((spec, i) => (
              <WoodenCrate
                key={i}
                width={crateW}
                spec={spec}
                seed={i * 11 + 3}
                tilt={crateTilt(i)}
              />
            ))}
          </div>
        </div>
      </div>
    </Room>
  );
}
