import { searchReviewUrls as searchSerper } from './serper.js';
import { searchReviewUrls as searchTavily } from './tavilySearch.js';

// Single source of truth for review-URL discovery engine selection.
// Two engines are live and share the same searchReviewUrls(artist,
// album) signature and {url,title,snippet} result shape, so callers
// dispatch by name without engine-specific knowledge:
//   - Serper   — Google SERP proxy. One-time free credits, then a
//                $50/mo paid floor.
//   - Tavily   — AI-search aggregator. 1000 searches/month recurring
//                free, no card — comfortably covers the ~600 albums/
//                month volume, which is why it's the default.
//
// Brave and Google CSE were removed 2026-07-05. Brave dropped its free
// tier (metered + card required) and never matched Google's KR/niche
// recall. Google's Custom Search JSON API is closed to new customers,
// shuts down 2027-01-01, and no longer offers "search the entire web"
// for new engines — a dead end, not the dormant fallback it was long
// described as.

export interface DiscoveryResult {
  url: string;
  title: string;
  snippet: string;
}

export type DiscoveryEngine = 'serper' | 'tavily';

const ENGINES: Record<
  DiscoveryEngine,
  (artist: string, album: string) => Promise<DiscoveryResult[]>
> = {
  serper: searchSerper,
  tavily: searchTavily,
};

export function isDiscoveryEngine(v: string): v is DiscoveryEngine {
  return v === 'serper' || v === 'tavily';
}

// Default engine, overridable via the DISCOVERY_ENGINE env var. Governs
// the auto-curation batch (the real volume driver) and the admin
// discover route's fallback when no explicit ?engine= is supplied.
// Defaults to Tavily so the free recurring tier carries the batch load
// without the operator having to remember to set the env var; set
// DISCOVERY_ENGINE=serper to flip back without a code change.
export function defaultDiscoveryEngine(): DiscoveryEngine {
  const env = (process.env.DISCOVERY_ENGINE || '').toLowerCase();
  return isDiscoveryEngine(env) ? env : 'tavily';
}

export function searchReviewUrls(
  engine: DiscoveryEngine,
  artist: string,
  album: string
): Promise<DiscoveryResult[]> {
  return ENGINES[engine](artist, album);
}
