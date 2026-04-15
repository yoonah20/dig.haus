import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';

const router = Router();

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cover-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const TARGET_SIZE = 600;
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;

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

async function fetchAndResize(src: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(src, {
    responseType: 'arraybuffer',
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    maxContentLength: MAX_UPSTREAM_BYTES,
    headers: { 'User-Agent': 'dig.haus-cover-proxy/1.0' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const input = Buffer.from(response.data);
  return await sharp(input)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'cover',
      position: 'center',
      withoutEnlargement: true,
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

  const key = crypto.createHash('sha1').update(src).digest('hex');
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
