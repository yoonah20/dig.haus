import axios from 'axios';

// Serper.dev — lightweight Google SERP proxy. Free tier 2.5k/mo,
// then $50/mo for 50k. We hit the /search endpoint with the raw
// query; the response's `organic` array is the normal 10 blue-link
// search results. Used by the review-URL discovery flow: admin
// clicks 🔎 자동 검색, we Google "{artist} {album} review" and pick
// editorial candidates via a cheap Haiku pass downstream.

export interface SerperResult {
  url: string;
  title: string;
  snippet: string;
}

function getApiKey(): string | null {
  return process.env.SERPER_API_KEY ?? null;
}

export async function searchReviewUrls(
  artist: string,
  album: string,
  limit = 20
): Promise<SerperResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[serper] SERPER_API_KEY not set — discovery disabled');
    return [];
  }
  // Quote artist AND album to stop Google from tokenizing them apart —
  // without quotes, "Dödsrit Nocturnal Will review" was returning
  // reviews of other Dödsrit albums because the artist name dominates
  // Google's relevance signal. Quotes force album-title presence.
  const q = `"${artist}" "${album}" review`;
  try {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      { q, num: limit },
      {
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const organic = Array.isArray(resp.data?.organic) ? resp.data.organic : [];
    return organic
      .slice(0, limit)
      .map((r: any): SerperResult => ({
        url: typeof r?.link === 'string' ? r.link : '',
        title: typeof r?.title === 'string' ? r.title : '',
        snippet: typeof r?.snippet === 'string' ? r.snippet : '',
      }))
      .filter((r: SerperResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error('[serper] search failed:', (err as Error).message);
    return [];
  }
}
