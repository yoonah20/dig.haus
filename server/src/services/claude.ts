import Anthropic from '@anthropic-ai/sdk';
import { memoAsync } from '../utils/memoCache.js';
import { execute, queryAll } from '../db/index.js';
import { invokeLlm } from './llmRouter.js';

// maxRetries=5 amplified 429 storms into 5×-call cascades per failed
// request. 2 absorbs transient blips without turning a rate-limit
// into a much bigger one — especially important since reviews_search
// itself already does a thin-response retry (so a bad call could
// balloon to 10+ web searches).
let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 2 });
  return _client;
}

export const HAIKU = 'claude-haiku-4-5-20251001';
export const SONNET = 'claude-sonnet-4-5';
// Was an alias to claude-3-haiku-20240307 (~4× cheaper) for one-shot
// transliteration, but Haiku 3 silently flunked basic Korean phonetic
// work — band names came back blank or wrong, and the cached miss
// meant the bad output stuck per album. Reverted to Haiku 4.5; the
// extra cost on a permanently-cached, once-per-album call is fine.
export const HAIKU_LITE = HAIKU;

// Usage logger. Writes one row per Claude response so the admin
// dashboard can surface a rolling token / web-search breakdown. Swallows
// errors — usage logging should never break a user-facing Claude call.
// `operation` is a free-form tag ("reviews_search", "pronunciation"…)
// used for per-operation cost attribution.
export function logClaudeUsage(
  operation: string,
  response: Anthropic.Messages.Message,
  webSearchCount = 0
): void {
  try {
    execute(
      `INSERT INTO claude_usage_log
         (operation, model, input_tokens, output_tokens, web_search_count)
       VALUES (?, ?, ?, ?, ?)`,
      [
        operation,
        response.model || 'unknown',
        response.usage?.input_tokens ?? 0,
        response.usage?.output_tokens ?? 0,
        webSearchCount,
      ]
    );
  } catch (err) {
    console.warn(`[claude-usage] log failed (${operation}):`, (err as Error).message);
  }
}

// Count server_tool_use blocks in a response — one block per web_search
// invocation. Used alongside logClaudeUsage for the web-search-billed
// Step 1 of the review pipeline.
export function countWebSearchUses(response: Anthropic.Messages.Message): number {
  let n = 0;
  for (const block of response.content) {
    if ((block as { type?: string }).type === 'server_tool_use') {
      const toolName = (block as { name?: string }).name;
      if (toolName === 'web_search') n++;
    }
  }
  return n;
}

/**
 * Generate Korean pronunciation + meaning for artist/album.
 */
async function _generatePronunciation(
  artist: string,
  album: string
): Promise<{ artistKo: string; titleKo: string; titleMeaning: string } | null> {
  try {
    const promptText = `JSON only: {"artistKo":"${artist} 한국어 발음","titleKo":"${album} 한국어 발음","titleMeaning":"${album} 한국어 뜻"}

titleMeaning 규칙:
- 반드시 번역 하나만 제공. 여러 후보를 슬래시(/)나 쉼표로 나열 금지.
- 가장 자연스럽고 의미 전달이 잘 되는 한국어 번역 하나만 선택.
- 고유명사이거나 번역이 불필요한 경우 빈 문자열("").

예:
- Hellripper → {"artistKo":"헬리퍼","titleKo":"헬리퍼","titleMeaning":""}
- Master of Puppets → {"titleKo":"마스터 오브 퍼펫츠","titleMeaning":"인형의 지배자"}
- Love Is Not Enough → {"titleKo":"러브 이즈 낫 이너프","titleMeaning":"사랑은 충분하지 않다"}
- Coronach → {"titleKo":"코로나크","titleMeaning":"장송곡"}
- Datalysium → {"titleKo":"데이터리시움","titleMeaning":""}`;
    const result = await invokeLlm({
      operation: 'pronunciation',
      prompt: promptText,
      maxTokens: 200,
      defaultModel: 'deepseek-chat',
      jsonMode: true,
      albumTitle: `${artist} - ${album}`,
    });
    if (!result.text) return null;
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Defensive: if the model still emits "A/B" despite instructions,
    // keep only the first option.
    const rawMeaning = parsed.titleMeaning || '';
    const titleMeaning = rawMeaning.includes('/')
      ? rawMeaning.split('/')[0].trim()
      : rawMeaning;
    return {
      artistKo: parsed.artistKo || '',
      titleKo: parsed.titleKo || '',
      titleMeaning,
    };
  } catch (err) {
    console.warn(`[claude] generatePronunciation failed for "${artist} - ${album}":`, (err as Error).message);
    return null;
  }
}

// In-flight dedup so two simultaneous album loads for the same fresh
// album (e.g. admin opens the page in two tabs, or a redirect lands
// while the original request is still resolving) collapse into one
// Claude call. 10s window covers the slow path.
export const generatePronunciation = memoAsync('pron', _generatePronunciation, 10_000);

/**
 * Generate Korean summary from cached reviews (fallback when reviews exist but no summary).
 */
export async function generateKoreanSummary(
  albumTitle: string,
  artist: string,
  reviews: Array<{ source: string; score?: number; excerpt?: string }>
): Promise<string | null> {
  const start = performance.now();
  try {
    const reviewsText = reviews
      .map((r) => `[${r.source}]${r.score ? ` (${r.score}/100)` : ''}: ${r.excerpt || ''}`)
      .join('\n');

    const promptText =
      `'${albumTitle}' by ${artist} 리뷰 종합 요약. ` +
      `**3 또는 4문장 / 총 길이 250-320자**. 점수 옆 float 박스가 5줄 wrap을 기준으로 디자인되어 있어, 너무 짧으면(150자 미만) 점수 옆이 비어 보이고 너무 길면(350자 이상) 박스 아래로 흘러내려 카드가 부풀어 보임. 문장당 60-85자 정도가 자연스럽다. ` +
      `매체명 금지. 평론가 시점으로 앨범의 분위기, 사운드 특징, 컬렉팅 가치를 서술. ` +
      `출력 규칙: 요약 본문만 작성. 앨범 제목이나 아티스트명을 헤더로 넣지 말 것. ` +
      `마크다운(#, **, *, -) 사용하지 말고 순수 문장으로만.\n${reviewsText}`;
    // Default to DeepSeek (V4 Flash via the deepseek-chat alias).
    // Earlier the default was Sonnet, then Haiku as a cost trial; V4
    // Flash launched 2026-04-24 with Korean prose quality competitive
    // with Haiku at ~10× lower cost ($0.14/$0.28 per 1M vs Haiku's
    // $1/$5). Sonnet stays reachable via env if quality regresses
    // — set LLM_PRIMARY_MODEL_SUMMARY_FALLBACK=claude-sonnet-4-5 on
    // Railway to flip back. Note: any existing env override that
    // pinned this op to Sonnet/Haiku needs clearing for the new
    // default to take effect in production.
    const result = await invokeLlm({
      operation: 'summary_fallback',
      prompt: promptText,
      maxTokens: 500,
      defaultModel: 'deepseek-chat',
      albumTitle: `${artist} - ${albumTitle}`,
    });
    const ms = Math.round(performance.now() - start);
    console.log(
      `[reviews/timing] op=summary reviews=${reviews.length} promptLen=${promptText.length} ms=${ms} outcome=${result.text ? 'ok' : 'empty'}`
    );
    if (!result.text) return null;
    return normaliseKoreanTerms(
      stripSummaryPreamble(result.text, albumTitle, artist)
    );
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.log(
      `[reviews/timing] op=summary reviews=${reviews.length} ms=${ms} outcome=error`
    );
    console.warn(`[claude] generateKoreanSummary failed for "${artist} - ${albumTitle}":`, (err as Error).message);
    return null;
  }
}

// Post-process the summary in case Sonnet sneaks in a "# Album -
// Artist" heading or a markdown lead despite being told not to.
// Korean-term post-processor — runs on every LLM-generated Korean
// field (excerpts, summaries) to normalise mistranslations into
// vinyl-listener vernacular. The rule set used to be a hardcoded
// array in this file; it now lives in the term_replacements table
// (system rules seeded via runOnce migration in schema.ts, operator
// rules added through /admin/curation). One source of truth, all
// edits flow through the admin UI.
//
// Rule shape:
//   - is_regex=1 — pattern compiled as JS RegExp with the `g` flag,
//     replacement may use $1 etc. for capture groups. Used for the
//     migrated system rules that hinge on alternation / optional
//     groups / capture references (e.g. "underground {genre}" →
//     "언더그라운드 $1").
//   - is_regex=0 — pattern matched as a plain substring (split +
//     join). Used for ad-hoc operator rules where regex would be
//     overkill ("금속 사운드" → "메탈 사운드").
//
// Word-boundary handling: Korean doesn't have \b-style boundaries
// that regex knows about, so we rely on the replacement phrases
// being long / specific enough (2+ syllables of context) that
// accidentally nesting inside a larger word is rare.
//
// Cached snapshot of the term_replacements table. Refreshed lazily
// when the row count or max(id) changes so the cache invalidates the
// moment an admin adds, edits, or deletes a rule. Avoids hitting the
// DB twice per LLM output (this gets called for every excerpt_ko +
// summary), and the small payload (rule list is order-of-tens) makes
// in-memory replay cheap. Compiled regex is cached alongside the
// rule so a noisy summary call doesn't recompile the same pattern.
type DbReplacement = {
  pattern: string;
  replacement: string;
  is_regex: number;
  compiled?: RegExp;
};
let _dbReplacementsCache: DbReplacement[] = [];
let _dbReplacementsKey = '0:0';

function loadDbReplacements(): DbReplacement[] {
  const meta = queryAll(
    `SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM term_replacements`
  )[0] as { c: number; m: number };
  const key = `${meta.c}:${meta.m}`;
  if (key === _dbReplacementsKey) return _dbReplacementsCache;
  const rows = queryAll(
    `SELECT pattern, replacement, is_regex FROM term_replacements ORDER BY id`
  ) as DbReplacement[];
  for (const r of rows) {
    if (r.is_regex) {
      try {
        r.compiled = new RegExp(r.pattern, 'g');
      } catch (err) {
        // Bad regex stored — log once and fall back to plain
        // string match so the rest of the rules still apply. Admin
        // can fix or delete the offender from the UI.
        console.warn(
          `[normaliseKoreanTerms] invalid regex skipped: ${r.pattern} (${(err as Error).message})`
        );
        r.compiled = undefined;
      }
    }
  }
  _dbReplacementsCache = rows;
  _dbReplacementsKey = key;
  return _dbReplacementsCache;
}

export function normaliseKoreanTerms(text: string | null | undefined): string {
  if (!text) return '';
  let out = text;
  for (const r of loadDbReplacements()) {
    if (!r.pattern) continue;
    if (r.is_regex && r.compiled) {
      out = out.replace(r.compiled, r.replacement);
    } else {
      out = out.split(r.pattern).join(r.replacement);
    }
  }
  return out;
}

export function stripSummaryPreamble(
  raw: string,
  albumTitle: string,
  artist: string
): string {
  const titleLower = albumTitle.toLowerCase();
  const artistLower = artist.toLowerCase();
  const normalise = (s: string) =>
    s
      .replace(/[#*_`~>]/g, '')
      .replace(/[-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const isTitleArtistLine = (line: string): boolean => {
    const n = normalise(line);
    if (!n) return false;
    const hasTitle = titleLower && n.includes(titleLower);
    const hasArtist = artistLower && n.includes(artistLower);
    // Line consists mostly of title/artist (and connectors like "by",
    // "-", etc). Length check keeps us from eating a real sentence
    // that happens to mention the title + artist in passing.
    return !!(hasTitle || hasArtist) && n.length <= titleLower.length + artistLower.length + 8;
  };

  const lines = raw.split(/\r?\n/);
  let start = 0;
  while (start < lines.length) {
    const trimmed = lines[start].trim();
    if (!trimmed) {
      start++;
      continue;
    }
    if (trimmed.startsWith('#') || isTitleArtistLine(trimmed)) {
      start++;
      continue;
    }
    break;
  }
  const afterPreambleStrip = lines.slice(start).join('\n');
  const final = afterPreambleStrip
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim();

  // Log whenever the stripper actually did something — if Sonnet starts
  // consistently emitting preambles or markdown despite the prompt, the
  // logs will show the regression before a reader notices. Silent when
  // the output was already clean (the common case).
  const markdownCharsRemoved = afterPreambleStrip.length - final.length;
  if (start > 0 || markdownCharsRemoved > 0) {
    console.log(
      `[summary] stripped ${start} preamble line(s), ${markdownCharsRemoved} markdown char(s) for "${artist} - ${albumTitle}"`
    );
  }
  return final;
}

/**
 * Generate Korean descriptions for similar albums.
 */
async function _generateSimilarDescriptions(
  baseArtist: string,
  baseAlbum: string,
  similarAlbums: Array<{ title: string; artist: string }>
): Promise<Array<{ title: string; artist: string; descriptionKo: string }> | null> {
  if (similarAlbums.length === 0) return [];

  const list = similarAlbums.map((a, i) => `${i + 1}. "${a.title}" by ${a.artist}`).join('\n');

  try {
    const promptText = `"${baseAlbum}" by ${baseArtist} 팬을 위한 비슷한 앨범 설명. 각 1-2문장 한국어.
${list}
JSON array only: [{"title":"","artist":"","descriptionKo":""}]`;
    const result = await invokeLlm({
      operation: 'similar_descriptions',
      prompt: promptText,
      maxTokens: 1000,
      defaultModel: 'deepseek-chat',
      jsonMode: true,
      albumTitle: `${baseArtist} - ${baseAlbum}`,
    });
    if (!result.text) return null;
    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item: any) => ({
      title: item.title || '',
      artist: item.artist || '',
      descriptionKo: item.descriptionKo || '',
    }));
  } catch (err) {
    console.warn(`[claude] generateSimilarDescriptions failed for "${baseArtist} - ${baseAlbum}":`, (err as Error).message);
    return null;
  }
}

// Same dedup pattern as generatePronunciation — keys on (artist, album,
// list of similar). Concurrent /similar hits for the same album coalesce.
export const generateSimilarDescriptions = memoAsync(
  'sim-desc',
  _generateSimilarDescriptions,
  10_000
);

/**
 * From a list of Google search candidates (title + snippet + url),
 * pick the ones that look like editorial album reviews. Excludes
 * shops, aggregators, forums, user-rating pages, band homepages. One
 * cheap Haiku call — titles and snippets are short so input tokens
 * are negligible (~1k), output is a compact JSON array.
 */
export async function selectEditorialReviewUrls(
  artist: string,
  album: string,
  candidates: Array<{ url: string; title: string; snippet: string }>
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const list = candidates
    .map(
      (c, i) => `${i + 1}. ${c.url}
   제목: ${c.title}
   요약: ${c.snippet}`
    )
    .join('\n');
  try {
    const promptText = `"${album}" by ${artist} 에 대한 editorial 음악 리뷰 URL 후보를 골라주세요.

후보:
${list}

기본 원칙: **recall 우선, precision은 admin이 저장 전 수동 확인**. 애매하면 포함하세요 — 최종 editorial 판단은 admin이 함.

앨범 매칭: 제목/요약에 이 앨범 "${album}"이 언급된 것처럼 보이면 포함. 제목에 **다른 앨범명이 명시적으로 보이는 경우만** 거부 (예: "Dodsrit – Spirit Crusher Review"에서 "Spirit Crusher"가 찾는 앨범 아니면 거부).

아티스트 레벨 페이지 / 디스코그래피 / 추천 리스트도 제외하세요. URL이 아티스트 슬러그에서 끝나고 (예: /artist/big-black/) 개별 앨범 슬러그까지 내려가지 않는 경우, 또는 제목이 "X album recommendations", "X albums ranked", "X discography", "best of X" 형태인 경우 — 타겟 앨범 "${album}"이 페이지에 있더라도 그 섹션이 전체 중 일부에 불과해서 스크레이퍼가 다른 앨범 내용을 이 앨범으로 섞어 저장하는 문제가 반복되고 있어요. 제목/URL에 이 앨범 이름이 명시적으로 들어가 있어야 포함.

포함: 전문 음악 매체, 음악 블로그, 잡지, 개인 리뷰 사이트 — writer byline 없어도 평가적 문장이 있으면 포함. 다국어 (네덜란드어/독일어/프랑스어/스페인어/이탈리아어/스웨덴어/일본어/한국어 등) 전부 포함.

제외: 쇼핑몰 (Amazon, Discogs store, Bandcamp store, HMV, Tower Records), 스트리밍 플랫폼 (Spotify, Apple Music), score aggregator (Metacritic, albumoftheyear, rateyourmusic, metal-archives), 포럼/Reddit, 아티스트 공식 홈페이지, Wikipedia, 트랙리스트만 있는 페이지.

인터뷰/뉴스도 제외 — 이 두 유형은 리뷰와 외형이 비슷해서 잘 섞이는데, 제목/URL/요약에 다음 신호 중 하나라도 보이면 거부하세요:
- interview, Q&A, "talks to/with", "sat down with/to talk", "in conversation (with)", "chat(s) with", "X tells us", "speaks with/to" → 인터뷰
- premiere(s), unleash(es), drops new (single/album/video/track), shares new (video/single), reveals (new tracklist/single/video), stream new (song/video), "music video for", "announces new album/tour", tour announcement → 발매/뮤비/공연 뉴스 공지
- 평가 문장이 섞여 있더라도 페이지의 주목적이 인터뷰나 공지면 제외. 리뷰 여부가 애매하면 "제목에 review 단어가 있거나 평론 톤의 제목인가?"로 판단하세요.

최대 25개까지. 명확한 제외 사유가 없으면 포함. Return ONLY a JSON array of the chosen URLs (원문 그대로).`;
    // 25 URLs × ~100 chars + JSON overhead ≈ 700–900 tokens; 1200 leaves
    // headroom so the model never truncates the JSON mid-array (which
    // would fail the regex parse and silently drop every URL it picked).
    const result = await invokeLlm({
      operation: 'serper_pick',
      prompt: promptText,
      maxTokens: 1200,
      defaultModel: 'deepseek-chat',
      jsonMode: true,
      albumTitle: `${artist} - ${album}`,
    });
    if (!result.text) return [];
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
      );
    } catch {
      return [];
    }
  } catch (err) {
    console.warn(
      `[claude] selectEditorialReviewUrls failed for "${artist} - ${album}":`,
      (err as Error).message
    );
    return [];
  }
}
