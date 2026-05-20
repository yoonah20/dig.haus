import axios from 'axios';
import { memoAsync } from '../utils/memoCache.js';

// Tavily Search API — AI-focused search aggregator. Free tier is
// 1000 credits/month with no card required; basic searches cost 1
// credit each, advanced 2. Tavily's index blends Google + Bing +
// its own crawl, so the SERP variance issue Serper hit (KR-Google
// rank ≠ Serper response even with gl: kr + location: Seoul) shows
// up in a different shape here — sometimes better, sometimes
// worse depending on the album. Worth A/B'ing against Serper while
// the dig.haus operator is on the bridge Serper credits.
//
// Endpoint takes a single `query` string and returns up to 20
// results in one call (no pagination), so unlike Serper/Brave/CSE
// the `pages` param maps to max_results here (pages=1 → 10
// results, pages=2 → 20 results). That also means 1 credit per
// album discovery, vs 2 credits for Serper at the current pages=2
// default — at the operator's ~600 album/month pace, free tier
// covers full advanced coverage comfortably.

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

function getApiKey(): string | null {
  return process.env.TAVILY_API_KEY ?? null;
}

async function _searchReviewUrls(
  artist: string,
  album: string,
  pages = 2
): Promise<SearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[tavily] TAVILY_API_KEY not set — discovery disabled');
    return [];
  }
  // Translate Serper-style page count to Tavily's max_results so
  // the discover route can call all three engines with the same
  // signature without engine-specific knowledge of result counts.
  const maxResults = Math.min(20, Math.max(5, pages * 10));
  const q = `${artist} ${album} album review`;
  try {
    const resp = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query: q,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );
    const results = Array.isArray(resp.data?.results) ? resp.data.results : [];
    return results
      .map((r: any): SearchResult => ({
        url: typeof r?.url === 'string' ? r.url : '',
        title: typeof r?.title === 'string' ? r.title : '',
        // Tavily returns the snippet under `content`. Strips any HTML
        // (rare but seen on aggregator-style result types) so the
        // picker LLM gets clean prose.
        snippet:
          typeof r?.content === 'string'
            ? r.content.replace(/<[^>]+>/g, '')
            : '',
      }))
      .filter((r: SearchResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error(
      '[tavily] search failed:',
      (err as Error).message,
      `q=${q}`
    );
    return [];
  }
}

// Cache for 10 minutes per (artist, album) — same window the other
// discovery services use so swapping engines doesn't change
// caching shape. Admin re-clicks on the same album within the
// window reuse the prior fetch.
export const searchReviewUrls = memoAsync(
  'tavily-search',
  _searchReviewUrls,
  10 * 60 * 1000
);
