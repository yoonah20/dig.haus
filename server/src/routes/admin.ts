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
// per 1000 calls (web search). If we see an unfamiliar model string in
// the log, we fall back to Haiku 4.5 rates rather than dropping the
// row — better to slightly misestimate than under-report.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
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

function pricingFor(model: string) {
  return PRICING_PER_1M[model] ?? PRICING_PER_1M['claude-haiku-4-5-20251001'];
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
  const INCOMPLETE_LIMIT = 5;

  // Exclude review-collection-pending albums (reviews_crawled_at IS NULL)
  // from every bucket — those are already surfaced in "리뷰 수집 대기"
  // and shouldn't double-count against the backlog here.
  const PENDING_FILTER = 'a.reviews_crawled_at IS NOT NULL';

  const noReviews = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE ${PENDING_FILTER}
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noSummary = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE ${PENDING_FILTER}
       AND (a.korean_summary IS NULL OR a.korean_summary = '')
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noCover = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE ${PENDING_FILTER}
       AND (a.cover_art_url IS NULL OR a.cover_art_url = '')
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  // Total counts (not limited) — shown next to the label so admin
  // knows how big the backlog is.
  const noReviewsCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE ${PENDING_FILTER}
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.album_mbid = a.mbid)`
  )?.n || 0;
  const noSummaryCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE ${PENDING_FILTER}
       AND (a.korean_summary IS NULL OR a.korean_summary = '')`
  )?.n || 0;
  const noCoverCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE ${PENDING_FILTER}
       AND (a.cover_art_url IS NULL OR a.cover_art_url = '')`
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

export default router;
