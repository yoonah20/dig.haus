import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAndResize, isSafeRemoteHost } from '../utils/coverImage.js';

// __dirname-relative (not cwd-relative) so the path lands on the mounted
// Railway Volume at <app>/server/data regardless of where node was
// launched from. See avatarHost.ts for the long version of why this
// matters — same class of bug.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CUSTOM_COVERS_DIR = path.resolve(__dirname, '..', '..', 'data', 'custom-covers');
fs.mkdirSync(CUSTOM_COVERS_DIR, { recursive: true });

export const CUSTOM_COVERS_ROUTE = '/api/custom-covers';

// Bump whenever the output format changes (target size, codec, quality).
// Filenames change so stale files on disk stop being served.
const HOST_VERSION = 1;

export class CustomCoverError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'CustomCoverError';
  }
}

/**
 * Downloads an arbitrary admin-supplied image, resizes to the site's
 * standard 600×600 WebP, and persists it under server/data/custom-covers/.
 * Returns the stable site-relative URL that should be stored in
 * `albums.cover_art_url`.
 *
 * Idempotent by source URL: re-hosting the same URL reuses the existing
 * file on disk. Failures throw a {@link CustomCoverError} with an HTTP
 * status suitable for returning to the admin client.
 */
export async function hostCustomCover(sourceUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new CustomCoverError(400, 'invalid url');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CustomCoverError(400, 'URL must start with http:// or https://');
  }
  if (!isSafeRemoteHost(parsed.hostname)) {
    throw new CustomCoverError(400, 'host not allowed');
  }

  const key = crypto
    .createHash('sha1')
    .update(`v${HOST_VERSION}:${sourceUrl}`)
    .digest('hex');
  const filename = `${key}.webp`;
  const filePath = path.join(CUSTOM_COVERS_DIR, filename);
  const publicUrl = `${CUSTOM_COVERS_ROUTE}/${filename}`;

  // Idempotent: same source URL → same hash → reuse cached file.
  if (fs.existsSync(filePath)) return publicUrl;

  let buffer: Buffer;
  try {
    buffer = await fetchAndResize(sourceUrl);
  } catch (err) {
    const detail = describeFetchError(err);
    console.warn(`[custom-cover] fetch failed for ${sourceUrl}:`, detail);
    throw new CustomCoverError(502, `Failed to fetch image: ${detail}`);
  }

  await fs.promises.writeFile(filePath, buffer);
  return publicUrl;
}

function describeFetchError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response) return `upstream returned ${err.response.status}`;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'upstream timed out';
    if (err.code) return `network error (${err.code})`;
  }
  return (err as Error)?.message || 'unknown error';
}
