import { Router } from 'express';
import { adminClaudeLimiter } from '../middleware/adminRateLimit.js';
import {
  scrapeReviewFromUrl,
  extractFromPastedText,
  EXCLUDED_URL_PATH_PATTERNS,
  isHostBlacklisted,
  getWhitelistedHostsFromDb,
  getVerifiedSourceNames,
  normalizeReviewUrl,
} from '../services/reviews.js';
import { searchReviewUrls as searchSerper } from '../services/serper.js';
import { searchReviewUrls as searchBrave } from '../services/braveSearch.js';
import { searchReviewUrls as searchTavily } from '../services/tavilySearch.js';
import {
  generateKoreanSummary,
  selectEditorialReviewUrls,
} from '../services/claude.js';
import { getAutoCurationProgress } from '../services/autoCuration.js';
import {
  getCachedAlbum,
  updateAlbumFields,
  getCachedReviews,
} from '../utils/cache.js';
import { execute, queryAll, queryGet } from '../db/index.js';
import { resolveAlbumId } from '../utils/slug.js';
import { requireAdmin } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';

// Review-specific endpoints extracted out of routes/albums.ts in the
// Phase 2 cleanup. URLs are preserved (this router is mounted at the
// same `/api/albums` prefix alongside albumsRouter in index.ts), so
// clients don't need any changes. Split motivated by the albums.ts
// review pipeline having grown to ~730 lines across nine endpoints —
// separating the review-pipeline file lets albums.ts focus on album
// CRUD + metadata and makes the review flow easier to reason about as
// a unit.
const router = Router();

// ─── POST /api/albums/:id/reviews/discover — admin URL discovery ────────
//
// Serper (Google SERP proxy) + Haiku URL picker. Admin hits this from
// the manual-add form's URL tab; we return 0-5 editorial review URLs
// the admin can review, edit, and save through the existing batch
// scrape flow. No DB writes here — pure discovery.
//
// Flow: Serper fetches ~40 organic results → we filter hostnames
// against EXCLUDED_URL_DOMAINS (shops, aggregators) → what's left goes
// to Haiku for editorial-only selection. Haiku's call is cheap
// (~$0.0003, just URL+title+snippet as input) and runs even if we end
// up with 0 usable candidates — the null case is itself useful
// feedback ("no editorial reviews indexed by Google for this album").
//
// Dedupe against reviews already saved for this album is the client's
// job — it has the current reviews list handy and can filter the
// response before populating the URL textarea.
router.post('/:id/reviews/discover', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);
  const albumRow = queryGet(
    'SELECT title, artist_name FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!albumRow) {
    return res.status(404).json({ error: 'Album not found' });
  }

  // Engine selector — admin UI sends ?engine=serper|tavily|brave so
  // the operator can A/B the three discovery backends against each
  // other on the same album. Unknown / missing values fall through
  // to serper, which is the current default. Tavily and Brave keep
  // their own caches keyed by engine name so flipping back and
  // forth in the same session doesn't reuse the wrong response.
  const rawEngine = String(req.query.engine || 'serper').toLowerCase();
  const engine: 'serper' | 'tavily' | 'brave' =
    rawEngine === 'tavily' || rawEngine === 'brave' ? rawEngine : 'serper';
  const dispatchSearch =
    engine === 'tavily'
      ? searchTavily
      : engine === 'brave'
        ? searchBrave
        : searchSerper;

  try {
    const candidates = await dispatchSearch(
      albumRow.artist_name,
      albumRow.title
    );
    // Debug dump (2026-05-18) — Serper returning unexpectedly empty
    // candidate lists for albums that obviously have editorial
    // coverage on KR Google. Logs the raw hit set per engine so we
    // can see whether a missing URL fell out at the search layer
    // (not here) vs the domain-filter / already-saved / picker
    // layers (below). Drop the line once the SERP knobs have
    // settled across engines.
    console.log(
      `[discover-debug] ${albumRow.artist_name} / ${albumRow.title}: ${engine} returned ${candidates.length} URLs:`
    );
    for (const c of candidates) console.log(`  ${c.url}`);
    if (candidates.length === 0) {
      return res.json({
        urls: [],
        message: '검색 결과가 없습니다. Serper 키가 설정되어 있는지, 이 앨범이 Google에 색인되어 있는지 확인해주세요.',
      });
    }

    const domainFiltered = candidates.filter((c) => {
      try {
        const parsed = new URL(c.url);
        const host = parsed.hostname.toLowerCase();
        if (isHostBlacklisted(host)) return false;
        // Path-level roundup / multi-album post filter. We'd rather
        // miss an occasional single-album feature nested inside a
        // "best-of" post than let the LLM pay tokens to sift through
        // year-end digests that almost never contain a real per-album
        // review.
        const pathKey = parsed.pathname + parsed.search;
        if (EXCLUDED_URL_PATH_PATTERNS.some((re) => re.test(pathKey))) return false;
        return true;
      } catch {
        return false;
      }
    });

    // Strip candidates we already have a review for against this album,
    // so admin doesn't see the same URL listed again and the Haiku pick
    // call doesn't waste tokens ranking URLs we can't use. Normalization
    // catches cosmetic variants (http vs https, trailing slash, www.)
    // that the per-URL dup check in /add-url would miss.
    const existingUrls = queryAll(
      `SELECT full_review_url FROM reviews WHERE album_mbid = ?`,
      [mbid]
    ) as Array<{ full_review_url: string }>;
    const existingKeys = new Set(
      existingUrls.map((r) => normalizeReviewUrl(r.full_review_url))
    );
    const filtered = domainFiltered.filter(
      (c) => !existingKeys.has(normalizeReviewUrl(c.url))
    );
    const alreadySaved = domainFiltered.length - filtered.length;

    if (filtered.length === 0) {
      console.log(
        `[discover] ${albumRow.artist_name} / ${albumRow.title}: ${engine}=${candidates.length} → domain-filter=${domainFiltered.length} → already-saved=${alreadySaved} → haiku-pick=0 (nothing new)`
      );
      return res.json({
        urls: [],
        alreadySavedCount: alreadySaved,
        message:
          alreadySaved > 0
            ? '새로 가져올 URL이 없어요. 이미 저장된 리뷰들입니다.'
            : '쇼핑몰/aggregator만 나왔어요. 직접 구글에서 찾아주세요.',
      });
    }

    const picked = await selectEditorialReviewUrls(
      albumRow.artist_name,
      albumRow.title,
      filtered
    );
    // Admin-curated whitelist re-rank: whitelisted hosts bubble to the
    // top while preserving their relative order, and non-whitelisted
    // hosts keep theirs too. NOT a gate — the long tail still surfaces,
    // it just lands below proven sources. This way admin scans trusted
    // outlets first when the picker returns 15-25 candidates for a new
    // album and can commit to the top ones without doubting each host.
    const whitelist = getWhitelistedHostsFromDb();
    const isWhitelisted = (u: string): boolean => {
      try {
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        if (whitelist.has(h)) return true;
        for (const entry of whitelist) {
          if (h === entry || h.endsWith(`.${entry}`)) return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    const reordered = [
      ...picked.filter(isWhitelisted),
      ...picked.filter((u) => !isWhitelisted(u)),
    ];
    const whitelistedCount = picked.length - picked.filter((u) => !isWhitelisted(u)).length;
    // Stage counts so we can see where candidates drop off when a known-
    // reviewed album comes back short.
    console.log(
      `[discover] ${albumRow.artist_name} / ${albumRow.title}: ${engine}=${candidates.length} → domain-filter=${domainFiltered.length} → already-saved=${alreadySaved} → haiku-pick=${picked.length} (whitelisted=${whitelistedCount})`
    );
    // whitelistedCount tells the client how many of the returned URLs
    // come from admin-trusted hosts. The auto-curation UI ("자동
    // 큐레이션") used to compute this client-side against a hardcoded
    // PRIORITY_REVIEW_DOMAINS list; moving it server-side means the
    // single admin-managed source_whitelist is the only list of
    // preferred hosts, matching the direction we took for the
    // blacklist.
    //
    // alreadySavedCount tells the client how many Serper candidates
    // were silently dropped at the dedup step — without it, admin
    // couldn't tell the difference between "Haiku rejected these
    // hosts" and "we already have these URLs on file." Surfacing
    // the number in the response lets the curation log call it out
    // ("이미 저장 N개 제외") so a returning admin doesn't wonder why
    // an otherwise-trusted URL didn't reappear.
    res.json({ urls: reordered, whitelistedCount, alreadySavedCount: alreadySaved });
  } catch (err) {
    console.error('[discover] failed:', err);
    res.status(500).json({ error: 'URL 검색에 실패했습니다.' });
  }
});

// ─── POST /api/albums/:id/reviews/add-url — admin add review by URL ─────

router.post('/:id/reviews/add-url', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const albumRow = queryGet(
    'SELECT title, artist_name FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!albumRow) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const urlRaw = (req.body ?? {}).url;
  if (typeof urlRaw !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const url = urlRaw.trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL too long' });
  }

  // Avoid burning a Claude call when this URL is already saved against
  // this album — accidental double-clicks or admins re-pasting the same
  // link would otherwise re-scrape and overwrite an identical row.
  // Comparison goes through normalizeReviewUrl so cosmetic variants
  // (http vs https, trailing slash, www., tracking params) still
  // de-duplicate. Reviews-per-album count is small (dozens tops) so
  // fetching all rows and comparing in JS is fine.
  const albumReviews = queryAll(
    `SELECT id, source_name, score, manual_score, score_max, excerpt, excerpt_ko, full_review_url
     FROM reviews WHERE album_mbid = ?`,
    [mbid]
  ) as Array<{
    id: number;
    source_name: string;
    score: number | null;
    manual_score: number | null;
    score_max: number;
    excerpt: string | null;
    excerpt_ko: string | null;
    full_review_url: string;
  }>;
  const incomingKey = normalizeReviewUrl(url);
  const dup = albumReviews.find(
    (r) => normalizeReviewUrl(r.full_review_url) === incomingKey
  );
  if (dup) {
    return res.json({
      ok: true,
      duplicate: true,
      review: {
        id: dup.id,
        source: dup.source_name,
        score: dup.manual_score ?? dup.score,
        scoreMax: dup.score_max,
        excerpt: dup.excerpt,
        excerptKo: dup.excerpt_ko || null,
        url: dup.full_review_url,
        isManualScore: dup.manual_score != null,
      },
    });
  }

  try {
    const outcome = await scrapeReviewFromUrl(
      url,
      albumRow.artist_name,
      albumRow.title,
      mbid
    );
    if (outcome.kind === 'fail') {
      // Friendly per-reason message so the batch-result alert in the
      // client tells admin WHY each URL failed instead of a generic
      // "추출하지 못했습니다". Status 502 specifically for upstream
      // network/bot-wall problems (bot-blocked, fetch-failed) so
      // monitoring treats them differently from "page processed but
      // unusable" (422). 'blacklisted-domain' / 'excluded-path' are
      // admin-policy refusals and stay 422 — the URL made it through
      // network-level fine, we just refused to process it.
      const friendly: Record<string, string> = {
        'bot-blocked': '봇 차단 (Cloudflare 등). 수동 입력 탭을 사용하세요.',
        'fetch-failed': '페이지를 가져오지 못했습니다 (네트워크/타임아웃).',
        'text-too-short': '페이지 본문이 너무 짧습니다 (JS 렌더링 가능). 수동 입력 탭을 사용하세요.',
        'blacklisted-domain': '도메인 블랙리스트에 등록돼 거부됐습니다 (봇 차단/aggregator/페이월 등). 관리자 → 리뷰 큐레이션에서 해제 가능.',
        'excluded-path': 'URL 슬러그가 제외 패턴(인터뷰/프리미어/roundup 등)에 걸려 거부됐습니다.',
        'not-a-review': '리뷰 페이지가 아닌 것으로 판단됐습니다.',
        'claude-no-text': 'AI 분석 응답이 비어있었습니다.',
        'claude-error': 'AI 분석 중 오류가 발생했습니다.',
        'json-parse-failed': 'AI 응답을 파싱하지 못했습니다.',
      };
      const status =
        outcome.reason === 'bot-blocked' || outcome.reason === 'fetch-failed' ? 502 : 422;
      return res.status(status).json({
        error: friendly[outcome.reason] ?? 'URL에서 리뷰를 추출하지 못했습니다.',
        reason: outcome.reason,
      });
    }

    const scraped = outcome.review;
    execute(
      `INSERT INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(album_mbid, source_name) DO UPDATE SET
         score = excluded.score,
         score_max = excluded.score_max,
         excerpt = excluded.excerpt,
         excerpt_ko = excluded.excerpt_ko,
         full_review_url = excluded.full_review_url,
         scraped_at = datetime('now')`,
      [
        mbid,
        scraped.sourceName,
        scraped.score,
        scraped.scoreMax,
        scraped.excerpt,
        scraped.excerptKo,
        scraped.fullReviewUrl,
      ]
    );

    const saved = queryGet(
      `SELECT id, source_name, score, manual_score, score_max, excerpt, excerpt_ko, full_review_url
       FROM reviews WHERE album_mbid = ? AND source_name = ?`,
      [mbid, scraped.sourceName]
    );

    if (!saved) {
      return res.status(500).json({ error: 'Failed to retrieve saved review' });
    }

    const verifiedSources = getVerifiedSourceNames();
    res.json({
      ok: true,
      review: {
        id: saved.id,
        source: saved.source_name,
        score: saved.manual_score ?? saved.score,
        scoreMax: saved.score_max,
        excerpt: saved.excerpt,
        excerptKo: saved.excerpt_ko || null,
        url: saved.full_review_url,
        isManualScore: saved.manual_score != null,
        verified: verifiedSources.has(saved.source_name),
      },
    });
  } catch (err) {
    console.error('Add review URL error:', err);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

// ─── POST /api/albums/:id/reviews/manual — admin paste-in review ─────────
//
// Companion to /reviews/add-url for sites that block scraping
// (Korean webzines, paywalled publications). Admin supplies source
// name + pasted body text + optional score/url; Claude generates
// the excerpt and Korean summary from the pasted body.
//
// Admin-supplied score wins. If admin leaves it blank, we fall
// back to whatever Claude spotted in the text — same cheap call
// already runs for excerpt extraction, so detecting a score is
// free.
router.post('/:id/reviews/manual', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const albumRow = queryGet(
    'SELECT title, artist_name FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!albumRow) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const body = req.body ?? {};
  const sourceNameRaw = body.sourceName;
  const bodyTextRaw = body.body;
  const urlRaw = body.url;
  const adminScoreRaw = body.score;

  if (typeof sourceNameRaw !== 'string' || !sourceNameRaw.trim()) {
    return res.status(400).json({ error: 'sourceName is required' });
  }
  if (typeof bodyTextRaw !== 'string' || bodyTextRaw.trim().length < 50) {
    return res.status(400).json({ error: '본문 텍스트가 너무 짧습니다 (최소 50자).' });
  }
  const sourceName = sourceNameRaw.trim().slice(0, 100);
  const bodyText = bodyTextRaw;

  let fullReviewUrl = '';
  if (typeof urlRaw === 'string' && urlRaw.trim()) {
    const trimmedUrl = urlRaw.trim();
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }
    if (trimmedUrl.length > 2000) {
      return res.status(400).json({ error: 'URL too long' });
    }
    fullReviewUrl = trimmedUrl;
  }

  let adminScore: number | null = null;
  if (adminScoreRaw !== undefined && adminScoreRaw !== null && adminScoreRaw !== '') {
    const n = typeof adminScoreRaw === 'number' ? adminScoreRaw : parseFloat(String(adminScoreRaw));
    if (isNaN(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: 'Score must be 0-100' });
    }
    adminScore = n;
  }
  try {
    const extracted = await extractFromPastedText(
      bodyText,
      albumRow.artist_name,
      albumRow.title,
      sourceName
    );
    if (!extracted) {
      return res.status(422).json({ error: '본문에서 리뷰를 추출하지 못했습니다.' });
    }

    const finalScore = adminScore !== null ? adminScore : extracted.score;

    execute(
      `INSERT INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
       VALUES (?, ?, ?, 100, ?, ?, ?)
       ON CONFLICT(album_mbid, source_name) DO UPDATE SET
         score = excluded.score,
         score_max = excluded.score_max,
         excerpt = excluded.excerpt,
         excerpt_ko = excluded.excerpt_ko,
         full_review_url = excluded.full_review_url,
         scraped_at = datetime('now')`,
      [
        mbid,
        sourceName,
        finalScore,
        extracted.excerpt,
        extracted.excerptKo,
        fullReviewUrl,
      ]
    );

    const saved = queryGet(
      `SELECT id, source_name, score, manual_score, score_max, excerpt, excerpt_ko, full_review_url
       FROM reviews WHERE album_mbid = ? AND source_name = ?`,
      [mbid, sourceName]
    );
    if (!saved) {
      return res.status(500).json({ error: 'Failed to retrieve saved review' });
    }

    const verifiedSources = getVerifiedSourceNames();
    res.json({
      ok: true,
      review: {
        id: saved.id,
        source: saved.source_name,
        score: saved.manual_score ?? saved.score,
        scoreMax: saved.score_max,
        excerpt: saved.excerpt,
        excerptKo: saved.excerpt_ko || null,
        url: saved.full_review_url,
        isManualScore: saved.manual_score != null,
        verified: verifiedSources.has(saved.source_name),
      },
    });
  } catch (err) {
    console.error('Manual review error:', err);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

// ─── POST /api/albums/:id/reviews/generate-summary ─────────────────────
//
// Cheap alternative to the full Claude review pipeline. Takes whatever
// reviews are already cached for the album (typically URL-scraped
// ones added by admin via /reviews/add-url), hands them to Sonnet,
// and writes the Korean summary + stamps reviews_crawled_at so the
// album un-dims on the home grid. Costs ~$0.01 per call vs ~$0.10
// for the full 리뷰 모아오기 path.
router.post(
  '/:id/reviews/generate-summary',
  adminClaudeLimiter,
  requireAdmin,
  async (req, res) => {
    const resolved = resolveAlbumId(req.params.id as string);
    const mbid = resolved?.mbid || (req.params.id as string);

    const cached = getCachedAlbum(mbid);
    if (!cached) return res.status(404).json({ error: 'Album not found' });

    const existing = getCachedReviews(mbid) || [];
    // Need at least 2 reviews for the summary to be worth anything —
    // one review summarising itself is pointless, zero is impossible.
    if (existing.length < 2) {
      return res.status(400).json({
        error: '요약을 생성하려면 리뷰가 최소 2개 필요합니다.',
      });
    }

    const summary = await generateKoreanSummary(
      cached.title,
      cached.artist_name,
      existing.map((r: any) => ({
        source: r.source_name,
        score: r.manual_score ?? r.score,
        excerpt: r.excerpt,
      }))
    );

    const fields: Record<string, any> = {
      // Stamp the crawl marker regardless of summary success — admin
      // deliberately curated this album manually; the "pending" state
      // is no longer accurate even if Sonnet fails.
      reviews_crawled_at: new Date().toISOString(),
    };
    if (summary) {
      fields.korean_summary = summary;
      fields.korean_summary_generated_at = new Date().toISOString();
    }
    updateAlbumFields(mbid, fields);

    res.json({ ok: true, summary, stamped: true });
  }
);

// ─── GET /api/albums/:id/auto-curation-status — poll for in-flight runs ──
//
// Public read endpoint so the album page can show "리뷰 발굴 중 N/15"
// while a user-triggered auto-curation is running, and refetch when it
// finishes. Returns `{ progress: null }` when nothing is in flight for
// this mbid — either the album was registered by admin (no auto-trigger),
// or the user's auto-curation already finished, or the album is fully
// curated. The client uses the null transition as its refresh signal.
//
// No rate limiter — the polling pattern (one client, every ~3s, only
// while reviews_crawled_at IS NULL) is bounded and the handler does no
// DB work, just an in-memory Map lookup.
router.get('/:id/auto-curation-status', (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);
  const progress = getAutoCurationProgress(mbid);
  res.json({ progress });
});

// ─── POST /api/albums/:id/reviews/mark-none — admin "no reviews exist" ─
//
// Escape hatch for albums too obscure to have any review coverage
// anywhere — the ⚠️ pending badge would otherwise stick around
// forever. Stamps reviews_crawled_at so the grid un-dims and the
// card stops showing the admin mark, without any Claude call or
// korean_summary being generated. No rate limiter needed; this is
// a single UPDATE with no external cost.
//
// Reversible by side effect: if admin later finds and adds a
// review, the existing "리뷰 추가" flow leaves reviews_crawled_at
// as-is, and the album just starts behaving like a normal
// reviewed album. No explicit unset is exposed.
router.post('/:id/reviews/mark-none', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const cached = getCachedAlbum(mbid);
  if (!cached) return res.status(404).json({ error: 'Album not found' });

  updateAlbumFields(mbid, {
    reviews_crawled_at: new Date().toISOString(),
  });
  res.json({ ok: true, stamped: true });
});

// ─── POST /api/albums/reviews/:reviewId/score — manual score entry ───────

router.post('/reviews/:reviewId/score', requireAdmin, async (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  const { score } = req.body;

  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  // null = admin typed "-" to clear the score entirely. We null BOTH
  // manual_score AND the original scraped score, because the API
  // response uses `manual_score ?? score` — if we only cleared
  // manual_score, the scraped value would bleed back through and
  // the admin's "remove score" intent would silently fail.
  // Destructive, but intentional: re-scoring is a single keystroke.
  try {
    if (score === null) {
      execute(
        'UPDATE reviews SET score = NULL, manual_score = NULL WHERE id = ?',
        [reviewId]
      );
    } else if (typeof score === 'number' && score >= 0 && score <= 100) {
      execute('UPDATE reviews SET manual_score = ? WHERE id = ?', [score, reviewId]);
    } else {
      return res.status(400).json({ error: 'Score must be null or a number 0-100' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Manual score error:', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// ─── PATCH /api/albums/reviews/:reviewId/excerpt — admin edit excerpt_ko ──

router.patch('/reviews/:reviewId/excerpt', requireAdmin, (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  const raw = (req.body ?? {}).excerpt_ko;
  let value: string | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    value = trimmed ? trimmed.slice(0, 4000) : null;
  } else {
    return res.status(400).json({ error: 'excerpt_ko must be a string or null' });
  }

  // Read the old excerpt_ko alongside the existence check so we can
  // feed the edit-log below. Single query instead of two.
  const existing = queryGet(
    'SELECT id, excerpt_ko FROM reviews WHERE id = ?',
    [reviewId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'Review not found' });
  }

  try {
    execute('UPDATE reviews SET excerpt_ko = ? WHERE id = ?', [value, reviewId]);

    // Log every actual change (both old and new text) so we can
    // periodically mine the corpus for recurring mistranslation
    // patterns that deserve a KO_TERM_REPLACEMENTS entry. Noop when
    // the text didn't change (admin opened the editor and saved
    // without edits). Intentionally never throws — the log is
    // best-effort and can't block the user-visible save.
    const oldText = existing.excerpt_ko ?? null;
    if (oldText !== value) {
      try {
        const adminId = (req.user as AppUser | undefined)?.id ?? null;
        execute(
          `INSERT INTO excerpt_edits (review_id, old_excerpt_ko, new_excerpt_ko, edited_by_user_id)
           VALUES (?, ?, ?, ?)`,
          [reviewId, oldText, value, adminId]
        );
      } catch (logErr) {
        console.error('[excerpt-edits] log failed:', (logErr as Error).message);
      }
    }

    res.json({ ok: true, excerptKo: value });
  } catch (error) {
    console.error('Update excerpt error:', error);
    res.status(500).json({ error: 'Failed to update excerpt' });
  }
});

// ─── POST /api/albums/reviews/:reviewId/rescrape — re-fetch + re-extract ───
//
// "다시 요약하기" admin action. Previously called /retranslate and re-ran the
// Korean translation against the stored `excerpt` column — which meant the
// LLM saw the same input every click and produced near-identical output,
// the very symptom that drove the redesign. The new flow does what the
// label promises: re-fetch the original page through the same Jina + LLM
// path a fresh review takes, and overwrite excerpt / excerpt_ko / score in
// place. manual_score is preserved (admin overrides survive); source_name
// is held constant so the (album_mbid, source_name) UNIQUE doesn't trip
// on a sourceName the LLM happens to capitalize differently this time.

router.post('/reviews/:reviewId/rescrape', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  try {
    const review = queryGet(
      'SELECT id, album_mbid, source_name, full_review_url FROM reviews WHERE id = ?',
      [reviewId]
    );
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    if (!review.full_review_url) {
      return res.status(400).json({
        error: '원문 URL이 저장되어 있지 않아 다시 가져올 수 없어요. 수정으로 직접 편집해 주세요.',
      });
    }

    const album = getCachedAlbum(review.album_mbid);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const outcome = await scrapeReviewFromUrl(
      review.full_review_url,
      album.artist_name || '',
      album.title || '',
      review.album_mbid
    );

    if (outcome.kind !== 'ok') {
      return res.status(422).json({
        error: '원문 다시 읽기에 실패했어요.',
        reason: outcome.reason,
        message: outcome.message,
      });
    }

    const fresh = outcome.review;
    execute(
      `UPDATE reviews
       SET excerpt = ?, excerpt_ko = ?, score = ?, score_max = ?, scraped_at = datetime('now')
       WHERE id = ?`,
      [fresh.excerpt, fresh.excerptKo, fresh.score, fresh.scoreMax, reviewId]
    );

    res.json({
      excerpt: fresh.excerpt,
      excerptKo: fresh.excerptKo,
      score: fresh.score,
      scoreMax: fresh.scoreMax,
    });
  } catch (error) {
    console.error('Rescrape error:', error);
    res.status(500).json({ error: 'Failed to rescrape review' });
  }
});

// ─── POST /api/albums/reviews/:reviewId/rescrape-paste — re-extract from pasted text ───
//
// Companion to /rescrape for cases where Jina keeps returning the wrong
// page (paywall stub, navigation-only render, cookie banner instead of
// body, etc.) — admin pastes the real article text from the browser
// and we re-run the same LLM extraction the manual-entry flow uses
// (extractFromPastedText). excerpt / excerpt_ko / score are overwritten
// in place; source_name and full_review_url are preserved so the
// (album_mbid, source_name) UNIQUE doesn't trip and the existing
// outbound link keeps working. manual_score is left untouched (admin
// score overrides survive).

router.post('/reviews/:reviewId/rescrape-paste', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }
  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  if (body.trim().length < 50) {
    return res.status(400).json({ error: '본문이 너무 짧아요. 최소 50자 이상 붙여넣어 주세요.' });
  }

  try {
    const review = queryGet(
      'SELECT id, album_mbid, source_name FROM reviews WHERE id = ?',
      [reviewId]
    );
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const album = getCachedAlbum(review.album_mbid);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const extracted = await extractFromPastedText(
      body,
      album.artist_name || '',
      album.title || '',
      review.source_name
    );
    if (!extracted) {
      return res.status(422).json({ error: '본문에서 리뷰를 추출하지 못했습니다.' });
    }

    execute(
      `UPDATE reviews
       SET excerpt = ?, excerpt_ko = ?, score = ?, score_max = ?, scraped_at = datetime('now')
       WHERE id = ?`,
      [extracted.excerpt, extracted.excerptKo, extracted.score, extracted.scoreMax, reviewId]
    );

    res.json({
      excerpt: extracted.excerpt,
      excerptKo: extracted.excerptKo,
      score: extracted.score,
      scoreMax: extracted.scoreMax,
    });
  } catch (error) {
    console.error('Rescrape-paste error:', error);
    res.status(500).json({ error: 'Failed to extract review from pasted text' });
  }
});

// ─── GET /api/albums/:mbid/reviews — slow: reviews + summary ────────────────

router.get('/:id/reviews', async (req, res) => {
  // Editorial reviews + Korean summary — no per-user state. Cache
  // duration chosen to absorb the spike when an album page is shared
  // (multiple anon viewers in a short window) while still letting an
  // admin score/excerpt edit propagate without a manual CF purge in
  // a couple of minutes.
  res.set('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');

  const resolved = resolveAlbumId((req.params.id as string));
  const mbid = resolved?.mbid || (req.params.id as string);

  try {
    const cached = getCachedAlbum(mbid);

    // Cached-only read. The automatic searchReviews fallback that
    // used to live here has moved: review collection is now an
    // explicit admin action ("리뷰 모아오기" / "요약 생성") on the
    // album page. That keeps the $0.10+ Claude pipeline from firing
    // on every first-visitor view of a pending album.
    const reviews = getCachedReviews(mbid);
    const koreanSummary = cached?.korean_summary || null;
    const verifiedSources = getVerifiedSourceNames();

    const formattedReviews = (reviews || []).map((r: any) => ({
      id: r.id,
      source: r.source_name,
      score: r.manual_score ?? r.score,
      scoreMax: r.score_max,
      excerpt: r.excerpt,
      excerptKo: r.excerpt_ko || null,
      url: r.full_review_url,
      isManualScore: r.manual_score != null,
      verified: verifiedSources.has(r.source_name),
    }));

    const scoredReviews = formattedReviews.filter(
      (r: any) => r.score != null && r.scoreMax != null && r.scoreMax > 0
    );
    const averageScore =
      scoredReviews.length > 0
        ? scoredReviews.reduce((sum: number, r: any) => sum + (r.score / r.scoreMax) * 100, 0) / scoredReviews.length
        : null;

    // Pronunciation from cache
    const freshCached = getCachedAlbum(mbid);

    res.json({
      reviews: formattedReviews,
      koreanSummary,
      averageScore,
      artistKo: freshCached?.artist_ko || null,
      titleKo: freshCached?.title_ko || null,
    });
  } catch (error) {
    console.error('Reviews endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

export default router;
