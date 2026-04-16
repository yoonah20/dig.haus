import axios from 'axios';
import { getClient, HAIKU, SONNET } from './claude.js';

export interface ReviewResult {
  sourceName: string;
  score: number | null;
  scoreMax: number;
  excerpt: string;
  excerptKo: string;
  fullReviewUrl: string;
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
    const step1Prompt = `Find editorial reviews of the album "${album}" by ${artist}. Run 3–5 web searches combining the artist + album title with words like "review", "rating", "score", "out of 10". Include genre keywords (metal/punk/rock/indie/electronic/jazz/etc.) only if the first searches return too little.

INCLUDE: any editorial music coverage — professional music publications, magazines, and dedicated music blogs of any size. Pitchfork, AllMusic, Sputnikmusic, Angry Metal Guy, MetalStorm, Blabbermouth, Metal Hammer, Kerrang, Dead Rhetoric, Nine Circles, Heavy Blog is Heavy, New Noise, The Quietus, Loud and Quiet, Clash, NME, Drowned in Sound, Consequence, Stereogum, Tiny Mix Tapes, Treble, Paste, Revolver, Invisible Oranges, Slant, PopMatters, The Line of Best Fit, Exclaim, Louder Sound, and many others all count — the list above is illustrative, NOT exhaustive. If a site has a writer byline and an evaluative take, treat it as editorial.

EXCLUDE — never return any of these:
- Shopping / marketplaces: Discogs, Amazon, eBay, Bandcamp store listings, Apple Music, iTunes, Spotify, HMV, Tower Records, Best Buy, Walmart, Target, YesAsia, CDJapan, Barnes & Noble
- Aggregators / score collectors: Metacritic, albumoftheyear.org, rateyourmusic.com (we want primary editorial reviews, not sites that re-publish other publications' scores)
- Anything that is user ratings, customer reviews, product pages, or storefront listings

For each review: source name, score (e.g. "8/10", "4/5", "85/100"; omit if the review has none), 1–2 sentence excerpt from the review body, URL.
Aim for 8–15 reviews. Do not return an empty list if there are editorial reviews on the web — return whatever you find.`;

    async function runStep1(maxUses: number): Promise<string> {
      const resp = await client.messages.create({
        model: HAIKU,
        // max_tokens is a billing-safe ceiling — Anthropic only charges for
        // tokens actually generated, but capping prevents a runaway response.
        // 2500 comfortably fits 8–15 review entries with URLs + excerpts.
        max_tokens: 2500,
        tools: [
          {
            // web_search is billed PER CALL ($10/1000 searches), separately
            // from tokens. 6 hits the sweet spot — enough headroom for
            // obscure releases that need a few extra angles, while still
            // well below the previous cap of 10.
            type: 'web_search_20250305' as const,
            name: 'web_search' as const,
            max_uses: maxUses,
          },
        ],
        messages: [{ role: 'user', content: step1Prompt }],
      });
      const out: string[] = [];
      for (const block of resp.content) {
        if (block.type === 'text') out.push(block.text);
      }
      return out.join('\n');
    }

    console.log(`[reviews] Step 1: Haiku web search for "${artist} - ${album}"...`);
    let rawReviewData = await runStep1(6);
    console.log(`[reviews] Step 1: ${rawReviewData.length} chars returned`);

    // Single retry with a wider search budget when the first pass came
    // back near-empty — covers the case where 6 searches didn't surface
    // anything for an obscure release. Only fires on the failure path so
    // healthy albums don't pay for a second call.
    if (rawReviewData.length < 50) {
      console.warn(
        `[reviews] Step 1 thin response (${rawReviewData.length} chars) for "${artist} - ${album}" — retrying with max_uses=10`
      );
      rawReviewData = await runStep1(10);
      console.log(`[reviews] Step 1 retry: ${rawReviewData.length} chars returned`);
    }

    if (rawReviewData.length < 50) {
      console.warn(
        `[reviews] Step 1 still empty after retry for "${artist} - ${album}" — giving up`
      );
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

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
        score: typeof r.score === 'number' ? r.score : null,
        scoreMax: 100,
        excerpt: r.excerpt || '',
        excerptKo: r.excerptKo || '',
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
            content: `'${album}' by ${artist} 리뷰 3-4문장 한국어 요약. 매체명 금지. 평론가 시점으로 앨범의 분위기, 사운드 특징, 컬렉팅 가치를 서술.\n${reviewsText}`,
          }],
        });
        const summaryBlock = summaryResponse.content.find((b) => b.type === 'text');
        if (summaryBlock && summaryBlock.type === 'text') {
          koreanSummary = summaryBlock.text.trim();
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
  album: string
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
    console.error('[reviews] URL fetch failed:', (err as Error).message);
    return null;
  }

  const pageText = stripHtml(html).slice(0, 20000);
  if (pageText.length < 100) {
    console.warn('[reviews] stripped page text too short');
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

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return null;

    let jsonText = block.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      console.warn('[reviews] Claude flagged URL as not a review:', parsed.error);
      return null;
    }

    return {
      sourceName:
        (typeof parsed.sourceName === 'string' && parsed.sourceName.trim()) ||
        hostname ||
        'Unknown',
      score: typeof parsed.score === 'number' ? parsed.score : null,
      scoreMax: typeof parsed.scoreMax === 'number' ? parsed.scoreMax : 100,
      excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
      excerptKo: typeof parsed.excerptKo === 'string' ? parsed.excerptKo : '',
      fullReviewUrl: url,
    };
  } catch (err) {
    console.error('[reviews] Claude extract failed:', (err as Error).message);
    return null;
  }
}
