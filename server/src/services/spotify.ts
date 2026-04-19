import axios from 'axios';
import https from 'https';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const httpsAgent = new https.Agent({ family: 4 });

let accessToken: string | null = null;
let tokenExpiry = 0;

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

    const primary = await runLabelQuery(token, primaryQuery, limit);
    if (primary.length > 0) return primary;

    // Fallback — drop the scope filter (year/tag:new) and just ask
    // Spotify for everything on this label. Catches cases where the
    // label is real but the release_date_precision on the filter
    // doesn't align with Spotify's internal index (we've seen
    // year:2025-2026 return 0 even when the label has recent
    // releases — Spotify's year filter is fussy). Caller still
    // applies a downstream date filter in recent mode so we don't
    // flood the feed with decade-old catalogue.
    const fallbackQuery = `label:"${labelName}"`;
    console.log(
      `[spotify] ${mode} primary returned 0 for "${labelName}" — retrying without scope filter`
    );
    const fallback = await runLabelQuery(token, fallbackQuery, limit);
    return fallback;
  } catch (err) {
    console.warn(`[spotify] searchAlbumsByLabel failed for "${labelName}":`, (err as Error).message);
    return [];
  }
}

export async function searchTrack(
  artist: string,
  album: string
): Promise<{ url: string | null; imageUrl: string | null }> {
  try {
    const token = await getToken();
    if (!token) return { url: null, imageUrl: null };

    const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      params: {
        q: `artist:${artist} album:${album}`,
        type: 'album',
        limit: '1',
      },
    });

    const albums = res.data?.albums?.items || [];
    if (albums.length === 0) return { url: null, imageUrl: null };

    const item = albums[0];
    // Prefer the largest variant (640px) so downstream resize to 600px doesn't
    // upscale a tiny source. Spotify commonly returns 640/300/64.
    const images = item.images || [];
    const imageUrl = images.find((i: any) => i.width === 640)?.url
      || images.find((i: any) => i.width === 300)?.url
      || images[0]?.url
      || null;

    return {
      url: item.external_urls?.spotify || null,
      imageUrl,
    };
  } catch (err) {
    console.warn(`[spotify] searchTrack failed for "${artist} - ${album}":`, (err as Error).message);
    return { url: null, imageUrl: null };
  }
}
