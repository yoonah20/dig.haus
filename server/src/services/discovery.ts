import { searchReviewUrls as searchSerper } from './serper.js';
import { searchReviewUrls as searchTavily } from './tavilySearch.js';
import { searchReviewUrls as searchJina } from './jinaSearch.js';
import { getSetting } from '../utils/settings.js';

// app_settings key holding the admin-picked default discovery engine.
// Set from /admin/api; absent means "use the code default (tavily)".
export const DISCOVERY_ENGINE_SETTING_KEY = 'discovery_engine';

// Single source of truth for review-URL discovery engine selection.
// The engines share the same searchReviewUrls(artist, album) signature
// and {url,title,snippet} result shape, so callers dispatch by name
// without engine-specific knowledge:
//   - Tavily   — AI-search aggregator. 1000 searches/month recurring
//                free, no card — comfortably covers the ~600 albums/
//                month volume, which is why it's the default.
//   - Serper   — Google SERP proxy. One-time free credits, then a
//                $50/mo paid floor. Kept as the A/B alternative.
//   - Jina     — s.jina.ai, on the same JINA_API_KEY we already use for
//                r.jina.ai page fetching. Under evaluation (KR/niche
//                recall vs Serper unproven); wired in so it can be A/B'd
//                in the live admin UI before any promotion to default.
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

export type DiscoveryEngine = 'serper' | 'tavily' | 'jina';

const ENGINES: Record<
  DiscoveryEngine,
  (artist: string, album: string) => Promise<DiscoveryResult[]>
> = {
  serper: searchSerper,
  tavily: searchTavily,
  jina: searchJina,
};

export function isDiscoveryEngine(v: string): v is DiscoveryEngine {
  return v === 'serper' || v === 'tavily' || v === 'jina';
}

// Default engine, overridable via the DISCOVERY_ENGINE env var. Governs
// the auto-curation batch (the real volume driver) and the admin
// discover route's fallback when no explicit ?engine= is supplied.
// Defaults to Tavily so the free recurring tier carries the batch load
// without the operator having to remember to set the env var; set
// DISCOVERY_ENGINE=serper to flip back without a code change.
export function defaultDiscoveryEngine(): DiscoveryEngine {
  // Precedence mirrors resolvePrimaryModel: env override wins (for
  // debugging), then the admin-picked app_settings value, then the code
  // default. Keeps DISCOVERY_ENGINE working while letting the operator
  // switch the batch/default engine from /admin/api without a redeploy.
  const env = (process.env.DISCOVERY_ENGINE || '').toLowerCase();
  if (isDiscoveryEngine(env)) return env;
  const configured = (getSetting(DISCOVERY_ENGINE_SETTING_KEY) || '').toLowerCase();
  if (isDiscoveryEngine(configured)) return configured;
  return 'tavily';
}

export function searchReviewUrls(
  engine: DiscoveryEngine,
  artist: string,
  album: string
): Promise<DiscoveryResult[]> {
  return ENGINES[engine](artist, album);
}
