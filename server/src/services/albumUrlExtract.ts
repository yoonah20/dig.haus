import axios from 'axios';
import {
  getDiscogsReleaseDetail,
  getDiscogsMasterMainRelease,
} from './discogs.js';
import { fetchSpotifyAlbumMeta } from './spotify.js';
import { searchExternalMerged } from '../utils/externalSearch.js';

export interface ExtractResult {
  artist: string;
  title: string;
  // Present for Discogs URLs (server canonicalised the release id) and
  // for Spotify URLs that we managed to re-resolve to a MusicBrainz /
  // Discogs release — in both cases the registration flow can
  // short-circuit straight to getOrFetchAlbumBaseForSubmission with
  // this id instead of asking the user to pick from a fresh MB search.
  // OG-scraped URLs (Bandcamp / Apple / shop pages) — and Spotify
  // albums MB + Discogs don't know — leave this undefined, and the
  // client falls back to the normal artist+title lookup.
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
    // getOrFetchAlbumBase accepts discogs-{id} (release) and
    // discogs-master-{id} (master). Use the plain discogs-{id} form here
    // because we already resolved the master to its main_release above,
    // making the cache key stable regardless of whether the user pasted
    // a /master or /release URL.
    mbid: `discogs-${releaseId}`,
    year: detail.year || null,
    coverArtUrl: detail.coverArtUrl || null,
  };
}

// Spotify album URLs (open.spotify.com/album/{id}). Spotify carries no
// MBID of its own, so — unlike Discogs — we can't hand the registration
// flow a canonical id directly. Instead we pull the clean artist/title
// from the Spotify API and re-resolve it against the same MB + Discogs
// merge the text-search box uses; the best matching candidate's id makes
// the paste a one-click register row exactly like a Discogs URL. When
// nothing matches (release MB and Discogs both lack), we still return
// Spotify's own artist+title so the client can fall back to a manual
// register — a Spotify paste is never a hard dead-end.
function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '') // drop trailing "(Deluxe)" etc.
    .replace(/[^a-z0-9]/g, '');
}

async function extractFromSpotifyUrl(url: URL): Promise<ExtractResult | null> {
  if (!/\/album\/[A-Za-z0-9]{22}/.test(url.pathname)) return null;
  const meta = await fetchSpotifyAlbumMeta(url.href);
  // No creds / rate-limited / unparseable → let the OG scrape try (it
  // still yields Spotify's artist+title, just without an mbid).
  if (!meta) return null;

  // Match Spotify's typical single-artist listing against MB/Discogs,
  // which often index collabs under the primary artist only.
  const primaryArtist =
    meta.artist.split(/\s*[,&]\s*/)[0]?.trim() || meta.artist;
  let candidates: Awaited<ReturnType<typeof searchExternalMerged>> = [];
  try {
    candidates = await searchExternalMerged(`${primaryArtist} ${meta.title}`);
  } catch (err) {
    console.warn(
      '[album-url-extract] spotify resolve search failed:',
      (err as Error).message
    );
  }

  const titleKey = normKey(meta.title);
  const artistKey = normKey(primaryArtist);
  // Prefer a candidate whose title matches exactly and whose artist
  // overlaps; otherwise fall back to the top relevance-ranked hit
  // (searchExternalMerged already requires the query words to appear in
  // artist+title, so it's at least on-topic). The user still sees the
  // cover / title / year in the register row and confirms with the click.
  const exact = candidates.find((c) => {
    const cArtist = normKey(c.artist);
    return (
      normKey(c.title) === titleKey &&
      (cArtist.includes(artistKey) || artistKey.includes(cArtist))
    );
  });
  const chosen = exact ?? candidates[0] ?? null;

  if (chosen) {
    return {
      artist: chosen.artist,
      title: chosen.title,
      mbid: chosen.mbid,
      year: chosen.year ?? meta.year ?? null,
      coverArtUrl: chosen.coverArtUrl ?? meta.coverArtUrl ?? null,
    };
  }

  return {
    artist: meta.artist,
    title: meta.title,
    year: meta.year,
    coverArtUrl: meta.coverArtUrl,
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

  // Spotify — resolve the album to a registrable MB/Discogs candidate
  // via the API + re-search. Falls through to the OG scrape below when
  // the API is unavailable (no creds / cooldown) so the previous
  // artist+title-only behaviour still works.
  if (/(^|\.)spotify\.com$/i.test(url.hostname)) {
    const result = await extractFromSpotifyUrl(url);
    if (result) return result;
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
