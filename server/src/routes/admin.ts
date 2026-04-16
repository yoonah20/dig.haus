import { Router } from 'express';
import { queryGet, queryAll } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

// Hardcoded prices for token → USD conversion. Update when Anthropic's
// pricing page changes. Rates are per 1M tokens (input / output) and
// per 1000 calls (web search). If we see an unfamiliar model string in
// the log, we fall back to Haiku 4.5 rates rather than dropping the
// row — better to slightly misestimate than under-report.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
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
    coverArtFallbacks: a.cover_art_fallbacks ? JSON.parse(a.cover_art_fallbacks) : [],
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

  // ── Claude API usage (rolling 7 days) ─────────────────────────────
  // Aggregate per (operation, model) then translate tokens + web
  // searches to USD client-side-friendly shape. `operation` labels
  // come from the logClaudeUsage() call sites.
  const usageRows = queryAll(
    `SELECT operation, model,
            SUM(input_tokens) AS in_tok,
            SUM(output_tokens) AS out_tok,
            SUM(web_search_count) AS search_n,
            COUNT(*) AS calls
     FROM claude_usage_log
     WHERE created_at >= datetime('now', '-7 days')
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
  const byOperation: Record<string, { tokens: number; searches: number; usd: number }> = {};

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

    const prev = byOperation[row.operation] || { tokens: 0, searches: 0, usd: 0 };
    byOperation[row.operation] = {
      tokens: prev.tokens + row.in_tok + row.out_tok,
      searches: prev.searches + row.search_n,
      usd: prev.usd + usd,
    };
  }

  // Sort operations by cost descending for the display.
  const operationsBreakdown = Object.entries(byOperation)
    .map(([op, v]) => ({
      operation: op,
      tokens: v.tokens,
      searches: v.searches,
      usd: Math.round(v.usd * 100) / 100,
    }))
    .sort((a, b) => b.usd - a.usd);

  const claudeUsage = {
    last7d: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      webSearchCount: totalSearchCount,
      usd: Math.round(totalUsd * 100) / 100,
      byOperation: operationsBreakdown,
    },
  };

  // ── Incomplete albums ─────────────────────────────────────────────
  // Buckets the admin should glance at and decide whether to top up
  // manually. Each bucket returns up to 5 rows — dashboard just needs
  // "something to click into", not a full inventory.
  const INCOMPLETE_LIMIT = 5;

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
     WHERE (a.korean_summary IS NULL OR a.korean_summary = '')
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [INCOMPLETE_LIMIT]
  );

  const noCover = queryAll(
    `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
     FROM albums a
     WHERE (a.cover_art_url IS NULL OR a.cover_art_url = '')
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
     WHERE (a.korean_summary IS NULL OR a.korean_summary = '')`
  )?.n || 0;
  const noCoverCount = queryGet(
    `SELECT COUNT(*) AS n FROM albums a
     WHERE (a.cover_art_url IS NULL OR a.cover_art_url = '')`
  )?.n || 0;

  function mapIncomplete(rows: any[]) {
    return rows.map((a: any) => ({
      id: a.id,
      mbid: a.slug || a.mbid,
      title: a.title,
      artist: a.artist_name,
      coverArtUrl: a.cover_art_url,
      coverArtFallbacks: a.cover_art_fallbacks ? JSON.parse(a.cover_art_fallbacks) : [],
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
    votesToday: {
      up: votesToday?.up || 0,
      down: votesToday?.down || 0,
    },
    recentAlbums,
    recentUsers,
    recentReviews,
    claudeUsage,
    incompleteAlbums,
  });
});

export default router;
