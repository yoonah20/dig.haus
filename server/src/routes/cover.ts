import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import axios from 'axios';
import sharp from 'sharp';

const router = Router();

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cover-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const TARGET_SIZE = 600;
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;

// Bump whenever the output format changes (target size, fit mode, codec).
// Cache keys are `v{N}:${src}` so old low-res artifacts on disk get ignored.
const CACHE_VERSION = 2;

// Force IPv4 — upstreams (coverartarchive.org → archive.org) advertise AAAA
// records whose routes time out on some hosts (e.g. WSL2), while IPv4 works.
// Node's happy-eyeballs still stalls for several seconds per request, so we
// pin the agent to v4.
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });
const httpAgent = new http.Agent({ family: 4, keepAlive: true });

const ALLOWED_HOSTS = new Set([
  'coverartarchive.org',
  'i.scdn.co',
  'mosaic.scdn.co',
  'i.discogs.com',
  'lastfm.freetls.fastly.net',
]);

function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  // Cover Art Archive redirects to ia*.us.archive.org storage.
  if (hostname.endsWith('.archive.org')) return true;
  if (hostname.endsWith('.scdn.co')) return true;
  if (hostname.endsWith('.discogs.com')) return true;
  return false;
}

const inflight = new Map<string, Promise<Buffer>>();

// Our cached cover is sized to 600px, so fetch a source at least that large
// whenever the upstream exposes a size selector in the URL. Without this,
// tiny source images (e.g. 174px Last.fm thumbs, 300px Spotify variants)
// get pinned in cache and look blurry when displayed.
function upgradeUpstreamUrl(src: string): string {
  // Cover Art Archive: /front-250 / /front-500 → /front-1200
  if (src.includes('coverartarchive.org/')) {
    return src.replace(/\/front-(250|500)(\?|$)/, '/front-1200$2');
  }
  // Spotify CDN: image IDs are prefixed by size.
  //   ab67616d00001e02… = 300px, ab67616d00004851… = 64px,
  //   ab67616d0000b273… = 640px (the largest album-art variant).
  if (src.includes('i.scdn.co/image/')) {
    return src
      .replace(/\/image\/ab67616d00001e02/, '/image/ab67616d0000b273')
      .replace(/\/image\/ab67616d00004851/, '/image/ab67616d0000b273');
  }
  // Last.fm CDN: size is encoded as /i/u/{size}/… e.g. 34s, 64s, 174s, 300x300.
  // Rewrite any size segment to /ar0/ (original, untrimmed) so we get the
  // largest available.
  if (src.includes('lastfm.freetls.fastly.net/i/u/')) {
    return src.replace(/\/i\/u\/[^/]+\//, '/i/u/ar0/');
  }
  return src;
}

async function fetchAndResize(srcRaw: string): Promise<Buffer> {
  const src = upgradeUpstreamUrl(srcRaw);
  const response = await axios.get<ArrayBuffer>(src, {
    responseType: 'arraybuffer',
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    maxContentLength: MAX_UPSTREAM_BYTES,
    headers: { 'User-Agent': 'dig.haus-cover-proxy/1.0' },
    validateStatus: (s) => s >= 200 && s < 300,
    httpsAgent,
    httpAgent,
  });
  const input = Buffer.from(response.data);
  // Always emit exactly TARGET_SIZE × TARGET_SIZE. Dropping
  // `withoutEnlargement` means tiny sources (e.g. 174px Last.fm thumbs) get
  // upscaled instead of pinned at their native size in cache — the UI is
  // designed around 600px covers, so a sharp-upscaled 600px is at least no
  // worse than the browser doing the same upscale at paint time.
  return await sharp(input)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'cover',
      position: 'center',
      kernel: 'lanczos3',
    })
    .webp({ quality: 82 })
    .toBuffer();
}

router.get('/', async (req, res) => {
  const src = typeof req.query.src === 'string' ? req.query.src : '';
  if (!src) {
    return res.status(400).json({ error: 'src required' });
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return res.status(400).json({ error: 'invalid protocol' });
  }
  if (!isAllowedHost(parsed.hostname)) {
    return res.status(400).json({ error: 'host not allowed' });
  }

  const key = crypto
    .createHash('sha1')
    .update(`v${CACHE_VERSION}:${src}`)
    .digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}.webp`);

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`);

  if (fs.existsSync(cachePath)) {
    return fs.createReadStream(cachePath).pipe(res);
  }

  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchAndResize(src).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const buffer = await pending;
    fs.promises.writeFile(cachePath, buffer).catch((err) => {
      console.error('cover cache write failed:', err);
    });
    res.send(buffer);
  } catch (err) {
    console.error('cover fetch failed:', src, (err as Error).message);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(502).json({ error: 'cover fetch failed' });
  }
});

export default router;
