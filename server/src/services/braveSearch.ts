import axios from 'axios';
import { memoAsync } from '../utils/memoCache.js';

// Brave Search Web API — independent search index, generous free
// tier (2k queries/month, no card required), $3 per 1k after.
// Replaced Serper.dev 2026-05-18 after that account's quota ran
// out; functional shape (issue a query, get back ~10 organic-style
// blue-link URLs we can hand to the editorial picker LLM) is the
// same, so the swap is contained to this file plus its callers.
//
// We hit /res/v1/web/search and read `web.results`. Brave doesn't
// ship a 1:1 "organic" key like Google SERP scrapers do — the web
// results array IS the editorial result list, with sponsored/news
// segregated into their own keys we don't look at.

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

function getApiKey(): string | null {
  return process.env.BRAVE_SEARCH_API_KEY ?? null;
}

async function runBravePage(
  apiKey: string,
  q: string,
  offset: number
): Promise<SearchResult[]> {
  try {
    const resp = await axios.get(
      'https://api.search.brave.com/res/v1/web/search',
      {
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
        params: { q, count: 10, offset },
        timeout: 10000,
      }
    );
    const results = Array.isArray(resp.data?.web?.results)
      ? resp.data.web.results
      : [];
    return results
      .map((r: any): SearchResult => ({
        url: typeof r?.url === 'string' ? r.url : '',
        title: typeof r?.title === 'string' ? r.title : '',
        // Brave returns the snippet under `description`. Some result
        // types ship HTML in this field (bold tags around matched
        // terms); the picker LLM tolerates them, but a quick strip
        // keeps log lines readable.
        snippet:
          typeof r?.description === 'string'
            ? r.description.replace(/<[^>]+>/g, '')
            : '',
      }))
      .filter((r: SearchResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error(
      '[braveSearch] page query failed:',
      (err as Error).message,
      `q=${q} offset=${offset}`
    );
    return [];
  }
}

async function _searchReviewUrls(
  artist: string,
  album: string,
  pages = 3
): Promise<SearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn(
      '[braveSearch] BRAVE_SEARCH_API_KEY not set — discovery disabled'
    );
    return [];
  }
  // Brave's `offset` parameter is page-style (0, 1, 2 ...) when
  // count<=20, so each iteration here pulls the next 10 results.
  // Same 3-page cap the Serper version used: page 1 is majors +
  // Reddit + YouTube, page 2-3 are mid-tier editorial blogs and
  // indie zines. Pages 4+ tend toward duplicates and roundup
  // mentions, so the zero-new early-stop below handles less-popular
  // albums gracefully without burning the rest of the budget.
  //
  // Free tier is 1 query/second — the sequential await loop is
  // already under that ceiling without an explicit sleep.
  const q = `${artist} ${album} album review`;
  const seen = new Set<string>();
  const all: SearchResult[] = [];
  for (let offset = 0; offset < pages; offset++) {
    const results = await runBravePage(apiKey, q, offset);
    if (results.length === 0) break;
    let added = 0;
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      all.push(r);
      added++;
    }
    // If a page brings nothing new, the index has stopped producing
    // fresh URLs — stop paginating to save the remaining calls.
    if (added === 0) break;
  }
  return all;
}

// Cache results for 10 minutes per (artist, album). Real use case
// is admin re-clicking 🔎 자동 검색 on the same album within a
// session, or auto-curation retrying after a transient failure —
// search index doesn't meaningfully move minute-to-minute, so a
// short window saves quota without hiding fresh index additions.
export const searchReviewUrls = memoAsync(
  'brave-search',
  _searchReviewUrls,
  10 * 60 * 1000
);
