import sharp from 'sharp';
import { execute, queryGet } from '../db/index.js';

// Cover-art dominant-colour extraction. Runs server-side (not
// client-side canvas) so we're not gated on whether an external
// host happens to send CORS headers — most album covers come
// from Discogs / Bandcamp / label CDNs that don't, which would
// leave every disc at the default black if we tried to extract
// client-side.
//
// Algorithm mirrors the earlier client hook: downsample to 32x32,
// bucket saturated non-grey pixels by quantised RGB (5 bits per
// channel), pick the bucket with the highest count × saturation.
// Result is stored in `albums.cover_dominant_color` as "r,g,b" so
// we only pay the extraction once per album, ever.

type RGB = [number, number, number];

const SAMPLE_SIZE = 32;
// Network timeout for the image fetch. Generous because Cover Art
// Archive can take a moment on cold cache, but hard enough that
// a broken host doesn't stall the wall endpoint for users.
const FETCH_TIMEOUT_MS = 3500;

// In-process de-dupe: if two wall renders hit the same album
// concurrently, only run one extraction. Keyed by album id.
const inflight = new Map<number, Promise<string | null>>();

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'dig.haus/1.0 (cover-color extractor)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

function pickDominantRGB(pixels: Buffer, width: number, height: number, channels: number): RGB | null {
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; count: number; sat: number }
  >();
  const stride = channels;
  const end = width * height * stride;
  for (let i = 0; i < end; i += stride) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    // Alpha: if RGBA, skip transparent pixels so padded thumbnails
    // don't pollute the bucket counts.
    if (stride === 4 && pixels[i + 3] < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Near-black / near-white / low-saturation greys dominate many
    // covers (margins, logos, monochrome artwork). Skipping them
    // forces the scorer to pick an actual accent hue.
    if (max < 40 || min > 220) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.18) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.r = (existing.r * (existing.count - 1) + r) / existing.count;
      existing.g = (existing.g * (existing.count - 1) + g) / existing.count;
      existing.b = (existing.b * (existing.count - 1) + b) / existing.count;
    } else {
      buckets.set(key, { r, g, b, count: 1, sat });
    }
  }
  if (buckets.size === 0) return null;
  let best: { r: number; g: number; b: number; score: number } | null = null;
  for (const v of buckets.values()) {
    const score = v.count * v.sat;
    if (!best || score > best.score) {
      best = { r: v.r, g: v.g, b: v.b, score };
    }
  }
  if (!best) return null;
  return [Math.round(best.r), Math.round(best.g), Math.round(best.b)];
}

export async function extractDominantColor(url: string): Promise<string | null> {
  const buf = await fetchImageBuffer(url);
  if (!buf) return null;
  try {
    const { data, info } = await sharp(buf)
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgb = pickDominantRGB(data, info.width, info.height, info.channels);
    return rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : null;
  } catch {
    return null;
  }
}

// Public entry: idempotent extract-and-store. Reads the existing
// column first, runs extraction only if null. Stored value is
// "r,g,b" string (or stays null if extraction couldn't find a
// vibrant bucket). Dedupes concurrent callers for the same album.
export async function ensureCoverDominantColor(
  albumId: number,
  coverUrl: string | null
): Promise<string | null> {
  if (!coverUrl) return null;
  const existing = queryGet(
    `SELECT cover_dominant_color FROM albums WHERE id = ?`,
    [albumId]
  ) as { cover_dominant_color: string | null } | undefined;
  if (existing?.cover_dominant_color) return existing.cover_dominant_color;
  const pending = inflight.get(albumId);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const color = await extractDominantColor(coverUrl);
      if (color) {
        execute(
          `UPDATE albums SET cover_dominant_color = ? WHERE id = ?`,
          [color, albumId]
        );
      }
      return color;
    } finally {
      inflight.delete(albumId);
    }
  })();
  inflight.set(albumId, promise);
  return promise;
}
