import axios from 'axios';
import {
  getClient,
  HAIKU,
  SONNET,
  logClaudeUsage,
  countWebSearchUses,
  stripSummaryPreamble,
  normaliseKoreanTerms,
} from './claude.js';
import { execute } from '../db/index.js';

// Append-only log of URL scrapes that didn't yield a review.
// Reason codes are deliberately short and stable so the admin
// aggregate query can GROUP BY them:
//   - fetch-failed: HTTP/network error (403 bot wall, timeout, etc.)
//   - text-too-short: page stripped to <100 chars (JS-rendered or empty)
//   - not-a-review: Claude flagged the page as non-review
//   - claude-no-text: Claude returned no text block (rare, usually API blip)
//   - claude-error: Claude call threw
//   - json-parse-failed: couldn't extract JSON from Claude's response
// errorMessage carries the caught exception text when available.
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

interface ReviewSearchResult {
  reviews: ReviewResult[];
  koreanSummary: string | null;
  artistKo: string | null;
  titleKo: string | null;
  titleMeaning: string | null;
}


// Non-editorial sources to exclude (shopping/marketplace/aggregators)
// Match against the lowercased sourceName via substring.
const EXCLUDED_SOURCE_PATTERNS = [
  'album of the year', 'albumoftheyear', 'aoty',
  'rateyourmusic', 'rate your music', 'rym',
  'metacritic',
  'discogs', 'amazon', 'ebay', 'bandcamp',
  'apple music', 'itunes', 'spotify',
  'hmv', 'tower records', 'towerrecords',
  'bestbuy', 'best buy', 'walmart', 'target.com',
  'yesasia', 'cdjapan', 'cd japan',
  'barnes & noble', 'barnesandnoble',
];

// Domains to exclude from fullReviewUrl.
// Substring match over the hostname — covers amazon.com/.co.jp/.de etc.
const EXCLUDED_URL_DOMAINS = [
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
];

function isExcludedSource(sourceName: string, url: string): boolean {
  const nameLower = sourceName.toLowerCase().trim();
  if (EXCLUDED_SOURCE_PATTERNS.some((p) => nameLower.includes(p))) return true;

  if (url) {
    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      hostname = url.toLowerCase();
    }
    if (EXCLUDED_URL_DOMAINS.some((d) => hostname.includes(d))) return true;
  }

  return false;
}

// Coalesce concurrent searches for the same album so we don't burn tokens
// calling Claude twice when two users hit the reviews endpoint simultaneously.
const _inflightSearches = new Map<string, Promise<ReviewSearchResult>>();

export function searchReviews(
  artist: string,
  album: string,
): Promise<ReviewSearchResult> {
  const key = `${artist}\u0001${album}`.toLowerCase();
  const existing = _inflightSearches.get(key);
  if (existing) return existing;
  const p = _searchReviewsImpl(artist, album).finally(() => {
    _inflightSearches.delete(key);
  });
  _inflightSearches.set(key, p);
  return p;
}

// Pricing used for the in-pipeline budget check. Kept in sync with
// server/src/routes/admin.ts PRICING_PER_1M — if that changes, bump
// this too. Rates are per 1M tokens (input/output) and per 1000 web
// searches. The check itself is intentionally conservative: we only
// block progress when Step 1 *already* spent more than the ceiling
// (the call completed before we knew the real usage), so the goal is
// to stop Step 2 + Step 3 from adding another ~$0.03 on top of a
// runaway Step 1.
const HAIKU_IN_PER_1M = 1;
const HAIKU_OUT_PER_1M = 5;
const WEB_SEARCH_PER_1000 = 10;
const STEP1_BUDGET_CAP_USD = 0.10;

function haikuResponseCostUsd(resp: any, webSearchCount: number): number {
  const input = resp?.usage?.input_tokens ?? 0;
  const output = resp?.usage?.output_tokens ?? 0;
  const tokenUsd =
    (input / 1_000_000) * HAIKU_IN_PER_1M +
    (output / 1_000_000) * HAIKU_OUT_PER_1M;
  const searchUsd = (webSearchCount / 1000) * WEB_SEARCH_PER_1000;
  return tokenUsd + searchUsd;
}

async function _searchReviewsImpl(
  artist: string,
  album: string,
): Promise<ReviewSearchResult> {
  console.log(`[reviews] searchReviews called: artist="${artist}", album="${album}"`);
  try {
    const client = getClient();

    // ── Step 1: Haiku + web_search ───────────────────────────────────
    // Prompt is phrased inclusively ("any editorial music review" + a hard
    // blocklist) rather than as a named allow-list. An allow-list makes
    // Haiku drop valid reviews from any publication not literally named
    // (Treble, Paste, Revolver, Invisible Oranges, Stereogum, etc.), which
    // previously caused otherwise well-covered albums to return 0 reviews.
    const step1Prompt = `Find editorial reviews of the album "${album}" by ${artist}. Run 2–3 targeted web searches combining the artist + album title with words like "review", "rating", "score", "out of 10". Include a genre keyword (metal/punk/rock/indie/electronic/jazz/etc.) only if the first search returns too little.

INCLUDE: any editorial music coverage — professional music publications, magazines, and dedicated music blogs of any size. Pitchfork, AllMusic, Sputnikmusic, Angry Metal Guy, MetalStorm, Blabbermouth, Metal Hammer, Kerrang, Dead Rhetoric, Nine Circles, Heavy Blog is Heavy, New Noise, The Quietus, Loud and Quiet, Clash, NME, Drowned in Sound, Consequence, Stereogum, Tiny Mix Tapes, Treble, Paste, Revolver, Invisible Oranges, Slant, PopMatters, The Line of Best Fit, Exclaim, Louder Sound, and many others all count — the list above is illustrative, NOT exhaustive. If a site has a writer byline and an evaluative take, treat it as editorial.

EXCLUDE — never return any of these:
- Shopping / marketplaces: Discogs, Amazon, eBay, Bandcamp store listings, Apple Music, iTunes, Spotify, HMV, Tower Records, Best Buy, Walmart, Target, YesAsia, CDJapan, Barnes & Noble
- Aggregators / score collectors: Metacritic, albumoftheyear.org, rateyourmusic.com (we want primary editorial reviews, not sites that re-publish other publications' scores)
- Anything that is user ratings, customer reviews, product pages, or storefront listings

For each review: source name, score (e.g. "8/10", "4/5", "85/100"; omit if the review has none), 1–2 sentence excerpt from the review body, URL.
Aim for 6–10 reviews. Do not return an empty list if there are editorial reviews on the web — return whatever you find.`;

    // Step 1 budget: max_uses 6 → 3. Each web_search invocation costs
    // $0.01 AND pulls a few tens of thousands of tokens of page
    // content back into the Haiku context (billed as input tokens
    // at $1/M) — that's where the bulk of a "why did this album
    // cost $0.15" hit came from. Capping searches tightens the
    // whole envelope. No retry: a thin first pass almost always
    // meant the album isn't indexed well enough for web search to
    // help, and retrying with more searches just burned another
    // $0.10 to confirm the same miss.
    async function runStep1(maxUses: number) {
      const resp = await client.messages.create({
        model: HAIKU,
        max_tokens: 2500,
        tools: [
          {
            type: 'web_search_20250305' as const,
            name: 'web_search' as const,
            max_uses: maxUses,
          },
        ],
        messages: [{ role: 'user', content: step1Prompt }],
      });
      const searchCount = countWebSearchUses(resp);
      logClaudeUsage('reviews_search', resp, searchCount);
      const text: string[] = [];
      for (const block of resp.content) {
        if (block.type === 'text') text.push(block.text);
      }
      return {
        text: text.join('\n'),
        costUsd: haikuResponseCostUsd(resp, searchCount),
      };
    }

    console.log(`[reviews] Step 1: Haiku web search for "${artist} - ${album}"...`);
    const step1 = await runStep1(3);
    console.log(
      `[reviews] Step 1: ${step1.text.length} chars, $${step1.costUsd.toFixed(4)}`
    );

    if (step1.text.length < 50) {
      console.warn(
        `[reviews] Step 1 empty for "${artist} - ${album}" — giving up (no retry)`
      );
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

    // Hard cap. If Step 1 alone blew past the per-album ceiling (a
    // single big album with lots of page content pulled back into
    // context can still push over even with max_uses=3), don't throw
    // another Haiku + Sonnet call after it. The data we got is
    // discarded; better to stop the bleeding than add $0.03 more.
    if (step1.costUsd > STEP1_BUDGET_CAP_USD) {
      console.warn(
        `[reviews] Step 1 cost $${step1.costUsd.toFixed(4)} exceeds $${STEP1_BUDGET_CAP_USD} cap for "${artist} - ${album}" — aborting pipeline`
      );
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

    const rawReviewData = step1.text;

    // ── Step 2: Haiku — structure + translate + pronunciation ──────────
    console.log(`[reviews] Step 2: Haiku structuring...`);
    const structureResponse = await client.messages.create({
      model: HAIKU,
      // Output is a JSON object containing up to 15 reviews + pronunciation
      // fields. 1500 was occasionally truncating the JSON mid-array on
      // well-covered albums (Korean excerpts are token-heavy), which then
      // crashed JSON.parse and dropped the whole batch. 2500 is still a
      // safe runaway ceiling; Anthropic only bills generated tokens.
      max_tokens: 2500,
      messages: [{ role: 'user', content: `Raw review data for "${album}" by ${artist}:
---
${rawReviewData}
---
Return ONLY JSON:
{"reviews":[{"sourceName":"Name","score":85,"scoreMax":100,"excerpt":"English excerpt","excerptKo":"한국어 요약","fullReviewUrl":"https://..."}],"artistKo":"발음","titleKo":"발음","titleMeaning":"뜻"}

Score: 8.5/10→85, 4/5→80, 3.5/5→70, 7/10→70. null if none.
excerptKo: 독립적으로 읽히는 2-3문장 한국어 재구성.
artistKo: "${artist}" 한국어 발음 (예: Metallica→메탈리카)
titleKo: "${album}" 한국어 발음
titleMeaning: "${album}" 한국어 뜻 (고유명사면 "")

Include any editorial music review. The site does NOT need to be on a named allow-list — if the raw data shows a review with a writer/byline and an evaluative take, include it.

CRITICAL EXCLUSIONS — never include:
- Discogs, Amazon, eBay, Bandcamp, Apple Music, iTunes, Spotify, HMV, Tower Records, Best Buy, Walmart, Target, YesAsia, CDJapan, Barnes & Noble (쇼핑몰 / 마켓플레이스의 유저 평점)
- Metacritic, albumoftheyear, rateyourmusic (점수 모아놓는 aggregator — primary editorial 리뷰만)
- Any review whose sourceName contains a format/edition descriptor like "(Vinyl 2024 Reissue)", "(CD Release 435503)", "Release ###" — these are storefront listings, not reviews
- Any URL on discogs.com, amazon.*, ebay.*, bandcamp.com, apple.com, spotify.com, hmv.*, towerrecords.*

Max 15 reviews. Deduplicate by source.` }],
    });
    logClaudeUsage('reviews_structure', structureResponse);

    const textBlock = structureResponse.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const seenSources = new Set<string>();
    const reviews: ReviewResult[] = [];
    let filteredCount = 0;
    for (const r of parsed.reviews || []) {
      if (!r.sourceName) continue;
      if (r.score === null && !r.excerpt) continue;
      const keyLower = r.sourceName.toLowerCase().trim();
      if (seenSources.has(keyLower)) continue;
      if (isExcludedSource(r.sourceName, r.fullReviewUrl || '')) {
        filteredCount++;
        console.log(`[reviews] filtered non-editorial source: "${r.sourceName}" (${r.fullReviewUrl || 'no url'})`);
        continue;
      }
      seenSources.add(keyLower);
      reviews.push({
        sourceName: r.sourceName,
        score: clampScore(r.score),
        scoreMax: 100,
        excerpt: r.excerpt || '',
        excerptKo: normaliseKoreanTerms(r.excerptKo),
        fullReviewUrl: r.fullReviewUrl || '',
      });
      if (reviews.length >= 15) break;
    }
    if (filteredCount > 0) {
      console.log(`[reviews] filtered ${filteredCount} non-editorial sources (shopping/marketplace/aggregator)`);
    }

    // ── Step 3: Sonnet — Korean summary (quality matters) ──────────────
    let koreanSummary: string | null = null;
    if (reviews.length >= 2) {
      try {
        console.log(`[reviews] Step 3: Sonnet summary...`);
        const reviewsText = reviews
          .map((r) => `[${r.sourceName}]${r.score ? ` (${r.score}/100)` : ''}: ${r.excerpt}`)
          .join('\n');
        const summaryResponse = await client.messages.create({
          model: SONNET,
          max_tokens: 500,
          messages: [{
            role: 'user',
            content:
              `'${album}' by ${artist} 리뷰 3-4문장 한국어 요약. ` +
              `매체명 금지. 평론가 시점으로 앨범의 분위기, 사운드 특징, 컬렉팅 가치를 서술. ` +
              `출력 규칙: 요약 본문만 작성. 앨범 제목이나 아티스트명을 헤더로 넣지 말 것. ` +
              `마크다운(#, **, *, -) 사용하지 말고 순수 문장으로만.\n${reviewsText}`,
          }],
        });
        logClaudeUsage('reviews_summary', summaryResponse);
        const summaryBlock = summaryResponse.content.find((b) => b.type === 'text');
        if (summaryBlock && summaryBlock.type === 'text') {
          koreanSummary = normaliseKoreanTerms(
            stripSummaryPreamble(summaryBlock.text, album, artist)
          );
        }
      } catch (err: any) {
        console.log(`[reviews] Sonnet summary failed (${err.status || err.message}), skipping`);
      }
    }

    console.log(`[reviews] Done: ${reviews.length} reviews, summary: ${!!koreanSummary}`);
    return {
      reviews,
      koreanSummary,
      artistKo: parsed.artistKo || null,
      titleKo: parsed.titleKo || null,
      titleMeaning: parsed.titleMeaning || null,
    };
  } catch (error) {
    console.error('[reviews] Error:', error);
    return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
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

export async function scrapeReviewFromUrl(
  url: string,
  artist: string,
  album: string,
  albumMbid: string | null = null
): Promise<ReviewResult | null> {
  console.log(`[reviews] scrapeReviewFromUrl: ${url}`);

  let html = '';
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      maxContentLength: 4_000_000,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    html = typeof resp.data === 'string' ? resp.data : String(resp.data);
  } catch (err) {
    recordScrapeFailure(url, albumMbid, 'fetch-failed', (err as Error).message);
    return null;
  }

  // Pull star-rating data from the raw HTML before we strip tags — the
  // <i> icons that carry it don't survive stripHtml. If detected, this
  // score overrides whatever Claude extracts (Claude only sees the
  // stripped text, so it never had the info in the first place).
  const starScore = detectStarRating(html);
  if (starScore !== null) {
    console.log(`[reviews] detected star rating ${starScore}/100 for ${url}`);
  }

  const pageText = stripHtml(html).slice(0, 20000);
  if (pageText.length < 100) {
    recordScrapeFailure(url, albumMbid, 'text-too-short');
    return null;
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // ignore
  }

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Extract a single album review's info from this page about "${album}" by ${artist}.

URL: ${url}
PAGE TEXT (HTML stripped):
---
${pageText}
---

Return ONLY JSON, no prose:
{
  "sourceName": "Publication name (e.g. Pitchfork, Angry Metal Guy). Derive from the page or the domain '${hostname}' if unclear.",
  "score": 85,
  "scoreMax": 100,
  "excerpt": "One or two sentences quoted or paraphrased from the review body, English.",
  "excerptKo": "2-3 문장 한국어 요약. 매체명 언급 금지, 평론가 시점."
}

Score: convert any scale to /100 (X/10→X*10, X/5→X*20, X/4→X*25, letter A+→97 A→93 A-→90 B+→87 B→83 ...). If no explicit score, set null.
Excerpt: pick the most evaluative sentence(s) from the review body; skip headlines/bylines/ads.
If this page is clearly NOT a review (shop listing, forum post, directory), return {"error":"not a review"} instead.`,
        },
      ],
    });
    logClaudeUsage('scrape_review', response);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      recordScrapeFailure(url, albumMbid, 'claude-no-text');
      return null;
    }

    let jsonText = block.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      recordScrapeFailure(url, albumMbid, 'json-parse-failed', jsonText.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      recordScrapeFailure(url, albumMbid, 'not-a-review', String(parsed.error));
      return null;
    }

    return {
      sourceName:
        (typeof parsed.sourceName === 'string' && parsed.sourceName.trim()) ||
        hostname ||
        'Unknown',
      score: starScore ?? clampScore(parsed.score),
      scoreMax: 100,
      excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
      excerptKo: normaliseKoreanTerms(parsed.excerptKo),
      fullReviewUrl: url,
    };
  } catch (err) {
    recordScrapeFailure(url, albumMbid, 'claude-error', (err as Error).message);
    return null;
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

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Extract review info from this hand-pasted article text about "${album}" by ${artist}, published by ${sourceName}.

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
If the text is clearly NOT a review (shop listing, track list only, marketing copy), return {"error":"not a review"} instead.`,
        },
      ],
    });
    logClaudeUsage('manual_review', response);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return null;

    let jsonText = block.text.trim();
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
    console.error('[reviews] Claude manual-extract failed:', (err as Error).message);
    return null;
  }
}
