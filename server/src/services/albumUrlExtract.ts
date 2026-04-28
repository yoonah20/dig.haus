import axios from 'axios';
import {
  getDiscogsReleaseDetail,
  getDiscogsMasterMainRelease,
} from './discogs.js';

export interface ExtractResult {
  artist: string;
  title: string;
  // Discogs URLs only — server has already canonicalised the release
  // id, so the registration flow can short-circuit straight to
  // getOrFetchAlbumBaseForSubmission with this MBID instead of asking
  // the user to pick from a fresh MB search. OG-scraped URLs
  // (Bandcamp / Spotify / Apple / shop pages) leave these undefined
  // and the client falls back to the normal artist+title lookup.
  mbid?: string;
  year?: string | null;
  coverArtUrl?: string | null;
}

// Discogs URLs land in the shape /release/{id}[-slug] or
// /master/{id}[-slug]. Master IDs resolve through the existing
// main_release helper → then we call the same detail endpoint the
// normal register path uses. No Claude, no heuristic — this is the
// cheapest and most reliable branch, so it gets first crack.
async function extractFromDiscogsUrl(url: URL): Promise<ExtractResult | null> {
  const match = url.pathname.match(/^\/(release|master)\/(\d+)/);
  if (!match) return null;
  const [, kind, idStr] = match;
  let releaseId = parseInt(idStr, 10);
  if (kind === 'master') {
    const mainRelease = await getDiscogsMasterMainRelease(releaseId);
    if (!mainRelease) return null;
    releaseId = mainRelease;
  }
  const detail = await getDiscogsReleaseDetail(releaseId);
  if (!detail) return null;
  return {
    artist: detail.artist,
    title: detail.title,
    // Always emit a release-prefixed MBID — even if the user pasted a
    // /master URL, we already resolved it to its main_release above,
    // and getOrFetchAlbumBase routes both `discogs-master-{id}` and
    // `discogs-release-{id}` through the same release-detail call.
    // Pinning to release- here keeps the cache key stable across the
    // master/release re-paste case.
    mbid: `discogs-release-${releaseId}`,
    year: detail.year || null,
    coverArtUrl: detail.coverArtUrl || null,
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Lightweight meta-tag picker. Tries property=... and name=... in both
// attribute orders because sites aren't consistent about which comes
// first (og: usually uses property=, twitter: uses name=, and some
// hand-written headers flip either). Good-enough for the small set of
// tags we care about — no HTML parser dependency for this one call.
function pickMeta(html: string, ...names: string[]): string | null {
  for (const n of names) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
        'i'
      ),
      new RegExp(
        `<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`,
        'i'
      ),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) return decodeHtmlEntities(m[1]).trim();
    }
  }
  return null;
}

// Interpret the common OG-title shapes record shops and music sites
// use. Roughly ranked by specificity so the most-distinctive formats
// win before the ambiguous "X - Y" fallback. Returns null if nothing
// looks like an album.
function extractFromOg(html: string): ExtractResult | null {
  const ogTitle = pickMeta(html, 'og:title', 'twitter:title');
  if (!ogTitle) return null;
  const ogDescription = pickMeta(html, 'og:description', 'twitter:description');
  const ogSiteName = pickMeta(html, 'og:site_name');

  // Bandcamp: "Album, by Artist"
  const bandcampMatch = ogTitle.match(/^(.+?),\s*by\s+(.+?)\s*$/i);
  if (bandcampMatch) {
    return { title: bandcampMatch[1].trim(), artist: bandcampMatch[2].trim() };
  }

  // Apple Music / generic: "Album by Artist" or "Album by Artist on Apple Music"
  const byMatch = ogTitle.match(/^(.+?)\s+by\s+(.+?)(?:\s+on\s+[^.]+)?$/i);
  if (byMatch) {
    return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
  }

  // Spotify: og:title is just the album title; og:description is
  // "Artist · Album · Year · N songs". Site_name disambiguates.
  if (
    ogSiteName &&
    /spotify/i.test(ogSiteName) &&
    ogDescription &&
    ogDescription.includes('·')
  ) {
    const parts = ogDescription.split('·').map((p) => p.trim());
    if (parts[0] && parts[0].length < 200) {
      return { title: ogTitle, artist: parts[0] };
    }
  }

  // Generic "Artist - Album" / "Artist: Album" / "Artist — Album".
  // Ambiguous: some sites put album first. If og:description names an
  // artist via "by X", prefer that signal; otherwise fall back to the
  // "artist first" convention, which most label / shop pages follow.
  const dashMatch = ogTitle.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim();
    if (ogDescription) {
      const byInDesc = ogDescription.match(/\bby\s+([^.,\n]+?)(?:[.,\n]|$)/i);
      if (byInDesc) {
        const descArtist = byInDesc[1].trim();
        if (descArtist.toLowerCase() === left.toLowerCase()) {
          return { artist: left, title: right };
        }
        if (descArtist.toLowerCase() === right.toLowerCase()) {
          return { artist: right, title: left };
        }
      }
    }
    return { artist: left, title: right };
  }

  // Last ditch: og:title is album, og:description has "by Artist".
  if (ogDescription) {
    const byDesc = ogDescription.match(/\bby\s+([^.,\n]+?)(?:[.,\n]|$)/i);
    if (byDesc) {
      return { title: ogTitle, artist: byDesc[1].trim() };
    }
  }

  return null;
}

// SSRF guards. The string checks stop the obvious "point this at
// 127.0.0.1 / 169.254.169.254 AWS metadata / internal RFC1918" vector.
// Not bulletproof against DNS rebinding — but the feature is behind
// auth + the per-user search rate limit, so an attacker would also
// need a valid user account and patience to burn one-shot lookups.
// Matches the existing practice elsewhere in the codebase.
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fe80::/i,
  /^fc00::/i,
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(hostname));
}

export async function extractAlbumFromUrl(
  raw: string
): Promise<ExtractResult | null> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isBlockedHost(url.hostname)) return null;

  // Level 1 — known-site parsing. Discogs is the only one we actively
  // resolve via API because we already have the client wired up and
  // the response is canonical. Bandcamp / Spotify / Apple Music all
  // have reliable og:title shapes so they roll through Level 2.
  if (/(^|\.)discogs\.com$/i.test(url.hostname)) {
    const result = await extractFromDiscogsUrl(url);
    if (result) return result;
    // Not a /release or /master URL → fall through to OG scrape.
  }

  // Level 2 — fetch + parse OG tags. Tight timeout and size cap so a
  // slow / huge page doesn't hang the request thread.
  try {
    const resp = await axios.get(url.href, {
      timeout: 10_000,
      maxContentLength: 2_000_000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    return extractFromOg(html);
  } catch (err) {
    console.warn(
      `[album-url-extract] fetch failed for ${raw}:`,
      (err as Error).message
    );
    return null;
  }
}
