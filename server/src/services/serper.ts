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

async function runSerperPage(
  apiKey: string,
  q: string,
  page: number
): Promise<SerperResult[]> {
  try {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      { q, num: 10, page },
      {
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const organic = Array.isArray(resp.data?.organic) ? resp.data.organic : [];
    return organic
      .map((r: any): SerperResult => ({
        url: typeof r?.link === 'string' ? r.link : '',
        title: typeof r?.title === 'string' ? r.title : '',
        snippet: typeof r?.snippet === 'string' ? r.snippet : '',
      }))
      .filter((r: SerperResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error(
      '[serper] page query failed:',
      (err as Error).message,
      `q=${q} page=${page}`
    );
    return [];
  }
}

export async function searchReviewUrls(
  artist: string,
  album: string,
  pages = 3
): Promise<SerperResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[serper] SERPER_API_KEY not set — discovery disabled');
    return [];
  }
  // Serper's `num` parameter doesn't actually paginate — num=40 and
  // num=10 both return the same page-1 set of ~10 organic results.
  // Real pagination needs explicit `page=1..N` and deduping across
  // pages. Page 1 is majors + Reddit + YouTube, page 2 is mid-tier
  // editorial blogs (atthebarrier, louderthanwar, markusheavymusicblog),
  // page 3 is indie zines (avenoctum, ever-metal, distortedsoundmag,
  // gbhbl, metalreviews). Page 4 is mostly Google barrel-bottom —
  // other-album hits, roundup mentions, duplicates — so we cap at 3.
  // The zero-new early-stop below handles less-popular albums
  // gracefully: if page 2 brings no fresh URLs, we don't waste page 3.
  //
  // The earlier "quoted album" two-tier strategy was dropped: Serper
  // rejects quoted queries combined with num>=40 ("Query not allowed.
  // Contact support.", HTTP 400), and at num=10 quoted vs unquoted
  // returned the same page-1 set anyway, so the extra complexity
  // bought nothing. Haiku does the album-match check downstream.
  const q = `${artist} ${album} album review`;
  const seen = new Set<string>();
  const all: SerperResult[] = [];
  for (let page = 1; page <= pages; page++) {
    const results = await runSerperPage(apiKey, q, page);
    if (results.length === 0) break;
    let added = 0;
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      all.push(r);
      added++;
    }
    // If a page brings nothing new, the organic index has stopped
    // producing fresh URLs — stop paginating to save the remaining
    // Serper calls. Real "tail" pages tend to repeat page 3 results
    // verbatim, so zero-new is a reliable stop signal.
    if (added === 0) break;
  }
  return all;
}
