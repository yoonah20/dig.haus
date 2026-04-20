import type { ReactNode } from 'react';
import { CBG } from './palettes';

// Abstract placeholder cover art. Used while the storefront is a
// design preview — real album covers will replace these once the
// page wires up to the /my/:username data. Design anchors: ECM,
// Factory, 23 Envelope, Blue Note, early Warp. One color field +
// one graphic/typographic element + tiny catalog code.

function CoverNoise({ id }: { id: number }) {
  return (
    <filter id={`cn-${id}`}>
      <feTurbulence baseFrequency="1.3" numOctaves="2" seed={id} />
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.07 0" />
    </filter>
  );
}

function Base({
  size,
  bg,
  seed,
  children,
}: {
  size: number;
  bg: string;
  seed: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: 'block', background: bg }}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <CoverNoise id={seed} />
      </defs>
      {children}
      <rect width="100" height="100" filter={`url(#cn-${seed})`} />
      <rect width="100" height="100" fill="url(#coverVig)" opacity="0.25" />
    </svg>
  );
}

// One-off <defs> that every Base can reference. Render this once,
// high in the tree (Storefront does it).
export function CoverDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <radialGradient id="coverVig" cx="0.5" cy="0.55" r="0.8">
          <stop offset="0.6" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.45)" />
        </radialGradient>
      </defs>
    </svg>
  );
}

type CoverArgs = { size: number; seed: number };

const COVERS: Array<(args: CoverArgs) => ReactNode> = [
  // 1 — ECM-ish triangle
  ({ size, seed }) => (
    <Base size={size} bg={CBG.bordeaux} seed={seed}>
      <polygon points="50,24 76,70 24,70" fill={CBG.bone} />
      <text x="50" y="90" fontFamily="serif" fontSize="4" letterSpacing="1.2" textAnchor="middle" fill={CBG.bone}>
        ECHO VIII · ECM 1223
      </text>
    </Base>
  ),
  // 2 — SIDE A
  ({ size, seed }) => (
    <Base size={size} bg={CBG.bone} seed={seed}>
      <text x="50" y="54" fontFamily="Helvetica,Arial,sans-serif" fontSize="22" fontWeight="700" letterSpacing="-0.5" textAnchor="middle" fill={CBG.ink}>
        SIDE A
      </text>
      <line x1="16" y1="63" x2="84" y2="63" stroke={CBG.ink} strokeWidth="0.6" />
      <text x="50" y="72" fontFamily="Helvetica,sans-serif" fontSize="3.5" letterSpacing="3" textAnchor="middle" fill={CBG.ink}>
        33⅓ · STEREO · LP-07
      </text>
    </Base>
  ),
  // 3 — concentric rings
  ({ size, seed }) => (
    <Base size={size} bg={CBG.charcoal} seed={seed}>
      {[42, 34, 26, 18, 10, 4].map((r, i) => (
        <circle key={i} cx="50" cy="48" r={r} fill="none" stroke={CBG.bone} strokeWidth={0.4 + i * 0.1} opacity={0.3 + i * 0.1} />
      ))}
      <circle cx="50" cy="48" r="1.2" fill={CBG.amber} />
      <text x="50" y="92" fontFamily="monospace" fontSize="3" letterSpacing="2" textAnchor="middle" fill={CBG.bone}>
        FAC-081
      </text>
    </Base>
  ),
  // 4 — Fraktur single word
  ({ size, seed }) => (
    <Base size={size} bg={CBG.ink} seed={seed}>
      <text x="50" y="60" fontFamily="'UnifrakturMaguntia','Old English Text MT',serif" fontSize="30" textAnchor="middle" fill={CBG.bone} fontWeight="700">
        GRAB
      </text>
      <text x="50" y="88" fontFamily="monospace" fontSize="3" letterSpacing="3" textAnchor="middle" fill={CBG.bone}>
        WARP · 004
      </text>
    </Base>
  ),
  // 5 — diagonal split
  ({ size, seed }) => (
    <Base size={size} bg={CBG.amber} seed={seed}>
      <polygon points="0,0 100,0 100,100 0,35" fill={CBG.ink} />
      <text x="92" y="18" fontFamily="Helvetica,sans-serif" fontSize="4" letterSpacing="1" textAnchor="end" fill={CBG.bone}>
        LP.04
      </text>
      <text x="8" y="92" fontFamily="Helvetica,sans-serif" fontSize="5.5" fontWeight="700" fill={CBG.ink}>
        IV / SPLIT
      </text>
    </Base>
  ),
  // 6 — sage framed italic
  ({ size, seed }) => (
    <Base size={size} bg={CBG.seagreen} seed={seed}>
      <rect x="10" y="10" width="80" height="80" fill="none" stroke={CBG.bone} strokeWidth="0.5" />
      <text x="14" y="34" fontFamily="serif" fontSize="9" fontStyle="italic" fill={CBG.bone}>oh.</text>
      <text x="14" y="48" fontFamily="serif" fontSize="9" fontStyle="italic" fill={CBG.bone}>an</text>
      <text x="14" y="62" fontFamily="serif" fontSize="9" fontStyle="italic" fill={CBG.bone}>end.</text>
      <text x="86" y="86" fontFamily="monospace" fontSize="3" letterSpacing="1" textAnchor="end" fill={CBG.bone}>
        B-17/87
      </text>
    </Base>
  ),
  // 7 — Factory single circle
  ({ size, seed }) => (
    <Base size={size} bg={CBG.bone} seed={seed}>
      <circle cx="36" cy="40" r="22" fill={CBG.ink} />
      <text x="92" y="94" fontFamily="monospace" fontSize="3.2" letterSpacing="1" textAnchor="end" fill={CBG.ink}>
        FAC · 022
      </text>
    </Base>
  ),
  // 8 — horizontal bars
  ({ size, seed }) => (
    <Base size={size} bg={CBG.cream} seed={seed}>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x="10" y={16 + i * 8} width="80" height="3" fill={CBG.ink} opacity={i % 2 === 0 ? 1 : 0.3} />
      ))}
      <text x="50" y="94" fontFamily="Helvetica,sans-serif" fontSize="3.4" letterSpacing="2.5" textAnchor="middle" fill={CBG.ink}>
        CODA · PART II
      </text>
    </Base>
  ),
  // 9 — big numeral
  ({ size, seed }) => (
    <Base size={size} bg={CBG.rust} seed={seed}>
      <text x="50" y="76" fontFamily="serif" fontSize="72" fontWeight="500" textAnchor="middle" fill={CBG.bone}>
        7
      </text>
      <text x="50" y="93" fontFamily="monospace" fontSize="3.5" letterSpacing="2" textAnchor="middle" fill={CBG.bone}>
        SEVEN MOVEMENTS
      </text>
    </Base>
  ),
  // 10 — photogram shapes
  ({ size, seed }) => (
    <Base size={size} bg={CBG.ink} seed={seed}>
      <g fill={CBG.bone}>
        <ellipse cx="48" cy="40" rx="22" ry="14" transform="rotate(-18 48 40)" />
        <ellipse cx="62" cy="58" rx="14" ry="9" transform="rotate(24 62 58)" opacity="0.7" />
        <ellipse cx="36" cy="62" rx="6" ry="4" />
      </g>
      <text x="8" y="92" fontFamily="monospace" fontSize="3" letterSpacing="1" fill={CBG.bone}>
        NEGATIVE SPACE · 03
      </text>
    </Base>
  ),
  // 11 — grid + dot
  ({ size, seed }) => (
    <Base size={size} bg={CBG.paper} seed={seed}>
      <g stroke={CBG.ink} strokeWidth="0.4" fill="none" opacity="0.6">
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`h${i}`} x1="14" y1={18 + i * 8} x2="86" y2={18 + i * 8} />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`v${i}`} x1={14 + i * 8} y1="18" x2={14 + i * 8} y2="86" />
        ))}
      </g>
      <circle cx="54" cy="50" r="5" fill={CBG.rust} />
      <text x="14" y="94" fontFamily="monospace" fontSize="3" letterSpacing="1" fill={CBG.ink}>
        COORDINATE / 03
      </text>
    </Base>
  ),
  // 12 — vertical line + word
  ({ size, seed }) => (
    <Base size={size} bg={CBG.olive} seed={seed}>
      <line x1="30" y1="10" x2="30" y2="90" stroke={CBG.bone} strokeWidth="1" />
      <text x="38" y="56" fontFamily="serif" fontStyle="italic" fontSize="12" fill={CBG.bone}>
        drift
      </text>
      <text x="38" y="86" fontFamily="monospace" fontSize="3" letterSpacing="1.5" fill={CBG.bone}>
        OLI-12
      </text>
    </Base>
  ),
  // 13 — Korean hand-typographic
  ({ size, seed }) => (
    <Base size={size} bg={CBG.bone} seed={seed}>
      <text x="50" y="56" fontFamily="'Nanum Myeongjo',serif" fontSize="26" textAnchor="middle" fill={CBG.ink} fontWeight="700">
        적막
      </text>
      <line x1="32" y1="64" x2="68" y2="64" stroke={CBG.ink} strokeWidth="0.5" />
      <text x="50" y="74" fontFamily="monospace" fontSize="3" letterSpacing="2" textAnchor="middle" fill={CBG.ink}>
        SILENCE · LP
      </text>
    </Base>
  ),
  // 14 — Malevich black square
  ({ size, seed }) => (
    <Base size={size} bg={CBG.bone} seed={seed}>
      <rect x="22" y="20" width="56" height="56" fill={CBG.ink} />
      <text x="50" y="92" fontFamily="monospace" fontSize="3" letterSpacing="2" textAnchor="middle" fill={CBG.ink}>
        SQ / 1915
      </text>
    </Base>
  ),
  // 15 — slate monogram
  ({ size, seed }) => (
    <Base size={size} bg={CBG.slate} seed={seed}>
      <text x="50" y="64" fontFamily="serif" fontSize="46" fontWeight="300" letterSpacing="-4" textAnchor="middle" fill={CBG.amber}>
        A.A.
      </text>
      <text x="50" y="82" fontFamily="monospace" fontSize="3" letterSpacing="3" textAnchor="middle" fill={CBG.amber}>
        VOL II · 1984
      </text>
    </Base>
  ),
  // 16 — ochre split
  ({ size, seed }) => (
    <Base size={size} bg={CBG.ochre} seed={seed}>
      <rect x="0" y="50" width="100" height="50" fill={CBG.ink} />
      <text x="50" y="36" fontFamily="serif" fontSize="10" fontStyle="italic" textAnchor="middle" fill={CBG.ink}>
        elsewhere,
      </text>
      <text x="50" y="76" fontFamily="serif" fontSize="10" fontStyle="italic" textAnchor="middle" fill={CBG.bone}>
        again.
      </text>
    </Base>
  ),
  // 17 — cream with sage dot grid
  ({ size, seed }) => (
    <Base size={size} bg={CBG.cream} seed={seed}>
      <g fill={CBG.sage}>
        {Array.from({ length: 6 }).map((_, r) =>
          Array.from({ length: 6 }).map((__, c) => (
            <circle key={`${r}-${c}`} cx={18 + c * 12} cy={18 + r * 12} r={1.5 + ((r + c) % 3) * 0.4} />
          ))
        )}
      </g>
      <text x="50" y="96" fontFamily="monospace" fontSize="3" letterSpacing="2" textAnchor="middle" fill={CBG.ink}>
        PATTERN · 06
      </text>
    </Base>
  ),
];

export function FakeCover({ size, seed }: { size: number; seed: number }) {
  // Deterministic cover pick from seed. `Math.sin * 43758` is the
  // standard shader trick for cheap pseudo-randomness; we just need
  // a stable mapping so the same album slot always shows the same
  // sleeve across reloads.
  const i = Math.abs(Math.floor(Math.sin(seed * 999.17) * 43758)) % COVERS.length;
  const Cover = COVERS[i];
  return <>{Cover({ size, seed })}</>;
}
