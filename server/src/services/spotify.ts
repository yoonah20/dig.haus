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
