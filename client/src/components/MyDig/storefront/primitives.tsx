import { FakeCover } from './FakeCover';
import { ROOM, FONT_HAND } from './palettes';

// Furniture primitives — plain utilitarian wood shop furniture.
// No frames, no mounting, no museum energy. Ported from the Claude
// Design prototype with three structural fixes applied inline:
//   1. ShelfUnit no longer has a solid top board across all cubbies
//      (the "수납장" look). Cubbies are open at the top.
//   2. ShelfUnit gained trestle-style end-panel legs so it reads as
//      a standalone piece of floor furniture instead of a built-in.
//   3. Wall zone height logic moved to Room (Storefront.tsx) so all
//      three rows of wall LPs sit against plaster instead of the
//      third row crossing onto the floor background.

// ─── Wall Rail ────────────────────────────────────────────────
// A plain wooden strip running horizontally across a row of LPs.
// Records lean on its top surface against the wall; a small front
// lip keeps them from sliding off.
//
// Polished pass borrowed from ShelfUnit's woodwork: richer gradient
// with an explicit lamp highlight concentrated on the upper-left
// quarter, deterministic knot/scuff marks seeded by row, a softer
// multi-stop underhang shadow so the rail looks like it's casting
// onto the wall behind rather than sitting on top of a drawn line.
// Each row passes a `seed` so successive rails don't share the
// exact same knot position and start to look like a pattern.
export function WallRail({
  width,
  seed = 0,
  style = {},
}: {
  width: number;
  seed?: number;
  style?: React.CSSProperties;
}) {
  const h = 14;
  const canvasH = h + 8;
  // Deterministic knot placements — one or two per rail depending on
  // width. Seed is XOR'd with width so two rails of the same length
  // but different rows pick different x positions.
  const knotCount = width > 520 ? 2 : 1;
  const knots = Array.from({ length: knotCount }).map((_, i) => {
    const hash = Math.abs(((seed ^ (width + i * 73)) * 2654435761) >>> 0);
    const x = 40 + (hash % Math.max(1, width - 80));
    const r = 1.4 + ((hash >> 8) % 10) / 10;
    return { x, r };
  });
  // Scuff — thin light scratch on the face, off-center so it doesn't
  // fight the knot visually.
  const scuffSeed = Math.abs(((seed + 991) * 2654435761) >>> 0);
  const scuffX = 30 + (scuffSeed % Math.max(1, width - 60));
  const scuffLen = 8 + (scuffSeed % 8);
  return (
    <svg
      width={width}
      height={canvasH}
      viewBox={`0 0 ${width} ${canvasH}`}
      style={{ display: 'block', ...style }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`railFace-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={ROOM.woodTop} />
          <stop offset="0.5" stopColor={ROOM.woodFace} />
          <stop offset="1" stopColor={ROOM.woodBot} />
        </linearGradient>
        <linearGradient id={`railLamp-${seed}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={ROOM.woodHi as string} stopOpacity="0.55" />
          <stop offset="0.35" stopColor={ROOM.woodHi as string} stopOpacity="0.2" />
          <stop offset="0.7" stopColor={ROOM.woodHi as string} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`railUnder-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(0,0,0,0.35)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      {/* tiny shadow cast upward onto the wall where records rest */}
      <rect x="0" y="0" width={width} height="1.5" fill="rgba(40,20,8,0.45)" />
      {/* top surface — lightest, catches the upper-left lamp */}
      <rect x="0" y="1.5" width={width} height="3.5" fill={ROOM.woodTop} />
      {/* lamp wash on top edge, biased upper-left */}
      <rect x="0" y="1.5" width={width} height="1" fill={`url(#railLamp-${seed})`} />
      {/* face — darker, grain */}
      <rect x="0" y="5" width={width} height="7" fill={`url(#railFace-${seed})`} />
      {/* subtle lamp wash on the face too, weaker */}
      <rect x="0" y="5" width={width * 0.45} height="7" fill={ROOM.woodHi as string} opacity="0.1" />
      {/* front lip */}
      <rect x="0" y="5" width={width} height="1.4" fill={ROOM.woodTop} opacity="0.9" />
      {/* undercut shadow — soft gradient instead of flat rect */}
      <rect x="0" y="12" width={width} height="5" fill={`url(#railUnder-${seed})`} />
      {/* floor-cast shadow below rail (kept, with wider blur for softness) */}
      <rect x="4" y={h} width={width - 8} height="4" fill="rgba(0,0,0,0.25)" filter="blur(3px)" />
      {/* grain streaks — varied opacity per stripe, mirroring the
          shelf carcass streaks so the two pieces of wood read as the
          same material. */}
      {Array.from({ length: Math.floor(width / 28) }).map((_, i) => (
        <line
          key={i}
          x1={10 + i * 28}
          y1="6"
          x2={20 + i * 28}
          y2="11.5"
          stroke={ROOM.woodGrain}
          strokeWidth="0.4"
          opacity={0.35 + ((i + seed) % 4) * 0.12}
        />
      ))}
      {/* knot(s) — darker circle on the face, very small */}
      {knots.map((k, i) => (
        <g key={i}>
          <ellipse
            cx={k.x}
            cy={8.5}
            rx={k.r}
            ry={k.r * 0.75}
            fill={ROOM.woodGrain as string}
            opacity="0.7"
          />
          <ellipse
            cx={k.x - 0.3}
            cy={8.2}
            rx={k.r * 0.5}
            ry={k.r * 0.35}
            fill={ROOM.woodBot}
            opacity="0.8"
          />
        </g>
      ))}
      {/* scuff — thin light diagonal on the face, barely visible. */}
      <line
        x1={scuffX}
        y1={9.5}
        x2={scuffX + scuffLen}
        y2={7.5}
        stroke={ROOM.woodScuff as string}
        strokeWidth="0.4"
        opacity="0.55"
      />
    </svg>
  );
}

// ─── Bare LP on Wall ──────────────────────────────────────────
// A naked 12" record sleeve (square), leaning back 5° against the
// wall. No frame, no border. Just sleeve + a small gap-shadow
// between its bottom and the rail.
//
// `lampBias` (0-1) scales the upper-left highlight and pushes the
// drop-shadow further down-right so LPs closer to the lamp source
// (top-left of the wall grid) read with stronger directional light.
// Default 1 = full lamp (matches the original bright look). Wall
// function passes a value that decreases from 1 at slot (0,0) to
// near 0 at the bottom-right slot.
export function WallLP({
  size,
  seed,
  coverSeed,
  empty = false,
  lampBias = 1,
}: {
  size: number;
  seed: number;
  coverSeed?: number;
  empty?: boolean;
  lampBias?: number;
}) {
  if (empty) {
    // Empty slot = just blank wall. No placeholder, no ghost, no
    // "drop here" affordance.
    return <div style={{ width: size, height: size }} />;
  }
  const leanDeg = 5;
  const bias = Math.max(0, Math.min(1, lampBias));
  // Gap shadow offsets — pushed further from the sleeve when the
  // LP is near the lamp so the shadow falls "longer" in that
  // direction. Tiny absolute values keep the effect subtle.
  const shadowOffsetX = 2 + bias * 3;
  const shadowOffsetY = 4 + bias * 3;
  const shadowAlpha = 0.35 + bias * 0.2;
  // Lamp highlight intensity on the sleeve's upper-left corner.
  const highlightAlpha = 0.05 + bias * 0.15;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* gap shadow — blurred, and positioned via two layered rects
          so the drop has both a tight core (for the sleeve's bottom
          edge contact) and a wider spill (the directional lamp
          shadow onto the wall/rail). */}
      <div
        style={{
          position: 'absolute',
          left: shadowOffsetX,
          top: shadowOffsetY,
          width: size,
          height: size,
          background: `rgba(20, 10, 3, ${shadowAlpha})`,
          filter: 'blur(5px)',
          borderRadius: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 1,
          top: 3,
          width: size,
          height: size,
          background: 'rgba(15, 8, 3, 0.35)',
          filter: 'blur(2px)',
          borderRadius: 1,
        }}
      />
      {/* the sleeve itself */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `perspective(700px) rotateX(-${leanDeg}deg)`,
          transformOrigin: 'bottom center',
          boxShadow: `0 1px 0 rgba(0,0,0,0.45), 0 -1px 0 rgba(255,210,170,0.1) inset, inset 0 0 0 0.5px rgba(0,0,0,0.55)`,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        <FakeCover size={size} seed={coverSeed ?? seed} />
        {/* upper-left lamp highlight on the sleeve — a soft radial
            wash biased toward (0, 0) so LPs near the lamp source
            pick up extra warmth. Multiplied by lampBias so the
            effect fades across the grid. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at 15% 15%, rgba(255,220,160,${highlightAlpha}) 0%, transparent 55%)`,
            pointerEvents: 'none',
            mixBlendMode: 'screen',
          }}
        />
        {/* implied spine shadow on right edge */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.35))',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

// ─── Masking Tape Label ───────────────────────────────────────
// Handwritten label on tape — used on each shelf cubby's front
// bottom lip. ±7° tilt because tape is human-placed.
export function TapeLabel({
  width,
  text,
  seed,
  style = {},
}: {
  width: number;
  text: string;
  seed: number;
  style?: React.CSSProperties;
}) {
  const height = 22;
  const edge = 3;
  const tilt = (((Math.sin(seed * 5.5) * 43758) % 1 + 1) % 1) * 14 - 7;
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        transform: `rotate(${tilt.toFixed(2)}deg)`,
        transformOrigin: 'center',
        ...style,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <filter id={`tn-${seed}`}>
            <feTurbulence baseFrequency="2.5" numOctaves="2" seed={seed} />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" />
          </filter>
          <linearGradient id={`tg-${seed}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={ROOM.tapeTop} />
            <stop offset="0.5" stopColor={ROOM.tapeMid} />
            <stop offset="1" stopColor={ROOM.tapeBot} />
          </linearGradient>
        </defs>
        {/* soft cast shadow */}
        <rect
          x={edge + 1}
          y={edge + 2}
          width={width - edge * 2}
          height={height - edge * 2}
          fill="rgba(0,0,0,0.2)"
          filter="blur(2px)"
        />
        {/* ragged-edge tape body */}
        <path
          d={`
            M ${edge} ${edge + 1}
            L ${edge + 3} ${edge}
            L ${width - edge - 2} ${edge + 1}
            L ${width - edge} ${edge + 2}
            L ${width - edge - 1} ${height - edge}
            L ${width - edge - 4} ${height - edge - 1}
            L ${edge + 3} ${height - edge}
            L ${edge} ${height - edge - 2} Z
          `}
          fill={`url(#tg-${seed})`}
        />
        {/* fiber streak */}
        <line
          x1={edge + 6}
          y1={height / 2 - 2}
          x2={width - edge - 6}
          y2={height / 2 - 3}
          stroke={ROOM.tapeFiber}
          strokeWidth="0.4"
          opacity="0.4"
        />
        <rect
          x={edge}
          y={edge}
          width={width - edge * 2}
          height={height - edge * 2}
          filter={`url(#tn-${seed})`}
          opacity="0.6"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_HAND,
          fontSize: 13,
          color: ROOM.ink,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ─── Shelf Unit ───────────────────────────────────────────────
// A floor-standing wooden shelf with N cubbies. Each cubby sized
// to fit a 12" LP with ~15mm breathing room. Two structural
// differences from the Claude Design prototype:
//   (1) NO top board — cubbies are open at the top; the unit
//       reads as an open shop rack, not a storage cabinet.
//   (2) Two trestle-style end-panel legs extend below the unit
//       so it sits on the floor as a free-standing piece of
//       furniture rather than a built-in cabinet flush to the
//       ground.
export type CubbySpec = {
  label: string | null;
  count: number;
  coverSeed?: number;
};

export function ShelfUnit({
  lpSize,
  cols,
  rows = 1,
  cubbies,
}: {
  lpSize: number;
  cols: number;
  rows?: number;
  cubbies: CubbySpec[];
}) {
  // Breathing room around each LP inside a cubby (~15mm at 1:1
  // scale; ~5% of the LP's 305mm width). Clamped so small mobile
  // LPs don't crush against the cubby walls.
  const pad = Math.max(10, Math.round(lpSize * 0.08));
  const cubbyInteriorW = lpSize + pad * 2;
  const cubbyInteriorH = lpSize + pad * 2;
  // Front wood lip under each cubby holds the tape label.
  const bottomLip = Math.round(lpSize * 0.16);
  // Divider thickness (shared between neighbors).
  const boardT = Math.max(8, Math.round(lpSize * 0.05));

  // Per-cubby outer height: interior + bottom lip + ONE boardT
  // (the bottom board the records rest on). No top board — that's
  // the fix that removes the cabinet feel.
  const cubbyOuterW = cubbyInteriorW + boardT;
  const cubbyOuterH = cubbyInteriorH + bottomLip + boardT;

  const unitW = boardT + cols * cubbyOuterW;
  // Unit body height = just the cubby rows. No extra top boardT.
  const unitH = rows * cubbyOuterH;

  // Trestle-style end panels — two wooden uprights extending below
  // the unit. Gives the shelf floor-standing furniture feel and
  // lets a real cast-shadow fall under it.
  const legH = Math.max(44, Math.round(lpSize * 0.3));
  const panelW = Math.max(10, boardT);

  return (
    <div
      style={{
        position: 'relative',
        width: unitW,
        height: unitH + legH + 14,
        margin: '0 auto',
      }}
    >
      {/* Ground shadow under the whole unit — now falls under the
          legs, softer and wider since the unit sits slightly above
          the floor. */}
      <div
        style={{
          position: 'absolute',
          left: -6,
          right: -30,
          bottom: -2,
          height: 18,
          background:
            'radial-gradient(ellipse at 35% 40%, rgba(0,0,0,0.5), transparent 75%)',
          filter: 'blur(4px)',
          pointerEvents: 'none',
        }}
      />

      {/* Unit body — wooden carcass wrapping the cubbies */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: unitW,
          height: unitH,
          background: `linear-gradient(180deg, ${ROOM.woodTop}, ${ROOM.woodFace} 30%, ${ROOM.woodBot})`,
          boxShadow: `0 2px 3px rgba(0,0,0,0.35), inset 0 -3px 4px rgba(0,0,0,0.4)`,
        }}
      >
        {/* wood grain streaks + a small scuff + a pencil date-mark */}
        <svg
          width={unitW}
          height={unitH}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {Array.from({ length: Math.floor(unitW / 30) }).map((_, i) => (
            <line
              key={i}
              x1={8 + i * 30}
              y1="2"
              x2={12 + i * 30}
              y2={unitH - 2}
              stroke={ROOM.woodGrain}
              strokeWidth="0.5"
              opacity={0.25 + (i % 3) * 0.08}
            />
          ))}
          <path
            d={`M ${unitW * 0.82} ${unitH - 8} q ${8} ${-3}, ${14} 0`}
            stroke={ROOM.woodGrain}
            strokeWidth="0.8"
            fill="none"
            opacity="0.5"
          />
          <text
            x={unitW * 0.12}
            y={unitH - 5}
            fontFamily="monospace"
            fontSize="7"
            opacity="0.35"
            fill={ROOM.woodGrain as string}
          >
            11/08
          </text>
        </svg>
      </div>

      {/* Cubbies (dark openings carved into the unit body) */}
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const idx = r * cols + c;
          const cubby = cubbies[idx];
          if (!cubby) return null;
          const x = boardT + c * cubbyOuterW;
          const y = r * cubbyOuterH;
          return (
            <Cubby
              key={idx}
              x={x}
              y={y}
              w={cubbyInteriorW}
              h={cubbyInteriorH}
              lpSize={lpSize}
              bottomLip={bottomLip}
              pad={pad}
              count={cubby.count}
              coverSeed={cubby.coverSeed}
              label={cubby.label}
              seed={idx * 7 + 3}
            />
          );
        })
      )}

      {/* Left end-panel leg */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: unitH,
          width: panelW,
          height: legH,
          background: `linear-gradient(180deg, ${ROOM.woodFace}, ${ROOM.woodBot})`,
          boxShadow: `inset -1px 0 2px rgba(0,0,0,0.35), inset 1px 0 0 ${ROOM.woodHi}`,
        }}
      />
      {/* Right end-panel leg */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: unitH,
          width: panelW,
          height: legH,
          background: `linear-gradient(180deg, ${ROOM.woodFace}, ${ROOM.woodBot})`,
          boxShadow: `inset 1px 0 2px rgba(0,0,0,0.35), inset -1px 0 0 ${ROOM.woodHi}`,
        }}
      />
    </div>
  );
}

// ─── Cubby ────────────────────────────────────────────────────
// A single open-front cubby carved into the shelf. Front-forward
// LP stack: front record fully visible, back records peek only as
// thin top-edge slices implying depth.
function Cubby({
  x,
  y,
  w,
  h,
  lpSize,
  bottomLip,
  pad,
  count,
  coverSeed,
  label,
  seed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lpSize: number;
  bottomLip: number;
  pad: number;
  count: number;
  coverSeed?: number;
  label: string | null;
  seed: number;
}) {
  // Peek-line count — records pack tight, so ~1 visible peek per
  // 3 records, capped so even 100 records don't overflow the top
  // breathing room.
  const visiblePeeks =
    count >= 50 ? 15 : count >= 30 ? 11 : count >= 15 ? 7 : count >= 8 ? 4 : count >= 2 ? 2 : 0;
  const peekStackH = Math.min(pad - 6, visiblePeeks * 2);
  const peekLineH = visiblePeeks > 0 ? Math.max(1.2, peekStackH / visiblePeeks) : 0;

  const lpLeft = (w - lpSize) / 2;
  const frontLpY = h - lpSize - Math.max(4, pad * 0.3);

  return (
    <>
      {/* Dark cubby interior */}
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          background: `linear-gradient(180deg, ${ROOM.cubbyTop}, ${ROOM.cubbyBot})`,
          boxShadow: `
            inset 0 3px 5px rgba(0,0,0,0.7),
            inset 0 -1px 2px rgba(0,0,0,0.4),
            inset 2px 0 3px rgba(0,0,0,0.5),
            inset -2px 0 3px rgba(0,0,0,0.5),
            inset 0 0 0 0.5px rgba(0,0,0,0.8)
          `,
          overflow: 'hidden',
        }}
      >
        {/* Back-record peek lines — stacked above the front cover,
            slight horizontal jitter so they don't line up perfectly
            (real records in a bin are never perfectly aligned). */}
        {visiblePeeks > 0 &&
          Array.from({ length: visiblePeeks }).map((_, i) => {
            const idx = visiblePeeks - 1 - i;
            const peekColors = [
              ROOM.cubbyLip,
              '#5a3c24',
              '#8b6a3e',
              '#6b4628',
              '#3a2513',
              '#9a7840',
              '#4a311d',
            ];
            const col = peekColors[(idx * 3 + seed) % peekColors.length];
            const peekY = frontLpY - (idx + 1) * peekLineH + peekLineH * 0.2;
            const sideOffset = ((idx * 1.7) % 3) - 1;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: lpLeft - 1 + sideOffset,
                  top: peekY,
                  width: lpSize + 2,
                  height: peekLineH,
                  background: col,
                  boxShadow: `inset 0 -0.5px 0 rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,220,180,0.1)`,
                  opacity: 0.95 - idx * 0.02,
                }}
              />
            );
          })}

        {/* Front LP — only if cubby has at least one record */}
        {count >= 1 && (
          <div
            style={{
              position: 'absolute',
              left: lpLeft,
              top: frontLpY,
              width: lpSize,
              height: lpSize,
              transform: 'perspective(700px) rotateX(3deg)',
              transformOrigin: 'bottom center',
              boxShadow: `0 3px 5px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4), inset 0 0 0 0.5px rgba(0,0,0,0.55)`,
              overflow: 'hidden',
              zIndex: 20,
            }}
          >
            <FakeCover size={lpSize} seed={coverSeed ?? seed * 17 + 31} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 8%, transparent 85%, rgba(0,0,0,0.45) 100%)',
                pointerEvents: 'none',
              }}
            />
          </div>
        )}

        {/* Empty cubby hint — a faint divider down the back wall
            so the opening doesn't read as a pure black void. */}
        {count === 0 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: pad * 0.8,
              width: 2,
              height: h - pad * 1.5,
              background: ROOM.cubbyLip,
              opacity: 0.4,
              marginLeft: -1,
            }}
          />
        )}
      </div>

      {/* Front wood lip below the cubby opening — holds the tape label */}
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y + h,
          width: w,
          height: bottomLip,
          background: `linear-gradient(180deg, ${ROOM.woodTop}, ${ROOM.woodFace})`,
          boxShadow: `inset 0 1px 0 ${ROOM.woodHi}, inset 0 -1px 2px rgba(0,0,0,0.3)`,
          overflow: 'visible',
        }}
      >
        {label && (
          <TapeLabel
            width={Math.min(w * 0.85, 150)}
            text={label}
            seed={seed + 11}
            style={{
              position: 'absolute',
              left: '50%',
              top: (bottomLip - 22) / 2,
              transform: 'translateX(-50%)',
            }}
          />
        )}
      </div>
    </>
  );
}
