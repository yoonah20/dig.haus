import axios from 'axios';
import {
  getClient,
  HAIKU,
  logClaudeUsage,
  normaliseKoreanTerms,
} from './claude.js';
import {
  callDeepSeek,
  isDeepSeekConfigured,
  logDeepSeekUsage,
} from './deepseek.js';
import { execute, queryAll } from '../db/index.js';

// Ask DeepSeek first for a JSON extraction, fall back to Haiku if
// DeepSeek isn't configured, throws, or returns an unparseable body.
// Both paths log into claude_usage_log via their respective loggers
// (keyed by model string) so the admin dashboard can compare cost
// between the two providers. Returns the raw content string — JSON
// parsing + schema validation lives at the call site where the
// expected shape differs per use case.
async function extractJsonWithFallback(
  operation: string,
  prompt: string,
  maxTokens: number
): Promise<string | null> {
  // Primary: DeepSeek. Input-heavy extraction (Jina markdown → JSON)
  // is exactly where DeepSeek's ~73%-cheaper input pricing vs Haiku
  // earns the most, and JSON-mode on a structured schema is well
  // within its capability.
  if (isDeepSeekConfigured()) {
    try {
      const ds = await callDeepSeek(
        [{ role: 'user', content: prompt }],
        { jsonMode: true, maxTokens }
      );
      logDeepSeekUsage(operation, ds);
      return ds.content;
    } catch (err) {
      console.warn(
        `[${operation}] deepseek failed, falling back to Haiku:`,
        (err as Error).message
      );
    }
  }

  // Fallback: Haiku. Identical prompt; the model's own JSON fidelity
  // handles the "Return ONLY JSON" instruction without response_format.
  try {
    const resp = await getClient().messages.create({
      model: HAIKU,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    logClaudeUsage(`${operation}_haiku_fallback`, resp);
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    return block.text;
  } catch (err) {
    console.error(`[${operation}] Haiku fallback also failed:`, (err as Error).message);
    return null;
  }
}

// Append-only log of URL scrapes that didn't yield a review.
// Reason codes are deliberately short and stable so the admin
// aggregate query can GROUP BY them:
//   - bot-blocked: Cloudflare or similar JS-challenge wall (403/503 + challenge body)
//   - fetch-failed: HTTP/network error not identified as a bot wall
//   - text-too-short: page stripped to <100 chars (JS-rendered or empty)
//   - not-a-review: Claude flagged the page as non-review
//   - claude-no-text: Claude returned no text block (rare, usually API blip)
//   - claude-error: Claude call threw
//   - json-parse-failed: couldn't extract JSON from Claude's response
// errorMessage carries the caught exception text when available.

export type ScrapeFailureReason =
  | 'bot-blocked'
  | 'fetch-failed'
  | 'text-too-short'
  // Domain is on the admin blacklist (hardcoded EXCLUDED_URL_DOMAINS
  // or DB source_blacklist). Split out from 'not-a-review' so admin
  // sees "this host is blocked" instead of the misleading "this page
  // isn't a review" message — many blacklist entries are bot-walled
  // sites, not content judgements.
  | 'blacklisted-domain'
  // URL slug matched EXCLUDED_URL_PATH_PATTERNS (interview/roundup/
  // press-release verbs / etc.). Different from 'not-a-review' in the
  // sense that we refused based on the URL shape alone, before fetching.
  | 'excluded-path'
  | 'not-a-review'
  | 'claude-no-text'
  | 'claude-error'
  | 'json-parse-failed';

export type ScrapeOutcome =
  | { kind: 'ok'; review: ReviewResult }
  | { kind: 'fail'; reason: ScrapeFailureReason; message?: string };

// Cloudflare's JS challenge pages. They can come back as 403 or 503
// depending on the "Under Attack" mode level. Sniffing the body for the
// distinctive "Just a moment..." / cf-chl- markers is more reliable
// than status-code alone — Cloudflare sometimes returns 200 with the
// challenge embedded, and unrelated 403s happen for other reasons.
function isCloudflareChallenge(body: string | undefined): boolean {
  if (!body) return false;
  const head = body.slice(0, 2500);
  return /just a moment\.\.\.|cf-browser-verification|cf-chl-|challenges\.cloudflare\.com|__cf_chl_/i.test(
    head
  );
}
function recordScrapeFailure(
  url: string,
  albumMbid: string | null,
  reason: string,
  errorMessage?: string
): void {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    hostname = 'unknown';
  }
  try {
    execute(
      `INSERT INTO scrape_failures (url, hostname, album_mbid, reason, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [url, hostname, albumMbid, reason, errorMessage ? errorMessage.slice(0, 500) : null]
    );
    console.warn(`[scrape-fail] ${hostname} (${reason}) ${url}`);
  } catch (err) {
    // Never let logging itself break the caller — if the DB insert
    // fails (disk full, schema not yet migrated on first boot) just
    // fall back to stderr.
    console.error('[scrape-fail] DB write failed:', (err as Error).message);
  }
}

export interface ReviewResult {
  sourceName: string;
  score: number | null;
  scoreMax: number;
  excerpt: string;
  excerptKo: string;
  fullReviewUrl: string;
}

// All three extraction paths (web search, URL scrape, paste-in) tell
// Claude to convert whatever native scale the source uses to /100.
// But the model occasionally returns something nonsensical — most
// recently a 250/100 after getting confused by a review that mixed
// a star image rating with a dense numeric aside. We clamp on the
// way in so a hallucinated score can never leak into storage or the
// colour-tier math on the client.
function clampScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// Domains to exclude from review URLs. Used both by scrapeReviewFromUrl
// (defensive; admin shouldn't be pasting these) and by the Serper
// discovery pipeline (primary filter on search results). Substring
// match over the hostname — covers amazon.com/.co.jp/.de etc. Exported
// so services/serper.ts can apply the same allowlist definition.
// Structural baseline blacklist — categories that will NEVER carry
// editorial album reviews no matter what admin curates. Kept in code
// (not the DB) because they're platform shapes rather than editorial
// decisions: a shop URL stays a shop URL, a streaming link stays a
// streaming link. The DB-side source_blacklist table layers on top
// for operational additions (aggregators, paywalls, bot-walled sites,
// podcast outlets, user-review communities) — those are trust
// decisions that can be re-evaluated per site and benefit from the
// admin UI's one-click add/remove. See schema.ts's seed migration
// `seed-source-blacklist-from-hardcoded-2026-04-22` for the list of
// entries that moved from here to the DB.
export const EXCLUDED_URL_DOMAINS = [
  // Shops / retailers. Store pages (buy button, tracklist, occasional
  // editor blurb) don't contain substantive reviews, and even when
  // they do the saved URL would nag readers to buy the record.
  'discogs.com',
  'amazon.',
  'ebay.',
  'apple.com',
  'music.apple.com',
  'spotify.com',
  'bandcamp.com',
  'hmv.co.jp',
  'hmv.com',
  'towerrecords.',
  'bestbuy.com',
  'walmart.com',
  'target.com',
  'yesasia.com',
  'cdjapan.co.jp',
  'barnesandnoble.com',
  // Social media — never an editorial album review source. Tweets,
  // Facebook posts, TikToks, threads, Bluesky, Telegram, Reddit posts
  // may LINK to reviews but are themselves social noise that Jina
  // still renders, and the scraper sometimes lands on them when an
  // artist account or fan community is high on the SERP. Blocked
  // across the common platforms + their TLD variants.
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'bsky.app',
  't.me',
  'reddit.com',
  // YouTube — occasionally indexed as a review target but overwhelmingly
  // just playback / music video / reaction content. Any legitimate video
  // review (e.g. Fenriz-style channel takes) admin can paste manually.
  'youtube.com',
  'youtu.be',
];

// Admin-managed blacklist / whitelist caches. Loaded lazily from the
// source_blacklist / source_whitelist tables with a 60-second TTL so
// the discover pipeline doesn't hit SQLite on every URL it filters,
// but edits through /api/admin/sources land in the filter within a
// minute. bustSourceListCaches() is the hook the admin mutation
// endpoints call to propagate a change immediately without waiting
// for the TTL.
type SourceCache = { hosts: Set<string>; expiresAt: number };
const SOURCE_CACHE_TTL_MS = 60_000;
let blacklistCache: SourceCache | null = null;
let whitelistCache: SourceCache | null = null;

function loadHostSet(tableName: 'source_blacklist' | 'source_whitelist'): Set<string> {
  const rows = queryAll(`SELECT host FROM ${tableName}`) as Array<{ host: string }>;
  return new Set(rows.map((r) => r.host.toLowerCase().replace(/^www\./, '')));
}

function getBlacklistedHostsFromDb(): Set<string> {
  if (!blacklistCache || blacklistCache.expiresAt < Date.now()) {
    blacklistCache = {
      hosts: loadHostSet('source_blacklist'),
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    };
  }
  return blacklistCache.hosts;
}

export function getWhitelistedHostsFromDb(): Set<string> {
  if (!whitelistCache || whitelistCache.expiresAt < Date.now()) {
    whitelistCache = {
      hosts: loadHostSet('source_whitelist'),
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    };
  }
  return whitelistCache.hosts;
}

export function bustSourceListCaches(): void {
  blacklistCache = null;
  whitelistCache = null;
}

// Single entry point for "should we refuse this host?" — combines the
// hardcoded structural blacklist (EXCLUDED_URL_DOMAINS above) with the
// admin-managed DB blacklist. Host comparison strips the "www." prefix
// and lowercases so admin entering either form works.
export function isHostBlacklisted(host: string): boolean {
  const h = host.toLowerCase();
  if (EXCLUDED_URL_DOMAINS.some((d) => h.includes(d))) return true;
  const bare = h.replace(/^www\./, '');
  const dbSet = getBlacklistedHostsFromDb();
  if (dbSet.has(bare) || dbSet.has(h)) return true;
  // Suffix match so a DB entry for "example.com" also covers
  // "blog.example.com". Same shape as the EXCLUDED_URL_DOMAINS check.
  for (const entry of dbSet) {
    if (h === entry || h.endsWith(`.${entry}`)) return true;
  }
  return false;
}

// URL path / filename patterns that signal the target page is a multi-
// album roundup rather than a dedicated review (year-end lists, staff
// picks, "in brief" sweep posts, monthly digests). These pages usually
// mention the album in passing at best, and even when the LLM correctly
// refuses them the Haiku editorial filter has already paid to look at
// them. The mystificationzine.com "in-brief-october-25-pt-i" and
// heavyblogisheavy.com "heavy-blogs-superlatives-2025" hits that
// motivated this list are both year/month roundups; admin can still
// paste a specific URL manually through the add-url flow if one of
// these posts genuinely is a one-album feature.
export const EXCLUDED_URL_PATH_PATTERNS: RegExp[] = [
  /\bsuperlative/i,
  /\bbest[-_]of[-_]/i,
  /\byear[-_]end\b/i,
  /\byear[-_]in[-_]review\b/i,
  /\broundup\b/i,
  /\bround[-_]up\b/i,
  /\bin[-_]brief\b/i,
  /\btop[-_]\d+/i,
  /\bstaff[-_]picks?\b/i,
  /\bmonthly[-_]/i,
  /\blistening[-_]log\b/i,
  /\balbums?[-_]of[-_]the[-_](?:week|month|year)\b/i,
  // Discography-ranking listicles ("The albums ranked worst to first",
  // "best to worst", "albums-ranked"). These cover a whole band catalog
  // with a paragraph per album and never offer a focused single-album
  // take — same problem as year-end roundups. 2loud2oldmusic's "W.E.T.
  // The Albums Ranked Worst to First" was the recent trigger.
  /\bworst[-_]to[-_]first\b/i,
  /\bbest[-_]to[-_]worst\b/i,
  /\balbums?[-_]ranked\b/i,
  /\bdiscography[-_]ranked\b/i,
  // Sputnikmusic user-rating aggregate page (not an editorial review).
  // The path is /soundoff.php, separate from the /review/ editorial
  // URLs. soundoff pages list user scores and one-liners only.
  /\/soundoff\.php\b/i,
  // WordPress-style tag/category index pages for 'spotify'. These
  // aggregate streaming-link posts / playlist announcements rather
  // than individual editorial reviews. Covers /tag/spotify/,
  // /tags/spotify/, /category/spotify/.
  /\/(?:tag|tags|category)\/spotify\b/i,
  // Sputnikmusic band/artist directory page (not a review). Format is
  // /bands/<slug>/<numeric-id>/, distinct from /review/<id>/... which
  // is the editorial URL shape. The band page lists user-submitted
  // scores per album with no editorial prose. The alphanumeric slug +
  // numeric ID combo is specific enough that non-sputnik hosts with
  // similar paths are unlikely false positives.
  /^\/bands\/[^/]+\/\d+/i,
  // Sputnikmusic user-list page — /list.php?memberid=NNN is a member's
  // personal album list (top-of-the-year picks, etc.) with one-line
  // commentary per album, not editorial review prose. The memberid
  // query parameter is the user-list signature; matching the query
  // keeps this from false-positiving on other sites that happen to
  // serve a list.php endpoint.
  /\/list\.php\?[^"\s]*memberid=/i,
  // "Top albums of 20XX" style listicles on otherwise reputable
  // editorial sites (toiletovhell.com /top-albums-ov-2025-w-…/ was the
  // trigger). Each album gets a one-paragraph blurb inside the roundup
  // — same not-a-single-album-focus problem as the year-end / roundup
  // patterns above. Covers "top-albums", "top-records", "top-releases".
  /\btop[-_](?:albums?|records?|releases?)\b/i,
  // Interview / announcement / talk-to-artist content — the scraper
  // keeps mistaking these for reviews when they mention the album
  // by name. Common URL slugs:
  //   loudersound/features/…-interview
  //   alterock/…-announce-new-album-…-talk-new-music-direction
  //   …/band-talks-about-new-record
  /\binterview(?:s|ed)?\b/i,
  /\bannounce[sd]?\b/i,
  /\btalks?[-_](?:to|with|about|new|album|record)\b/i,
  // Press-release / news-post slugs. metalshockfinland's "Avralize
  // unleash new album liminal with brand new music video for focus
  // track fading faster" was a video-release announcement that got
  // scored 60/100 despite containing no rating or evaluative prose —
  // these verbs are near-universal in press-release copy and rarely
  // appear in editorial review slugs. "music-video-for" is the video-
  // release post shape specifically (anchored with "for" so a review
  // that happens to mention a music video in passing doesn't hit).
  // "drops/shares/stream new X" are the canonical "here's a new
  // track" news slugs on brooklynvegan, theprp, etc.
  /\bunleash(?:es|ed|ing)?\b/i,
  /\bpremier(?:e|es|ed|ing)\b/i,
  /\breveal(?:s|ed|ing)?\b/i,
  /\bdrops?[-_](?:new|single|album|video|track|ep|song)\b/i,
  /\bshares?[-_]new[-_](?:single|video|track|song|ep|album)\b/i,
  /\b(?:new|brand[-_]new)[-_]music[-_]video\b/i,
  /\bmusic[-_]video[-_]for\b/i,
  /\bstream[-_]new[-_](?:single|track|video|song|ep|album)\b/i,
  // EPK (Electronic Press Kit) is a press-release packet that labels
  // send to outlets — outlets re-publish the EPK verbatim as a news
  // post, never as a review. "epk" almost never appears in editorial
  // review slugs. Trigger: metalodyssey.net "hardline-danger-zone-
  // official-epk-album-out-now-via-frontiers-records" labeled itself
  // an EPK in the slug and still got laundered as a review.
  /\bepk\b/i,
  // "album out now" / "out now via X records" is the canonical
  // release-day news headline — a factual "record is available,
  // here's the streaming link" post rather than evaluative prose.
  /\b(?:album|ep|single|video)[-_]?out[-_]now\b/i,
  /\bout[-_]now[-_]via\b/i,
  // /news/ section paths. Outlets group press-release reposts,
  // tour announcements, lineup changes, and label news under a
  // /news/ subdirectory; even when an album is mentioned in a
  // headline there, the post itself is factual rather than
  // evaluative. Matches /news/ (and /news at end of path), plus
  // /news-foo (news listing slug) and /category/news/ style index
  // pages — `\b` boundaries skip false positives like /newsletter,
  // /newsboys (band name), /newscastle (place name).
  /\bnews\b/i,
];

// Normalize a URL for duplicate-detection only — what we STORE is still
// the admin-pasted string unchanged. This key is just for comparing two
// variants of the "same" page. Conservative strips: case-folded host,
// dropped www. prefix and http/https protocol, trailing slash, fragment,
// and common tracking params. Path and non-tracking query params are
// left intact so sites that use ?reviewid=N or similar as the actual
// page identifier (sputnikmusic, metalcrypt, a bunch of WP blogs) still
// distinguish different reviews correctly.
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
];

export function normalizeReviewUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of TRACKING_PARAMS) u.searchParams.delete(k);
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const search = u.searchParams.toString();
    return `${host}${path}${search ? `?${search}` : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

// ─── Admin: scrape a single review from an arbitrary URL ─────────────────

// Detect visual star ratings from RAW html (must run before stripHtml,
// which throws away the <i> icon tags that carry the rating). Handles
// two generic markup families:
//
//   - FontAwesome: <i class="fas fa-star">, <i class="fas fa-star-half">
//     / <i class="fas fa-star-half-alt">, <i class="far fa-star"> (outline
//     = empty slot). Metal Academy, Angry Metal Guy, many indie review
//     blogs use this.
//   - Unicode text: ★ / ☆ / ⯪ rendered as plain characters inline.
//
// Detection is scoped to elements whose `class` attribute contains
// "rating" / "stars" / "score" — this prevents site-wide decorations
// (nav bars love fa-star for "menu" icons) from polluting the count.
// We don't try to track tag nesting; instead we scan a bounded window
// after each class-attr hit and count icons inside it.
//
// Returns a /100 score, or null if the count isn't in the trustworthy
// 3–10 range (filters both nav false-positives and exotic scales we
// can't map confidently).
function detectStarRating(html: string): number | null {
  const containerRe = /class\s*=\s*"[^"]*(?:rating|stars|score)[^"]*"/gi;
  // Reject containers that are user-rating INPUT widgets rather than
  // editorial-score DISPLAYS. WP Review plugin renders a 5-star
  // picker for visitors as a "wp-review-user-rating-star" container
  // — each <i class="fa fa-star"> is an input control, not a filled
  // star of the reviewer's verdict. Counting those would always land
  // on 5/5 = 100 and shadow the real score (gbhbl editorial 90 was
  // being overridden this way). Any "user-rating" / "rating-input" /
  // "user-review" token in the container's class attribute flags it
  // as an input widget and skips the counter pass.
  const userInputMarker = /\b(?:user-rating|rating-input|user-review)\b/i;
  // Broadened from <i>-only to <i|svg|span|img>. Real-world sites use
  // any of these for their star icons:
  //   FontAwesome:                  <i class="fas fa-star">
  //   loudersound (custom icon):    <span class="icon icon-star">
  //   themusic.com.au (inline svg): <svg class="icon star ">
  //   Bootstrap icons:              <i class="bi bi-star-fill">
  // The ICON_RE captures the class attribute; star-vs-half-vs-empty
  // is classified from the class tokens below.
  const ICON_RE = /<(?:i|svg|span|img)\b[^>]*class\s*=\s*"([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = containerRe.exec(html)) !== null) {
    if (userInputMarker.test(m[0])) continue;
    const window = html.slice(m.index, m.index + 2000);
    let full = 0,
      half = 0,
      empty = 0;
    let icon: RegExpExecArray | null;
    // Reset lastIndex — ICON_RE is global and reused across loop iterations.
    ICON_RE.lastIndex = 0;
    while ((icon = ICON_RE.exec(window)) !== null) {
      const classes = icon[1];
      // Star-class detection: named prefixed variants (fa-star*,
      // icon-star*, bi-star*, glyphicon-star, lucide-star), suffixed
      // variants (star-full, star-empty, star-half, star-o, star-filled,
      // star-fill), OR a standalone "star" class. The standalone match
      // requires whitespace / end on both sides so "startup-icon" and
      // "star-chart" don't slip through — we only want "star" as a
      // dedicated class-name token.
      const isStar =
        /\b(?:fa-star|icon-star|bi-star|glyphicon-star|lucide-star)\b/i.test(classes) ||
        /\bstar(?:-full|-empty|-half|-o|-filled|-fill)\b/i.test(classes) ||
        /(?:^|\s)star(?:\s|$)/i.test(classes);
      if (!isStar) continue;
      // Half-star: explicit "half" token or FA/bootstrap half variants
      // or the star-half suffix form.
      const isHalf =
        /(?:^|\s|-)half(?:$|\s|-)/i.test(classes) ||
        /\b(?:fa-star-half|bi-star-half|icon-star-half|star-half)\b/i.test(classes);
      // Empty/outline star:
      //   `far` / `fa-regular` — FontAwesome regular (outline) style
      //   `fa-star-o` / `star-o` — FA v4 outline variant
      //   `star-empty` — common suffix form (newnoisemagazine, readdork)
      //   `bi-star` (not fill/half) handled by not-full fallback
      //   generic "empty"/"outline" — ad-hoc blog CSS
      const isOutline =
        /(?:^|\s)(?:fa-regular|far|fa-star-o|empty|outline)(?:$|\s|-)/i.test(
          classes
        ) ||
        /\b(?:star-empty|star-o)\b/i.test(classes);
      if (isHalf) half++;
      else if (isOutline) empty++;
      else full++;
    }

    // Fallback to Unicode stars in the same window if no FA icons found.
    // We strip inline tags first so char-count isn't confused by tag names.
    if (full + half + empty === 0) {
      const bare = window.replace(/<[^>]+>/g, ' ');
      full = (bare.match(/★/g) || []).length;
      half = (bare.match(/[⯪⯫⯬]/g) || []).length;
      empty = (bare.match(/☆/g) || []).length;
    }

    const total = full + half + empty;
    if (total < 3 || total > 10) continue;

    // If empty slots are rendered alongside filled ones, the total IS the
    // scale (5/5 or 10/10 system, fully drawn). If not, fall back to the
    // convention that any total ≤ 5 means a 5-star system with the empty
    // slots simply omitted from the DOM (e.g. metal.academy renders 3.5/5
    // as 3 full + 1 half and stops). Totals 6-10 without empties map to
    // a 10-star system.
    const scale = empty > 0 ? total : total <= 5 ? 5 : 10;
    const filled = full + half * 0.5;
    return Math.max(0, Math.min(100, Math.round((filled / scale) * 100)));
  }
  return null;
}

// Per-site score extractors for publications whose rating widgets are
// in places the generic detectors can't see — buried in a JS config,
// embedded with a site-specific visual convention, etc. Keyed by
// hostname so a pattern that only holds for one site can't false-
// positive elsewhere.
function detectSiteSpecificScore(html: string, url: string): number | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  // Sputnikmusic — the reviewer's score sits in a red-bold span with
  // no "Album Rating:" label. Every "Album Rating: N.N" on the page
  // belongs to a user comment, so the generic Album-Rating detector
  // (detectExplicitNumericScore rule 4) grabs the first user comment's
  // number instead of the reviewer's. Match the specific color-coded
  // span convention that Sputnik uses for its own score box.
  if (host === 'sputnikmusic.com') {
    const m = html.match(
      /color\s*:\s*#ff0000[^"]*"[^>]*>\s*(\d(?:\.\d)?)\s*<\/span>/i
    );
    if (m) {
      const score = parseFloat(m[1]);
      if (score >= 0 && score <= 5) {
        return Math.round((score / 5) * 100);
      }
    }
  }

  // Metal Trenches — the page renders a Highcharts rating distribution
  // chart and keeps the computed overall score in the chart title
  // (`text: 'Average Score: 10.0'`). Never surfaces in visible text, so
  // stripHtml + the text-based detectors never see it. Scan the raw
  // HTML (before any script strip) for the quoted pattern.
  if (host === 'metaltrenches.com') {
    const m = html.match(
      /['"]\s*(?:Average\s+)?(?:Score|Rating)\s*:\s*(\d+(?:\.\d+)?)\s*['"]/i
    );
    if (m) {
      const score = parseFloat(m[1]);
      // Site's scale is /10 (confirmed by the '10/10 perfect' rubric
      // on the ratings-chart legend). Clamp defensively.
      if (score >= 0 && score <= 10) {
        return Math.round((score / 10) * 100);
      }
    }
  }

  // Angry Metal Guy — the visible "Rating:" line is a qualitative word
  // ("Great!", "Excellent!", "Good", etc.) that our prompt explicitly
  // refuses to guess numerically. But the numeric /5 value is filed as a
  // tag on the post: <a href="/tag/45/" rel="tag">4.5</a> for 4.5/5.
  // Year tags ("2025", "Apr25") never match because they're 4-digit or
  // alphanumeric, while the rating tag is always a 2-digit path + a
  // visible decimal in N or N.N form.
  if (host === 'angrymetalguy.com') {
    const m = html.match(
      /<a\s+href="[^"]*\/tag\/\d{2}\/"\s+rel="tag"\s*>\s*(\d(?:\.\d)?)\s*</i
    );
    if (m) {
      const score = parseFloat(m[1]);
      if (score >= 0 && score <= 5) {
        return Math.round((score / 5) * 100);
      }
    }
  }

  // Chaoszine — custom star-widget markup where each slot is a
  // <div class="one"> (filled) or <div class="empty"> (empty) inside
  // a <div class="rating"> container. Neither "one" nor "empty" match
  // the generic star detector's class allow-list (fa-star / icon-star
  // / bi-star / standalone "star"), so generic counting misses it
  // entirely — "one" alone is too generic to add to the global list
  // without false-positiving on totally unrelated UI elements. Counted
  // here site-locally: numerator = `one` count, scale = one+empty total.
  // powerofmetal.dk — score encoded in an image filename under a
  // /rating/ subdirectory: <img src="…/rating/rating_82.jpg">. The
  // generic detectFilenameRatingImage only captures a single digit
  // (0-5 range for /5 scale), so "rating_82.jpg" never matched it;
  // meanwhile the page's "Artwork rating: 88/100" sub-rating on a
  // side widget is what detectExplicitNumericScore grabbed, landing
  // on the wrong number. Site-specific here: rating_NN.jpg with NN
  // read directly as a /100 score.
  if (host === 'powerofmetal.dk') {
    const m = html.match(/\/rating\/rating_(\d{1,3})\.(?:png|jpe?g|webp|svg)\b/i);
    if (m) {
      const score = parseInt(m[1], 10);
      if (score >= 0 && score <= 100) return score;
    }
  }

  // steenjepsen.dk / Revelationz Magazine — editorial score is labelled
  // with the reviewer's first name rather than "Score" or "Rating"
  // (<strong>Steen: 9/10</strong>). The generic detectExplicitNumericScore
  // skips it (no matching label word) and then lands on the individual
  // member comment block further down the page — <strong>Rating:
  // 8/10</strong> for the first user who voted — returning the wrong
  // number. Grab the first <strong>Name: N/10</strong> on the page and
  // reject known non-editorial labels so the byline name wins.
  if (host === 'steenjepsen.dk') {
    const m = html.match(
      /<strong[^>]*>(?:<[^>]*>)?\s*([A-Z][a-zA-Z]+)\s*:\s*(\d{1,2})\s*\/\s*10/
    );
    if (m) {
      const name = m[1];
      // Reject the site's meta labels so "Members:" (user aggregate)
      // and "Rating:" (individual comment) don't hijack the byline
      // capture.
      if (!/^(Members?|Rating|Score|Overall|Verdict|Final|Summary)$/i.test(name)) {
        const score = parseInt(m[2], 10);
        if (score >= 0 && score <= 10) return score * 10;
      }
    }
  }

  // Pitchfork — publishes the editorial score as a 0.0-10.0 decimal,
  // but the visible number on the page is deliberately blurred
  // (masked with a CSS filter until hover). Generic detectors can't
  // see it, and schema.org's ratingValue is set to null in their
  // JSON-LD. The score lives in the article's page-state JSON as
  // `"musicRating":{"isBestNewMusic":…,"isBestNewReissue":…,"score":8.2}`.
  //
  // The old detector matched a bare `"score":N` anywhere in the page,
  // which worked until Pitchfork's 2026-era refresh started scattering
  // other `"score":N` fields across the page — article-recommendation
  // relevance floats that land in the 0.1-0.5 range. Matching the
  // first one and rounding 0.36 × 10 = 4 is how a legitimate 8.2/10
  // review came back as 40/100. Anchor to `"musicRating":{…,"score":N}`
  // explicitly so unrelated JSON siblings can't hijack the match.
  if (host === 'pitchfork.com') {
    const m = html.match(/"musicRating"\s*:\s*\{[^}]*?"score"\s*:\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const score = parseFloat(m[1]);
      if (score >= 0 && score <= 10) return Math.round(score * 10);
    }
  }

  // The Guardian — DCR renders the star rating as a row of two
  // different obfuscated dcr-* span classes (one filled, one empty),
  // distinguished only by their CSS background — var(--star-rating-
  // background) is the yellow filled state, var(--star-rating-empty-
  // background) is grey. Class names change every deploy, so we
  // can't just allow-list them. Instead, read the CSS to figure out
  // which class is which, then count occurrences as `class="dcr-…"`
  // attributes in the body. Always a /5 scale.
  if (host === 'theguardian.com') {
    const fillClass = html.match(
      /\.(dcr-[a-z0-9]+)\s*\{[^}]*var\(--star-rating-background\)/i
    );
    const emptyClass = html.match(
      /\.(dcr-[a-z0-9]+)\s*\{[^}]*var\(--star-rating-empty-background\)/i
    );
    if (fillClass && emptyClass && fillClass[1] !== emptyClass[1]) {
      const fillRe = new RegExp(`class\\s*=\\s*"${fillClass[1]}"`, 'g');
      const emptyRe = new RegExp(`class\\s*=\\s*"${emptyClass[1]}"`, 'g');
      const full = (html.match(fillRe) || []).length;
      const empty = (html.match(emptyRe) || []).length;
      const total = full + empty;
      if (total >= 3 && total <= 5) {
        return Math.round((full / 5) * 100);
      }
    }
  }

  // Sea of Tranquility — uses filename images for stars:
  //   star_whole.gif = filled, star_half.gif = half, star_empty.gif = empty
  // The generic detectFilenameRatingImage only matches Rating_N.png
  // and /stars/N.png patterns, so seaoftranquility's scheme never
  // matched and the Claude extractor sometimes inferred a wrong
  // number from the page text. Count the three variants directly.
  // Scale is locked to 5 — the site never renders empty slots, so
  // treating (full + half) as the total would undersize the scale
  // for sub-5 ratings (3 full + 1 half would read 88 instead of 70).
  if (host === 'seaoftranquility.org') {
    const full = (html.match(/star_whole\.gif/gi) || []).length;
    const half = (html.match(/star_half\.gif/gi) || []).length;
    const empty = (html.match(/star_empty\.gif/gi) || []).length;
    const rendered = full + half + empty;
    if (rendered >= 1 && rendered <= 5) {
      const filled = full + half * 0.5;
      return Math.round((filled / 5) * 100);
    }
  }

  // The Metal Pit — presents the editorial score as "Review Score: N"
  // with NO visible denominator. Convention is /10 (they use 10 as
  // the top end, confirmed across their recent reviews). None of the
  // generic detectors match a bare "Review Score: 10" — rule 1 wants
  // a fraction, rule 3 wants a %, rule 4 is Sputnik-specific "Album
  // Rating" /5 assumption which 10 would exceed. Site-specific.
  if (host === 'themetalpit.org') {
    const m = html.match(/Review\s+Score\s*:\s*(\d{1,3}(?:\.\d+)?)/i);
    if (m) {
      const score = parseFloat(m[1]);
      if (Number.isFinite(score) && score >= 0 && score <= 10) {
        return Math.round(score * 10);
      }
    }
  }

  // Toilet ov Hell — sign-off rating in mixed-number form:
  //   <h3>4 1/2 out of 5 Flaming Toilets ov Hell</h3>
  // The generic "N out of M" detector can't read mixed numbers: it
  // matches "2 out of 5" (picking the "2" that's the denominator of
  // the 1/2 fraction) and reports 40 for what should be 90. Parse
  // whole + optional fraction here so the Vektor "4 1/2" case lands
  // on 4.5/5 = 90 instead of the spurious 2/5 = 40.
  if (host === 'toiletovhell.com') {
    const m = html.match(
      /(\d)(?:\s+(\d)\s*\/\s*(\d))?\s+out\s+of\s+5\s+Flaming\s+Toilets/i
    );
    if (m) {
      const whole = parseInt(m[1], 10);
      const num = m[2] ? parseInt(m[2], 10) : 0;
      const den = m[3] ? parseInt(m[3], 10) : 1;
      const score = den > 0 ? whole + num / den : whole;
      if (score >= 0 && score <= 5) {
        return Math.round((score / 5) * 100);
      }
    }
  }

  if (host === 'chaoszine.net') {
    // Scan a 500-char window after the container open to count the
    // filled/empty slot divs. 5 slots × ~30 chars per slot = ~150,
    // so 500 leaves plenty of headroom without risking bleed into
    // a different rating block lower on the page.
    const open = html.search(/<div\s+class\s*=\s*"rating"\s*>/i);
    if (open >= 0) {
      const window = html.slice(open, open + 500);
      const full = (window.match(/class\s*=\s*"one"/gi) || []).length;
      const empty = (window.match(/class\s*=\s*"empty"/gi) || []).length;
      const total = full + empty;
      if (total >= 3 && total <= 10) {
        return Math.round((full / total) * 100);
      }
    }
  }

  // Get Ready To Rock — sign-off rating uses ASCII asterisks on a
  // 5-star scale, in the body of the last paragraph: `<strong>. ****
  // </strong>` for 4/5 (=80), `<strong>. ***1/2</strong>` for 3.5/5
  // (=70). The site also publishes its star key in a sidebar widget
  // ("***** Out of this world / **** Pretty damn fine / …"), so we
  // anchor on the period prefix that only appears in the editorial
  // sign-off — the legend lines never start with `. `. Half-star
  // markers: 1/2, ½, .5.
  if (host === 'getreadytorock.me.uk') {
    const m = html.match(
      /<(?:strong|b)>\s*\.\s*(\*{3,5})(?:\s*(1\/2|½|\.5))?\s*<\/(?:strong|b)>/i
    );
    if (m) {
      const full = m[1].length;
      const half = m[2] ? 0.5 : 0;
      return Math.max(0, Math.min(100, Math.round(((full + half) / 5) * 100)));
    }
  }

  return null;
}

// WordPress "WP Product Review" plugin encodes the score directly in
// a class name: `wppr-pNN` where NN is 0-100 (already on a /100 scale).
// The main article's review widget appears first in document order;
// sidebar "related posts" and "other reviews" widgets come later in
// the markup, so taking the FIRST match keeps us on the album the page
// is actually reviewing. Our detectExplicitNumericScore would otherwise
// land on a sidebar "8.5/10" via the bare-fraction last-match rule.
// Used by thedarkmelody.com and a bunch of other indie WordPress
// review blogs that use the same plugin.
function detectWpProductReviewRating(html: string): number | null {
  const m = html.match(/class\s*=\s*"[^"]*\bwppr-p(\d{1,3})\b[^"]*"/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 0 || n > 100) return null;
  return n;
}

// MyThemeShop "WP Review" plugin — different from WP Product Review
// above. Renders the editorial score as a CSS width percentage on a
// class="review-result" element:
//   <div class="review-result" style="width:90%; background-color:...">
// The user review block (wp-review-user-rating-*) appears LATER in the
// markup and tends to have a different value (100 when a single
// enthusiastic user submits 10/10). The generic bare-fraction detector
// grabs the last "10/10" from the user block instead of the editorial
// 9/10. Matching the width-as-percentage style attribute pins us to
// the editorial half. Used by gbhbl.com and friends.
//
// Caveat: metalexpressradio.com's pages have ONLY the user-rating
// widget (no editorial width widget) with "width:0%" when no one has
// voted, which would otherwise return a spurious 0. The user-rating
// widget's wrapper always carries a data-originalrating attribute;
// the editorial widget doesn't. Skip any match whose preceding 300
// chars contain that attribute.
function detectWpReviewPluginRating(html: string): number | null {
  const re = /class\s*=\s*"review-result"[^>]*style\s*=\s*"[^"]*width\s*:\s*(\d{1,3})%/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n < 0 || n > 100) continue;
    const preceding = html.slice(Math.max(0, m.index - 300), m.index);
    if (/data-originalrating\s*=/i.test(preceding)) continue;
    return n;
  }
  return null;
}

// A11y-first rating widgets draw the visual with pure CSS (no child
// <i> icons, no Unicode chars) and put the actual number in an
// aria-label / title / alt attribute on the container element:
//
//   <span class="chunk rating" aria-label="Rating: 4 out of 5 stars">
//   <div class="stars" title="4.5/5">
//
// stripHtml drops the attribute text when it removes the tag, so
// detectExplicitNumericScore can't see it either. This detector reads
// the attributes directly off the rating container before any strip.
// Detects schema.org Rating / AggregateRating microdata:
//   <meta itemprop="ratingValue" content="4">
//   <meta itemprop="bestRating" content="5">
// Highest-authority signal when present — the page explicitly declares
// its own rating for search-engine consumption, so it's immune to
// confusion between the actual review and related-article teasers
// that rendered star icons near the top of the document (the ramzine
// case: multiple <span class="entry-review-stars"> blocks with
// DIFFERENT scores, only the last was the current review; star
// detector grabbed the first). If bestRating is missing, falls back
// to 5 (the only common default for star-system reviews).
// Pull a microdata-tagged numeric value out of HTML. Tries the
// `<meta itemprop="X" content="N">` form first (the schema.org
// canonical encoding), then falls back to `<span itemprop="X">N</span>`
// / `<div itemprop="X">N</div>` (element text — saladdaysmag uses this
// shape for ratingValue while keeping bestRating in a meta tag, so
// the meta-only variant misses the value entirely).
function extractMicrodataNumber(html: string, propName: string): number | null {
  const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const metaRe = new RegExp(
    `<meta[^>]*itemprop\\s*=\\s*"${escaped}"[^>]*content\\s*=\\s*"([^"]+)"`,
    'i'
  );
  const meta = html.match(metaRe);
  if (meta) {
    const v = parseFloat(meta[1].replace(',', '.'));
    if (Number.isFinite(v)) return v;
  }
  // Element-text form: opening tag with itemprop, immediate numeric
  // text, matching close tag. Tolerates surrounding whitespace.
  const textRe = new RegExp(
    `<(span|div|p|strong|b)[^>]*itemprop\\s*=\\s*"${escaped}"[^>]*>\\s*(\\d+(?:[.,]\\d+)?)\\s*</\\1>`,
    'i'
  );
  const text = html.match(textRe);
  if (text) {
    const v = parseFloat(text[2].replace(',', '.'));
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function detectSchemaOrgRating(html: string): number | null {
  // Form 1 — schema.org microdata, either `<meta content>` or element
  // text. ratingValue=0 is treated as a sentinel for "widget present
  // but never configured" — WP Review and friends ship with a default
  // 0 that stays put when an editor publishes without filling the
  // rating in. mhf-mag's Aephanemer review had the body text reading
  // "Rating : 80/100" while the JSON-LD carried ratingValue=0, and
  // returning 0 short-circuited every downstream detector.
  const microValue = extractMicrodataNumber(html, 'ratingValue');
  if (microValue !== null && microValue > 0) {
    const microBest = extractMicrodataNumber(html, 'bestRating');
    const scale = microBest !== null ? microBest : 5;
    if (
      [5, 10, 20, 100].includes(scale) &&
      microValue >= 0 &&
      microValue <= scale
    ) {
      return Math.max(0, Math.min(100, Math.round((microValue / scale) * 100)));
    }
  }

  // Form 2 — JSON-LD or JSON-in-attribute: "ratingValue":4, "bestRating":5.
  // Modern React / Next.js sites (readdork, many Headless-WP builds)
  // embed schema.org data inline as JSON. Two common encodings:
  //   1. <script type="application/ld+json">{"ratingValue":4,…}</script>
  //      (plain, unescaped quotes)
  //   2. <div data-foo="…\"ratingValue\":4,…">
  //      (JSON serialised into an attribute — inner quotes escape-slashed)
  // The pattern tolerates both via a small non-digit run between the
  // key and its number. Same zero-sentinel rule as Form 1.
  const jsonValue = html.match(/ratingValue[^\d]{1,10}(\d+(?:\.\d+)?)/);
  if (jsonValue) {
    const value = parseFloat(jsonValue[1]);
    if (Number.isFinite(value) && value > 0) {
      const jsonBest = html.match(/bestRating[^\d]{1,10}(\d+(?:\.\d+)?)/);
      const scale = jsonBest ? parseFloat(jsonBest[1]) : 5;
      if (
        [5, 10, 20, 100].includes(scale) &&
        value >= 0 &&
        value <= scale
      ) {
        return Math.max(0, Math.min(100, Math.round((value / scale) * 100)));
      }
    }
  }

  return null;
}

function detectAriaLabelRating(html: string): number | null {
  const containerRe =
    /<[a-z]+\b[^>]*class\s*=\s*"[^"]*(?:rating|stars|score)[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = containerRe.exec(html)) !== null) {
    const tagText = m[0];
    const attr =
      /aria-label\s*=\s*"([^"]+)"/i.exec(tagText)?.[1] ||
      /title\s*=\s*"([^"]+)"/i.exec(tagText)?.[1] ||
      /alt\s*=\s*"([^"]+)"/i.exec(tagText)?.[1];
    if (!attr) continue;
    // "4 out of 5 stars" / "8.5 out of 10"
    const outOf = attr.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s+out\s+of\s+(\d{1,3})/i);
    if (outOf) {
      const score = parseFloat(outOf[1].replace(',', '.'));
      const scale = parseInt(outOf[2], 10);
      if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
        return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
      }
    }
    // "4/5", "8.5/10" inside the attribute
    const frac = attr.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,3})/);
    if (frac) {
      const score = parseFloat(frac[1].replace(',', '.'));
      const scale = parseInt(frac[2], 10);
      if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
        return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
      }
    }
  }
  return null;
}

// Maps common English / Korean / Romance-language review labels
// (Score, Rating, Verdict, Overall, 점수, 평점, Note, ...) to a single
// unified regex prefix. Every detector below that expects a label
// uses this, so adding a new label value is a one-liner. "Album
// Rating" gets its own bare-number detector below (Sputnikmusic
// style — N.N with no denominator, implicit /5).
const SCORE_LABEL_PATTERN =
  '(?:Score|Scoring|Rating|Verdict|Overall(?:\\s+score)?|Bottom\\s*line|Final(?:\\s+score)?|Mark|Note|Nota|Cijfer|Punkte|Punktzahl|평점|점수|총평|최종\\s*점수|評価|点数|評点)';

// Label-anchored numeric score detection. Runs on stripped text of
// the raw HTML so we see human-readable labels (e.g. "Score: 90/100"
// on Zware Metalen, "Note: 8/10" on French zines, "8 out of 10" on
// English). The anchor keeps us from grabbing tracklist-style "1/10"
// that would otherwise produce false positives.
//
// Scale must be a recognised editorial one (5, 10, 20, 100) — anything
// else is almost certainly not a review score. On match, normalises
// to /100 and returns the rounded integer.
function detectExplicitNumericScore(html: string): number | null {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  // Korean labels aren't \w so \b doesn't anchor them. Use a char-class
  // lookbehind that accepts start-of-string, whitespace, or punctuation —
  // matches both "Score: ..." and "점수: ..." consistently.
  const LABEL_PREFIX = '(?:^|[\\s.,;()\\[\\]])';

  // (1) "Score: 90/100" / "Verdict: 8.5/10" / "평점: 4/5" / "총평: 85/100"
  const labelled = text.match(
    new RegExp(`${LABEL_PREFIX}${SCORE_LABEL_PATTERN}\\s*[:：]\\s*(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*\\/\\s*(\\d{1,3})\\b`, 'i')
  );
  if (labelled) {
    const score = parseFloat(labelled[1].replace(',', '.'));
    const scale = parseInt(labelled[2], 10);
    if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
      return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
    }
  }

  // (2) "8 out of 10" / "4.5 out of 5". Unanchored, so require the scale
  // to still be a recognised editorial one — that check drops "chapter
  // 4 out of 12" or similar non-score sentences.
  const outOf = text.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s+out\s+of\s+(\d{1,3})\b/i);
  if (outOf) {
    const score = parseFloat(outOf[1].replace(',', '.'));
    const scale = parseInt(outOf[2], 10);
    if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
      return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
    }
  }

  // (3) Percentage with a score label: "Verdict: 85%" / "평점 90%".
  // Require the label to avoid false positives from "40% of this
  // album's 12 songs..." kind of prose.
  const percent = text.match(
    new RegExp(`${LABEL_PREFIX}${SCORE_LABEL_PATTERN}\\s*[:：]?\\s*(\\d{1,3})\\s*%`, 'i')
  );
  if (percent) {
    const n = parseInt(percent[1], 10);
    if (n >= 0 && n <= 100) {
      return n;
    }
  }

  // (3b) "Score of X: N%" — the label carries a qualifier before the
  // colon, which rule (3) can't match because its regex only allows
  // whitespace between the label word and the colon. Man Of Much
  // Metal signs off with "The Score of Much Metal: 94%"; other sites
  // use similar "Score of <section>" headers (e.g. "Score of the
  // Day: …"). Bounded non-colon run so we don't accidentally jump
  // across paragraphs to the next numeric %.
  const qualifiedScore = text.match(
    /\bScore\s+of\s+[A-Za-z ]{1,30}[:：]\s*(\d{1,3})\s*%/i
  );
  if (qualifiedScore) {
    const n = parseInt(qualifiedScore[1], 10);
    if (n >= 0 && n <= 100) {
      return n;
    }
  }

  // (4) "Album Rating: 4.0" — Sputnikmusic and similar sites list the
  // reviewer rating without a visible denominator. Convention is /5
  // (0.0 to 5.0 scale), and taking the FIRST match grabs the
  // reviewer's number before any user-comment ratings that follow
  // with the same label. Values over 5 fall through to the next
  // detector — might be /10 data with a different label.
  const albumRating = text.match(
    /(?:^|[\s.,;()\[\]])Album\s+Rating\s*[:：]\s*(\d(?:\.\d{1,2})?)\b/i
  );
  if (albumRating) {
    const score = parseFloat(albumRating[1]);
    if (score >= 0 && score <= 5) {
      return Math.max(0, Math.min(100, Math.round((score / 5) * 100)));
    }
  }

  // (5) Bare "N/M" or "N.M/10" without a label — reviews sign off
  // with a score but no "Score:" prefix ("3.5/5 Flaming Toilets Ov
  // Hell", "4.0/5 stars"). We scan the whole stripped text and
  // pick the LAST recognised fraction-with-editorial-scale match:
  // body-prose "4 out of 10 songs are great" style mentions come
  // before the final sign-off, and the last occurrence is almost
  // always the critic's number. Scale whitelist (5 / 10 / 100)
  // filters obvious non-score fractions like "4/4 time signature".
  // /20 used to be allowed for French zines but caused real-world
  // false positives (toiletovhell's sidebar link "4/20 Playlist" got
  // picked over the actual "2.5/5" review score). Labelled /20 still
  // works via rule (1) — unlabelled /20 is too collision-prone with
  // dates and track numbers to stay in the bare-fraction whitelist.
  const bareRe = /(?:^|[\s(])(\d{1,2}(?:[.,]\d{1,2})?)\s*\/\s*(5|10|100)(?=\s|[.,)]|$)/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = bareRe.exec(text)) !== null) lastMatch = m;
  if (lastMatch) {
    const score = parseFloat(lastMatch[1].replace(',', '.'));
    const scale = parseInt(lastMatch[2], 10);
    if (score >= 0 && score <= scale) {
      return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
    }
  }

  return null;
}

// Some review themes embed the rating as a static image whose FILENAME
// encodes the numerator — e.g. metal-roos.com.au serves
// `/wp-content/uploads/helpers/Rating4.png` for a 4/5 review ("4
// kangaroos"), stereoboard.com serves `/images/icons/stars/x4-0.png`
// for a 4.0/5 review. stripHtml drops the <img> tag and detectStarRating
// doesn't look at src attrs, so these slip through.
//
// Two patterns now recognised:
//   (a) Filename starts with Rating/Ratings/Star(s)/Score:
//         Rating4.png / rating-4.png / Rating_3-5.png /
//         stars-4.5.png / Score4.png
//   (b) Path contains /stars/ and the filename encodes the numerator
//       with an optional short prefix (x, star-, etc.):
//         /stars/x4-0.png → 4.0/5
//         /stars/4.png    → 4/5
//         /stars/rating-3-5.png → 3.5/5
//
// Both branches bound the integer numerator at 0-5; wider scales here
// are unusual and prone to false positives from unrelated decorative
// images.
function detectFilenameRatingImage(html: string): number | null {
  const patterns = [
    /\/(?:Rating|Ratings|Stars?|Score)[-_]?(\d)(?:[-_.](\d))?\.(?:png|jpe?g|webp|svg)\b/gi,
    /\/stars\/[a-z_-]*?(\d)(?:[-_.](\d))?\.(?:png|jpe?g|webp|svg)\b/gi,
    // Digit-first variant: "4-5-stars.png", "4_5_stars.jpg", "3-stars.png".
    // The other two patterns cover the Stars4-5.png convention; this one
    // covers the opposite shape common on WordPress uploads (e.g.
    // nosuchthingasnirvana.wordpress.com/.../4-5-stars.png). Without
    // this, Claude fell back to the alt text "4.5 stars" to derive the
    // score, which made the attribution look invented even though it
    // wasn't — the detector now owns this case explicitly.
    /\/(\d)(?:[-_.](\d))?[-_]?stars?\.(?:png|jpe?g|webp|svg)\b/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const whole = parseInt(m[1], 10);
      if (!Number.isFinite(whole) || whole < 0 || whole > 5) continue;
      const frac = m[2] ? parseInt(m[2], 10) / 10 : 0;
      const rating = whole + frac;
      if (rating < 0 || rating > 5) continue;
      return Math.round((rating / 5) * 100);
    }
  }
  return null;
}

// Detects when the page's own tag / category metadata marks it as
// "spotify" content. Reviews that are genuinely about the album
// shouldn't be tagged with Spotify (it's a streaming service, not a
// genre/descriptor) — when they are, the post is almost always a
// playlist announcement, streaming-links roundup, or press release,
// not editorial criticism. Checks three common tag conventions:
//   WordPress core:     <a rel="tag">Spotify</a>
//   Custom tag themes:  <a class="post-tag|tag-link|tag">Spotify</a>
//   OpenGraph article:  <meta property="article:tag" content="Spotify">
function hasSpotifyTag(html: string): boolean {
  const patterns: RegExp[] = [
    /<a[^>]*\brel\s*=\s*"[^"]*\btag\b[^"]*"[^>]*>\s*spotify\b/i,
    /<a[^>]*\bclass\s*=\s*"[^"]*\b(?:post-tag|tag-link|tag-cloud-link|entry-tag)\b[^"]*"[^>]*>\s*spotify\b/i,
    /<meta[^>]*property\s*=\s*"article:tag"[^>]*content\s*=\s*"[^"]*\bspotify\b/i,
  ];
  // keyword meta is deliberately NOT checked — many outlets keyword-
  // stuff "spotify" into review pages for SEO even when the review
  // itself is editorial. Only structured tag markup counts.
  return patterns.some((re) => re.test(html));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// Jina Reader fetches the URL through a headless browser and converts
// the result to clean article markdown — boilerplate nav/footer/ads
// stripped, JS-rendered content captured. Free tier (no API key) caps
// at 20 req/min which is plenty for the single-operator manual flow.
// r.jina.ai/ accepts the target URL appended raw (no encoding) per
// Jina's docs.
async function fetchJinaReader(url: string): Promise<string | null> {
  try {
    const resp = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: 25000, // headless browser path can be slow on first hit
      responseType: 'text',
      headers: {
        // Hint Jina to skip their own telemetry banner at the top of
        // the response. Without X-Return-Format we still get markdown
        // but with a 2-3 line "Source URL:" preamble that Claude can
        // handle fine — keep a safety truncation downstream regardless.
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
      },
    });
    const body = typeof resp.data === 'string' ? resp.data : String(resp.data);
    return body.trim().length > 0 ? body : null;
  } catch (err) {
    console.warn(`[jina] fetch failed for ${url}:`, (err as Error).message);
    return null;
  }
}

// Jina returns 200 for several "we couldn't really get the content"
// scenarios: Cloudflare / bot-wall HTML dumped verbatim, Jina's own
// rate-limit error (`SecurityCompromiseError: Anonymous access to
// domain X blocked ...`), and "Target URL returned error 403"
// warnings. All of those pass the downstream length check and get
// fed to Claude, which then correctly tags them "not a review" —
// our scrape_failures log showed 6-of-7 false-positive rejections
// caused by exactly this. Sniff the patterns ourselves and treat as
// a real upstream failure instead.
function isJinaErrorPayload(text: string | null): boolean {
  if (!text) return false;
  const head = text.slice(0, 1500);
  return (
    /SecurityCompromiseError/i.test(head) ||
    /DDoS attack suspected/i.test(head) ||
    /Warning:\s*Target URL returned error/i.test(head) ||
    /This page maybe requiring CAPTCHA/i.test(head) ||
    /Performing security verification/i.test(head) ||
    /just a moment\.\.\./i.test(head) ||
    /cf-browser-verification|cf-chl-/i.test(head)
  );
}

async function fetchRawHtml(
  url: string
): Promise<
  | { ok: true; html: string }
  | { ok: false; reason: ScrapeFailureReason; status?: number; message?: string }
> {
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      maxContentLength: 4_000_000,
      responseType: 'text',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    if (isCloudflareChallenge(html)) {
      return { ok: false, reason: 'bot-blocked', status: 200, message: 'cloudflare challenge on 200' };
    }
    return { ok: true, html };
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    const body = typeof axiosErr.response?.data === 'string' ? axiosErr.response.data : '';
    const status = axiosErr.response?.status;
    // 401 / 403 = the page exists but we're not allowed through. Even if
    // Jina manages to bypass with its proxy infrastructure, ordinary
    // visitors clicking the saved URL from a review card will hit the
    // same wall. Treat as bot-blocked so the scrape outer flow can drop
    // the URL rather than save an unreachable citation.
    // (musicwaves.org returned 403 across all browser UAs + referers.)
    const reason: ScrapeFailureReason =
      isCloudflareChallenge(body) || status === 401 || status === 403
        ? 'bot-blocked'
        : 'fetch-failed';
    return { ok: false, reason, status, message: axiosErr.message ?? String(err) };
  }
}

// Fallback fetch via the Wayback Machine for sites whose live edition
// is bot-blocked but whose archive.org snapshots are reachable
// (metalstorm, metalcrypt, ghostcultmag, etc. — rich editorial bodies
// behind reader walls). Two-step:
//   1. Hit the availability API to find the closest snapshot. Cheap
//      JSON, no auth.
//   2. Fetch the snapshot via the `id_` modifier so Wayback returns
//      the original archived page bytes without injecting its toolbar
//      or rewriting links — the score detectors and Claude extraction
//      need to see the page exactly as it was when archived.
// The original URL stays as full_review_url; only the bytes we feed
// into the detector + LLM pipeline come from the snapshot. End-user
// click-through still hits the original (possibly bot-blocked) page,
// which is the same UX as before — but we go from "no review" to "we
// have the review text and score, click-through is the only friction".
async function fetchWayback(
  url: string
): Promise<{ ok: true; html: string; timestamp: string } | { ok: false }> {
  try {
    const availResp = await axios.get('https://archive.org/wayback/available', {
      params: { url },
      timeout: 8000,
      validateStatus: (s) => s === 200,
    });
    const closest = availResp.data?.archived_snapshots?.closest as
      | { available?: boolean; url?: string; timestamp?: string }
      | undefined;
    if (!closest?.available || !closest.url) return { ok: false };
    const snapshotUrl = String(closest.url);
    // closest.url is "https://web.archive.org/web/<ts>/<original>".
    // Inserting "id_" between the timestamp and the original URL
    // gives us the raw mirrored page (no toolbar, no link rewrites).
    const idUrl = snapshotUrl.replace(/\/web\/(\d+)\//, '/web/$1id_/');
    const resp = await axios.get(idUrl, {
      timeout: 15000,
      maxContentLength: 4_000_000,
      responseType: 'text',
      validateStatus: (s) => s === 200,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    if (html.length < 500) return { ok: false };
    return { ok: true, html, timestamp: String(closest.timestamp || '') };
  } catch {
    return { ok: false };
  }
}

// Interview / Q&A structure detector. Runs on Jina markdown before
// the Claude extraction call. Catches interview pages whose URL slug
// can't be matched by EXCLUDED_URL_PATH_PATTERNS — the trigger case
// was highwiredaze.com/2025/11/11/avralizeint1/, whose slug ("int1")
// is too short to regex safely but whose body is an unmistakable Q&A
// transcript: 16 `**Bastian:**` / `**Severin:**` speaker tags and 15
// italic-bold question lines.
//
// Two independent signals, either triggers a refusal:
//   (1) Speaker-attribution: the same `**Name:**` token repeating 4+
//       times. Reviews that quote the artist once or twice pass
//       through; an actual interview has the speaker tag before every
//       answer and crosses the threshold easily.
//   (2) Italic-bold questions: `_**...?**_` appearing 3+ times.
//       Reviews almost never use this markup; interviewers use it for
//       every question line.
//
// A small label whitelist (Verdict, Rating, Score, Producer, …) is
// excluded from the speaker-name count so review metadata blocks
// ("**Verdict:** 85/100") don't trip the detector.
const NON_SPEAKER_LABELS = new Set([
  'Verdict', 'Rating', 'Score', 'Scores', 'Label', 'Producer',
  'Release', 'Tracklist', 'Personnel', 'Lineup', 'Genre', 'Style',
  'Length', 'Duration', 'Artist', 'Album', 'Title', 'Track', 'Tracks',
  'Highlights', 'Recommended', 'Conclusion', 'Summary', 'Overview',
  'Standouts', 'Pros', 'Cons', 'Band', 'Format', 'Country', 'Year',
  'Review', 'Reviewed', 'Written', 'Author', 'Date', 'Published',
  'Note', 'Notes', 'Credits', 'Recording', 'Mixed', 'Mastered',
  'Released', 'Buy',
]);

function detectInterviewStructure(text: string): boolean {
  // Title-based check first — Jina puts "Title: ..." at the very top
  // of its output and many interview pages declare themselves right
  // there (e.g. "Title: Interview - Johnny Gioeli/Hardline ..." on
  // sarkophag-rocks.com). This catches plain-text Q&A layouts where
  // the interviewer asks questions as regular paragraphs ending in
  // "?" — those have no speaker tags or bold-question markup for
  // the structural signals below to latch onto. Scoped to the first
  // 1000 chars because "Title:" can appear incidentally later in a
  // review's body (e.g. quoted chapter titles from concept albums).
  const head = text.slice(0, 1000);
  const titleMatch = head.match(/(?:^|\n)Title:\s*([^\n]+)/i);
  if (titleMatch) {
    const title = titleMatch[1];
    // Multi-language interview terms. "Mailinterview" is a single
    // word on German sites. "Entrevista" / "Im Gespräch" / "En
    // conversation" cover Spanish / German / French. Keep the list
    // to terms that almost never appear in genuine review titles.
    const interviewTerms =
      /\b(interview|mailinterview|q[\s&]*a|q[\s-]and[\s-]a|entrevista|in conversation(?:\s+with)?|sat down (?:with|to talk)|im gespr(?:ä|ae)ch|en conversation)\b/i;
    if (interviewTerms.test(title)) return true;
  }

  const nameCount = new Map<string, number>();
  const nameRe = /\*\*([A-Z][a-zA-Z]{1,15}):\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text)) !== null) {
    const name = m[1];
    if (NON_SPEAKER_LABELS.has(name)) continue;
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  for (const count of nameCount.values()) {
    if (count >= 4) return true;
  }
  const questionRe = /_\*\*[^*]{8,300}\?\*\*_/g;
  const questionMatches = text.match(questionRe);
  if (questionMatches && questionMatches.length >= 3) return true;
  return false;
}

// Jina Reader renders the whole page, including nav, sidebar, cookie
// banners, and category listings, before the article body. On sites
// with heavy chrome (spectrumculture runs 33KB of nav before its
// Igorrr review body), that pushes the actual review past the slice
// cap. This trim finds a markdown heading that mentions the target
// album or artist and slices from there — typically where the article
// content starts. Matches at the very top of the document are skipped
// because they're usually the site's own logo/title heading; the
// post-body heading that repeats the album name shows up after the
// nav block.
function trimLeadingNavigation(md: string, artist: string, album: string): string {
  const artistLower = artist.toLowerCase();
  const albumLower = album.toLowerCase();
  const headingRe = /^#{1,3}\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(md)) !== null) {
    // Skip headings in the top few hundred bytes — those are the
    // site's own landing title, not the article-body heading we want.
    if (m.index < 500) continue;
    const title = m[1].toLowerCase();
    if (title.includes(albumLower) || title.includes(artistLower)) {
      return md.slice(m.index);
    }
  }
  return md;
}

export async function scrapeReviewFromUrl(
  url: string,
  artist: string,
  album: string,
  albumMbid: string | null = null
): Promise<ScrapeOutcome> {
  console.log(`[reviews] scrapeReviewFromUrl: ${url}`);

  // Defensive path-pattern guard for callers that bypass the discover
  // pipeline — the manual add-url / batch-scrape path feeds URLs
  // straight into this function without the path filter that the
  // discover endpoint applies. Without this check, admin pasting a
  // sputnikmusic.com/soundoff.php link (user-rating aggregator) or a
  // "best-of-2025" roundup URL would scrape normally. Domain
  // blacklist check is here too for symmetry with the discover flow.
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (isHostBlacklisted(host)) {
      recordScrapeFailure(url, albumMbid, 'blacklisted-domain', 'blacklisted domain');
      return { kind: 'fail', reason: 'blacklisted-domain', message: 'blacklisted domain' };
    }
    const pathKey = parsed.pathname + parsed.search;
    if (EXCLUDED_URL_PATH_PATTERNS.some((re) => re.test(pathKey))) {
      recordScrapeFailure(url, albumMbid, 'excluded-path', 'excluded path pattern');
      return { kind: 'fail', reason: 'excluded-path', message: 'excluded path pattern' };
    }
  } catch {
    // Invalid URL — let the fetch step handle it (it'll return a
    // fetch-failed reason with a clearer error message).
  }

  // Two parallel fetches: raw HTML (for visual/encoded score detectors
  // that need the original markup) and Jina Reader (for Claude's text
  // input — fewer tokens, JS-rendered content resolved, some bot walls
  // bypassed). Either can fail independently — we combine what succeeds.
  const [initialRawResult, jinaRaw] = await Promise.all([
    fetchRawHtml(url),
    fetchJinaReader(url),
  ]);

  // Wayback fallback when raw fetch is bot-blocked. archive.org
  // snapshots reach metalstorm / metalcrypt / ghostcultmag and similar
  // rich-content sites that block our scraper directly. On success
  // we substitute the snapshot bytes for the failed raw fetch and
  // continue the pipeline normally — detectors run, source name
  // extraction works, etc. The original URL is preserved as the
  // canonical review citation. On failure (no snapshot, or snapshot
  // also unreachable) we fall through to the existing bot-blocked
  // failure path below.
  let rawResult = initialRawResult;
  if (!rawResult.ok && rawResult.reason === 'bot-blocked') {
    const wb = await fetchWayback(url);
    if (wb.ok) {
      console.log(`[wayback] ${url} via snapshot ${wb.timestamp}`);
      rawResult = { ok: true, html: wb.html };
    }
  }

  const html = rawResult.ok ? rawResult.html : '';

  // Reject Jina output that's actually a Cloudflare challenge / DDoS
  // protection notice / Jina's own rate-limit error. These all
  // pass the "body length > 100" check but are meaningless text
  // that used to get sent to Claude and come back "not a review".
  const jinaText = isJinaErrorPayload(jinaRaw) ? null : jinaRaw;
  if (jinaRaw && !jinaText) {
    console.log(`[jina] error-payload detected for ${url} — discarded`);
  }
  const jinaAvailable = jinaText !== null && jinaText.length > 100;

  // If raw fetch reports the page as bot-blocked (401/403/Cloudflare
  // challenge), we refuse the scrape even when Jina managed to pull
  // content. Jina's proxy infrastructure can sometimes reach pages that
  // ordinary browsers can't, but end-users clicking a saved review card
  // URL would hit the same wall — so storing a Jina-only review means
  // every reader sees a broken "read full review" link. The musicwaves.
  // org case (all external visitors see HTTP 403) was the trigger.
  if (!rawResult.ok && rawResult.reason === 'bot-blocked') {
    recordScrapeFailure(url, albumMbid, 'bot-blocked', rawResult.message);
    return { kind: 'fail', reason: 'bot-blocked', message: rawResult.message };
  }

  // Hard-fail only if BOTH paths failed. If one worked we can still
  // produce a review, just with reduced fidelity (no detectors on Jina-
  // only path; no clean text on raw-only path).
  if (!rawResult.ok && !jinaAvailable) {
    const reason = rawResult.reason;
    recordScrapeFailure(url, albumMbid, reason, rawResult.message);
    return { kind: 'fail', reason, message: rawResult.message };
  }

  // Tag-based exclusion: pages whose own tag / category metadata
  // includes "spotify" are almost always streaming-link posts,
  // playlist roundups, or press-release-style announcements rather
  // than editorial album reviews. Catching this in raw HTML is cheap
  // and short-circuits both the score-detector pass and the Claude
  // extraction call. Checks WordPress rel="tag" anchors, generic
  // post-tag/tag-link class anchors, and OpenGraph article:tag meta.
  if (rawResult.ok && hasSpotifyTag(html)) {
    recordScrapeFailure(url, albumMbid, 'not-a-review', 'page tagged "spotify"');
    return { kind: 'fail', reason: 'not-a-review', message: 'page tagged "spotify"' };
  }

  // Run score detectors on raw HTML when available. These need the
  // original <img>/<i>/class markup and don't work on Jina markdown.
  // Priority order, highest-trust first: (1) FontAwesome / Unicode star
  // icons, (2) filename-encoded rating images (Rating4.png and
  // friends), (3) text-labelled numeric scores ("Score: 90/100").
  let detectedScore: number | null = null;
  if (rawResult.ok) {
    // Site-specific handler runs first — high-confidence per-site
    // knowledge (sputnikmusic reviewer box, metaltrenches Highcharts
    // config, etc.) that would otherwise be shadowed by a generic
    // detector landing on the wrong number.
    const siteScore = detectSiteSpecificScore(html, url);
    // Schema.org microdata next — when a page declares its own rating
    // via <meta itemprop="ratingValue"> that's the author's explicit
    // statement of the score for search engines, higher trust than any
    // visual-element guessing. ramzine's multiple star-icon widgets
    // (related-review teasers, then the actual review's overall stars)
    // would otherwise land on the wrong one in document order.
    const schemaScore = siteScore === null ? detectSchemaOrgRating(html) : null;
    const starScore =
      siteScore === null && schemaScore === null
        ? detectStarRating(html)
        : null;
    const ariaScore =
      siteScore === null && schemaScore === null && starScore === null
        ? detectAriaLabelRating(html)
        : null;
    // Widget-specific detectors run ahead of the filename/numeric
    // detectors because these pages often ALSO have sidebar widgets
    // or user-review blocks with X/10 markup — explicit-numeric would
    // grab the last X/10 match and land on the wrong album or user
    // rating.
    const wpprScore =
      siteScore === null &&
      schemaScore === null &&
      starScore === null &&
      ariaScore === null
        ? detectWpProductReviewRating(html)
        : null;
    const wpReviewScore =
      siteScore === null &&
      schemaScore === null &&
      starScore === null &&
      ariaScore === null &&
      wpprScore === null
        ? detectWpReviewPluginRating(html)
        : null;
    const filenameRatingScore =
      siteScore === null &&
      schemaScore === null &&
      starScore === null &&
      ariaScore === null &&
      wpprScore === null &&
      wpReviewScore === null
        ? detectFilenameRatingImage(html)
        : null;
    const numericScore =
      siteScore === null &&
      schemaScore === null &&
      starScore === null &&
      ariaScore === null &&
      wpprScore === null &&
      wpReviewScore === null &&
      filenameRatingScore === null
        ? detectExplicitNumericScore(html)
        : null;
    detectedScore =
      siteScore ??
      schemaScore ??
      starScore ??
      ariaScore ??
      wpprScore ??
      wpReviewScore ??
      filenameRatingScore ??
      numericScore;
    if (detectedScore !== null) {
      const source =
        siteScore !== null
          ? 'site-specific'
          : schemaScore !== null
            ? 'schema-org'
            : starScore !== null
              ? 'star'
              : ariaScore !== null
                ? 'aria-label'
                : wpprScore !== null
                  ? 'wppr'
                  : wpReviewScore !== null
                    ? 'wp-review'
                    : filenameRatingScore !== null
                      ? 'filename-image'
                      : 'explicit-numeric';
      console.log(`[reviews] detected ${source} score ${detectedScore}/100 for ${url}`);
    }
  }

  // Prefer Jina's cleaned markdown for Claude's input — significantly
  // fewer tokens vs stripHtml of the whole page, and boilerplate nav/
  // comments are already gone. Fall back to stripHtml when Jina didn't
  // work (rate limit, their upstream error, etc.).
  //
  // Slice cap of 40000 chars (≈10k tokens on DeepSeek) because some
  // WordPress sites produce Jina output with 30KB+ of sidebar nav
  // before the actual article body — spectrumculture's Igorrr review
  // lives at offset ~33000 in its Jina markdown. Trimming leading nav
  // (trimLeadingNavigation) shaves most of that, but the higher slice
  // cap is there as a safety net for sites the trim heuristic can't
  // handle.
  const rawText = jinaAvailable ? jinaText! : stripHtml(html);
  const trimmed = jinaAvailable
    ? trimLeadingNavigation(rawText, artist, album)
    : rawText;
  const pageText = trimmed.slice(0, 40000);
  if (pageText.length < 100) {
    recordScrapeFailure(url, albumMbid, 'text-too-short');
    return { kind: 'fail', reason: 'text-too-short' };
  }

  // Q&A structure guard. Catches interview pages whose URL slug
  // couldn't be regex'd (cryptic shorthand like /avralizeint1/). The
  // editorial-refusal rule in the Claude prompt does flag interviews,
  // but Haiku occasionally extracts a paraphrased "excerpt" and makes
  // up a score instead of returning the error key — refusing here
  // avoids both the cost and the laundered-interview storage.
  if (detectInterviewStructure(pageText)) {
    recordScrapeFailure(url, albumMbid, 'not-a-review', 'interview/Q&A structure');
    return { kind: 'fail', reason: 'not-a-review', message: 'interview/Q&A structure' };
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // ignore
  }

  const prompt = `Extract a single album review's info from this page about "${album}" by ${artist}.

URL: ${url}
PAGE TEXT (cleaned markdown via Jina Reader, or stripped HTML if Jina was unavailable):
---
${pageText}
---

Return ONLY JSON, no prose:
{
  "sourceName": "Publication name (e.g. Pitchfork, Angry Metal Guy). Derive from the page or the domain '${hostname}' if unclear.",
  "score": 85,
  "scoreMax": 100,
  "excerpt": "One or two sentences quoted or paraphrased from the review body, in the original language.",
  "excerptKo": "한국어 요약. 매체명 언급 금지. **리뷰어 본인이 1인칭으로 직접 말하는 것처럼** 오직 '~다 / ~한다' 문어체 평서문으로 작성. 존댓말('~합니다', '~입니다', '~네요') 절대 금지, 반말('~해', '~어', '~아') 절대 금지. '리뷰어는/평론가는/필자는' 등 3인칭 주어 금지, '~라고 평가한다/말한다/지적한다' 같은 전달체도 금지. **총 길이 130자 이내, 최대 2문장**. 카드 UI에 들어가는 발췌문이라 4-5줄을 넘기면 레이아웃이 깨짐 — 길면 핵심 한 문장으로 압축하세요."
}

Score: find the review's explicit rating and convert to a /100 integer. Follow these rules in order:

1. If the text has no explicit rating (just descriptive prose about the album), set score to null. Do NOT guess.
2. If the text has a clear label like "Score: X/Y", "Verdict: X/Y", "8 out of 10", "Rating: 4/5": convert using (X / Y) * 100, rounded. Example conversions:
   - 8/10 → 80
   - 8.5/10 → 85
   - 4/5 → 80
   - 4.5/5 → 90
   - 3/5 → 60
   - 85/100 → 85
3. Percentages like "Rating: 85%" → 85 (already /100).
4. "Album Rating: 4.0" (Sputnikmusic style, no visible denominator) → treat as /5. So 4.0 → 80, 3.5 → 70, 5.0 → 100.
5. If you see numbers in the text that are NOT the album's rating — track lengths, release years, "5 of 10 songs are great" style prose, "4 stars" about a different album — do NOT use them. score = null is correct.
6. QUALITATIVE ratings map to null — never guess a number. This includes:
   - Letter grades (A+, B-, etc.)
   - Word ratings like "Great!", "Excellent", "Good", "Okay", "Mediocre", "Disappointing"
   - Publication-specific scales (e.g. Angry Metal Guy's Great/Excellent/Good system maps internally to 4/5/3/5 BUT we treat them as null — the site reader should see admin-confirmed numbers, not our reverse-engineered conversions)
   If a page has ONLY a word rating and no visible number, score = null.
7. If unsure, prefer null over a guess. A null score is fine; a wrong score is worse.

Language: the review may be in English, Dutch, German, French, Spanish, Italian, Portuguese, Swedish, Korean, Japanese, or any other language. Non-English reviews are valid. Extract the excerpt in the review's original language; still produce a Korean excerptKo regardless of the source language.

Excerpt: pick whatever prose about the album you can find. Evaluative sentences first, but if the page only has descriptive prose (release context, band history, track-by-track discussion) include that instead. Skip pure navigation text, ads, and tracklists-only pages. "[Read more...]" preview links or aggregator-style listings with a short paragraph still count — extract what's there.

Be AGGRESSIVE about extracting when the page IS an album review. The cost of refusing a genuine review is higher than saving a weak excerpt.

BUT: strictly refuse the following non-review page types, even when they mention the album by name. Return {"error":"not an album review"} with no prose:
 - Live / concert / gig / tour review or report (the page is about a specific live show, not the studio album). Signals: specific date + venue at the top, prose about "tonight", "stage", "audience", "setlist", "encore".
 - Interview or Q&A with the artist (even if the album is discussed). Signals: question/answer format, "we spoke with", "told us", "said".
 - Release announcement / news piece with no evaluative content. Signals: press-release-style phrasing about an upcoming record, tour announcement, single premiere.
 - Roundup / year-end / best-of / "X albums you should hear" list covering multiple albums.
 - Track-by-track preview / analysis published BEFORE the album (a listening diary from embargo, not a review).
 - A different album's review page (the page is about an unrelated record).
 - Artist discography / recommendation catalogue covering multiple albums by the same artist (e.g. "Big Black Album Recommendations" with Atomizer, Racer-X, Bulldozer, Lungs sections and per-album ratings). Even if the target album "${album}" has its own section, refuse — the scraper tends to leak prose from adjacent sections into the excerpt. Admin can still add via the per-album subpage URL if one exists.
 - 404 / error / no-results / under-maintenance page.
 - User-generated community review site the domain blacklist missed (visible signals: "edit this review", username/avatar beside the review body, "report abuse" link, sign-up CTA, "Write a review" buttons).

Refusal format is STRICT: ONLY the error key, nothing else. Do NOT put the refusal as prose into the excerpt / excerptKo fields. When in doubt between "weak album review" and "non-review content about the album", pick the refusal — admin can paste the URL manually via the 수동 입력 tab if they disagree.`;

  try {
    const rawText = await extractJsonWithFallback('scrape_review', prompt, 2000);
    if (!rawText) {
      recordScrapeFailure(url, albumMbid, 'claude-no-text');
      return { kind: 'fail', reason: 'claude-no-text' };
    }

    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      recordScrapeFailure(url, albumMbid, 'json-parse-failed', jsonText.slice(0, 200));
      return { kind: 'fail', reason: 'json-parse-failed', message: jsonText.slice(0, 200) };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      recordScrapeFailure(url, albumMbid, 'not-a-review', String(parsed.error));
      return { kind: 'fail', reason: 'not-a-review', message: String(parsed.error) };
    }

    // Second line of defense: the LLM sometimes describes its own
    // refusal as prose inside excerpt / excerptKo instead of using the
    // {"error":"..."} structure it was told to use. Catches roundup
    // posts and wrong-album pages that slipped past the editorial
    // filter. Patterns cover English + Korean since excerpt may be
    // either and excerptKo is always Korean.
    const rejectionPatterns = [
      /제공된 페이지/,
      /리뷰가?\s*(?:포함되[^가-힣]*않|없|찾을 수 없)/,
      /이\s*페이지에는\s*[^가-힣]*리뷰만?\s*수록/,
      /no review (?:of|for)\s+(?:this|the)/i,
      /this page (?:does not|doesn't)\s+(?:contain|include|have)/i,
      /(?:page|article|text)\s+is\s+(?:about|covering)\s+(?:other|different|another)\s+albums?/i,
      // Error-page / downtime guards. stormbringer.at once served a
      // "데이터베이스 연결 오류로 리뷰 내용을 확인할 수 없습니다" page and
      // that text ended up stored as an excerpt. The detector fires on
      // either the English or Korean side — whichever language the LLM
      // echoed the error message in.
      /데이터베이스\s*연결\s*오류/,
      /잠시\s*후\s*다시\s*시도/,
      /연결\s*오류로\s*(?:리뷰|내용|페이지)/,
      /database\s*connection\s*(?:error|failed|unavailable)/i,
      /(?:server|site|page)\s*is\s*(?:temporarily\s*)?unavailable/i,
      /(?:site|page|service)\s*(?:is\s*)?under\s*maintenance/i,
      /please\s*try\s*again\s*(?:later|in a)/i,
      // Page-load failure described as prose. Fetched fine on our
      // end (Jina + raw both succeeded enough to reach the LLM) but
      // the LLM still wrote "페이지가 로드되지 않아 리뷰 내용을 확인할
      // 수 없다" into the excerpt — usually because the page was an
      // SPA shell whose body landed empty after JS-strip. The
      // pattern matches "페이지가 로드/열리/뜨지 않" along with the
      // English "page failed to load" / "couldn't load this page"
      // shapes. Pair with the broader "리뷰/페이지/내용을 확인할 수
      // 없" guard so summaries that admit they couldn't verify the
      // review get rejected too.
      /페이지[가은는이]?\s*(?:정상적으로\s*)?(?:로드되|열리|뜨)[^.]{0,10}않/,
      /(?:리뷰|평론|기사|내용|페이지)\s*(?:내용)?[을를은는이가]?\s*확인[^가-힣]{0,15}(?:할\s*수\s*없|되지\s*않|불가능?)/,
      /(?:서버|사이트)\s*(?:응답|반응)[이가]?\s*없/,
      /(?:page|article)\s+(?:failed\s+to\s+load|did(?:n't|\s+not)\s+load|couldn't\s+(?:be\s+)?load(?:ed)?)/i,
      /(?:unable|failed)\s+to\s+(?:load|access|retrieve|fetch)\s+(?:the\s+)?(?:page|review|content|article)/i,
      // "Metadata / tracklist page, not an actual review" style
      // meta-commentary. The LLM occasionally describes the page's
      // contents ("이 페이지는 트랙리스트, 발매 정보, … 앨범 세부 정보를
      // 제공하지만, 앨범의 내용이나 품질에 대한 명시적인 리뷰 텍스트나
      // 평가적 문장은 포함되어 있지 않습니다") instead of returning the
      // error key. Any of these phrases indicates the excerpt is meta-
      // commentary about missing review content, not review content.
      /평가적\s*(?:문장|표현|내용|서술)[은는이가]?\s*(?:포함되[^가-힣]*않|없|찾을 수 없|부재)/,
      /(?:명시적인?|구체적인?|직접적인?)\s*(?:리뷰\s*텍스트|평가\s*문장|평가적\s*문장|리뷰\s*내용)/,
      // The 포함되 → 않 gap may carry auxiliary verbs ("포함되어 있지
      // 않다", "포함되지 않는다") so we can't constrain to non-Hangul
      // chars between them; bound it to the same sentence (no period)
      // and a reasonable distance instead.
      /(?:리뷰|평론)\s*(?:텍스트|내용|본문)[은는이가]?\s*포함[되하][^.]{0,15}않/,
      /(?:리뷰|평론)\s*(?:텍스트|내용|본문)[은는이가]?\s*없/,
      // "리뷰가 [올라오지 / 게재되지 / 등록되지 / 작성되지 / 실리지]
      // 않[다/았다]" — the page exists but has no review yet. Common
      // phrasing on retail-site listings before a release lands.
      /리뷰가?\s*(?:올라오|게재되|등록되|작성되|실리)[^.]{0,15}않/,
      // "평가[를/가] [포함하지 / 담고 있지 / 싣지 / 제공하지] 않[다]" —
      // LLM describing the source as evaluation-free instead of
      // returning the {error} key.
      /평가[을를는이가]?\s*(?:포함하지|담고\s*있지|싣지|제공하지|적지)[^.]{0,15}않/,
      // "[발표 / 발매 / 보도 / 공연] 소식만 [전한다 / 알린다 / 다룬다]" —
      // page is an announcement, not a review.
      /(?:발표|발매|보도|공연|투어)\s*소식만\s*(?:전|알리|다루|기록|싣|올리)/,
      /앨범\s*세부\s*정보[을를은는이가]?\s*제공/,
      /트랙리스트[\s\S]{0,50}(?:발매\s*정보|세부\s*정보|메타데이터)/,
      /(?:page|article)\s+(?:provides|offers|shows)\s+(?:only\s+)?(?:tracklist|metadata|release\s+info)/i,
      /no\s+(?:explicit|specific|actual)\s+review\s+(?:text|content|prose)/i,
      // Search-results / empty-hits landing page echo. Some scrape
      // targets serve a "no results" page with a generic message when
      // the album slug doesn't resolve, and the LLM writes that
      // phrasing straight into the excerpt.
      /검색\s*결과(?:가|를)?\s*(?:없|찾을 수 없|존재하지 않)/,
      /no\s+(?:search\s+)?results?\s+(?:found|for)/i,
      // Meta-commentary where Claude admits the page is an interview
      // / live report / announcement but still writes a summary
      // instead of returning the error key. Only matches the "this
      // page IS an X" shape so that a review which happens to mention
      // an interview or live show in prose doesn't get rejected.
      /(?:this\s+is|this\s+page\s+is|the\s+(?:page|article|content)\s+is)\s+(?:an?\s+)?(?:interview|live\s+(?:show\s+)?review|concert\s+(?:review|report)|tour\s+report|announcement|press\s+release)/i,
      /(?:이\s*(?:페이지|글|기사)(?:는|가)?)\s*(?:인터뷰|라이브\s*공연|콘서트\s*(?:리뷰|리포트)|발매\s*소식|보도\s*자료)/,
      /(?:the\s+article|this\s+piece)\s+(?:is\s+)?(?:not\s+)?(?:an\s+)?album\s+review\s*[,.;]/i,
    ];
    const prose = `${parsed.excerpt ?? ''}\n${parsed.excerptKo ?? ''}`;
    if (rejectionPatterns.some((re) => re.test(prose))) {
      recordScrapeFailure(url, albumMbid, 'not-a-review-in-prose', prose.slice(0, 200));
      return {
        kind: 'fail',
        reason: 'not-a-review',
        message: 'LLM described refusal as prose instead of using the error key',
      };
    }

    return {
      kind: 'ok',
      review: {
        sourceName:
          (typeof parsed.sourceName === 'string' && parsed.sourceName.trim()) ||
          hostname ||
          'Unknown',
        score: detectedScore ?? clampScore(parsed.score),
        scoreMax: 100,
        excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
        excerptKo: normaliseKoreanTerms(parsed.excerptKo),
        fullReviewUrl: url,
      },
    };
  } catch (err) {
    const msg = (err as Error).message;
    recordScrapeFailure(url, albumMbid, 'claude-error', msg);
    return { kind: 'fail', reason: 'claude-error', message: msg };
  }
}

// Manual-entry counterpart to scrapeReviewFromUrl for sites that
// block crawling (Korean webzines, paywalled publications). Admin
// hand-pastes the article body; Claude only does the excerpt
// extraction + Korean summarisation. Source name is given by admin,
// so no domain/page heuristics needed. Claude still tries to spot
// a numeric score in the body — if admin doesn't supply one, we
// fall back to what Claude found.
//
// Same cost profile as scrapeReviewFromUrl (~$0.003/call) — single
// Haiku pass on pre-stripped text.
export async function extractFromPastedText(
  body: string,
  artist: string,
  album: string,
  sourceName: string
): Promise<{
  score: number | null;
  scoreMax: number;
  excerpt: string;
  excerptKo: string;
} | null> {
  const trimmed = body.trim().slice(0, 20000);
  if (trimmed.length < 50) {
    console.warn('[reviews] pasted body too short');
    return null;
  }

  const prompt = `Extract review info from this hand-pasted article text about "${album}" by ${artist}, published by ${sourceName}.

ARTICLE TEXT:
---
${trimmed}
---

Return ONLY JSON, no prose:
{
  "score": 85,
  "scoreMax": 100,
  "excerpt": "One or two sentences quoted or paraphrased from the article body, original language.",
  "excerptKo": "한국어 요약. 매체명 언급 금지. **리뷰어 본인이 1인칭으로 직접 말하는 것처럼** 오직 '~다 / ~한다' 문어체 평서문으로 작성. 존댓말('~합니다', '~입니다', '~네요') 절대 금지, 반말('~해', '~어', '~아') 절대 금지. '리뷰어는/평론가는/필자는' 등 3인칭 주어 금지, '~라고 평가한다/말한다/지적한다' 같은 전달체도 금지. **총 길이 130자 이내, 최대 2문장**. 카드 UI에 들어가는 발췌문이라 4-5줄을 넘기면 레이아웃이 깨짐 — 길면 핵심 한 문장으로 압축하세요."
}

Score: convert any scale to /100 (X/10→X*10, X/5→X*20, X/4→X*25, letter A+→97 A→93 A-→90 B+→87 B→83 ...). If no explicit score in the text, set null.
Excerpt: pick the most evaluative sentence(s) from the body.
If the text is clearly NOT a review (shop listing, track list only, marketing copy), return {"error":"not a review"} instead.`;

  try {
    const rawText = await extractJsonWithFallback('manual_review', prompt, 2000);
    if (!rawText) return null;

    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      console.warn('[reviews] Claude flagged pasted text as not a review:', parsed.error);
      return null;
    }

    return {
      score: clampScore(parsed.score),
      scoreMax: 100,
      excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
      excerptKo: normaliseKoreanTerms(parsed.excerptKo),
    };
  } catch (err) {
    console.error('[reviews] manual-extract failed:', (err as Error).message);
    return null;
  }
}
