import axios from 'axios';
import { memoAsync } from '../utils/memoCache.js';

// Jina Search (s.jina.ai) — discovery engine sharing the searchReviewUrls
// signature with serper / tavilySearch. The draw is vendor consolidation:
// we already depend on r.jina.ai for page fetching, and s.jina.ai runs on
// the SAME account API key (JINA_API_KEY), one token bucket across all
// Jina endpoints — no separate key or account needed.
//
// Cost: we send `X-Respond-With: no-content`, which drops the rendered
// page bodies and returns just url/title/description per hit — a few
// hundred tokens per query, effectively free at our ~600 albums/month.
// (Without that header Jina renders every result page, which is both
// slow and token-expensive — never do a discovery call in full mode.)
//
// Under evaluation: unlike Serper, Jina doesn't document an hl/gl locale
// passthrough, so KR / niche recall vs Serper still has to be judged on
// real albums (see server/scripts/jina-search-probe.ts). Wired in as a
// selectable engine so that comparison can happen in the live admin UI;
// promote to default (or drop) once the recall question is settled.
//
// s.jina.ai search needs the key — unlike the anonymous r.jina.ai reader,
// the keyless search endpoint returns 403.

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

function getApiKey(): string | null {
  return process.env.JINA_API_KEY ?? null;
}

async function _searchReviewUrls(
  artist: string,
  album: string
): Promise<SearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[jinaSearch] JINA_API_KEY not set — discovery disabled');
    return [];
  }
  const q = `${artist} ${album} album review`;
  try {
    const resp = await axios.get('https://s.jina.ai/', {
      params: { q },
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        // Link-only mode: metadata, no page bodies. The cost lever.
        'X-Respond-With': 'no-content',
      },
      timeout: 30000,
    });
    // Response shape: { code, status, data: [ { title, url, description } ] }
    const data = Array.isArray(resp.data?.data) ? resp.data.data : [];
    return data
      .map((r: any): SearchResult => ({
        url: typeof r?.url === 'string' ? r.url : '',
        title: typeof r?.title === 'string' ? r.title : '',
        // Jina returns the snippet under `description`. Strip stray HTML
        // so the picker LLM sees clean prose (matches tavily/brave shape).
        snippet:
          typeof r?.description === 'string'
            ? r.description.replace(/<[^>]+>/g, '')
            : '',
      }))
      .filter((r: SearchResult) => r.url && /^https?:\/\//i.test(r.url));
  } catch (err) {
    console.error('[jinaSearch] search failed:', (err as Error).message, `q=${q}`);
    return [];
  }
}

// Cache 10 minutes per (artist, album) — same window the other discovery
// engines use so swapping between them doesn't change the caching shape.
export const searchReviewUrls = memoAsync(
  'jina-search',
  _searchReviewUrls,
  10 * 60 * 1000
);
