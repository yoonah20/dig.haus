import axios from 'axios';

// Serper.dev — lightweight Google SERP proxy. Free tier 2.5k/mo,
// then $50/mo for 50k. We hit the /search endpoint with the raw
// query; the response's `organic` array is the normal 10 blue-link
// search results. Used by the review-URL discovery flow: admin
// clicks 🔎 자동 검색, we Google the album and Haiku picks
// editorial candidates downstream.

export interface SerperResult {
  url: string;
  title: string;
  snippet: string;
}

function getApiKey(): string | null {
  return process.env.SERPER_API_KEY ?? null;
}

async function runSerperQuery(
  apiKey: string,
  q: string,
  limit: number
): Promise<SerperResult[]> {
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
    console.error('[serper] query failed:', (err as Error).message, `q=${q}`);
    return [];
  }
}

export async function searchReviewUrls(
  artist: string,
  album: string,
  limit = 40
): Promise<SerperResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[serper] SERPER_API_KEY not set — discovery disabled');
    return [];
  }
  // Two-tier strategy: quote only the ALBUM so Google has to see the
  // exact title (the real disambiguation signal), but leave the artist
  // unquoted so accented / alternately-romanized names (Dödsrit /
  // Dodsrit / DÖDSRIT) still match loosely. Haiku does the final
  // album-match check downstream.
  //
  // Query includes the phrase "album review" (rather than just
  // "review") to push editorial pages up and demote shops/streaming/
  // lyrics pages that only match the bare "review" token. num=40
  // covers ~4 Google result pages in a single Serper call, which is
  // enough to catch major review sites (Angry Metal Guy, Blabbermouth,
  // Metal Hammer, Pitchfork, etc.) without needing per-site
  // whitelist queries.
  //
  // Fallback when the primary returns 0: drop quotes entirely. Some
  // album titles are short generic phrases ("Home", "Love") that
  // Google indexes weirdly even for exact-match, and getting SOME
  // results that Haiku can sift through beats getting zero. The
  // fallback only runs on empty primary, so Serper usage stays close
  // to 1 query/discovery in the common case.
  const primary = await runSerperQuery(
    apiKey,
    `"${album}" ${artist} album review`,
    limit
  );
  if (primary.length > 0) return primary;

  console.log(
    `[serper] primary (quoted album) returned 0 for "${artist}" / "${album}" — retrying unquoted`
  );
  return runSerperQuery(apiKey, `${artist} ${album} album review`, limit);
}
