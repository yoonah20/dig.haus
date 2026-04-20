import { useEffect, useRef, useState } from 'react';
import { CoverDefs } from './FakeCover';
import { ShelfUnit, WallLP, WallRail, type CubbySpec } from './primitives';
import { ROOM, FONT_HEAD, FONT_LABEL } from './palettes';

// Wall fill pattern — 12 of 15 slots populated, empties scattered
// across different columns per row so there's no visible gap pattern.
const WALL_PATTERN: readonly (readonly boolean[])[] = [
  [true, true, false, true, true],
  [true, true, true, false, true],
  [false, true, true, true, true],
];

// Deterministic per-slot seeds — stable across reloads so the same
// slot always shows the same fake sleeve.
const WALL_SEEDS = [11, 42, 0, 67, 29, 88, 5, 56, 0, 73, 0, 94, 18, 37, 61];

// Shelf cubby contents — covers the range we want the design to
// demonstrate (empty / single / sparse / packed / dense) plus one
// Korean-label case to verify Gaegu/Nanum Pen Script renders.
const CUBBIES: CubbySpec[] = [
  { label: 'BLACK METAL', count: 30, coverSeed: 3 },
  { label: '비 오는 일요일', count: 8, coverSeed: 13 },
  { label: '최애 ONE', count: 1, coverSeed: 9 },
  { label: null, count: 0 },
  { label: 'DEATH METAL', count: 15, coverSeed: 5 },
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
      {/* plaster noise */}
      <svg
        width={width}
        height={wallH}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        <defs>
          <filter id="plasterTex">
            <feTurbulence baseFrequency="0.9" numOctaves="2" seed="3" />
            <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.07  0 0 0 0 0.03  0 0 0 0.05 0" />
          </filter>
          <filter id="plasterBig">
            <feTurbulence baseFrequency="0.008" numOctaves="2" seed="7" />
            <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.08  0 0 0 0 0.04  0 0 0 0.18 0" />
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

// ─── Wall tier (5 × 3 bare LPs on wooden rails) ──────────────
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
  const cols = 5;
  const rowW = cols * lpSize + (cols - 1) * gapX;
  const rowLeft = (width - rowW) / 2;

  return (
    <div style={{ position: 'relative', width, paddingTop: 12 }}>
      {WALL_PATTERN.map((row, ri) => (
        <div key={ri} style={{ position: 'relative', marginBottom: rowSpacing }}>
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
              const idx = ri * cols + ci;
              return (
                <WallLP
                  key={ci}
                  size={lpSize}
                  seed={WALL_SEEDS[idx] || idx + 1}
                  coverSeed={WALL_SEEDS[idx] || idx + 1}
                  empty={!filled}
                />
              );
            })}
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: -1,
              paddingLeft: Math.max(0, rowLeft - 10),
              paddingRight: Math.max(0, rowLeft - 10),
            }}
          >
            <WallRail width={rowW + 20} style={{ margin: '0 auto' }} />
          </div>
        </div>
      ))}
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
  // CRITICAL: LP size is the SAME on both tiers. A 12" LP is a
  // 12" LP regardless of whether it's mounted on the wall or
  // sitting in a shelf cubby.
  const lpSize = mobile ? 96 : 170;
  const wallGapX = mobile ? 8 : 16;
  const wallRowSpacing = mobile ? 16 : 26;
  const shelfCols = mobile ? 2 : 6;
  const shelfRows = mobile ? 3 : 1;

  const contentRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  // Initial guess — refined to actual measurement on mount. The
  // initial values are just enough to avoid a visible flash before
  // the useEffect settles the true dimensions.
  const [height, setHeight] = useState(mobile ? 1300 : 1050);
  const [wallH, setWallH] = useState(mobile ? 900 : 720);

  useEffect(() => {
    const content = contentRef.current;
    const shelf = shelfRef.current;
    if (!content || !shelf) return;
    const h = content.scrollHeight;
    if (h && Math.abs(h - height) > 2) setHeight(h);
    // shelf.offsetTop is relative to contentRef's padding box since
    // content is position:relative. That's exactly where the wall
    // zone should end.
    const wallEnd = shelf.offsetTop;
    if (wallEnd && Math.abs(wallEnd - wallH) > 2) setWallH(wallEnd);
  });

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

        {/* Transition space between wall and shelf. 'shelfRef' is
            the anchor Room uses to split its wall vs floor zones. */}
        <div style={{ height: mobile ? 18 : 26 }} />

        {/* Tier 2 — Shelf (ref'd so Room can measure wall-zone end) */}
        <div
          ref={shelfRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingBottom: mobile ? 20 : 28,
            position: 'relative',
          }}
        >
          <ShelfUnit
            lpSize={lpSize}
            cols={shelfCols}
            rows={shelfRows}
            cubbies={CUBBIES}
          />
        </div>
      </div>
    </Room>
  );
}
