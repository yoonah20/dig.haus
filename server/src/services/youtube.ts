import axios from 'axios';
import https from 'https';
import { memoAsync } from '../utils/memoCache.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const httpsAgent = new https.Agent({ family: 4 });

function getApiKey(): string {
  return process.env.YOUTUBE_API_KEY || '';
}

async function _searchVideo(
  artist: string,
  album: string
): Promise<string | null> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    // Try "full album" search first
    const query = `${artist} ${album} full album`;

    const res = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      httpsAgent,
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: '1',
        key: apiKey,
      },
    });

    const items = res.data?.items || [];
    if (items.length > 0) {
      const videoId = items[0].id?.videoId;
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Fallback: try "official" search
    const fallbackRes = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      httpsAgent,
      params: {
        part: 'snippet',
        q: `${artist} ${album} official`,
        type: 'video',
        maxResults: '1',
        key: apiKey,
      },
    });

    const fallbackItems = fallbackRes.data?.items || [];
    if (fallbackItems.length > 0) {
      const videoId = fallbackItems[0].id?.videoId;
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    return null;
  } catch (err) {
    console.warn(`[youtube] searchVideo failed for "${artist} - ${album}":`, (err as Error).message);
    return null;
  }
}

// Cache YouTube lookups for an hour per (artist, album). Album pages
// re-resolve the video embed on every visit and the result rarely
// changes — same search today and tomorrow picks the same top hit.
// TTL is a balance against YouTube's 10k units/day quota.
export const searchVideo = memoAsync('yt-search', _searchVideo, 60 * 60 * 1000);
