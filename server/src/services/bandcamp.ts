import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';

const BANDCAMP_SEARCH_URL = 'https://bandcamp.com/search';
const httpsAgent = new https.Agent({ family: 4 });

let lastRequestTime = 0;

async function rateLimitedGet(url: string, params?: Record<string, string>) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, {
    params,
    httpsAgent,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
}

export async function searchBandcamp(
  artist: string,
  album: string
): Promise<{ url: string; purchaseUrl: string } | null> {
  try {
    const query = `${artist} ${album}`;
    const res = await rateLimitedGet(BANDCAMP_SEARCH_URL, {
      q: query,
      item_type: 'a', // album type
    });

    const $ = cheerio.load(res.data);
    const firstResult = $('.searchresult .itemurl a').first();

    if (firstResult.length === 0) return null;

    const url = firstResult.attr('href') || '';
    if (!url) return null;

    return {
      url,
      purchaseUrl: url,
    };
  } catch (err) {
    console.warn(`[bandcamp] searchBandcamp failed for "${artist} - ${album}":`, (err as Error).message);
    return null;
  }
}
