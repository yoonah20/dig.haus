// Sample the dominant wall colour from a backdrop image and apply it
// to a home_walls row.
//
// Why this exists:
//   Each home_walls row stores its own ink_color / shadow_css /
//   wall_color tokens so the hero carousel renders each track with
//   contrast that's correct for that backdrop's surface tone (cream
//   ink against dark plum, dark brown ink against warm beige, etc.).
//   Deriving those tokens by hand means eyeballing hex codes, which
//   is the kind of thing a script does better.
//
// Usage:
//   npm --prefix server run extract-hero-theme -- <backdrop-file> [wall-id]
//
//   Examples:
//     npm --prefix server run extract-hero-theme -- basement_dawn.avif
//       → samples the file in client/public/backdrops/ and prints
//         the sampled wall hex + derived ink + shadow + a SQL hint.
//         No DB write — useful for previewing before committing.
//
//     npm --prefix server run extract-hero-theme -- basement_dawn.avif 2
//       → samples + runs UPDATE home_walls SET backdrop_file = ...,
//         ink_color = ..., shadow_css = ..., wall_color = ...
//         WHERE id = 2.  The wall slot in the carousel immediately
//         picks up the new backdrop on next page load.
//
// The script reads the live SQLite DB at the standard server data
// path so the change shows up the moment the dev server reloads.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BACKDROPS_DIR = resolve(REPO_ROOT, 'client/public/backdrops');
// Standard server data path. Override via DB_PATH env if running
// against a different DB (e.g. a sanitised local copy).
const DB_PATH =
  process.env.DB_PATH || resolve(REPO_ROOT, 'server/data/diggershaus.db');

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

function printUsage() {
  console.error(
    'Usage: npm --prefix server run extract-hero-theme -- <backdrop-file> [wall-id]'
  );
  console.error('');
  console.error('  <backdrop-file>  filename inside client/public/backdrops/');
  console.error('  [wall-id]        optional — when given, runs an UPDATE on');
  console.error('                   home_walls(id=wall-id). Without it, prints');
  console.error('                   a SQL hint instead.');
}

async function main() {
  const [backdropFile, wallIdArg] = process.argv.slice(2);
  if (!backdropFile) {
    printUsage();
    process.exit(1);
  }

  const backdropPath = resolve(BACKDROPS_DIR, backdropFile);
  console.log(`[hero-theme] sampling ${backdropFile}`);

  let buffer: Buffer;
  try {
    buffer = await readFile(backdropPath);
  } catch (err) {
    console.error(
      `[hero-theme] could not read ${backdropPath}: ${(err as Error).message}`
    );
    process.exit(1);
  }

  const wall = await extractDominant(buffer);
  const theme = deriveTheme(wall);
  const lum = luminance(wall.r, wall.g, wall.b);
  console.log(
    `[hero-theme] wall=${theme.wall} (lum=${lum.toFixed(2)}) ink=${theme.ink}`
  );
  console.log(`[hero-theme] shadow=${theme.shadow}`);

  if (!wallIdArg) {
    // Dry-run path — print a SQL snippet the user can paste, no DB write.
    console.log('');
    console.log('SQL to apply (replace <wall-id> with the target row):');
    console.log(
      `  UPDATE home_walls SET backdrop_file = '${backdropFile}', wall_color = '${theme.wall}', ink_color = '${theme.ink}', shadow_css = '${theme.shadow}' WHERE id = <wall-id>;`
    );
    console.log('');
    console.log(
      'Or rerun with a wall id to apply the update directly:'
    );
    console.log(
      `  npm --prefix server run extract-hero-theme -- ${backdropFile} <wall-id>`
    );
    return;
  }

  const wallId = Number.parseInt(wallIdArg, 10);
  if (!Number.isFinite(wallId) || wallId <= 0) {
    console.error(`[hero-theme] invalid wall id: ${wallIdArg}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  try {
    const exists = db
      .prepare('SELECT 1 FROM home_walls WHERE id = ?')
      .get(wallId);
    if (!exists) {
      console.error(
        `[hero-theme] no home_walls row with id=${wallId}. Available ids:`
      );
      const rows = db
        .prepare('SELECT id, position, backdrop_file FROM home_walls ORDER BY position')
        .all() as Array<{ id: number; position: number; backdrop_file: string }>;
      for (const r of rows) {
        console.error(`  - id=${r.id} (position ${r.position}, backdrop=${r.backdrop_file})`);
      }
      process.exit(1);
    }
    db.prepare(
      `UPDATE home_walls
         SET backdrop_file = ?,
             wall_color = ?,
             ink_color = ?,
             shadow_css = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    ).run(backdropFile, theme.wall, theme.ink, theme.shadow, wallId);
    console.log(
      `[hero-theme] updated home_walls(id=${wallId}) → backdrop_file=${backdropFile}, wall=${theme.wall}, ink=${theme.ink}`
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('[hero-theme] failed:', err);
  process.exit(1);
});
