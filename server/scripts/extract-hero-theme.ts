// Sample the dominant wall colour from the desktop hero backdrop and
// rewrite client/src/lib/heroTheme.ts so the mobile hero (which can't
// load the AVIF directly) and the desktop hero share one set of
// surface + ink tokens.
//
// Why this exists:
//   The desktop hero uses a baked-in wall photo; the mobile hero uses
//   a tiled paper texture + a flat fill colour. Whenever the desktop
//   backdrop swapped (gray basement → purple basement, etc.) the
//   mobile fill and the title ink colour drifted out of sync, and
//   "dark brown ink on dark purple wall" went unreadable. This script
//   is the single point that re-derives both.
//
// Usage:
//   npm --prefix server run extract-hero-theme
//
// Reads HERO_BACKDROP_FILE from client/src/lib/heroTheme.ts, samples
// the AVIF in client/public/backdrops/, and rewrites the AUTO-
// GENERATED block in heroTheme.ts.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const HERO_THEME_PATH = resolve(REPO_ROOT, 'client/src/lib/heroTheme.ts');
const BACKDROPS_DIR = resolve(REPO_ROOT, 'client/public/backdrops');

// 5 bits per channel = 32 buckets per channel = 32^3 = 32k buckets
// total. Coarse enough that lighting noise across the wall collapses
// into the same bucket; fine enough that distinct hues (a wall vs a
// floor stripe) don't merge.
const QUANTIZE_BITS = 5;
const QUANTIZE_STEP = 1 << (8 - QUANTIZE_BITS);

interface ExtractedTheme {
  wall: string;
  ink: string;
  shadow: string;
}

function parseBackdropFile(source: string): string {
  const m = source.match(/HERO_BACKDROP_FILE\s*=\s*'([^']+)'/);
  if (!m) {
    throw new Error('could not parse HERO_BACKDROP_FILE from heroTheme.ts');
  }
  return m[1];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Perceived luminance — the standard ITU-R BT.601 weighting, normalised
// to 0..1. Used to decide whether ink should be cream (against a dark
// wall) or dark brown (against a light wall).
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

async function extractDominant(buffer: Buffer): Promise<{ r: number; g: number; b: number }> {
  // 64×64 = 4096 pixels — enough variation to find the wall hue
  // without the script taking real time. Resize uses sharp's
  // default Lanczos which preserves the wall's mid-tone instead of
  // over-sharpening into noise.
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<number, number>();
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Quantize into the bucket key. Reading the same bucket back as
    // the bucket centre means the final colour is a stable midpoint,
    // not a single arbitrary pixel value.
    const qr = (r >> (8 - QUANTIZE_BITS)) & ((1 << QUANTIZE_BITS) - 1);
    const qg = (g >> (8 - QUANTIZE_BITS)) & ((1 << QUANTIZE_BITS) - 1);
    const qb = (b >> (8 - QUANTIZE_BITS)) & ((1 << QUANTIZE_BITS) - 1);
    const key = (qr << (QUANTIZE_BITS * 2)) | (qg << QUANTIZE_BITS) | qb;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }

  const mask = (1 << QUANTIZE_BITS) - 1;
  const qr = (bestKey >> (QUANTIZE_BITS * 2)) & mask;
  const qg = (bestKey >> QUANTIZE_BITS) & mask;
  const qb = bestKey & mask;
  // Bucket centre — left-shift back to 0–255 then nudge by half a
  // step so the colour reads as the middle of the bucket, not its
  // floor.
  const center = (q: number) => Math.min(255, q * QUANTIZE_STEP + (QUANTIZE_STEP >> 1));
  return { r: center(qr), g: center(qg), b: center(qb) };
}

function deriveTheme(wall: { r: number; g: number; b: number }): ExtractedTheme {
  const wallHex = rgbToHex(wall.r, wall.g, wall.b);
  const lum = luminance(wall.r, wall.g, wall.b);

  // Symmetric flip: dark wall gets cream ink with a dark drop
  // shadow; light wall gets brown ink with a soft light shadow that
  // looks like chalk-dust glow rather than a bevel.
  const isDarkWall = lum < 0.5;
  const ink = isDarkWall ? '#f5e6c8' : '#1a1208';
  const shadow = isDarkWall
    ? '0 1px 2px rgba(0, 0, 0, 0.45)'
    : '0 1px 2px rgba(255, 245, 220, 0.55)';

  return { wall: wallHex, ink, shadow };
}

function rewriteThemeFile(source: string, backdropFile: string, theme: ExtractedTheme): string {
  const start = source.indexOf('// === AUTO-GENERATED');
  const endMarker = '// === END AUTO-GENERATED ===';
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error('could not locate AUTO-GENERATED block in heroTheme.ts');
  }
  const block =
    `// === AUTO-GENERATED — do not hand-edit, run extract-hero-theme ===
// Last source: ${backdropFile}
export const HERO_THEME = {
  // Dominant wall colour sampled from the backdrop. Used as the
  // mobile hero's background tone so the mobile band reads as the
  // same room as desktop.
  wall: '${theme.wall}',
  // Title ink colour — auto-flipped to stay readable against the
  // wall (light wall → dark ink, dark wall → cream ink).
  ink: '${theme.ink}',
  // Title text-shadow — direction inverts with ink so the halo
  // anchors letters to the surface instead of bleaching them.
  shadow: '${theme.shadow}',
} as const;
`;
  return source.slice(0, start) + block + source.slice(end);
}

async function main() {
  const themeSource = await readFile(HERO_THEME_PATH, 'utf8');
  const backdropFile = parseBackdropFile(themeSource);
  const backdropPath = resolve(BACKDROPS_DIR, backdropFile);

  console.log(`[hero-theme] sampling ${backdropFile}`);
  const buffer = await readFile(backdropPath);
  const wall = await extractDominant(buffer);
  const theme = deriveTheme(wall);
  console.log(
    `[hero-theme] wall=${theme.wall} (lum=${luminance(wall.r, wall.g, wall.b).toFixed(2)}) ink=${theme.ink}`
  );

  const next = rewriteThemeFile(themeSource, backdropFile, theme);
  await writeFile(HERO_THEME_PATH, next, 'utf8');
  console.log(`[hero-theme] wrote ${HERO_THEME_PATH}`);
}

main().catch((err) => {
  console.error('[hero-theme] failed:', err);
  process.exit(1);
});
