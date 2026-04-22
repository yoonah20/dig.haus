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
import { bustSourceListCaches } from '../services/reviews.js';

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
  // DeepSeek V3 — used for scrape extraction (Jina markdown → JSON).
  // Much cheaper than Haiku for the input-heavy extraction path; we
  // still log under the same claude_usage_log table keyed by the
  // response's model string, so the admin panel surfaces a separate
  // row.
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

  const recentAlbums = queryAll(
    `SELECT id, mbid, slug, title, artist_name, created_at, cover_art_url, cover_art_fallbacks
     FROM albums ORDER BY created_at DESC LIMIT 20`
  ).map((a: any) => ({
    id: a.id,
    mbid: a.slug || a.mbid,
    title: a.title,
    artist: a.artist_name,
    createdAt: a.created_at,
    coverArtUrl: a.cover_art_url,
    coverArtFallbacks: safeParseArray(a.cover_art_fallbacks),
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

  const noReviews = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noSummary = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE a.korean_summary IS NULL OR a.korean_summary = ''
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
  // knows how big the backlog is.
  const noReviewsCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)`
  )?.n || 0;
  const noSummaryCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE a.korean_summary IS NULL OR a.korean_summary = ''`
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

// ─── Admin genre taxonomy CRUD ──────────────────────────────────────────
//
// The `genres` table drives Shelf-bin labels (Phase 3c). Admin picks
// what the shared taxonomy looks like; regular users then choose from
// this list when assigning genres to their 6 shelf bins. Edits here
// propagate instantly — a genre toggled `is_active=0` stops appearing
// in the picker but existing shelf_slots.genre_id references stay
// intact (display falls back to "장르 미지정" on the mydig page).

router.get('/genres', (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT id, slug, name_ko, name_en, position, is_active, created_at
       FROM genres
       ORDER BY position ASC, id ASC`
    );
    res.json({ genres: rows });
  } catch (err) {
    console.error('[admin/genres] list failed:', err);
    res.status(500).json({ error: 'failed to list genres' });
  }
});

const GENRE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

router.post('/genres', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const nameKo = typeof body.nameKo === 'string' ? body.nameKo.trim() : '';
  const nameEn = typeof body.nameEn === 'string' ? body.nameEn.trim() : '';
  if (!slug || !GENRE_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug은 영문소문자/숫자/하이픈으로만, 1-40자.' });
  }
  if (!nameKo || nameKo.length > 60) {
    return res.status(400).json({ error: '한글 이름이 필요합니다 (60자 이내).' });
  }
  if (!nameEn || nameEn.length > 60) {
    return res.status(400).json({ error: '영문 이름이 필요합니다 (60자 이내).' });
  }
  try {
    // Append to the end by default — position = (max position) + 1.
    const maxPos =
      (queryGet(`SELECT MAX(position) AS p FROM genres`)?.p as number | null) ?? -1;
    const result = execute(
      `INSERT INTO genres (slug, name_ko, name_en, position) VALUES (?, ?, ?, ?)`,
      [slug, nameKo, nameEn, maxPos + 1]
    );
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 사용 중인 slug 입니다.' });
    }
    console.error('[admin/genres] create failed:', err);
    res.status(500).json({ error: '장르 추가 실패' });
  }
});

router.patch('/genres/:id', (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: any[] = [];
  if (typeof body.nameKo === 'string') {
    const v = body.nameKo.trim();
    if (!v || v.length > 60) {
      return res.status(400).json({ error: 'nameKo 길이 오류' });
    }
    sets.push('name_ko = ?');
    vals.push(v);
  }
  if (typeof body.nameEn === 'string') {
    const v = body.nameEn.trim();
    if (!v || v.length > 60) {
      return res.status(400).json({ error: 'nameEn 길이 오류' });
    }
    sets.push('name_en = ?');
    vals.push(v);
  }
  if (typeof body.isActive === 'boolean') {
    sets.push('is_active = ?');
    vals.push(body.isActive ? 1 : 0);
  }
  if (typeof body.position === 'number' && Number.isFinite(body.position)) {
    sets.push('position = ?');
    vals.push(Math.max(0, Math.round(body.position)));
  }
  if (sets.length === 0) return res.status(400).json({ error: '업데이트할 필드가 없어요.' });
  vals.push(id);
  try {
    const result = execute(
      `UPDATE genres SET ${sets.join(', ')} WHERE id = ?`,
      vals
    );
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/genres] update failed:', err);
    res.status(500).json({ error: '업데이트 실패' });
  }
});

// Soft-delete preferred — flipping is_active to 0 — so existing
// shelf_slots.genre_id references don't become dangling when admin
// retires a taxonomy entry. Hard delete still supported for
// slugs that were mistakes and never used.
router.delete('/genres/:id', (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  try {
    const inUse = queryGet(
      `SELECT COUNT(*) AS n FROM shelf_slots WHERE genre_id = ?`,
      [id]
    )?.n as number;
    if (inUse && inUse > 0) {
      return res.status(409).json({
        error: `사용 중인 장르입니다 (${inUse}개 shelf 슬롯에 연결). 먼저 '비활성화'를 쓰세요.`,
      });
    }
    const result = execute(`DELETE FROM genres WHERE id = ?`, [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/genres] delete failed:', err);
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
       ORDER BY attempts DESC, sf.failed_at DESC
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
    const successHosts = Array.from(successMap.entries())
      .map(([host, v]) => ({ host, hits: v.hits, lastUrl: v.lastUrl }))
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
      { operation: 'serper_pick', defaultModel: 'claude-haiku-4-5-20251001' },
      { operation: 'summary_fallback', defaultModel: 'claude-sonnet-4-5' },
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

export default router;
