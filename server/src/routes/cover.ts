import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CACHE_MAX_AGE_SECONDS, fetchAndResize } from '../utils/coverImage.js';

const router = Router();

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cover-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Bump whenever the output format changes (target size, fit mode, codec).
// Cache keys are `v{N}:${src}` so old low-res artifacts on disk get ignored.
const CACHE_VERSION = 3;

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
