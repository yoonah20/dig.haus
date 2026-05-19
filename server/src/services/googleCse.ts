import axios from 'axios';
import { memoAsync } from '../utils/memoCache.js';

// Google Custom Search JSON API — uses a Programmable Search Engine
// (CSE) configured to "Search the entire web". Free tier is a real
// 100 queries/day, no card required, no monthly credit accounting
// to bookkeep. At dig.haus's steady-state volume (~7 albums/day × 3
// pages each ≈ 21 queries/day) we use roughly 20% of the daily
// ceiling, with the album-level memoAsync cache further damping
// admin re-clicks within a 10-minute window.
//
// DORMANT: this file ships ready to use but isn't imported by any
// call site as of 2026-05-18. To activate, set GOOGLE_CSE_API_KEY +
// GOOGLE_CSE_ID and swap the import in routes/albumReviews.ts +
// services/autoCuration.ts from './serper.js' to './googleCse.js'.
// Functional shape (searchReviewUrls signature, SearchResult shape)
// matches the active Serper service so the swap is contained to
// those two import lines.
//
// Setup (one-time, on the operator side):
//   1. https://programmablesearchengine.google.com → create engine,
//      enable "Search the entire web", grab the cx (search engine
//      ID).
//   2. https://console.cloud.google.com → APIs & Services → enable
//      "Custom Search API" on a billing-free project, create an
//      API key restricted to that API.
//   3. Export GOOGLE_CSE_API_KEY=<key> + GOOGLE_CSE_ID=<cx>.

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

function getCredentials(): { key: string; cx: string } | null {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;
  return { key, cx };
}

async function runGoogleCsePage(
  creds: { key: string; cx: string },
  q: string,
  start: number
): Promise<SearchResult[]> {
  try {
    const resp = await axios.get(
      'https://www.googleapis.com/customsearch/v1',
      {
        params: { key: creds.key, cx: creds.cx, q, num: 10, start },
        timeout: 10000,
      }
    );
    const items = Array.isArray(resp.data?.items) ? resp.data.items : [];
    return items
      .map((r: any): SearchResult => ({
        url: typeof r?.link === 'string' ? r.link : '',
        title: typeof r?.title === 'string' ? r.title : '',
        snippet: typeof r?.snippet === 'string' ? r.snippet : '',
      }))
      .filter((r: SearchResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error(
      '[googleCse] page query failed:',
      (err as Error).message,
      `q=${q} start=${start}`
    );
    return [];
  }
}

async function _searchReviewUrls(
  artist: string,
  album: string,
  pages = 3
): Promise<SearchResult[]> {
  const creds = getCredentials();
  if (!creds) {
    console.warn(
      '[googleCse] GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID not set — discovery disabled'
    );
    return [];
  }
  // Google CSE pages by 1-indexed item offset: start=1 → results
  // 1-10, start=11 → 11-20, start=21 → 21-30. Same 3-page cap the
  // other discovery services use (page 1 majors + Reddit, pages
  // 2-3 mid-tier editorial blogs and indie zines, pages 4+ trail
  // off into duplicates). Zero-new early-stop here handles less-
  // popular albums by saving the rest of the daily 100-query
  // budget for other albums.
  const q = `${artist} ${album} album review`;
  const seen = new Set<string>();
  const all: SearchResult[] = [];
  for (let i = 0; i < pages; i++) {
    const start = i * 10 + 1;
    const results = await runGoogleCsePage(creds, q, start);
    if (results.length === 0) break;
    let added = 0;
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      all.push(r);
      added++;
    }
    if (added === 0) break;
  }
  return all;
}

// Cache results for 10 minutes per (artist, album) — same window
// the other discovery services use. Admin re-clicks on the same
// album within a session or auto-curation retrying after a tran-
// sient failure reuse the prior fetch without burning fresh budget.
export const searchReviewUrls = memoAsync(
  'google-cse-search',
  _searchReviewUrls,
  10 * 60 * 1000
);
