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
  height,
  style = {},
}: {
  width: number;
  seed?: number;
  // Optional override for the rail's face height. Defaults to 20
  // (desktop). Mobile callers pass a smaller value so the rail
  // reads as a subtle shelf strip instead of a heavy plank at
  // smaller cover sizes.
  height?: number;
  style?: React.CSSProperties;
}) {
  const h = Math.max(10, height ?? 20);
  const canvasH = h + 10;
  const topH = 4;              // top surface (catches lamp)
  const faceTop = topH + 1.5;  // y-coord where the face begins
  const faceH = h - topH - 1;  // face body height
  const lipY = h - 1.8;        // thin lip at bottom edge

  // Deterministic knot placements — one or two per rail depending
  // on width. Seed is XOR'd with width so two rails of the same
  // length but different rows pick different x positions.
  const knotCount = width > 520 ? 2 : 1;
  const knots = Array.from({ length: knotCount }).map((_, i) => {
    const hash = Math.abs(((seed ^ (width + i * 73)) * 2654435761) >>> 0);
    const x = 40 + (hash % Math.max(1, width - 80));
    const r = 2.2 + ((hash >> 8) % 10) / 8; // slightly bigger knots
    return { x, r };
  });

  // Multiple scuffs/scratches scattered across the face for more
  // "real wood" vibe. Each seeded independently so they don't
  // cluster.
  const scuffs = Array.from({ length: 3 }).map((_, i) => {
    const h1 = Math.abs(((seed ^ (i * 577 + 991)) * 2654435761) >>> 0);
    const h2 = Math.abs(((seed ^ (i * 131 + 77)) * 2654435761) >>> 0);
    return {
      x: 20 + (h1 % Math.max(1, width - 60)),
      len: 6 + (h2 % 12),
      y1: faceTop + 2 + (h2 % 8),
      dy: -1 - ((h1 >> 4) % 3),
      opacity: 0.35 + ((h2 >> 8) % 5) * 0.06,
    };
  });

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
          <stop offset="0.4" stopColor={ROOM.woodFace} />
          <stop offset="1" stopColor={ROOM.woodBot} />
        </linearGradient>
        <linearGradient id={`railLamp-${seed}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={ROOM.woodHi as string} stopOpacity="0.6" />
          <stop offset="0.35" stopColor={ROOM.woodHi as string} stopOpacity="0.22" />
          <stop offset="0.7" stopColor={ROOM.woodHi as string} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`railUnder-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(0,0,0,0.4)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
        {/* Wood grain noise filter — feTurbulence stretched along
            the X axis (baseFrequency 0.9x / 0.02y) so it reads as
            horizontal grain fibers rather than static. */}
        <filter id={`railGrain-${seed}`}>
          <feTurbulence baseFrequency="0.9 0.02" numOctaves="2" seed={seed + 13} />
          <feColorMatrix values="0 0 0 0 0.05  0 0 0 0 0.03  0 0 0 0 0.015  0 0 0 0.5 0" />
        </filter>
      </defs>

      {/* tiny shadow cast upward onto the wall where records rest */}
      <rect x="0" y="0" width={width} height="1.5" fill="rgba(40,20,8,0.55)" />
      {/* top surface — lightest, catches the upper-left lamp */}
      <rect x="0" y="1.5" width={width} height={topH} fill={ROOM.woodTop} />
      {/* lamp wash on top edge, biased upper-left */}
      <rect x="0" y="1.5" width={width} height={topH * 0.7} fill={`url(#railLamp-${seed})`} />
      {/* Subtle top-edge highlight (1px crisp cream line) where
          the lamp catches the very top plank corner. */}
      <rect x="0" y="1.5" width={width * 0.8} height="0.6" fill={ROOM.woodHi as string} opacity="0.5" />

      {/* face — base gradient */}
      <rect x="0" y={faceTop} width={width} height={faceH} fill={`url(#railFace-${seed})`} />

      {/* Horizontal wood-grain noise overlayed on the face —
          this is the main new "woodsiness" pass. Screen-space
          turbulence warped horizontally reads as grain fiber. */}
      <rect
        x="0"
        y={faceTop}
        width={width}
        height={faceH}
        filter={`url(#railGrain-${seed})`}
        opacity="0.75"
      />

      {/* Longer horizontal grain streaks — maybe 3-4 across the
          face. These read as clear visible fibers on top of the
          noise, giving direction. */}
      {Array.from({ length: 4 }).map((_, i) => {
        const hash = Math.abs(((seed ^ (i * 443 + 17)) * 2654435761) >>> 0);
        const y = faceTop + 2 + (i * (faceH - 4)) / 4 + ((hash % 3) - 1);
        const startX = (hash % Math.max(1, width - 120)) | 0;
        const len = 40 + ((hash >> 6) % Math.max(1, width - startX - 40));
        return (
          <line
            key={`grainH-${i}`}
            x1={startX}
            y1={y}
            x2={startX + len}
            y2={y + ((hash >> 10) % 2)}
            stroke={ROOM.woodGrain as string}
            strokeWidth="0.6"
            opacity={0.3 + ((i + seed) % 3) * 0.12}
          />
        );
      })}

      {/* Short diagonal grain streaks — the original "visible wood
          texture" pattern, denser than before. */}
      {Array.from({ length: Math.floor(width / 18) }).map((_, i) => (
        <line
          key={`grainD-${i}`}
          x1={6 + i * 18}
          y1={faceTop + 2}
          x2={14 + i * 18}
          y2={faceTop + faceH - 2}
          stroke={ROOM.woodGrain as string}
          strokeWidth="0.35"
          opacity={0.25 + ((i + seed) % 4) * 0.1}
        />
      ))}

      {/* lamp wash on the face — brightens the upper-left quarter */}
      <rect
        x="0"
        y={faceTop}
        width={width * 0.45}
        height={faceH}
        fill={ROOM.woodHi as string}
        opacity="0.08"
      />

      {/* front lip — thin highlight near the bottom edge */}
      <rect x="0" y={lipY} width={width} height="1.2" fill={ROOM.woodTop} opacity="0.85" />

      {/* undercut shadow — soft gradient instead of flat rect */}
      <rect x="0" y={h} width={width} height={canvasH - h} fill={`url(#railUnder-${seed})`} />

      {/* floor-cast shadow below rail (kept, with wider blur for softness) */}
      <rect x="4" y={h + 1} width={width - 8} height="5" fill="rgba(0,0,0,0.3)" filter="blur(3px)" />

      {/* knot(s) — darker oval with concentric ring around it
          suggesting growth rings. */}
      {knots.map((k, i) => (
        <g key={i}>
          {/* Outer ring — wood growth-ring feel */}
          <ellipse
            cx={k.x}
            cy={faceTop + faceH / 2}
            rx={k.r * 1.8}
            ry={k.r * 1.3}
            fill="none"
            stroke={ROOM.woodGrain as string}
            strokeWidth="0.4"
            opacity="0.35"
          />
          {/* Knot body */}
          <ellipse
            cx={k.x}
            cy={faceTop + faceH / 2}
            rx={k.r}
            ry={k.r * 0.75}
            fill={ROOM.woodGrain as string}
            opacity="0.75"
          />
          {/* Dark centre */}
          <ellipse
            cx={k.x - 0.3}
            cy={faceTop + faceH / 2 - 0.3}
            rx={k.r * 0.55}
            ry={k.r * 0.4}
            fill={ROOM.woodBot}
            opacity="0.85"
          />
        </g>
      ))}

      {/* Scuffs / light scratches — multiple, short, low-angle */}
      {scuffs.map((s, i) => (
        <line
          key={`scuff-${i}`}
          x1={s.x}
          y1={s.y1}
          x2={s.x + s.len}
          y2={s.y1 + s.dy}
          stroke={ROOM.woodScuff as string}
          strokeWidth="0.35"
          opacity={s.opacity}
        />
      ))}
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
// ─── Vinyl disc ────────────────────────────────────────────────
// Black 12" LP record with amber centre label + pressed grooves,
// sized to the same square as the cover sleeve. Mounted behind
// the cover by the WallCell so a group-hover on the cell slides
// it partway out to the right (the "peek" interaction the home
// grid used to have at 3036c13^). No spin animation — that one
// read as too flashy on the home grid and got removed; here the
// peek happens for an instant on hover and a still-life disc is
// plenty. Amber label text reads "dig" in the dig.haus accent.
export function VinylDisc({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{
        display: 'block',
        // Zero vertical offset so the shadow doesn't spill below
        // the disc onto the wooden rail when the cell is hovered.
        filter: 'drop-shadow(2px 0 3px rgba(0,0,0,0.45))',
      }}
      aria-hidden
    >
      <defs>
        {/* Base vinyl body — slightly brighter at centre → pitch
            black at the rim. Avoids the "flat paper disc" look
            the earlier single-gradient version had. */}
        <radialGradient id="vinylBase" cx="0.5" cy="0.5" r="0.65">
          <stop offset="0" stopColor="#161616" />
          <stop offset="0.7" stopColor="#0b0b0b" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        {/* Specular crescent — simulates light reflecting off the
            upper-right. Offset centre (0.72 / 0.28) + soft radial
            falloff gives the half-moon sheen real vinyl shots
            have; this is the single biggest thing making the disc
            read as 3D instead of a flat circle. */}
        <radialGradient id="vinylSheen" cx="0.72" cy="0.28" r="0.5">
          <stop offset="0" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="0.4" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        {/* Paper sheen on label — diagonal gradient so the label
            reads as a printed paper sticker catching light, not a
            painted flat disc. */}
        <linearGradient id="vinylLabelSheen" x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <stop offset="0" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Disc body */}
      <circle cx="50" cy="50" r="50" fill="url(#vinylBase)" />

      {/* Banded grooves — 18 concentric rings with alternating
          darker/lighter strokes simulate the vinyl's spiralled
          surface catching ambient light. Not a literal spiral
          (cheaper to render this way and indistinguishable at
          small sizes), but the band alternation is what sells
          the "grooved" texture vs. a smooth disc. */}
      {Array.from({ length: 18 }, (_, i) => {
        const r = 16 + i * 1.9;
        const bright = i % 2 === 0;
        return (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={bright ? '#1f1f1f' : '#0c0c0c'}
            strokeWidth={bright ? 0.45 : 0.22}
          />
        );
      })}

      {/* Specular highlight — painted AFTER the grooves so the
          crescent smooths over them where the light would be
          bouncing off a real vinyl's surface. */}
      <circle cx="50" cy="50" r="50" fill="url(#vinylSheen)" />

      {/* Centre label — dig.haus amber with a paper-sheen overlay
          + crisp outer/inner boundary rings (printed-sticker edge
          detail, matches what the sample vinyl shots show). */}
      <circle cx="50" cy="50" r="15" fill="#e8a020" />
      <circle cx="50" cy="50" r="15" fill="url(#vinylLabelSheen)" />
      <circle
        cx="50"
        cy="50"
        r="15"
        fill="none"
        stroke="rgba(20,14,8,0.4)"
        strokeWidth="0.45"
      />
      <circle
        cx="50"
        cy="50"
        r="13.5"
        fill="none"
        stroke="rgba(20,14,8,0.2)"
        strokeWidth="0.3"
      />

      <text
        x="50"
        y="52"
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontWeight: 600,
          fontStyle: 'italic',
          fontSize: '10px',
          fill: '#141008',
        }}
      >
        dig
      </text>

      {/* Spindle hole */}
      <circle cx="50" cy="50" r="1.6" fill="#0a0503" />
    </svg>
  );
}

export function WallLP({
  size,
  seed,
  coverSeed,
  empty = false,
  lampBias = 1,
  children,
}: {
  size: number;
  seed: number;
  coverSeed?: number;
  empty?: boolean;
  lampBias?: number;
  // Caller can inject their own cover node (typically a real
  // <CoverArt />) instead of the FakeCover seeded preview. Used by
  // the live /my/:username page; preview surfaces leave this out
  // and get the FakeCover demo sleeves.
  children?: React.ReactNode;
}) {
  if (empty) {
    // Empty slot = just blank wall. No placeholder, no ghost, no
    // "drop here" affordance.
    return <div style={{ width: size, height: size }} />;
  }
  const bias = Math.max(0, Math.min(1, lampBias));
  // Gap shadow — single tight pass behind the sleeve. Earlier
  // version had two big blurred shadows that spilled past the
  // bottom of the record onto the rail, making records read as
  // "floating over" rather than "resting on" the rail. This is
  // now a small sideways offset with almost no vertical drop so
  // the shadow stays on the wall behind the record and doesn't
  // bleed downward.
  const shadowOffsetX = 2 + bias * 2;
  const shadowAlpha = 0.32 + bias * 0.15;
  // Lamp highlight intensity on the sleeve's upper-left corner.
  const highlightAlpha = 0.05 + bias * 0.15;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* gap shadow — pushed only sideways (to the right, matching
          the upper-left lamp direction). Zero vertical offset so
          nothing bleeds downward onto the wooden rail; the blur
          keeps the shadow soft without dropping it below the LP. */}
      <div
        style={{
          position: 'absolute',
          left: shadowOffsetX,
          top: 0,
          width: size,
          height: size,
          background: `rgba(20, 10, 3, ${shadowAlpha})`,
          filter: 'blur(3px)',
          borderRadius: 1,
        }}
      />
      {/* the sleeve itself — rendered flat against the wall. An
          earlier iteration used perspective(700px) rotateX(-5deg)
          to imply a physical lean-back, but in practice it reads
          as the cover "about to fall forward" rather than resting
          against the wall, so we dropped the tilt. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          boxShadow: `0 1px 0 rgba(0,0,0,0.45), 0 -1px 0 rgba(255,210,170,0.1) inset, inset 0 0 0 0.5px rgba(0,0,0,0.55)`,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {children ?? <FakeCover size={size} seed={coverSeed ?? seed} />}
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

// ─── Wooden Crate (bedroom-floor variant) ────────────────────
// A freestanding wooden record crate sitting on a bedroom floor,
// showing both its front face and its top opening at a slight
// perspective. Replaces the ShelfUnit cubby for the lofi-bedroom
// scene where records are stored on the floor, not on a wall-
// mounted shelf. Two visible faces:
//
//   Front face  — vertical rectangle with wood grain, masking-tape
//                 label. This is where the genre / theme name lives.
//   Top face    — angled parallelogram at the top, showing the
//                 interior "looking down into the crate" from an
//                 above-front angle. Inside we see the TOP EDGES of
//                 records stored vertically (strips stacked like
//                 books on a shelf viewed from above).
//
// No real 3D CSS transforms — the top face is just a skewed div with
// a clip-path polygon. Simpler to maintain than a preserve-3d setup,
// and the result reads as 3D enough at the scale crates render.
export type CrateSpec = {
  label: string | null;
  count: number;
  coverSeed?: number;
};

export function WoodenCrate({
  width,
  depthRatio = 0.5,
  spec,
  seed = 0,
  tilt = 0,
}: {
  /** Exterior width of the crate. Height is derived so the front
   *  face is slightly taller than a square (crates are usually
   *  deeper than they are wide when viewed from the front). */
  width: number;
  /** Top-face apparent height relative to width. 0.5 ≈ moderate
   *  viewing angle from a seated viewpoint. Larger = steeper angle
   *  (more top visible), smaller = flatter (less top visible). */
  depthRatio?: number;
  spec: CrateSpec;
  seed?: number;
  /** Degrees to rotate the whole crate around its bottom center.
   *  Used by the caller to scatter crates on the floor (±3–8°). */
  tilt?: number;
}) {
  // Front face dimensions. A real 12" LP is 305mm × 305mm; the
  // crate interior needs ~20mm breathing room, so the front face
  // is slightly taller than the LP itself. Keep the aspect close
  // to square with a touch of extra height.
  const frontH = Math.round(width * 1.05);
  const topH = Math.round(width * depthRatio);
  const totalH = frontH + topH;

  // Wood board thickness (visible on top rim and inner walls).
  const boardT = Math.max(6, Math.round(width * 0.05));

  // LP top-edge "strips" visible in the top face. count scales how
  // dense the stack looks inside. We cap the visible strip count so
  // a 50-record crate doesn't try to draw 50 sub-pixel lines.
  const visibleEdges =
    spec.count === 0
      ? 0
      : Math.min(spec.count, Math.max(6, Math.floor(width / 3)));

  // Interior width for the strip row (top face minus side boards).
  const stripRowW = width - boardT * 2;
  const stripW = visibleEdges > 0 ? stripRowW / visibleEdges : 0;

  // Deterministic per-strip color jitter — each "record" has a
  // slightly different top-edge tone. Using the same cover-background
  // palette as FakeCover so the edges feel like they're extensions
  // of real sleeves.
  const EDGE_COLORS = [
    '#3a2a1a',
    '#5a3c24',
    '#2a1a0d',
    '#6b4628',
    '#1a0f08',
    '#8b6a3e',
    '#4a311d',
    '#3a2513',
  ];

  return (
    <div
      style={{
        position: 'relative',
        width,
        height: totalH + 12,
        transform: `rotate(${tilt.toFixed(2)}deg)`,
        transformOrigin: 'bottom center',
      }}
    >
      {/* Ground shadow under the crate */}
      <div
        style={{
          position: 'absolute',
          left: -4,
          right: -4,
          bottom: -4,
          height: 14,
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0.5), transparent 75%)',
          filter: 'blur(4px)',
          pointerEvents: 'none',
        }}
      />

      {/* TOP FACE — the crate opening viewed from a downward angle.
          Rendered as a trapezoid using clip-path so the back edge
          sits further from the viewer than the front edge. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height: topH,
          background: `linear-gradient(180deg, ${ROOM.woodFace}, ${ROOM.woodBot})`,
          clipPath: `polygon(${topH * 0.35}px 0, ${width - topH * 0.35}px 0, 100% 100%, 0 100%)`,
        }}
      >
        {/* Inner shadow around the opening rim */}
        <div
          style={{
            position: 'absolute',
            inset: boardT,
            background: ROOM.crateInterior as string,
            boxShadow: `inset 0 3px 6px ${ROOM.crateShadow as string}, inset 0 -2px 4px rgba(0,0,0,0.45)`,
            clipPath: `polygon(${topH * 0.2}px 0, ${width - boardT * 2 - topH * 0.2}px 0, 100% 100%, 0 100%)`,
          }}
        >
          {/* LP top-edge strip row — each record's top ~20mm visible
              as a thin vertical strip. Packed tight side-by-side. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: topH * 0.1,
              bottom: topH * 0.1,
              display: 'flex',
              gap: 0,
            }}
          >
            {Array.from({ length: visibleEdges }).map((_, i) => {
              const hash = Math.abs(((seed + i) * 2654435761) >>> 0);
              const color = EDGE_COLORS[hash % EDGE_COLORS.length];
              const shift = ((hash >> 8) % 3) - 1;
              return (
                <div
                  key={i}
                  style={{
                    width: `${stripW}px`,
                    height: '100%',
                    background: color,
                    boxShadow: `inset -0.5px 0 0 rgba(0,0,0,0.4), inset 0.5px 0 0 rgba(255,220,170,0.06)`,
                    transform: `translateY(${shift}px)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* FRONT FACE — vertical wood panel with grain, holds the
          masking-tape label. Positioned below the top face. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: topH,
          width,
          height: frontH,
          background: `linear-gradient(180deg, ${ROOM.woodFace}, ${ROOM.woodBot})`,
          boxShadow: `inset 0 2px 3px rgba(0,0,0,0.25), inset 0 -3px 4px rgba(0,0,0,0.4), inset 1px 0 0 ${ROOM.woodHi}`,
          overflow: 'hidden',
        }}
      >
        {/* Wood grain — vertical streaks, deterministic per seed */}
        <svg
          width={width}
          height={frontH}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {Array.from({ length: Math.floor(width / 14) }).map((_, i) => {
            const hash = Math.abs(((seed + i * 31) * 2654435761) >>> 0);
            return (
              <line
                key={i}
                x1={6 + i * 14 + (hash % 4)}
                y1={4}
                x2={8 + i * 14 + (hash % 3)}
                y2={frontH - 4}
                stroke={ROOM.woodGrain}
                strokeWidth="0.45"
                opacity={0.3 + ((hash >> 4) % 5) * 0.1}
              />
            );
          })}
          {/* Top rim highlight — a thin light line just under the
              crate opening suggests the top edge of the front panel
              catching the lamp. */}
          <rect
            x="0"
            y="0"
            width={width}
            height="1.5"
            fill={ROOM.woodHi as string}
            opacity="0.35"
          />
          {/* Bottom rim shadow */}
          <rect
            x="0"
            y={frontH - 2}
            width={width}
            height="2"
            fill="rgba(0,0,0,0.4)"
          />
        </svg>

        {/* Masking-tape label, centered on the lower-middle of the
            front face (where it'd realistically be stuck). */}
        {spec.label && (
          <TapeLabel
            width={Math.min(width * 0.8, 160)}
            text={spec.label}
            seed={seed + 11}
            style={{
              position: 'absolute',
              left: '50%',
              top: frontH * 0.55,
              transform: `translateX(-50%) rotate(${(((Math.sin(seed * 5.5) * 43758) % 1 + 1) % 1 * 14 - 7).toFixed(2)}deg)`,
              transformOrigin: 'center',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Turntable Console ────────────────────────────────────────
// A low wooden console against the wall, holding the user's
// turntable and bookshelf speakers. Sits between the Vinyl Wall
// (above) and the floor crates (below). For S1 this is static
// decoration — no hover, no playback; the LP on the platter is
// just a visible "currently spinning" placeholder. Interactive
// pop-out / click-to-play behavior lands in S4 (per the phase-3
// decisions log).
//
// Composition, left to right:
//   Bookshelf speaker — Turntable — Small amp / plant — Bookshelf speaker
//
// The console top is slightly tilted so we can see its surface
// (same fake-perspective trick as WoodenCrate: clip-path trapezoid,
// no true 3D transforms). Everything on top of it renders in the
// top-face space.
export function TurntableConsole({
  width,
  spinningCoverSeed,
}: {
  /** Total console width. Should be 70–80% of the Room width per
   *  the design spec — caller handles the outer centering. */
  width: number;
  /** Seed used to pick the fake cover currently sitting on the
   *  platter. Pass undefined to show an empty platter (no LP). */
  spinningCoverSeed?: number;
}) {
  // Console dimensions. Height is modest — a console is a piece of
  // low furniture; most of its visual weight is from the gear on
  // top, not the carcass itself.
  const topH = Math.round(width * 0.06);
  const frontH = Math.round(width * 0.13);
  const legH = Math.round(width * 0.035);
  const gearH = Math.round(width * 0.22);
  const totalH = gearH + topH + frontH + legH + 8;

  // Gear placements along the width. Speakers flank both ends,
  // turntable takes the center, small amp + plant fill the middle
  // right between turntable and right speaker.
  const speakerW = Math.round(width * 0.13);
  const turntableW = Math.round(width * 0.32);
  const speakerY = 0;
  const speakerLeftX = Math.round(width * 0.02);
  const speakerRightX = width - speakerW - Math.round(width * 0.02);
  const turntableX = Math.round((width - turntableW) / 2);
  const ampW = Math.round(width * 0.09);
  const ampX = speakerRightX - ampW - Math.round(width * 0.02);
  const plantW = Math.round(width * 0.05);
  const plantX = ampX + ampW + Math.round(width * 0.01);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height: totalH,
        margin: '0 auto',
      }}
    >
      {/* Ground shadow under the whole console, falling to the right
          to match the upper-left lamp. */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          right: -16,
          bottom: -4,
          height: 18,
          background:
            'radial-gradient(ellipse at 40% 40%, rgba(0,0,0,0.55), transparent 75%)',
          filter: 'blur(5px)',
          pointerEvents: 'none',
        }}
      />

      {/* GEAR on top — rendered BEFORE the console carcass so the
          gear sits visually in front of the back edge. The gear
          row's vertical placement puts its bottom at the top edge
          of the console surface. */}
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: gearH }}>
        <Speaker x={speakerLeftX} y={speakerY} w={speakerW} h={gearH} />
        <Turntable
          x={turntableX}
          y={Math.round(gearH * 0.08)}
          w={turntableW}
          h={Math.round(gearH * 0.85)}
          spinningCoverSeed={spinningCoverSeed}
        />
        <Amp x={ampX} y={Math.round(gearH * 0.35)} w={ampW} h={Math.round(gearH * 0.5)} />
        <Plant x={plantX} y={Math.round(gearH * 0.2)} w={plantW} h={Math.round(gearH * 0.6)} />
        <Speaker x={speakerRightX} y={speakerY} w={speakerW} h={gearH} />
      </div>

      {/* CONSOLE TOP — slim tilted surface the gear sits on. Visible
          as a thin trapezoid just under the gear baseline. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: gearH,
          width,
          height: topH,
          background: `linear-gradient(180deg, ${ROOM.woodTop}, ${ROOM.woodFace})`,
          clipPath: `polygon(${topH * 0.6}px 0, ${width - topH * 0.6}px 0, 100% 100%, 0 100%)`,
          boxShadow: `inset 0 1px 0 ${ROOM.woodHi}`,
        }}
      />

      {/* CONSOLE FRONT — vertical wood panel. Wood grain vertical,
          inset shadow at top/bottom for depth. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: gearH + topH,
          width,
          height: frontH,
          background: `linear-gradient(180deg, ${ROOM.woodFace}, ${ROOM.woodBot})`,
          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.35), inset 0 -2px 3px rgba(0,0,0,0.4)`,
        }}
      >
        <svg
          width={width}
          height={frontH}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {Array.from({ length: Math.floor(width / 28) }).map((_, i) => (
            <line
              key={i}
              x1={12 + i * 28}
              y1={2}
              x2={14 + i * 28}
              y2={frontH - 2}
              stroke={ROOM.woodGrain}
              strokeWidth="0.4"
              opacity="0.35"
            />
          ))}
        </svg>
      </div>

      {/* LEGS — two small feet under the front corners so the
          console reads as freestanding furniture, not built-in. */}
      {[
        Math.round(width * 0.06),
        width - Math.round(width * 0.06) - Math.round(width * 0.03),
      ].map((lx, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: lx,
            top: gearH + topH + frontH,
            width: Math.round(width * 0.03),
            height: legH,
            background: `linear-gradient(180deg, ${ROOM.woodBot}, ${ROOM.woodFace})`,
            boxShadow: `inset 1px 0 0 ${ROOM.woodHi}`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Speaker (bookshelf, static) ──────────────────────────────
function Speaker({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cabinetColor = '#2a1f16';
  const grilleColor = '#3a2f24';
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: `linear-gradient(180deg, ${cabinetColor}, #1a120a)`,
        borderRadius: 2,
        boxShadow: `0 2px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.15), inset 0 -2px 3px rgba(0,0,0,0.5)`,
      }}
    >
      {/* Grille cloth front */}
      <div
        style={{
          position: 'absolute',
          inset: 4,
          background: grilleColor,
          borderRadius: 1,
          backgroundImage:
            'radial-gradient(circle at 50% 50%, rgba(255,230,180,0.06) 0.5px, transparent 1px)',
          backgroundSize: '4px 4px',
        }}
      >
        {/* Woofer circle */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '18%',
            width: w * 0.55,
            height: w * 0.55,
            marginLeft: -w * 0.275,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 40%, #1a120a, #0a0503 60%, #000)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8), 0 0 1px rgba(255,220,170,0.15)',
          }}
        />
        {/* Tweeter dome */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '14%',
            width: w * 0.25,
            height: w * 0.25,
            marginLeft: -w * 0.125,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 40%, #2a1f16, #0a0503)',
            boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.6)',
          }}
        />
      </div>
    </div>
  );
}

// ─── Turntable (static, decorative) ────────────────────────────
// Flat-ish top-down view of a vinyl turntable. Platter rendered as
// an ellipse so it reads as viewed from a slight angle. Tonearm
// resting on the LP if one is present, otherwise parked.
function Turntable({
  x,
  y,
  w,
  h,
  spinningCoverSeed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  spinningCoverSeed?: number;
}) {
  const plinthH = h;
  const platterR = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h * 0.48;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: plinthH,
        background: `linear-gradient(180deg, #2a1f16, #1a120a)`,
        borderRadius: 3,
        boxShadow: `0 2px 4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,220,170,0.15), inset 0 -2px 3px rgba(0,0,0,0.5)`,
      }}
    >
      <svg
        width={w}
        height={plinthH}
        viewBox={`0 0 ${w} ${plinthH}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Platter — dark disc with a slight ellipse from viewing angle */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={platterR}
          ry={platterR * 0.82}
          fill="#0f0a05"
          stroke="#1a120a"
          strokeWidth="1"
        />
        {/* Inner platter rim highlight */}
        <ellipse
          cx={cx}
          cy={cy - 1}
          rx={platterR * 0.98}
          ry={platterR * 0.82 * 0.98}
          fill="none"
          stroke="rgba(255,220,170,0.18)"
          strokeWidth="0.6"
        />
        {/* Vinyl on platter — if seed provided, show LP with label */}
        {spinningCoverSeed !== undefined && (
          <>
            <ellipse
              cx={cx}
              cy={cy}
              rx={platterR * 0.95}
              ry={platterR * 0.82 * 0.95}
              fill="#0a0503"
            />
            {/* Concentric grooves */}
            {[0.85, 0.72, 0.58, 0.44].map((r, i) => (
              <ellipse
                key={i}
                cx={cx}
                cy={cy}
                rx={platterR * r}
                ry={platterR * 0.82 * r}
                fill="none"
                stroke="rgba(255,220,170,0.1)"
                strokeWidth="0.3"
              />
            ))}
            {/* LP label center — amber to match dig.haus accent */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={platterR * 0.32}
              ry={platterR * 0.82 * 0.32}
              fill="#c87a2a"
            />
            <ellipse
              cx={cx}
              cy={cy}
              rx={platterR * 0.03}
              ry={platterR * 0.82 * 0.03}
              fill="#1a120a"
            />
          </>
        )}
        {/* Tonearm — a thin bar from right side down to the LP edge */}
        <g transform={`translate(${cx + platterR * 0.9}, ${cy - platterR * 0.7})`}>
          <circle cx="0" cy="0" r={Math.max(2, w * 0.015)} fill="#1a120a" stroke="rgba(255,220,170,0.2)" strokeWidth="0.5" />
          <line
            x1="0"
            y1="0"
            x2={-platterR * 0.75}
            y2={platterR * 0.65}
            stroke="#2a1f16"
            strokeWidth={Math.max(1.5, w * 0.012)}
            strokeLinecap="round"
          />
          {/* Headshell at the end of the tonearm */}
          <rect
            x={-platterR * 0.82}
            y={platterR * 0.62}
            width={Math.max(3, w * 0.02)}
            height={Math.max(2, w * 0.012)}
            fill="#1a120a"
            transform={`rotate(-40, ${-platterR * 0.82}, ${platterR * 0.62})`}
          />
        </g>
        {/* Control dot on plinth (on/off LED) */}
        <circle
          cx={w - 8}
          cy={plinthH - 8}
          r="1.5"
          fill="#c87a2a"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

// ─── Small Amp (VU meters) ────────────────────────────────────
function Amp({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: 'linear-gradient(180deg, #3a2f24, #1f1812)',
        borderRadius: 2,
        boxShadow: `0 2px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.2)`,
        padding: '3px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      {/* VU meter pair */}
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background:
                'linear-gradient(180deg, #2a1f16, #0a0503)',
              border: '0.5px solid rgba(0,0,0,0.6)',
              borderRadius: 1,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 2,
                width: 1,
                height: '60%',
                background: '#e8a020',
                transformOrigin: 'bottom',
                transform: i === 0 ? 'rotate(-18deg)' : 'rotate(12deg)',
              }}
            />
          </div>
        ))}
      </div>
      {/* Knob row */}
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: Math.max(3, w * 0.12),
              height: Math.max(3, w * 0.12),
              borderRadius: '50%',
              background: '#2a1f16',
              boxShadow: 'inset 0 0.5px 0 rgba(255,220,170,0.2), inset 0 -0.5px 0 rgba(0,0,0,0.4)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Small Plant (potted, decorative) ─────────────────────────
function Plant({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const potH = h * 0.4;
  const foliageH = h * 0.6;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
      }}
    >
      {/* Foliage — a few overlapping rounded leaves */}
      <svg
        width={w}
        height={foliageH}
        viewBox={`0 0 ${w} ${foliageH}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ellipse cx={w * 0.5} cy={foliageH * 0.7} rx={w * 0.4} ry={foliageH * 0.45} fill="#4a6a3a" />
        <ellipse cx={w * 0.3} cy={foliageH * 0.5} rx={w * 0.25} ry={foliageH * 0.35} fill="#5a7a45" />
        <ellipse cx={w * 0.7} cy={foliageH * 0.4} rx={w * 0.22} ry={foliageH * 0.4} fill="#3a5a2a" />
        <ellipse cx={w * 0.45} cy={foliageH * 0.25} rx={w * 0.18} ry={foliageH * 0.3} fill="#5a7a45" />
      </svg>
      {/* Pot — terracotta */}
      <div
        style={{
          position: 'absolute',
          left: w * 0.15,
          top: foliageH,
          width: w * 0.7,
          height: potH,
          background: 'linear-gradient(180deg, #8a4a2a, #5a2f18)',
          borderRadius: '2px 2px 4px 4px',
          boxShadow: 'inset 0 1px 0 rgba(255,220,170,0.2), inset 0 -1px 2px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  );
}

