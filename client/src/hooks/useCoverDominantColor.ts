import { useEffect, useState } from 'react';

// Pulls a "wall-legible" accent colour out of an album cover so the
// vinyl disc behind that cover on the mydig wall can tint its
// centre label to match. Purely client-side: load the image,
// downsample to a tiny canvas, bucket non-greyscale pixels, pick
// the bucket with the best (count × saturation) score.
//
// Cache is a module-level Map keyed by URL. Same image ≈ single
// extraction across the session — hover / snapshot swap / remount
// all hit the cache. Negative results (CORS-blocked, no vibrant
// bucket) are cached as null so we don't retry every render.
//
// CORS: external cover hosts vary. Cover Art Archive + Spotify
// images return `Access-Control-Allow-Origin: *`, most others
// don't. When the fetch taints the canvas, getImageData throws
// and we fall through to null — disc just keeps the default amber
// label, which is exactly what it did before this hook existed.

export type RGB = [number, number, number];
type CacheEntry = { rgb: RGB | null };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

// Downsample target. 32×32 = 1024 samples is enough to identify a
// dominant hue without spending real CPU per cell; going larger
// made the bucket counts more stable but extraction visibly
// blocked the hover animation frame on mid-tier hardware.
const SAMPLE_SIZE = 32;

function extractDominantRGB(img: HTMLImageElement): RGB | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    // Canvas is cross-origin tainted — no pixel access. Caller
    // treats this identically to "no vibrant pixels found".
    return null;
  }

  // Bucket quantised RGB (5 bits per channel → 32³ cells). A
  // coarser quantisation merges near-identical hues so the count
  // signal survives compression / film grain / printing noise;
  // finer splits it apart and lets greyish noise win by volume.
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; count: number; sat: number }
  >();
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip near-black + near-white + grey — none of those tint a
    // vinyl label convincingly, and they tend to dominate covers
    // with big margins, logos, or monochrome artwork.
    if (max < 40 || min > 220) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.18) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      // Average the representative RGB so the returned colour
      // tracks the bucket's mean, not whichever pixel landed first.
      existing.r = (existing.r * (existing.count - 1) + r) / existing.count;
      existing.g = (existing.g * (existing.count - 1) + g) / existing.count;
      existing.b = (existing.b * (existing.count - 1) + b) / existing.count;
    } else {
      buckets.set(key, { r, g, b, count: 1, sat });
    }
  }

  if (buckets.size === 0) return null;

  // Score = count × saturation. Straight "most common" picks
  // desaturated beige on sepia covers; the saturation weight tips
  // it toward a real accent hue even when it's not the largest
  // bucket by raw count.
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

function loadAndExtract(url: string): Promise<CacheEntry> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const finish = (entry: CacheEntry) => {
      img.onload = null;
      img.onerror = null;
      cache.set(url, entry);
      inflight.delete(url);
      resolve(entry);
    };
    img.onload = () => {
      finish({ rgb: extractDominantRGB(img) });
    };
    img.onerror = () => {
      finish({ rgb: null });
    };
    img.src = url;
  });
}

// Raw RGB. Consumers decide how to shade it for their context —
// a near-black tinted vinyl body wants different stops than a
// flat chip tag, so the hook intentionally doesn't normalise.
export function useCoverDominantColor(
  url: string | null | undefined
): RGB | null {
  const [rgb, setRgb] = useState<RGB | null>(() =>
    url ? cache.get(url)?.rgb ?? null : null
  );

  useEffect(() => {
    if (!url) {
      setRgb(null);
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      setRgb(cached.rgb);
      return;
    }
    let cancelled = false;
    const p = inflight.get(url) ?? loadAndExtract(url);
    if (!inflight.has(url)) inflight.set(url, p);
    p.then((entry) => {
      if (!cancelled) setRgb(entry.rgb);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return rgb;
}
