import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  getRollingDailyClaudeSpendUsd,
  ROLLING_24H_USD_CAP,
} from '../services/claudeBudget.js';
import { describeOperationRoutes } from '../services/llmRouter.js';
import {
  bustSourceListCaches,
  getVerifiedHosts,
  VERIFIED_REVIEW_COUNT_THRESHOLD,
} from '../services/reviews.js';
import { invalidateTagBlacklistCache } from './albums.js';
import {
  searchTrack,
  isSpotifyRateLimited,
  spotifyRateLimitRemainingMs,
} from '../services/spotify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

router.use(requireAdmin);

// Defensive JSON parse for TEXT columns that store a JSON array
// (e.g. albums.cover_art_fallbacks). A single malformed row would
// otherwise crash the whole /admin/stats response with a 500.
function safeParseArray(raw: unknown): any[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Hardcoded prices for token → USD conversion. Update when Anthropic's
// pricing page changes. Rates are per 1M tokens (input / output) and
// per 1000 calls (web search). Both exact alias (what we pass into the
// SDK) and the dated response model string (what Anthropic echoes back
// and what logClaudeUsage actually stores) are listed so the lookup
// hits on either side. If a brand-new versioned model shows up we
// prefix-match in pricingFor before giving up.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  // DeepSeek V4 Flash (launched 2026-04-24). The deepseek-chat API
  // alias now routes to v4-flash for back-compat, so all new
  // responses come back with model='deepseek-v4-flash' and we log
  // those rows under that key. Cache-miss pricing (the conservative
  // ceiling); cache-hit input is $0.0028 but billing it accurately
  // would need cache_hit metadata we don't track yet. Used for
  // scrape extraction (Jina markdown → JSON), pronunciation,
  // similar-album descriptions, editorial URL picks, and Korean
  // review summaries.
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  // DeepSeek V4 Pro — reserved for the pricier per-op routes (Korean
  // review summary is the first candidate) via LLM_PRIMARY_MODEL_<OP> /
  // shadow. Same cache-miss-as-ceiling convention as flash; the current
  // promo cache-miss rate ($0.435/$0.87) is what we're billed today —
  // the pre-discount list price is ~4x ($1.74/$3.48).
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  // Legacy log rows logged under model='deepseek-chat' all pre-date
  // 2026-04-24 — V3-era pricing.
  'deepseek-chat': { input: 0.27, output: 1.1 },
  // Legacy / fallback
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};
const WEB_SEARCH_PER_1000 = 10; // $10 / 1000 calls

// Prefix-match fallback: if Anthropic bumps the date suffix on an
// existing model (e.g. claude-sonnet-4-5-20250929 → ...-20260115) the
// exact lookup misses. Match on the family prefix and use those rates
// so costs stay honest until the table is updated. Ordered longest-
// prefix-first so "claude-sonnet-4-5" wins over a hypothetical
// "claude-sonnet" entry.
const PRICING_PREFIXES = Object.keys(PRICING_PER_1M).sort(
  (a, b) => b.length - a.length
);

function pricingFor(model: string) {
  const exact = PRICING_PER_1M[model];
  if (exact) return exact;
  for (const p of PRICING_PREFIXES) {
    if (model.startsWith(p)) return PRICING_PER_1M[p];
  }
  return PRICING_PER_1M['claude-haiku-4-5'];
}

// GET /api/admin/stats — dashboard overview
router.get('/stats', (_req, res) => {
  const totalAlbums = queryGet(`SELECT COUNT(*) AS n FROM albums`)?.n || 0;
  const albumsToday = queryGet(
    `SELECT COUNT(*) AS n FROM albums WHERE DATE(created_at) = DATE('now')`
  )?.n || 0;
  const totalUsers = queryGet(`SELECT COUNT(*) AS n FROM users`)?.n || 0;
  const usersToday = queryGet(
    `SELECT COUNT(*) AS n FROM users WHERE DATE(created_at) = DATE('now')`
  )?.n || 0;
  const totalReviews = queryGet(
    `SELECT COUNT(*) AS n FROM user_reviews`
  )?.n || 0;
  const reviewsToday = queryGet(
    `SELECT COUNT(*) AS n FROM user_reviews WHERE DATE(created_at) = DATE('now')`
  )?.n || 0;
  const totalPurchaseLinks = queryGet(
    `SELECT COUNT(*) AS n FROM purchase_links`
  )?.n || 0;
  const purchaseLinksToday = queryGet(
    `SELECT COUNT(*) AS n FROM purchase_links WHERE DATE(created_at) = DATE('now')`
  )?.n || 0;
  const votesToday = queryGet(
    `SELECT
       SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down
     FROM album_votes WHERE DATE(created_at) = DATE('now')`
  );

  // LEFT JOIN users so we can flag rows the admin registered themselves
  // — admin self-registrations should not light up as NEW in the
  // dashboard feed. `requested_by_user_id IS NULL` covers direct admin
  // inserts (e.g. browsing to /album/:mbid for an uncached album,
  // seed rows); `u.is_admin = 1` covers the regular register-modal
  // flow which stamps the admin's own id.
  const recentAlbums = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.created_at,
            a.cover_art_url, a.cover_art_fallbacks,
            a.requested_by_user_id,
            COALESCE(u.is_admin, 0) AS requester_is_admin
     FROM albums a
     LEFT JOIN users u ON u.id = a.requested_by_user_id
     ORDER BY a.created_at DESC LIMIT 20`
  ).map((a: any) => ({
    id: a.id,
    mbid: a.slug || a.mbid,
    title: a.title,
    artist: a.artist_name,
    createdAt: a.created_at,
    coverArtUrl: a.cover_art_url,
    coverArtFallbacks: safeParseArray(a.cover_art_fallbacks),
    registeredByAdmin:
      a.requested_by_user_id == null || !!a.requester_is_admin,
  }));

  // Recent purchase-link activity — complements the per-album view by
  // surfacing "who's seeding store links lately" at the dashboard
  // level. Scoped to 20 rows to keep the payload cheap.
  const recentPurchaseLinks = queryAll(
    `SELECT pl.id, pl.url, pl.store_name, pl.store_favicon_url,
            pl.price, pl.currency, pl.created_at,
            a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            pl.user_id,
            COALESCE(u.display_name, u.name) AS user_name
     FROM purchase_links pl
     INNER JOIN albums a ON a.id = pl.album_id
     LEFT JOIN users u ON u.id = pl.user_id
     ORDER BY pl.created_at DESC
     LIMIT 20`
  ).map((r: any) => ({
    id: r.id,
    url: r.url,
    storeName: r.store_name,
    storeFaviconUrl: r.store_favicon_url,
    price: r.price,
    currency: r.currency,
    createdAt: r.created_at,
    albumSlug: r.album_slug || r.album_mbid || '',
    albumTitle: r.album_title,
    albumArtist: r.album_artist,
    userId: r.user_id,
    userName: r.user_name,
  }));

  const recentUsers = queryAll(
    `SELECT id, email, name, avatar_url, is_admin, created_at
     FROM users ORDER BY created_at DESC LIMIT 20`
  ).map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatar_url,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
  }));

  const recentReviews = queryAll(
    `SELECT ur.id, ur.body, ur.emoji, ur.rating, ur.created_at, ur.updated_at,
            a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            u.id AS user_id, u.name AS user_name, u.email AS user_email,
            u.avatar_url AS user_avatar
     FROM user_reviews ur
     LEFT JOIN albums a ON a.id = ur.album_id
     LEFT JOIN users u ON u.id = ur.user_id
     ORDER BY ur.updated_at DESC, ur.id DESC
     LIMIT 30`
  ).map((r: any) => ({
    id: r.id,
    body: r.body,
    emoji: r.emoji,
    rating: r.rating,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    albumSlug: r.album_slug || r.album_mbid,
    albumTitle: r.album_title,
    albumArtist: r.album_artist,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    userAvatar: r.user_avatar,
  }));

  // ── Claude API usage (current calendar month, UTC) ────────────────
  // Aggregate per (operation, model) then translate tokens + web
  // searches to USD client-side-friendly shape. The window resets at
  // the start of each calendar month — so the dashboard reads as
  // "this month's spend" instead of a sliding 7-day total. Admins
  // can also wipe the log entirely via DELETE /api/admin/claude-usage
  // when they want a hard reset (e.g. clearing experimentation
  // noise during testing).
  const usageRows = queryAll(
    `SELECT operation, model,
            SUM(input_tokens) AS in_tok,
            SUM(output_tokens) AS out_tok,
            SUM(web_search_count) AS search_n,
            COUNT(*) AS calls
     FROM claude_usage_log
     WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now')
     GROUP BY operation, model`
  ) as Array<{
    operation: string;
    model: string;
    in_tok: number;
    out_tok: number;
    search_n: number;
    calls: number;
  }>;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalSearchCount = 0;
  let totalUsd = 0;
  const byOperation: Record<
    string,
    { calls: number; tokens: number; searches: number; usd: number }
  > = {};

  for (const row of usageRows) {
    const prices = pricingFor(row.model);
    const inUsd = (row.in_tok / 1_000_000) * prices.input;
    const outUsd = (row.out_tok / 1_000_000) * prices.output;
    const searchUsd = (row.search_n / 1000) * WEB_SEARCH_PER_1000;
    const usd = inUsd + outUsd + searchUsd;

    totalInputTokens += row.in_tok;
    totalOutputTokens += row.out_tok;
    totalSearchCount += row.search_n;
    totalUsd += usd;

    const prev =
      byOperation[row.operation] || { calls: 0, tokens: 0, searches: 0, usd: 0 };
    byOperation[row.operation] = {
      calls: prev.calls + row.calls,
      tokens: prev.tokens + row.in_tok + row.out_tok,
      searches: prev.searches + row.search_n,
      usd: prev.usd + usd,
    };
  }

  // Sort operations by cost descending for the display.
  const operationsBreakdown = Object.entries(byOperation)
    .map(([op, v]) => ({
      operation: op,
      calls: v.calls,
      tokens: v.tokens,
      searches: v.searches,
      usd: Math.round(v.usd * 100) / 100,
    }))
    .sort((a, b) => b.usd - a.usd);

  const monthLabel = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
  // Rolling-24h total — separate from the calendar-month figure above.
  // Displayed in the dashboard as "24h 지출" and enforced as a hard cap
  // on 🔍 리뷰 모아오기 at the request layer (see albumRequests.ts).
  const rolling24hUsd = getRollingDailyClaudeSpendUsd();
  const claudeUsage = {
    month: {
      label: monthLabel,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      webSearchCount: totalSearchCount,
      usd: Math.round(totalUsd * 100) / 100,
      byOperation: operationsBreakdown,
    },
    rolling24h: {
      usd: Math.round(rolling24hUsd * 100) / 100,
      capUsd: ROLLING_24H_USD_CAP,
    },
  };

  // ── Incomplete albums ─────────────────────────────────────────────
  // Buckets the admin should glance at and decide whether to top up
  // manually. Each bucket returns up to 5 rows — dashboard just needs
  // "something to click into", not a full inventory.
  // Higher sample cap so the checkbox-batch curation flow on the admin
  // page can select a meaningful chunk at once without paging. Admin
  // can still refresh after a batch to pick up the next slice.
  const INCOMPLETE_LIMIT = 30;

  // PENDING_FILTER used to exclude albums with reviews_crawled_at IS NULL
  // because they were double-counted in a separate "리뷰 수집 대기" panel.
  // That panel is gone (replaced by "최근 등록 앨범"), so filtering on
  // reviews_crawled_at IS NOT NULL was hiding the majority of the backlog
  // — every fresh registration lands with NULL per the cost-discipline
  // rule in CLAUDE.md ("never warm-up reviews"), so the bucket was showing
  // only the tiny subset of albums that had a review-scrape explicitly
  // triggered before. The filter is dropped entirely; the buckets now
  // reflect the real backlog admin needs to work through.

  // Released-on-or-before-today filter for the curation buckets.
  // Future-release albums obviously have no reviews and no summary
  // yet — that's not curator backlog, that's anticipation. Excluding
  // them keeps the bucket honest. COALESCE to today for albums whose
  // release date is unknown so they don't get filtered out for
  // missing data; release_year-only entries fall back to year-01-01,
  // which is fine for the in-the-past majority and only mis-includes
  // late-year releases registered with year-only metadata. Cover
  // backlog is unaffected — even unreleased albums need cover art.
  const RELEASED_FILTER = `
    COALESCE(a.release_date, a.release_year || '-01-01', DATE('now')) <= DATE('now')
  `;

  const noReviews = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)
       AND ${RELEASED_FILTER}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noSummary = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE (a.korean_summary IS NULL OR a.korean_summary = '')
       AND ${RELEASED_FILTER}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noCover = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE a.cover_art_url IS NULL OR a.cover_art_url = ''
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  // Total counts (not limited) — shown next to the label so admin
  // knows how big the backlog is. Same released-filter applied to
  // noReviews/noSummary so the count matches the visible sample.
  const noReviewsCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)
       AND ${RELEASED_FILTER}`
  )?.n || 0;
  const noSummaryCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE (a.korean_summary IS NULL OR a.korean_summary = '')
       AND ${RELEASED_FILTER}`
  )?.n || 0;
  const noCoverCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE a.cover_art_url IS NULL OR a.cover_art_url = ''`
  )?.n || 0;

  function mapIncomplete(rows: any[]) {
    return rows.map((a: any) => ({
      id: a.id,
      mbid: a.slug || a.mbid,
      title: a.title,
      artist: a.artist_name,
      coverArtUrl: a.cover_art_url,
      coverArtFallbacks: safeParseArray(a.cover_art_fallbacks),
    }));
  }

  const incompleteAlbums = {
    noReviews: { count: noReviewsCount, samples: mapIncomplete(noReviews) },
    noSummary: { count: noSummaryCount, samples: mapIncomplete(noSummary) },
    noCover: { count: noCoverCount, samples: mapIncomplete(noCover) },
  };

  res.json({
    totalAlbums,
    albumsToday,
    totalUsers,
    usersToday,
    totalReviews,
    reviewsToday,
    totalPurchaseLinks,
    purchaseLinksToday,
    votesToday: {
      up: votesToday?.up || 0,
      down: votesToday?.down || 0,
    },
    recentAlbums,
    recentPurchaseLinks,
    recentUsers,
    recentReviews,
    claudeUsage,
    incompleteAlbums,
  });
});

// DELETE /api/admin/claude-usage — wipe the rolling usage log.
//
// Used as a hard reset from the API 사용량 panel — the natural
// monthly window above is the default behaviour, but during testing
// or after a billing reconciliation the admin sometimes wants the
// counters cleared without waiting for the calendar to flip.
router.delete('/claude-usage', (_req, res) => {
  const before = queryGet(`SELECT COUNT(*) AS c FROM claude_usage_log`)?.c ?? 0;
  execute(`DELETE FROM claude_usage_log`);
  res.json({ deleted: before });
});

// GET /api/admin/claude-usage/recent — last N Claude calls for
// forensic "where did my $3 go" inspection. The aggregated panel
// hides how many times each operation fired; this endpoint shows
// one row per actual call so admin can spot unexpected repeat
// patterns (refresh-reviews clicked 12 times, retranslate burning
// on every review, etc.). Limited to 100 rows by default.
router.get('/claude-usage/recent', (req, res) => {
  const limitRaw = parseInt((req.query.limit as string) || '', 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

  const rows = queryAll(
    `SELECT id, operation, model,
            input_tokens, output_tokens, web_search_count,
            created_at
     FROM claude_usage_log
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  ) as Array<{
    id: number;
    operation: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    web_search_count: number;
    created_at: string;
  }>;

  res.json({
    calls: rows.map((r) => {
      const prices = pricingFor(r.model);
      const inUsd = (r.input_tokens / 1_000_000) * prices.input;
      const outUsd = (r.output_tokens / 1_000_000) * prices.output;
      const searchUsd = (r.web_search_count / 1000) * WEB_SEARCH_PER_1000;
      return {
        id: r.id,
        operation: r.operation,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        webSearchCount: r.web_search_count,
        usd: Math.round((inUsd + outUsd + searchUsd) * 10000) / 10000,
        createdAt: r.created_at,
      };
    }),
  });
});

// GET /api/admin/api-console — console-view data for the dedicated
// admin monitoring page. Returns four time-window totals + per-
// operation + per-model breakdowns + the recent calls tail, all in
// one response so the client can poll a single endpoint on a short
// interval (15s) without fanning out to multiple round-trips.
router.get('/api-console', (_req, res) => {
  const windows: Array<{ label: string; interval: string }> = [
    { label: '1h', interval: '-1 hour' },
    { label: '24h', interval: '-1 day' },
    { label: '7d', interval: '-7 days' },
    { label: '30d', interval: '-30 days' },
  ];

  function sumRowsUsd(rows: any[]) {
    let usd = 0;
    for (const r of rows) {
      const prices = pricingFor(r.model);
      usd += (r.in_tok / 1_000_000) * prices.input;
      usd += (r.out_tok / 1_000_000) * prices.output;
      usd += (r.search_n / 1000) * WEB_SEARCH_PER_1000;
    }
    return Math.round(usd * 10000) / 10000;
  }

  const totals = windows.map((w) => {
    const rows = queryAll(
      `SELECT model,
              SUM(input_tokens) AS in_tok,
              SUM(output_tokens) AS out_tok,
              SUM(web_search_count) AS search_n,
              COUNT(*) AS call_n
       FROM claude_usage_log
       WHERE created_at >= datetime('now', ?)
       GROUP BY model`,
      [w.interval]
    ) as Array<{ model: string; in_tok: number; out_tok: number; search_n: number; call_n: number }>;
    return {
      label: w.label,
      usd: sumRowsUsd(rows),
      calls: rows.reduce((a, r) => a + r.call_n, 0),
    };
  });

  // Last-30-days breakdown by operation, sorted by cost desc.
  const byOperation = queryAll(
    `SELECT operation, model,
            SUM(input_tokens) AS in_tok,
            SUM(output_tokens) AS out_tok,
            SUM(web_search_count) AS search_n,
            COUNT(*) AS call_n
     FROM claude_usage_log
     WHERE created_at >= datetime('now', '-30 days')
     GROUP BY operation, model`
  ) as Array<{ operation: string; model: string; in_tok: number; out_tok: number; search_n: number; call_n: number }>;

  // Aggregate operations into one row per operation (collapse models),
  // so the UI shows "scrape_review — $2.34 (500 calls)" regardless of
  // whether it's Haiku or DeepSeek. Expose the provider mix on the
  // side for context.
  const opMap = new Map<string, { calls: number; usd: number; providers: Record<string, number> }>();
  for (const r of byOperation) {
    const prices = pricingFor(r.model);
    const rowUsd =
      (r.in_tok / 1_000_000) * prices.input +
      (r.out_tok / 1_000_000) * prices.output +
      (r.search_n / 1000) * WEB_SEARCH_PER_1000;
    const entry = opMap.get(r.operation) || { calls: 0, usd: 0, providers: {} };
    entry.calls += r.call_n;
    entry.usd += rowUsd;
    entry.providers[r.model] = (entry.providers[r.model] || 0) + r.call_n;
    opMap.set(r.operation, entry);
  }
  const operations = Array.from(opMap.entries())
    .map(([operation, v]) => ({
      operation,
      calls: v.calls,
      usd: Math.round(v.usd * 10000) / 10000,
      providers: v.providers,
    }))
    .sort((a, b) => b.usd - a.usd);

  // Live tail — last 30 calls, same shape as /claude-usage/recent
  // but smaller limit since the console polls this frequently.
  const recentRows = queryAll(
    `SELECT id, operation, model, input_tokens, output_tokens,
            web_search_count, created_at
     FROM claude_usage_log
     ORDER BY id DESC
     LIMIT 30`
  ) as Array<{
    id: number; operation: string; model: string;
    input_tokens: number; output_tokens: number;
    web_search_count: number; created_at: string;
  }>;
  const recent = recentRows.map((r) => {
    const prices = pricingFor(r.model);
    const usd =
      (r.input_tokens / 1_000_000) * prices.input +
      (r.output_tokens / 1_000_000) * prices.output +
      (r.web_search_count / 1000) * WEB_SEARCH_PER_1000;
    return {
      id: r.id,
      operation: r.operation,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      webSearchCount: r.web_search_count,
      usd: Math.round(usd * 10000) / 10000,
      createdAt: r.created_at,
    };
  });

  res.json({ totals, operations, recent });
});

// GET /api/admin/snapshot-dump
//
// Streams a tar.gz bundle of the live production state so the site
// operator can pull a complete snapshot down to their local
// environment. Includes:
//   - diggershaus.db       (VACUUM INTO copy — transactionally safe)
//   - avatars/             (user-uploaded avatars)
//   - custom-covers/       (user-uploaded album covers)
//
// Excludes cover-cache/ — that's a passthrough cache of external
// cover images and regenerates on demand locally.
//
// DB + assets must travel together: rows in the DB reference asset
// filenames (users.avatar_url, albums.custom_cover_*) so a DB-only
// dump leaves local avatars/covers broken. Phase 3 mydig layout
// work needs real digger data with intact visuals to surface edge
// cases.
//
// Archive layout mirrors server/data/ so the operator extracts with
//   cd server/data && tar xzf ~/Downloads/diggershaus-YYYY-MM-DD.tar.gz
// and is done.
//
// Admin-only via the router-level requireAdmin middleware (line 14).
// Not surfaced in UI — visit the URL directly in a browser logged
// in as admin; the session cookie handles auth.
router.get('/snapshot-dump', (_req, res) => {
  const dbPath =
    process.env.DB_PATH ||
    path.join(__dirname, '..', '..', 'data', 'diggershaus.db');
  const dataDir = path.dirname(dbPath);
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diggershaus-snapshot-')
  );
  const snapshotDb = path.join(tmpDir, 'diggershaus.db');

  try {
    execute(`VACUUM INTO ?`, [snapshotDb]);
  } catch (err) {
    console.error('[snapshot-dump] VACUUM INTO failed:', err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return res.status(500).json({ error: 'failed to snapshot db' });
  }

  const filename = `diggershaus-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // `-C <dir> <entries>` switches cwd for the entries that follow.
  // First -C pulls the vacuumed DB from tmpDir; second switches to
  // the live data dir for the asset directories. Result: archive
  // root contains diggershaus.db + avatars/ + custom-covers/.
  const tar = spawn('tar', [
    'czf',
    '-',
    '-C',
    tmpDir,
    'diggershaus.db',
    '-C',
    dataDir,
    'avatars',
    'custom-covers',
  ]);

  tar.stdout.pipe(res);
  tar.stderr.on('data', (d) =>
    console.error('[snapshot-dump] tar stderr:', d.toString())
  );
  tar.on('close', (code) => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (code !== 0) {
      console.error('[snapshot-dump] tar exited with code', code);
    }
  });
  tar.on('error', (err) => {
    console.error('[snapshot-dump] tar spawn error:', err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (!res.headersSent) {
      res.status(500).json({ error: 'failed to create archive' });
    } else {
      res.end();
    }
  });
});

// Aggregate view of URL-scrape failures, grouped by hostname so the
// worst-offending sites surface first. Each group carries the most
// recent failure detail so we can see WHY (bot wall vs. parse miss
// vs. not-a-review) without a second round-trip. Window defaults to
// 30 days — older rows aren't deleted but they're usually not
// actionable once a site has been fixed or given up on.
// Nuke the entire scrape-failure log. Used periodically when admin
// wants a clean slate after rolling out a prompt/scraper fix — the
// old failures aren't useful anymore since the fix changes the
// outcome.
router.delete('/scrape-failures', (_req, res) => {
  try {
    const result = execute(`DELETE FROM scrape_failures`);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[scrape-failures] clear-all failed:', err);
    res.status(500).json({ error: 'failed to clear scrape failures' });
  }
});

// Clear all failure rows for a given hostname — used after we've
// either added a site-specific parser or decided a site is
// unscrapable and moved it permanently to the paste-in fallback. The
// hostname param comes from the GROUP BY key the UI surfaces, so it
// arrives already-normalised (lowercase, www-stripped). Returns the
// number of rows deleted so the UI can show "17개 항목 삭제됨" etc.
router.delete('/scrape-failures/:hostname', (req, res) => {
  const hostname = String(req.params.hostname || '').trim().toLowerCase();
  if (!hostname || hostname.length > 253) {
    return res.status(400).json({ error: 'Invalid hostname' });
  }
  try {
    const result = execute(
      `DELETE FROM scrape_failures WHERE hostname = ?`,
      [hostname]
    );
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[scrape-failures] delete failed:', err);
    res.status(500).json({ error: 'failed to delete scrape failures' });
  }
});

// Raw excerpt-edit log. No UI yet — intended for periodic curl
// review: pull the last 90 days of admin edits, diff old→new per
// row, and promote any recurring pattern to a KO_TERM_REPLACEMENTS
// entry in claude.ts. The limit keeps the response sane; bump via
// ?limit=… if the corpus grows past that window.
router.get('/excerpt-edits', (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || '200'), 10) || 200));
  try {
    const rows = queryAll(
      `SELECT e.id, e.review_id, e.old_excerpt_ko, e.new_excerpt_ko,
              e.edited_at, u.display_name, u.email,
              r.source_name, a.title AS album_title, a.artist_name
       FROM excerpt_edits e
       LEFT JOIN users u ON u.id = e.edited_by_user_id
       LEFT JOIN reviews r ON r.id = e.review_id
       LEFT JOIN albums a ON a.mbid = r.album_mbid
       ORDER BY e.edited_at DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ count: rows.length, edits: rows });
  } catch (err) {
    console.error('[excerpt-edits] query failed:', err);
    res.status(500).json({ error: 'failed to fetch excerpt edits' });
  }
});

// Korean term replacements — single source of truth for every
// mistranslation fix applied during normaliseKoreanTerms. System
// rules (migrated from the formerly-hardcoded array) and operator
// rules share this table; they're indistinguishable except by note
// content and is_regex usage. Apply order = id ASC, so the migrated
// rules (lower ids) run first, then any operator additions.
router.get('/term-replacements', (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT id, pattern, replacement, is_regex, note, created_at
         FROM term_replacements
        ORDER BY id ASC`
    );
    res.json({ rules: rows });
  } catch (err) {
    console.error('[admin/term-replacements] list failed:', err);
    res.status(500).json({ error: '목록 조회 실패' });
  }
});

router.post('/term-replacements', (req, res) => {
  const pattern = String(req.body?.pattern ?? '').trim();
  const replacement = String(req.body?.replacement ?? '').trim();
  const isRegex = req.body?.isRegex ? 1 : 0;
  const noteRaw = req.body?.note;
  const note =
    typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim() : null;
  if (!pattern) return res.status(400).json({ error: 'pattern 필수' });
  if (!replacement) return res.status(400).json({ error: 'replacement 필수' });
  if (pattern.length > 500 || replacement.length > 500) {
    return res.status(400).json({ error: '500자 이하로 입력해 주세요' });
  }
  if (note && note.length > 200) {
    return res.status(400).json({ error: 'note는 200자 이하' });
  }
  // For plain-string rules pattern === replacement is a no-op.
  // Regex rules with capture groups can legitimately have the same
  // raw text on both sides (e.g. pattern "(메탈)" replacement "$1
  // 씬"), so we only check the equality for is_regex=0.
  if (!isRegex && pattern === replacement) {
    return res.status(400).json({ error: 'pattern과 replacement이 같습니다' });
  }
  if (isRegex) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern, 'g');
    } catch (err) {
      return res
        .status(400)
        .json({ error: `정규식이 잘못됐어요: ${(err as Error).message}` });
    }
  }
  try {
    const result = execute(
      `INSERT INTO term_replacements (pattern, replacement, is_regex, note)
         VALUES (?, ?, ?, ?)`,
      [pattern, replacement, isRegex, note]
    );
    const row = queryGet(
      `SELECT id, pattern, replacement, is_regex, note, created_at
         FROM term_replacements WHERE id = ?`,
      [result.lastInsertRowid]
    );
    res.status(201).json({ rule: row });
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 pattern입니다' });
    }
    console.error('[admin/term-replacements] insert failed:', err);
    res.status(500).json({ error: '등록 실패' });
  }
});

router.delete('/term-replacements/:id', (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  try {
    const result = execute(`DELETE FROM term_replacements WHERE id = ?`, [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/term-replacements] delete failed:', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

router.get('/scrape-failures', (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'), 10) || 30));
  try {
    // The last_* fields are pulled from the single most-recent failure
    // row per hostname via correlated subqueries. Joining albums on
    // the mbid from THAT same row gives the retry link a slug +
    // title so the UI can deep-link straight to the album page's
    // manual-entry form.
    const rows = queryAll(
      `WITH last_per_host AS (
         SELECT hostname, MAX(id) AS last_id
         FROM scrape_failures
         WHERE failed_at >= datetime('now', ?)
         GROUP BY hostname
       )
       SELECT sf.hostname,
              (SELECT COUNT(*) FROM scrape_failures sf2
               WHERE sf2.hostname = sf.hostname
                 AND sf2.failed_at >= datetime('now', ?)) AS attempts,
              sf.failed_at AS last_failed_at,
              sf.reason AS last_reason,
              sf.error_message AS last_error,
              sf.url AS last_url,
              sf.album_mbid AS last_album_mbid,
              a.slug AS last_album_slug,
              a.title AS last_album_title,
              a.artist_name AS last_album_artist
       FROM scrape_failures sf
       JOIN last_per_host lph ON lph.last_id = sf.id
       LEFT JOIN albums a ON a.mbid = sf.album_mbid
       ORDER BY sf.failed_at DESC
       LIMIT 200`,
      [`-${days} days`, `-${days} days`]
    );
    res.json({ windowDays: days, hosts: rows });
  } catch (err) {
    console.error('[scrape-failures] query failed:', err);
    res.status(500).json({ error: 'failed to fetch scrape failures' });
  }
});

// ─── Source whitelist / blacklist ────────────────────────────────────
//
// Admin-curated trust layer built up from the cumulative scrape log.
// Four lists surfaced in one call so the admin page can render them
// side-by-side:
//
//   successHosts: every hostname that has landed a saved row in
//     `reviews`, with a count of how many times. Derived view, not a
//     stored list — it reflects actual successful scrapes.
//   failureHosts: every hostname that has landed in `scrape_failures`
//     (lifetime, not windowed), with a count. Also derived.
//   whitelist / blacklist: admin-curated explicit lists from the
//     source_whitelist / source_blacklist tables. Whitelist hosts get
//     re-ranked to the top of /reviews/discover results; blacklist
//     hosts are refused at the scrape layer exactly like the
//     hardcoded EXCLUDED_URL_DOMAINS list.
//
// Host normalisation: stored lowercase, www. stripped, so entering
// "www.Example.Com" or "example.com" or "EXAMPLE.COM" all resolve to
// the same record.
function normaliseHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
}

router.get('/sources', requireAdmin, (_req, res) => {
  try {
    // Cumulative success rollup. derives from reviews.full_review_url
    // via a hostname extract. SQLite doesn't have url_hostname() so we
    // do it in JS after the query — small dataset, negligible cost.
    const reviewRows = queryAll(
      `SELECT full_review_url FROM reviews WHERE full_review_url IS NOT NULL AND full_review_url != ''`
    ) as Array<{ full_review_url: string }>;
    const successMap = new Map<string, { hits: number; lastUrl: string }>();
    for (const row of reviewRows) {
      try {
        const host = new URL(row.full_review_url).hostname.toLowerCase().replace(/^www\./, '');
        const prev = successMap.get(host);
        if (prev) {
          prev.hits += 1;
          prev.lastUrl = row.full_review_url;
        } else {
          successMap.set(host, { hits: 1, lastUrl: row.full_review_url });
        }
      } catch {
        // Malformed URL — ignore.
      }
    }
    // Verified rollup for the panel — a host is verified if it's
    // whitelisted (suffix match) or has accumulated at least the
    // threshold count of reviews. Same rule that backs the badge on
    // the album page so the panel and the public view stay in sync.
    const verifiedHosts = getVerifiedHosts();
    const isVerifiedHost = (h: string): boolean => {
      if (verifiedHosts.has(h)) return true;
      for (const entry of verifiedHosts) {
        if (h === entry || h.endsWith(`.${entry}`)) return true;
      }
      return false;
    };
    const successHosts = Array.from(successMap.entries())
      .map(([host, v]) => ({
        host,
        hits: v.hits,
        lastUrl: v.lastUrl,
        verified: isVerifiedHost(host),
        threshold: VERIFIED_REVIEW_COUNT_THRESHOLD,
      }))
      .sort((a, b) => b.hits - a.hits || a.host.localeCompare(b.host));

    // Cumulative failure rollup (lifetime, not the 30-day window that
    // /scrape-failures uses — this view is about deciding long-term
    // trust, not spotting recent regressions).
    const failureRows = queryAll(
      `SELECT hostname, COUNT(*) AS hits, MAX(failed_at) AS last_failed_at
       FROM scrape_failures
       GROUP BY hostname
       ORDER BY hits DESC, hostname ASC`
    ) as Array<{ hostname: string; hits: number; last_failed_at: string }>;
    const failureHosts = failureRows.map((r) => ({
      host: r.hostname,
      hits: r.hits,
      lastFailedAt: r.last_failed_at,
    }));

    const whitelist = queryAll(
      `SELECT host, added_at, note FROM source_whitelist ORDER BY host ASC`
    ) as Array<{ host: string; added_at: string; note: string | null }>;
    const blacklist = queryAll(
      `SELECT host, added_at, reason FROM source_blacklist ORDER BY host ASC`
    ) as Array<{ host: string; added_at: string; reason: string | null }>;

    res.json({
      successHosts,
      failureHosts,
      whitelist: whitelist.map((r) => ({ host: r.host, addedAt: r.added_at, note: r.note })),
      blacklist: blacklist.map((r) => ({ host: r.host, addedAt: r.added_at, reason: r.reason })),
    });
  } catch (err) {
    console.error('[sources] query failed:', err);
    res.status(500).json({ error: 'failed to fetch sources' });
  }
});

router.post('/sources/whitelist', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawHost = typeof body.host === 'string' ? body.host : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  const host = normaliseHost(rawHost);
  if (!host || host.length < 3 || !/^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/i.test(host)) {
    return res.status(400).json({ error: '올바른 호스트명을 입력하세요 (예: example.com).' });
  }
  try {
    execute(
      `INSERT INTO source_whitelist (host, note) VALUES (?, ?)
       ON CONFLICT(host) DO UPDATE SET note = excluded.note`,
      [host, note]
    );
    bustSourceListCaches();
    res.json({ ok: true, host });
  } catch (err) {
    console.error('[sources/whitelist] insert failed:', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

router.delete('/sources/whitelist/:host', requireAdmin, (req, res) => {
  const host = normaliseHost(String(req.params.host || ''));
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    const result = execute(`DELETE FROM source_whitelist WHERE host = ?`, [host]);
    bustSourceListCaches();
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sources/whitelist] delete failed:', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

router.post('/sources/blacklist', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawHost = typeof body.host === 'string' ? body.host : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;
  const host = normaliseHost(rawHost);
  if (!host || host.length < 3 || !/^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/i.test(host)) {
    return res.status(400).json({ error: '올바른 호스트명을 입력하세요 (예: example.com).' });
  }
  try {
    execute(
      `INSERT INTO source_blacklist (host, reason) VALUES (?, ?)
       ON CONFLICT(host) DO UPDATE SET reason = excluded.reason`,
      [host, reason]
    );
    bustSourceListCaches();
    res.json({ ok: true, host });
  } catch (err) {
    console.error('[sources/blacklist] insert failed:', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

router.delete('/sources/blacklist/:host', requireAdmin, (req, res) => {
  const host = normaliseHost(String(req.params.host || ''));
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    const result = execute(`DELETE FROM source_blacklist WHERE host = ?`, [host]);
    bustSourceListCaches();
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sources/blacklist] delete failed:', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// ─── Tag blacklist (genre tags banned from auto-import) ────────────────
//
// Different table from source_blacklist (URL hosts) — these are genre
// strings the curator has stamped as "never re-add". Populated implicitly
// by the × button in TagEditor (PATCH /albums/:id/tags). Listed here
// most-recent-first so the curator can find the entry they just added
// by mistake at the top of the panel; DELETE removes the row and busts
// the in-memory cleanGenres filter cache so subsequent imports stop
// stripping the tag. Does NOT auto-restore the tag on albums it was
// stripped from — the cross-album strip is irreversible without an
// audit trail (admin must manually re-add via TagEditor input).
router.get('/tag-blacklist', requireAdmin, (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT tb.tag, tb.created_at AS addedAt, u.email AS addedByEmail
       FROM tag_blacklist tb
       LEFT JOIN users u ON u.id = tb.added_by_user_id
       ORDER BY tb.created_at DESC`
    ) as Array<{ tag: string; addedAt: string; addedByEmail: string | null }>;
    res.json({ tags: rows });
  } catch (err) {
    console.error('[tag-blacklist] query failed:', err);
    res.status(500).json({ error: 'failed to fetch tag blacklist' });
  }
});

router.delete('/tag-blacklist/:tag', requireAdmin, (req, res) => {
  const tag = String(req.params.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'tag required' });
  try {
    // tag column is COLLATE NOCASE so the match here is case-
    // insensitive, mirroring how the blacklist filter check reads.
    const result = execute(`DELETE FROM tag_blacklist WHERE tag = ?`, [tag]);
    invalidateTagBlacklistCache();
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[tag-blacklist] delete failed:', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// ─── Tag usage count ────────────────────────────────────────────────────
//
// Pre-flight count for the × (blacklist) button in TagEditor — surfaces
// the blast radius of a blacklist add before the click commits, so the
// curator sees "이 태그는 47개 앨범에 있다" in the confirm popup
// instead of having to discover it by undo. Mirrors the cross-album
// strip path's substring-then-JS-filter approach (no first-class JSON
// array operator in SQLite); the LIKE narrows candidates and the JS
// loop is the authoritative case-insensitive equality check.
router.get('/tags/usage/:tag', requireAdmin, (req, res) => {
  const tag = String(req.params.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'tag required' });
  try {
    const tagLower = tag.toLowerCase();
    const candidates = queryAll(
      `SELECT genres FROM albums WHERE genres IS NOT NULL AND genres LIKE ?`,
      [`%${tag.replace(/[%_]/g, '')}%`]
    ) as Array<{ genres: string }>;
    let count = 0;
    for (const c of candidates) {
      try {
        const arr = JSON.parse(c.genres);
        if (
          Array.isArray(arr) &&
          arr.some(
            (t) => typeof t === 'string' && t.toLowerCase() === tagLower
          )
        ) {
          count++;
        }
      } catch {
        // malformed genres JSON — ignore row
      }
    }
    res.json({ tag, albumCount: count });
  } catch (err) {
    console.error('[tags/usage] query failed:', err);
    res.status(500).json({ error: 'failed to count tag usage' });
  }
});

// ─── POST /api/admin/curation-runs ────────────────────────────────────
// Client (CurationProgressContext) pings this once per album as the
// pipeline finishes — one row per album per run. Cost_usd is computed
// HERE from claude_usage_log rows that fell within the album's
// processing window (albumStartedAt..albumEndedAt), instead of the
// old approach where the client snapshotted /api/admin/stats twice
// per album just to get a delta. That was 2 extra HTTP round-trips
// per album; this is one SQL aggregation on the write we were doing
// anyway.
router.post('/curation-runs', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const albumMbid = typeof body.albumMbid === 'string' ? body.albumMbid : null;
  const albumTitle = typeof body.albumTitle === 'string' ? body.albumTitle : null;
  const triggerKind = typeof body.triggerKind === 'string' ? body.triggerKind : 'oneclick';
  const startedAt = typeof body.startedAt === 'string' ? body.startedAt : null;
  const albumStartedAt =
    typeof body.albumStartedAt === 'string' ? body.albumStartedAt : startedAt;
  const albumEndedAt =
    typeof body.albumEndedAt === 'string' ? body.albumEndedAt : null;
  if (!runId || !albumMbid || !albumTitle || !startedAt) {
    return res.status(400).json({ error: 'runId, albumMbid, albumTitle, startedAt required' });
  }
  const toInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

  // Cost aggregation over the album's processing window. Matches both
  // the ISO-with-'T' timestamps the client sends and SQLite's
  // datetime('now') 'YYYY-MM-DD HH:MM:SS' default format by running
  // both sides through datetime() for normalisation. Web-search dollars
  // price per 1000 calls (see PRICING_PER_1M comments).
  let costUsd = 0;
  try {
    const windowEnd = albumEndedAt ?? new Date().toISOString();
    const usageRows = queryAll(
      `SELECT model, input_tokens, output_tokens, web_search_count
         FROM claude_usage_log
         WHERE datetime(created_at) >= datetime(?)
           AND datetime(created_at) <= datetime(?)`,
      [albumStartedAt, windowEnd]
    ) as Array<{
      model: string;
      input_tokens: number;
      output_tokens: number;
      web_search_count: number;
    }>;
    for (const r of usageRows) {
      const p = pricingFor(r.model);
      costUsd += (r.input_tokens * p.input + r.output_tokens * p.output) / 1_000_000;
      costUsd += (r.web_search_count * WEB_SEARCH_PER_1000) / 1000;
    }
  } catch (err) {
    console.warn('[curation-runs] cost aggregation failed:', (err as Error).message);
  }

  try {
    execute(
      `INSERT INTO curation_runs
         (run_id, album_mbid, album_title, trigger_kind,
          urls_found, urls_saved, duplicates, failures,
          summary_generated, cost_usd, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        albumMbid,
        albumTitle,
        triggerKind,
        toInt(body.urlsFound),
        toInt(body.urlsSaved),
        toInt(body.duplicates),
        toInt(body.failures),
        body.summaryGenerated ? 1 : 0,
        costUsd,
        typeof body.status === 'string' ? body.status : 'done',
        startedAt,
      ]
    );
    res.json({ ok: true, costUsd });
  } catch (err) {
    console.error('[curation-runs] insert failed:', err);
    res.status(500).json({ error: 'failed to record curation run' });
  }
});

// ─── GET /api/admin/curation-runs ─────────────────────────────────────
// Feed for the "큐레이션 이력" panel on /admin. Returns the most
// recent ~50 rows with the album slug so UI can deep-link. Ordered
// by finished_at DESC so the most recent run is at the top.
router.get('/curation-runs', (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT cr.id, cr.run_id, cr.album_mbid, cr.album_title,
              cr.trigger_kind, cr.urls_found, cr.urls_saved,
              cr.duplicates, cr.failures, cr.summary_generated,
              cr.cost_usd, cr.status, cr.started_at, cr.finished_at,
              a.slug AS album_slug,
              a.cover_art_url AS cover_art_url,
              a.cover_art_fallbacks AS cover_art_fallbacks,
              a.artist_name AS artist_name
         FROM curation_runs cr
         LEFT JOIN albums a ON a.mbid = cr.album_mbid
         ORDER BY cr.finished_at DESC
         LIMIT 50`
    );
    res.json({ runs: rows });
  } catch (err) {
    console.error('[curation-runs] list failed:', err);
    res.status(500).json({ error: 'failed to list curation runs' });
  }
});

// ─── GET /api/admin/llm-comparisons ───────────────────────────────────
// Feed for the /admin/compare page. Returns recent shadow-comparison
// rows newest first. Optional ?operation= filter narrows to one op.
// limit/offset paginate. Response is the raw rows — cost math and
// per-row formatting live on the client so we can iterate on the
// display without touching this endpoint.
router.get('/llm-comparisons', (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    const operation = typeof req.query.operation === 'string' && req.query.operation.trim()
      ? req.query.operation.trim()
      : null;

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    if (operation) {
      whereClauses.push('operation = ?');
      params.push(operation);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const rows = queryAll(
      `SELECT id, operation, album_mbid, album_title, prompt_preview,
              primary_model, primary_output,
              primary_input_tokens, primary_output_tokens, primary_latency_ms,
              shadow_model, shadow_output,
              shadow_input_tokens, shadow_output_tokens, shadow_latency_ms,
              shadow_error, created_at
         FROM llm_comparison_log
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const countRow = queryAll(
      `SELECT COUNT(*) AS n FROM llm_comparison_log ${where}`,
      params
    ) as Array<{ n: number }>;
    const total = countRow[0]?.n ?? 0;

    const opsRows = queryAll(
      `SELECT operation, COUNT(*) AS n
         FROM llm_comparison_log
         GROUP BY operation
         ORDER BY n DESC`
    ) as Array<{ operation: string; n: number }>;

    // Introspect the currently-active primary/shadow wiring per
    // known operation so the /admin/compare page can show "you're
    // comparing Haiku 4.5 vs DeepSeek on pronunciation, Sonnet 4.5
    // vs DeepSeek on summary_fallback…" without admin having to
    // remember which env vars are set. KNOWN_OPS is the list of
    // invokeLlm call-site IDs; keep in sync with the shadow-wrapped
    // operations in services/claude.ts.
    const KNOWN_OPS: Array<{ operation: string; defaultModel: string }> = [
      { operation: 'pronunciation', defaultModel: 'claude-haiku-4-5-20251001' },
      { operation: 'similar_descriptions', defaultModel: 'claude-haiku-4-5-20251001' },
      // Op name is historical — kept as 'serper_pick' so any admin
      // routing overrides persisted in DB under this key keep working
      // regardless of which discovery engine (Serper / Tavily) is active.
      { operation: 'serper_pick', defaultModel: 'claude-haiku-4-5-20251001' },
      { operation: 'summary_fallback', defaultModel: 'claude-haiku-4-5-20251001' },
    ];
    const routes = describeOperationRoutes(KNOWN_OPS);
    const shadowConfigured = routes.some((r) => r.shadowModel !== null);

    res.json({
      rows,
      total,
      operations: opsRows,
      routes,
      enabled: shadowConfigured,
    });
  } catch (err) {
    console.error('[llm-comparisons] list failed:', err);
    res.status(500).json({ error: 'failed to list llm comparisons' });
  }
});

// ─── GET /api/admin/spotify/status ────────────────────────────────────
//
// Read-only check on the in-memory cooldown gate. Doesn't call
// Spotify — just reports whether the gate is active and, if so,
// when it expires. Set whenever a previous searchTrack call hit a
// 429; if the server restarts mid-cooldown this resets to "free"
// and the next real call will re-trigger the gate with a fresh
// Retry-After value.
router.get('/spotify/status', (_req, res) => {
  const remainingMs = spotifyRateLimitRemainingMs();
  const rateLimited = isSpotifyRateLimited();
  res.json({
    rateLimited,
    remainingMs: rateLimited ? remainingMs : 0,
    remainingMinutes: rateLimited ? Math.ceil(remainingMs / 1000 / 60) : 0,
    cooldownEndsAt: rateLimited
      ? new Date(Date.now() + remainingMs).toISOString()
      : null,
  });
});

// ─── POST /api/admin/spotify/backfill ─────────────────────────────────
//
// Walks every album row with `spotify_url IS NULL`, re-runs the
// quoted-fields searchTrack query on each, and updates the row when
// a hit comes back. Use case: Spotify hits a 30-day-rolling-window
// 429 (Retry-After in hours), albums registered during the cooldown
// land with null spotify_url, then once the cooldown expires the
// admin runs this once to backfill the gap. The cooldown gate
// inside searchTrack means re-running this during an active
// cooldown is safe — it'll early-out without burning quota.
//
// Returns counts so the admin can see progress; `?limit=N` caps a
// single run so a very long album list can be chunked across
// multiple invocations rather than tying up the request thread.
router.post('/spotify/backfill', async (req, res) => {
  if (isSpotifyRateLimited()) {
    return res.status(429).json({
      error: 'Spotify가 현재 rate-limited 상태예요.',
      remainingMs: spotifyRateLimitRemainingMs(),
      remainingHuman: `${Math.ceil(spotifyRateLimitRemainingMs() / 1000 / 60)}분 후 다시 시도하세요`,
    });
  }
  const limitRaw = Number.parseInt((req.query.limit as string) || '50', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
    ? limitRaw
    : 50;

  const rows = queryAll(
    `SELECT id, mbid, title, artist_name AS artist
     FROM albums
     WHERE spotify_url IS NULL
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  ) as Array<{ id: number; mbid: string; title: string; artist: string }>;

  let scanned = 0;
  let filled = 0;
  let stoppedOnRateLimit = false;
  try {
    for (const row of rows) {
      if (isSpotifyRateLimited()) {
        stoppedOnRateLimit = true;
        break;
      }
      scanned++;
      const result = await searchTrack(row.artist, row.title);
      if (result.url) {
        execute(
          `UPDATE albums SET spotify_url = ? WHERE id = ?`,
          [result.url, row.id]
        );
        filled++;
      }
      // Small inter-call delay so a multi-hundred-album scan doesn't
      // burst into the 30s rate-limit bucket all at once. 250ms ≈ 4
      // calls/sec, well under the per-token sustainable rate.
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    // Express 4 doesn't forward async throws — without this the
    // request would hang until the client gives up.
    console.error('[spotify-backfill] failed:', err);
    return res.status(500).json({ error: 'backfill failed', scanned, filled });
  }

  res.json({
    scanned,
    filled,
    candidatesRemaining: rows.length === limit ? 'more pages possible' : 0,
    stoppedOnRateLimit,
  });
});

// ─── DELETE /api/admin/llm-comparisons ────────────────────────────────
// Wipe the log. Used from the /admin/compare page when admin wants to
// start a clean test run without stale rows drowning out new results.
router.delete('/llm-comparisons', (_req, res) => {
  try {
    execute('DELETE FROM llm_comparison_log');
    res.json({ ok: true });
  } catch (err) {
    console.error('[llm-comparisons] delete failed:', err);
    res.status(500).json({ error: 'failed to clear llm comparisons' });
  }
});

// ─── Invitation gate management ───────────────────────────────────────
//
// Three endpoints back the /admin "가입 신청" panel. Pending signups
// are listed by descending last_attempt_at so the most-recent ask is
// at the top; once admin approves a row (= insert into invited_emails),
// the row stays in pending_signups as a record but the user's next
// Google login completes. Revoking an invite drops the email from
// invited_emails — won't kick anyone already logged in (the gate only
// runs at signup), but blocks future repeat-signup attempts.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

// GET /api/admin/signups — combined view of pending requests + the
// current invited list. Two arrays in one payload so the admin panel
// renders both without juggling two queries.
router.get('/signups', (_req, res) => {
  try {
    const pending = queryAll(
      `SELECT p.email, p.name, p.avatar_url, p.first_attempt_at,
              p.last_attempt_at, p.attempt_count, p.notified_at,
              CASE WHEN i.email IS NOT NULL THEN 1 ELSE 0 END AS invited
         FROM pending_signups p
         LEFT JOIN invited_emails i ON LOWER(i.email) = LOWER(p.email)
        ORDER BY p.last_attempt_at DESC, p.email ASC`
    );
    const invited = queryAll(
      `SELECT i.email, i.invited_at, i.note,
              u.id AS user_id, u.name AS user_name, u.avatar_url AS user_avatar
         FROM invited_emails i
         LEFT JOIN users u ON LOWER(u.email) = LOWER(i.email)
        ORDER BY i.invited_at DESC, i.email ASC`
    );
    res.json({
      pending: pending.map((r: any) => ({
        email: r.email,
        name: r.name,
        avatarUrl: r.avatar_url,
        firstAttemptAt: r.first_attempt_at,
        lastAttemptAt: r.last_attempt_at,
        attemptCount: r.attempt_count,
        notifiedAt: r.notified_at,
        invited: !!r.invited,
      })),
      invited: invited.map((r: any) => ({
        email: r.email,
        invitedAt: r.invited_at,
        note: r.note,
        user: r.user_id
          ? { id: r.user_id, name: r.user_name, avatarUrl: r.user_avatar }
          : null,
      })),
    });
  } catch (err) {
    console.error('[admin/signups] list failed:', err);
    res.status(500).json({ error: '가입 신청 목록을 가져오지 못했어요.' });
  }
});

// POST /api/admin/signups/invite — add an email to invited_emails.
// Idempotent on email. Optional note for context ("DJ on Mastodon",
// "label rep", etc.). The user's next Google login then completes
// the signup; if the email is already in pending_signups, it gets
// flagged as invited but isn't auto-promoted to users — Google must
// re-authenticate so we have a fresh google_id.
router.post('/signups/invite', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: '올바른 이메일이 필요해요.' });
  }
  const note =
    typeof req.body?.note === 'string' && req.body.note.trim().length > 0
      ? req.body.note.trim().slice(0, 280)
      : null;
  const inviter = (req.user as any)?.id ?? null;
  try {
    execute(
      `INSERT INTO invited_emails (email, invited_by, note)
       VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         invited_by = COALESCE(invited_by, excluded.invited_by),
         note = COALESCE(excluded.note, note)`,
      [email, inviter, note]
    );
    res.json({ ok: true, email });
  } catch (err) {
    console.error('[admin/signups/invite] failed:', err);
    res.status(500).json({ error: '초대 처리에 실패했어요.' });
  }
});

// DELETE /api/admin/signups/invite/:email — revoke an invite. Doesn't
// affect anyone already in users (the gate only runs at signup) but
// blocks future re-signup. Useful when an invited email never finished
// the OAuth dance and admin wants to clean up.
router.delete('/signups/invite/:email', (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!email) {
    return res.status(400).json({ error: '올바른 이메일이 필요해요.' });
  }
  try {
    const result = execute(
      `DELETE FROM invited_emails WHERE LOWER(email) = LOWER(?)`,
      [email]
    );
    res.json({ ok: true, removed: result.changes });
  } catch (err) {
    console.error('[admin/signups/invite] revoke failed:', err);
    res.status(500).json({ error: '초대 취소에 실패했어요.' });
  }
});

// DELETE /api/admin/signups/pending/:email — discard a pending request
// without inviting. Drops the row from pending_signups; the email can
// still try again later (a new row will be created). For declining a
// signup attempt that doesn't fit the curation profile.
router.delete('/signups/pending/:email', (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!email) {
    return res.status(400).json({ error: '올바른 이메일이 필요해요.' });
  }
  try {
    const result = execute(
      `DELETE FROM pending_signups WHERE LOWER(email) = LOWER(?)`,
      [email]
    );
    res.json({ ok: true, removed: result.changes });
  } catch (err) {
    console.error('[admin/signups/pending] discard failed:', err);
    res.status(500).json({ error: '신청 삭제에 실패했어요.' });
  }
});

// ─── GET /api/admin/review-reports ──────────────────────────────────────
//
// Dashboard queue for the user-facing 리뷰 신고 flow. Mirrors the
// purchase-link-reports JOIN shape (report + reviewed-thing + album
// + reporter) so the admin row template renders without follow-up
// queries. Sorted newest first since admin typically reviews the
// backlog top-down.
router.get('/review-reports', (_req, res) => {
  const rows = queryAll(
    `SELECT r.id, r.reason, r.created_at,
            r.review_id,
            rv.source_name AS review_source,
            rv.excerpt_ko AS review_excerpt_ko,
            rv.excerpt AS review_excerpt,
            rv.full_review_url AS review_url,
            a.id AS album_id, a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            r.user_id AS reporter_id,
            COALESCE(ru.display_name, ru.name) AS reporter_name
     FROM review_reports r
     INNER JOIN reviews rv ON rv.id = r.review_id
     INNER JOIN albums a ON a.mbid = rv.album_mbid
     LEFT JOIN users ru ON ru.id = r.user_id
     ORDER BY r.created_at DESC`
  ) as Array<{
    id: number;
    reason: 'wrong-album' | 'bad-translation' | 'not-a-review';
    created_at: string;
    review_id: number;
    review_source: string;
    review_excerpt_ko: string | null;
    review_excerpt: string | null;
    review_url: string;
    album_id: number;
    album_slug: string | null;
    album_mbid: string;
    album_title: string;
    album_artist: string | null;
    reporter_id: number;
    reporter_name: string | null;
  }>;

  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.created_at,
      reviewId: r.review_id,
      reviewSource: r.review_source,
      reviewExcerpt: r.review_excerpt_ko || r.review_excerpt,
      reviewUrl: r.review_url,
      albumId: r.album_id,
      albumSlug: r.album_slug,
      albumMbid: r.album_mbid,
      albumTitle: r.album_title,
      albumArtist: r.album_artist,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
    })),
  });
});

// ─── DELETE /api/admin/review-reports/:id — dismiss one report ──────────
//
// Single-report dismissal. Distinct from "delete the underlying review"
// — admin uses the review card's own × button for that, which CASCADEs
// all reports for that review away. This endpoint is for when admin
// looked at the report and judges it unjustified, leaving the review
// intact.
router.delete('/review-reports/:id', (req, res) => {
  const reportId = parseInt(req.params.id as string, 10);
  if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid id' });
  execute(`DELETE FROM review_reports WHERE id = ?`, [reportId]);
  res.json({ ok: true });
});

export default router;
