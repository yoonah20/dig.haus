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
import { execute } from '../db/index.js';

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
export const EXCLUDED_URL_DOMAINS = [
  'discogs.com',
  'amazon.',
  'ebay.',
  'rateyourmusic.com',
  'albumoftheyear.org',
  'metacritic.com',
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
  // Encyclopaedia Metallum — user-submitted review aggregator. Multiple
  // user reviews per album confuse the "one editorial take per source"
  // model we're building around. Admin can still hand-pick a specific
  // reviewer's take via the manual paste-in tab when a notable reviewer's
  // opinion is worth preserving.
  'metal-archives.com',
  // YouTube — occasionally indexed as a review target but overwhelmingly
  // just playback / music video / reaction content. Any legitimate video
  // review (e.g. Fenriz-style channel takes) admin can paste manually.
  'youtube.com',
  'youtu.be',
];

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
  const ICON_RE = /<i\b[^>]*class\s*=\s*"([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = containerRe.exec(html)) !== null) {
    const window = html.slice(m.index, m.index + 2000);
    let full = 0,
      half = 0,
      empty = 0;
    let icon: RegExpExecArray | null;
    // Reset lastIndex — ICON_RE is global and reused across loop iterations.
    ICON_RE.lastIndex = 0;
    while ((icon = ICON_RE.exec(window)) !== null) {
      const classes = icon[1];
      if (!/\bfa-star/.test(classes)) continue;
      const isHalf = /\bfa-star-half/.test(classes);
      // `far` (FontAwesome "regular" style) = outline-only = empty slot.
      // `fas` (solid) = filled. Anything else (fa-star with no style
      // prefix, or newer fa-solid / fa-regular forms) falls through to
      // "full" — safer default than dropping the icon silently.
      const isOutline = /\bfa-regular\b|\bfar\b/.test(classes);
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

  // "Score: 90/100" / "Rating: 4/5" / "Note: 8.5/10" / "점수: 85/100"
  const labelled = text.match(
    /\b(?:Score|Scoring|Rating|Note|Nota|Cijfer|Punkte|Punktzahl|평점|점수|評価|点数)\s*[:：]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,3})\b/i
  );
  if (labelled) {
    const score = parseFloat(labelled[1].replace(',', '.'));
    const scale = parseInt(labelled[2], 10);
    if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
      return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
    }
  }

  // "8 out of 10" / "4.5 out of 5". Unanchored, so require the scale to
  // still be a recognised editorial one — that check drops "chapter 4
  // out of 12" or similar non-score sentences.
  const outOf = text.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s+out\s+of\s+(\d{1,3})\b/i);
  if (outOf) {
    const score = parseFloat(outOf[1].replace(',', '.'));
    const scale = parseInt(outOf[2], 10);
    if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
      return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
    }
  }

  return null;
}

// Some WordPress review themes embed the rating as a static image whose
// FILENAME encodes the numerator — e.g. metal-roos.com.au serves
// `/wp-content/uploads/helpers/Rating4.png` for a 4/5 review ("4
// kangaroos"). stripHtml drops the <img> tag and detectStarRating
// doesn't look at src attrs, so these slip through.
//
// Recognised shapes (all optional hyphen/underscore between name and
// number; fraction via dash, underscore, or dot):
//   Rating4.png         → 4/5
//   rating-4.png        → 4/5
//   Rating_3-5.png      → 3.5/5
//   stars-4.5.png       → 4.5/5
//   Score4.png          → 4/5
//
// Anchored on `/` so it matches the filename segment cleanly and won't
// fire on something like `metal-roos-rating-system.png`. Integer
// numerator bounded 0-5; wider scales here are unusual and prone to
// false positives from unrelated decorative images.
function detectFilenameRatingImage(html: string): number | null {
  const re = /\/(?:Rating|Ratings|Stars?|Score)[-_]?(\d)(?:[-_.](\d))?\.(?:png|jpe?g|webp|svg)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const whole = parseInt(m[1], 10);
    if (!Number.isFinite(whole) || whole < 0 || whole > 5) continue;
    const frac = m[2] ? parseInt(m[2], 10) / 10 : 0;
    const rating = whole + frac;
    if (rating < 0 || rating > 5) continue;
    return Math.round((rating / 5) * 100);
  }
  return null;
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
  | { ok: false; reason: ScrapeFailureReason; message?: string }
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
      return { ok: false, reason: 'bot-blocked', message: 'cloudflare challenge on 200' };
    }
    return { ok: true, html };
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    const body = typeof axiosErr.response?.data === 'string' ? axiosErr.response.data : '';
    const reason: ScrapeFailureReason = isCloudflareChallenge(body)
      ? 'bot-blocked'
      : 'fetch-failed';
    return { ok: false, reason, message: axiosErr.message ?? String(err) };
  }
}

export async function scrapeReviewFromUrl(
  url: string,
  artist: string,
  album: string,
  albumMbid: string | null = null
): Promise<ScrapeOutcome> {
  console.log(`[reviews] scrapeReviewFromUrl: ${url}`);

  // Two parallel fetches: raw HTML (for visual/encoded score detectors
  // that need the original markup) and Jina Reader (for Claude's text
  // input — fewer tokens, JS-rendered content resolved, some bot walls
  // bypassed). Either can fail independently — we combine what succeeds.
  const [rawResult, jinaRaw] = await Promise.all([
    fetchRawHtml(url),
    fetchJinaReader(url),
  ]);

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

  // Hard-fail only if BOTH paths failed. If one worked we can still
  // produce a review, just with reduced fidelity (no detectors on Jina-
  // only path; no clean text on raw-only path).
  if (!rawResult.ok && !jinaAvailable) {
    const reason = rawResult.reason;
    recordScrapeFailure(url, albumMbid, reason, rawResult.message);
    return { kind: 'fail', reason, message: rawResult.message };
  }

  // Run score detectors on raw HTML when available. These need the
  // original <img>/<i>/class markup and don't work on Jina markdown.
  // Priority order, highest-trust first: (1) FontAwesome / Unicode star
  // icons, (2) filename-encoded rating images (Rating4.png and
  // friends), (3) text-labelled numeric scores ("Score: 90/100").
  let detectedScore: number | null = null;
  if (rawResult.ok) {
    const starScore = detectStarRating(html);
    const filenameRatingScore = starScore === null ? detectFilenameRatingImage(html) : null;
    const numericScore =
      starScore === null && filenameRatingScore === null
        ? detectExplicitNumericScore(html)
        : null;
    detectedScore = starScore ?? filenameRatingScore ?? numericScore;
    if (detectedScore !== null) {
      const source =
        starScore !== null
          ? 'star'
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
  const pageText = jinaAvailable
    ? jinaText!.slice(0, 20000)
    : stripHtml(html).slice(0, 20000);
  if (pageText.length < 100) {
    recordScrapeFailure(url, albumMbid, 'text-too-short');
    return { kind: 'fail', reason: 'text-too-short' };
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
  "excerptKo": "2-3 문장 한국어 요약. 매체명 언급 금지, 평론가 시점."
}

Score: convert any scale to /100 (X/10→X*10, X/5→X*20, X/4→X*25, letter A+→97 A→93 A-→90 B+→87 B→83 ...). A descriptive-only review with no explicit number is perfectly valid — set score to null in that case.

Language: the review may be in English, Dutch, German, French, Spanish, Italian, Portuguese, Swedish, Korean, Japanese, or any other language. Non-English reviews are valid. Extract the excerpt in the review's original language; still produce a Korean excerptKo regardless of the source language.

Excerpt: pick whatever prose about the album you can find. Evaluative sentences first, but if the page only has descriptive prose (release context, band history, track-by-track discussion) include that instead. Skip pure navigation text, ads, and tracklists-only pages. "[Read more...]" preview links or aggregator-style listings with a short paragraph still count — extract what's there.

Be AGGRESSIVE about extracting. The cost of returning a weak excerpt + null score is low (admin can delete the row if useless). The cost of refusing ("not a review") when there was extractable content is much higher — it means we lose real coverage. Only return {"error":"not a review"} when the page text is truly unrelated: 404 pages, completely unrelated albums, pure navigation with zero descriptive prose about THIS album. When in ANY doubt, extract.`;

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
  "excerptKo": "2-3 문장 한국어 요약. 매체명 언급 금지, 평론가 시점."
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
