import axios from 'axios';
import http from 'http';
import https from 'https';
import sharp from 'sharp';

export const TARGET_SIZE = 600;
export const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;

// Force IPv4 — upstreams (coverartarchive.org → archive.org) advertise AAAA
// records whose routes time out on some hosts (e.g. WSL2), while IPv4 works.
export const httpsAgent = new https.Agent({ family: 4, keepAlive: true });
export const httpAgent = new http.Agent({ family: 4, keepAlive: true });

/**
 * Rewrites known-upstream image URLs to fetch a variant ≥ TARGET_SIZE.
 * Callers should run this before fetching when the URL came from a
 * trusted upstream (Cover Art Archive, Spotify, Last.fm). For arbitrary
 * admin-supplied URLs it's a no-op.
 */
export function upgradeUpstreamUrl(src: string): string {
  if (src.includes('coverartarchive.org/')) {
    return src.replace(/\/front-(250|500)(\?|$)/, '/front-1200$2');
  }
  if (src.includes('i.scdn.co/image/')) {
    return src
      .replace(/\/image\/ab67616d00001e02/, '/image/ab67616d0000b273')
      .replace(/\/image\/ab67616d00004851/, '/image/ab67616d0000b273');
  }
  if (src.includes('lastfm.freetls.fastly.net/i/u/')) {
    return src.replace(/\/i\/u\/[^/]+\//, '/i/u/ar0/');
  }
  return src;
}

/**
 * Downloads `srcRaw`, resizes to TARGET_SIZE × TARGET_SIZE (center-cropped,
 * lanczos3 upscale for small sources), and returns a WebP buffer.
 */
export async function fetchAndResize(srcRaw: string): Promise<Buffer> {
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
  return await sharp(input)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'cover',
      position: 'center',
      kernel: 'lanczos3',
    })
    .webp({ quality: 82 })
    .toBuffer();
}

/**
 * Basic SSRF guard: reject loopback, link-local, and RFC1918 hosts before
 * making a fetch. This is NOT a full SSRF defense — DNS rebinding, IPv6
 * tricks, and custom DNS are out of scope — but it keeps an admin-supplied
 * URL from trivially pointing at internal services.
 */
export function isSafeRemoteHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') return false;
  // IPv4 literal checks
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
  }
  // IPv6 link-local / unique-local
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return false;
  return true;
}
