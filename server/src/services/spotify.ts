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

/**
 * Search Spotify for recent albums released on a specific label. Uses the
 * `label:"X" tag:new` combo which Spotify's search docs expose for
 * discovering newly-released content (~last 2 weeks). Returns whatever
 * Spotify gives us unfiltered — caller applies further filtering
 * (album_type, dedup, etc.).
 *
 * limit caps at 50 per Spotify's search API; the label-feed poller keeps
 * it at 50 so infrequent albums on small labels still get picked up.
 */
export async function searchAlbumsByLabel(
  labelName: string,
  limit = 50
): Promise<SpotifyLabelAlbum[]> {
  try {
    const token = await getToken();
    if (!token) return [];

    const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      params: {
        // `label:"X"` expects exact-ish match; `tag:new` scopes to
        // Spotify's "new releases" window (~14 days). Both combine via
        // a single q param.
        q: `label:"${labelName}" tag:new`,
        type: 'album',
        limit: String(Math.min(limit, 50)),
      },
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
