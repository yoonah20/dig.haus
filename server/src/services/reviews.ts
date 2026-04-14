import Anthropic from '@anthropic-ai/sdk';

interface ReviewResult {
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

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 5 });
  return _client;
}

// Non-editorial sources to exclude (shopping/marketplace/aggregators)
// Match against the lowercased sourceName via substring.
const EXCLUDED_SOURCE_PATTERNS = [
  'album of the year', 'albumoftheyear', 'aoty',
  'rateyourmusic', 'rate your music', 'rym',
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

export async function searchReviews(
  artist: string,
  album: string,
): Promise<ReviewSearchResult> {
  console.log(`[reviews] searchReviews called: artist="${artist}", album="${album}"`);
  try {
    const client = getClient();

    // ── Step 1: Haiku + web_search (2 queries, max 5 uses) ──────────
    console.log(`[reviews] Step 1: Haiku web search...`);
    const searchResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      tools: [
        {
          type: 'web_search_20250305' as const,
          name: 'web_search' as const,
          max_uses: 10,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Search for reviews of "${album}" by ${artist}. Do 3 searches:
1. ${artist} ${album} album review
2. ${artist} ${album} review score rating
3. ${artist} ${album} metal review OR punk review OR rock review OR indie review OR music critic review

STRICT RULES — include ONLY reviews from professional music publications, music magazines, or dedicated music blogs (e.g. Pitchfork, AllMusic, Sputnikmusic, Angry Metal Guy, MetalStorm, Blabbermouth, Metal Hammer, Kerrang, Dead Rhetoric, Nine Circles, Heavy Blog is Heavy, New Noise Magazine, The Quietus, Loud and Quiet, Clash, NME, Drowned in Sound, Consequence, Stereogum, Tiny Mix Tapes, etc.).

EXCLUDE — do NOT return any of the following under any circumstances:
- Shopping sites / marketplaces: Discogs, Amazon, eBay, Bandcamp (store listings), Apple Music, iTunes, Spotify, HMV, Tower Records, Best Buy, Walmart, Target, YesAsia, CDJapan, Barnes & Noble
- User-aggregated score sites: albumoftheyear.org, rateyourmusic.com
- Anything labeled as user ratings, customer reviews, product ratings, or storefront pages

Aim for 10+ different reviews from editorial sources only.
For each review found: source name, score (X/10 etc), 1-2 sentence excerpt, URL.`,
        },
      ],
    });

    const rawTexts: string[] = [];
    for (const block of searchResponse.content) {
      if (block.type === 'text') rawTexts.push(block.text);
    }
    const rawReviewData = rawTexts.join('\n');
    console.log(`[reviews] Step 1: ${rawReviewData.length} chars`);

    if (rawReviewData.length < 50) {
      return { reviews: [], koreanSummary: null, artistKo: null, titleKo: null, titleMeaning: null };
    }

    // ── Step 2: Haiku — structure + translate + pronunciation ──────────
    console.log(`[reviews] Step 2: Haiku structuring...`);
    const structureResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: `Raw review data for "${album}" by ${artist}:
---
${rawReviewData}
---
Return ONLY JSON:
{"reviews":[{"sourceName":"Name","score":85,"scoreMax":100,"excerpt":"English excerpt","excerptKo":"한국어 요약","fullReviewUrl":"https://..."}],"artistKo":"발음","titleKo":"발음","titleMeaning":"뜻"}

Score: 8.5/10→85, 4/5→80, 3.5/5→70. null if none.
excerptKo: 독립적으로 읽히는 2-3문장 한국어 재구성.
artistKo: "${artist}" 한국어 발음 (예: Metallica→메탈리카)
titleKo: "${album}" 한국어 발음
titleMeaning: "${album}" 한국어 뜻 (고유명사면 "")

CRITICAL EXCLUSIONS — never include:
- Discogs, Amazon, eBay, Bandcamp, Apple Music, iTunes, Spotify, HMV, Tower Records, Best Buy, Walmart, Target, YesAsia, CDJapan, Barnes & Noble (쇼핑몰 / 마켓플레이스의 유저 평점)
- albumoftheyear, rateyourmusic (유저 집계 점수)
- Any review whose sourceName contains a format/edition descriptor like "(Vinyl 2024 Reissue)", "(CD Release 435503)", "Release ###" — these are storefront listings, not reviews
- Any URL on discogs.com, amazon.*, ebay.*, bandcamp.com, apple.com, spotify.com, hmv.*, towerrecords.*

Only include reviews from professional music publications and music blogs (Pitchfork, AllMusic, Sputnikmusic, Angry Metal Guy, MetalStorm, Blabbermouth, Metal Hammer, Kerrang, Dead Rhetoric, Nine Circles, Heavy Blog is Heavy, New Noise Magazine, etc.).
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
          model: 'claude-sonnet-4-20250514',
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
