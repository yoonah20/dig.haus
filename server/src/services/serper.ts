import axios from 'axios';
import { memoAsync } from '../utils/memoCache.js';

// Serper.dev — lightweight Google SERP proxy. Free tier 2.5k one-
// time credits (not monthly), then $50/mo for 50k. We hit the
// /search endpoint with the raw query; the response's `organic`
// array is the normal 10 blue-link search results. Used by the
// review-URL discovery flow: admin clicks 🔎 자동 검색, we Google
// the album and Haiku picks editorial candidates downstream.
//
// Active again as of 2026-05-18 short-term while Google Custom
// Search Engine is being set up. Operator is rotating in a second
// Serper account's free credits to bridge the gap. Long-term path
// is services/googleCse.ts once GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID
// are configured — at that point swap the imports in routes/
// albumReviews.ts + services/autoCuration.ts to './googleCse.js'.
// services/braveSearch.ts is the other revert target kept dormant.

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
  // No explicit gl/hl/location — Serper's own defaults (gl: us,
  // hl: en) consistently surfaced more editorial review URLs than
  // the gl: kr + location: Seoul tuning we ran for a few days. The
  // hypothesis was that KR-locale would match what the operator
  // sees in their own browser, but in practice the operator-noted
  // recall dropped on the catalog as a whole — KR-localized SERP
  // buries English editorial blogs that don't have strong KR-side
  // signals. Reverted 2026-05-22 after operator review. Knobs kept
  // env-overridable in case a future experiment wants to tune
  // either direction without a redeploy.
  const gl = process.env.SERPER_GL;
  const hl = process.env.SERPER_HL;
  const location = process.env.SERPER_LOCATION;
  const params: Record<string, unknown> = { q, num: 10, page };
  if (gl) params.gl = gl;
  if (hl) params.hl = hl;
  if (location) params.location = location;
  try {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      params,
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

async function _searchReviewUrls(
  artist: string,
  album: string,
  pages = 2
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
  // gbhbl, metalreviews). Page 4+ is mostly Google barrel-bottom.
  // The zero-new early-stop below handles less-popular albums
  // gracefully: if page 2 brings no fresh URLs, we don't waste page 3.
  //
  // Default trimmed to 2 pages (2026-05-18, operator iter) while
  // running on a bridge Serper account's one-time 2.5k free credits.
  // Each page = 1 credit, so 2 pages/album = ~1250 albums of head-
  // room vs ~833 at the original pages=3. Keeps the page-2 mid-tier
  // editorial blogs (atthebarrier, louderthanwar, markusheavymusic-
  // blog) — dig.haus's bread-and-butter source band — and drops only
  // the page-3 indie-zine layer, which admin can still cover by
  // pasting URLs manually for any album that needs deeper sourcing.
  // Bump back to 3 once services/googleCse.ts is live (100/day free,
  // no per-call cost) — callers pass pages explicitly if they want
  // different.
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

// Cache SERP results for 10 minutes per (artist, album). Real use
// case is admin re-clicking 🔎 자동 검색 on the same album within
// a session, or auto-curation retrying after a transient failure —
// Google's organic results don't meaningfully move minute-to-minute,
// so a short window saves Serper quota without hiding fresh index
// additions.
export const searchReviewUrls = memoAsync(
  'serper-search',
  _searchReviewUrls,
  10 * 60 * 1000
);
