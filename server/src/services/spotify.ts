import axios from 'axios';
import https from 'https';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const httpsAgent = new https.Agent({ family: 4 });

let accessToken: string | null = null;
let tokenExpiry = 0;

// Reset the cached token. Call from a request's 401 path so the next
// request fetches a fresh one — otherwise an externally-revoked token
// silently fails every call until natural expiry (up to ~1h).
function invalidateToken() {
  accessToken = null;
  tokenExpiry = 0;
}

async function getToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID || '';
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) return null;

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      SPOTIFY_TOKEN_URL,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        httpsAgent,
      }
    );

    accessToken = res.data.access_token;
    // Expire 60 seconds early to be safe
    tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return accessToken;
  } catch (err) {
    console.warn('[spotify] token fetch failed:', (err as Error).message);
    return null;
  }
}

export interface SpotifyLabelAlbum {
  spotifyAlbumId: string;
  artistName: string;
  albumName: string;
  releaseDate: string; // YYYY-MM-DD or YYYY-MM or YYYY per Spotify's release_date_precision
  coverArtUrl: string | null;
  spotifyUrl: string | null;
  albumType: string; // 'album' | 'single' | 'compilation'
  totalTracks: number;
}

export type LabelSearchMode = 'new' | 'recent';

/**
 * Search Spotify for albums released on a specific label.
 *
 * mode='new' — `label:"X" tag:new` uses Spotify's ~14-day new-releases
 * tag. Tight window, ideal for the daily cron. Returns 0 results if
 * the label hasn't dropped anything recently.
 *
 * mode='recent' — `label:"X" year:${last}-${this}` spans the last two
 * calendar years. Much wider net, used for the initial poll right
 * after an admin adds a label (so the feed isn't empty on labels
 * that release infrequently) and for the manual refresh button. The
 * caller is expected to apply a date filter downstream if it only
 * wants truly recent items.
 *
 * limit caps at 50 per Spotify's search API.
 */
async function runLabelQuery(
  token: string,
  q: string,
  limit: number
): Promise<SpotifyLabelAlbum[]> {
  const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
    headers: { Authorization: `Bearer ${token}` },
    httpsAgent,
    params: { q, type: 'album', limit: String(Math.min(limit, 50)) },
  });
  const items = res.data?.albums?.items || [];
  return items.map((item: any): SpotifyLabelAlbum => {
    const images = item.images || [];
    const coverArtUrl =
      images.find((i: any) => i.width === 640)?.url ||
      images.find((i: any) => i.width === 300)?.url ||
      images[0]?.url ||
      null;
    const artistName =
      Array.isArray(item.artists) && item.artists.length > 0
        ? item.artists.map((a: any) => a.name).filter(Boolean).join(', ')
        : '';
    return {
      spotifyAlbumId: String(item.id || ''),
      artistName,
      albumName: String(item.name || ''),
      releaseDate: String(item.release_date || ''),
      coverArtUrl,
      spotifyUrl: item.external_urls?.spotify || null,
      albumType: String(item.album_type || ''),
      totalTracks: Number(item.total_tracks) || 0,
    };
  }).filter((a: SpotifyLabelAlbum) => a.spotifyAlbumId && a.artistName && a.albumName);
}

export async function searchAlbumsByLabel(
  labelName: string,
  limit = 50,
  mode: LabelSearchMode = 'new'
): Promise<SpotifyLabelAlbum[]> {
  try {
    const token = await getToken();
    if (!token) return [];

    // Primary query — tightest scope for each mode. tag:new on the
    // daily cron, year-range for manual/initial refresh.
    let primaryQuery: string;
    if (mode === 'recent') {
      const thisYear = new Date().getUTCFullYear();
      primaryQuery = `label:"${labelName}" year:${thisYear - 1}-${thisYear}`;
    } else {
      primaryQuery = `label:"${labelName}" tag:new`;
    }

    let results = await runLabelQuery(token, primaryQuery, limit);

    // Fallback — drop the scope filter (year/tag:new) and just ask
    // Spotify for everything on this label. Catches cases where the
    // label is real but the release_date_precision on the filter
    // doesn't align with Spotify's internal index (we've seen
    // year:2025-2026 return 0 even when the label has recent
    // releases — Spotify's year filter is fussy).
    if (results.length === 0) {
      console.log(
        `[spotify] ${mode} primary returned 0 for "${labelName}" — retrying without scope filter`
      );
      results = await runLabelQuery(token, `label:"${labelName}"`, limit);
    }

    const beforeFilter = results.length;

    // Always drop singles. Major labels release a LOT of them (pre-
    // release teasers, feature tracks) and they flood the feed
    // without meaningfully expanding album coverage. Compilations
    // stay — they're often legit retrospective releases from
    // heritage labels.
    results = results.filter((a) => a.albumType !== 'single');

    // Date window applies in both modes now — preview + poll + cron
    // all see the same set. 30 days matches the "최근 신보"
    // intuition; future release_date values (pre-release) always
    // pass so upcoming albums are still surfaced.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    results = results.filter((a) => {
      if (!a.releaseDate) return false;
      const parsed = Date.parse(a.releaseDate);
      if (!Number.isFinite(parsed)) return false;
      if (parsed > Date.now()) return true;
      return parsed >= cutoff;
    });

    console.log(
      `[spotify] "${labelName}" ${mode}: ${beforeFilter} raw → ${results.length} after single+30d filter`
    );

    return results;
  } catch (err: any) {
    if (err?.response?.status === 401) invalidateToken();
    console.warn(`[spotify] searchAlbumsByLabel failed for "${labelName}":`, (err as Error).message);
    return [];
  }
}

// Pick a 30-second preview for a given album — used by the mydig
// hover-play chip. Strategy is "first track with a non-null
// preview_url" because most Spotify albums front-load the lead
// track, and paying for popularity-weighted scoring (N+1 track
// lookups per album × 15 albums per wall) wasn't worth the
// bandwidth. When no track in the album carries a preview_url —
// common on recent Korean releases — we return null, and the
// caller's DB row records the lookup so we don't re-try.
//
// `albumIdOrUrl` can be a bare Spotify album id (22 chars) or a
// full open.spotify.com URL; we normalise either to the id.
export async function fetchAlbumPreview(
  albumIdOrUrl: string
): Promise<{ previewUrl: string; trackName: string } | null> {
  try {
    const token = await getToken();
    if (!token) {
      console.warn(
        '[spotify] fetchAlbumPreview skipped — no token (check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)'
      );
      return null;
    }
    const id = extractSpotifyAlbumId(albumIdOrUrl);
    if (!id) {
      console.warn(
        `[spotify] fetchAlbumPreview unparseable input: ${albumIdOrUrl}`
      );
      return null;
    }
    const res = await axios.get(`${SPOTIFY_API_BASE}/albums/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      // market=KR nudges Spotify into returning preview_url values
      // for the user's regional catalogue. Without it, previews
      // come back null for albums that ARE available in-region,
      // purely because the endpoint defaults to US and treats the
      // album as unavailable in that market.
      params: { market: 'KR' },
    });
    const tracks = res.data?.tracks?.items as Array<any> | undefined;
    if (!Array.isArray(tracks)) return null;
    for (const t of tracks) {
      if (typeof t?.preview_url === 'string' && t.preview_url.length > 0) {
        return {
          previewUrl: t.preview_url,
          trackName: String(t.name ?? '').slice(0, 120),
        };
      }
    }
    return null;
  } catch (err: any) {
    if (err?.response?.status === 401) invalidateToken();
    console.warn(
      '[spotify] fetchAlbumPreview failed:',
      (err as Error).message
    );
    return null;
  }
}

// Sibling of fetchAlbumPreview — pulls the album cover URL from
// the same /albums/{id} payload. Used as the fallback when the
// stored cover_art_url (usually Cover Art Archive) 404s, which
// happens often on older MusicBrainz releases whose art archive
// entries got deleted or re-sized without updating the DB.
export async function fetchSpotifyAlbumCover(
  albumIdOrUrl: string
): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const id = extractSpotifyAlbumId(albumIdOrUrl);
    if (!id) return null;
    const res = await axios.get(`${SPOTIFY_API_BASE}/albums/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
    });
    const images = res.data?.images as Array<any> | undefined;
    if (!Array.isArray(images) || images.length === 0) return null;
    // Largest first (Spotify typically returns 640 / 300 / 64).
    // 640 is plenty for a 32×32 dominant-colour resize; no point
    // fetching the 64 thumbnail and risking blocky colour data.
    return (
      images.find((i: any) => i.width === 640)?.url ||
      images.find((i: any) => i.width === 300)?.url ||
      images[0]?.url ||
      null
    );
  } catch (err: any) {
    if (err?.response?.status === 401) invalidateToken();
    console.warn(
      '[spotify] fetchSpotifyAlbumCover failed:',
      (err as Error).message
    );
    return null;
  }
}

function extractSpotifyAlbumId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Bare id — 22 base62 characters.
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  // Match open.spotify.com/album/<id>[?si=...]
  const match = trimmed.match(/open\.spotify\.com\/album\/([A-Za-z0-9]{22})/);
  if (match) return match[1];
  return null;
}

// Module-level cooldown timestamp set when Spotify returns 429.
// Every album-search call below early-returns null while
// Date.now() < spotifyRateLimitedUntil, so a single 429 shuts down
// the *entire* fallback chain for the duration of the Retry-After
// window instead of burning quota on three more queries that are
// guaranteed to 429 too. Spotify's 30-day rolling burst protection
// can return Retry-After values measured in hours; without this
// gate, every album register during the cooldown would hit four
// 429s and extend the rolling-window strike count.
let spotifyRateLimitedUntil = 0;

export function isSpotifyRateLimited(): boolean {
  return Date.now() < spotifyRateLimitedUntil;
}

export function spotifyRateLimitRemainingMs(): number {
  return Math.max(0, spotifyRateLimitedUntil - Date.now());
}

// Single-shot album search against the Spotify /search endpoint.
// Returns the first hit's url + cover image; null when the response
// has no albums.items, when we're inside an active 429 cooldown, or
// when the request itself errors. Pulled out as a helper so
// searchTrack below can try several query shapes in sequence
// without duplicating the fetch + parse + 429-handling boilerplate.
async function trySpotifyAlbumSearch(
  token: string,
  q: string
): Promise<{ url: string | null; imageUrl: string | null } | null> {
  if (isSpotifyRateLimited()) return null;
  try {
    const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      params: { q, type: 'album', limit: '1' },
    });
    const albums = res.data?.albums?.items || [];
    if (albums.length === 0) return null;
    const item = albums[0];
    // Prefer the 640px variant (Spotify commonly returns 640/300/64)
    // so the downstream cover resize to 600px doesn't upscale a
    // smaller source.
    const images = item.images || [];
    const imageUrl =
      images.find((i: any) => i.width === 640)?.url ||
      images.find((i: any) => i.width === 300)?.url ||
      images[0]?.url ||
      null;
    return {
      url: item.external_urls?.spotify || null,
      imageUrl,
    };
  } catch (err: any) {
    if (err.response?.status === 429) {
      // Honour the Retry-After header — Spotify returns it in
      // seconds. Default to 60s if missing (the spec doesn't
      // require it, but the API in practice always sets it).
      const retryAfterRaw = err.response.headers?.['retry-after'];
      const retryAfterSec =
        typeof retryAfterRaw === 'string'
          ? Number.parseInt(retryAfterRaw, 10)
          : 60;
      const wait = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec
        : 60;
      spotifyRateLimitedUntil = Date.now() + wait * 1000;
      console.warn(
        `[spotify] 429 — cooldown ${wait}s (until ${new Date(spotifyRateLimitedUntil).toISOString()}). All Spotify search calls suspended until then.`
      );
    } else if (err.response?.status === 401) {
      invalidateToken();
      console.warn(
        `[spotify] 401 on search q="${q}" — cached token invalidated`
      );
    } else {
      console.warn(
        `[spotify] album search failed for q="${q}":`,
        (err as Error).message
      );
    }
    return null;
  }
}

export async function searchTrack(
  artist: string,
  album: string
): Promise<{ url: string | null; imageUrl: string | null }> {
  const token = await getToken();
  if (!token) return { url: null, imageUrl: null };

  // Sequential query strategy — first hit wins. Each step
  // progressively loosens the constraint so we catch the cases
  // where MB metadata and Spotify metadata don't align exactly.
  // The motivating example was "Hawthorne Heights — If Only You
  // Were Lonely", which exists on Spotify but the previous
  // unquoted `artist:Hawthorne Heights` query parsed only
  // "Hawthorne" as the artist field and silently returned 0.
  const queries: string[] = [];

  // 1. Structured query with QUOTED multi-word values. Without the
  //    quotes Spotify's parser consumes only the first whitespace-
  //    separated token as the field value, then treats the rest as
  //    free text — which is why exact-match queries on multi-word
  //    artists / albums were failing en masse.
  queries.push(`artist:"${artist}" album:"${album}"`);

  // 2. Drop comma- or ampersand-joined collab co-credits. MB returns
  //    "Artist A, Artist B, Artist C" / "Artist A & Artist B" for
  //    multi-artist releases; Spotify typically lists the album
  //    under the primary artist only, so the structured artist:
  //    filter on the joined string returns 0.
  const primaryArtist =
    artist.split(/\s*[,&]\s*/)[0]?.trim() || artist;
  if (primaryArtist && primaryArtist !== artist) {
    queries.push(`artist:"${primaryArtist}" album:"${album}"`);
  }

  // 3. Strip parenthetical / bracket subtitle from album title.
  //    MB tends to keep "(Deluxe Edition)" / "(Remastered 2024)" /
  //    "[Special Version]" suffixes that Spotify drops on its
  //    standard-edition entry.
  const cleanAlbum = album
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    .trim();
  if (cleanAlbum && cleanAlbum !== album) {
    queries.push(`artist:"${primaryArtist}" album:"${cleanAlbum}"`);
  }

  // 4. Last-ditch free-text query — Spotify's natural-language
  //    relevance ranker can succeed where the structured filter
  //    fails (UTF-8 normalisation differences, hyphenation
  //    mismatches, "The X" vs "X" prefix drift, etc.). The first
  //    result is typically the right album when both terms are
  //    present and unique.
  queries.push(`${primaryArtist} ${cleanAlbum || album}`);

  for (const q of queries) {
    const result = await trySpotifyAlbumSearch(token, q);
    if (result?.url) return result;
  }

  return { url: null, imageUrl: null };
}
