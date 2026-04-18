import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getCachedAlbum } from '../utils/cache.js';
import { searchExternalMerged } from '../utils/externalSearch.js';
import {
  getRollingDailyClaudeSpendUsd,
  ROLLING_24H_USD_CAP,
} from '../services/claudeBudget.js';
import type { AppUser } from '../auth/passport.js';

// Max albums a non-admin can submit in one calendar day. Caps spam
// without getting in the way of a motivated curator adding a batch.
// Admin bypasses this cap entirely.
const USER_DAILY_ALBUM_CAP = 50;

const router = Router();

function userKey(req: { user?: unknown; ip?: string }): string {
  const uid = (req.user as AppUser | undefined)?.id;
  return uid ? `u:${uid}` : (req.ip || 'anon');
}

// Burst guard for create: 5/min per user. Tight enough that a
// misbehaving client can't dump a session's worth of rows into the
// admin queue in seconds; loose enough that a genuine flurry of
// "ooh and also this one, and this one…" doesn't get throttled.
const createBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: '잠시 뒤에 다시 시도해주세요 (1분에 최대 5개).' },
});

// Long-window cap on create: 500/day per user. Even the admin doesn't
// register that many in a day — this is the "no one is acting in good
// faith" ceiling, not the normal throttle.
const createDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: '하루에 500개 이상은 안 돼요. 내일 다시 시도해주세요.' },
});

// Rate limit for the request-mode search endpoint. MusicBrainz allows
// ~1 req/sec from our server IP, so per-user throttling is the first
// line of defence before we fan out to MB. 30/min lets an engaged
// user iterate on queries comfortably while blocking scripts.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: '검색이 너무 잦아요. 잠시 뒤 다시 시도해주세요.' },
});

const NOTES_MAX = 280;
const TITLE_MAX = 300;
const ARTIST_MAX = 300;

function normalizeString(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// ─── POST /api/album-requests ─────────────────────────────────────────
//
// User-submitted album registration. Creates the album row immediately
// (MB metadata + cover + pronunciation + Discogs prices — all of which
// are cheap or free) but defers the expensive review-crawl until an
// admin approves. Albums with reviews_crawled_at IS NULL show as
// dimmed cards on the home grid and use a placeholder for their
// review section; voting, 50자 평, and purchase-link curation all
// work normally in the meantime.
router.post(
  '/album-requests',
  requireAuth,
  createDailyLimiter,
  createBurstLimiter,
  async (req, res) => {
  const user = req.user as AppUser;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const mbid = normalizeString(body.mbid, 64);
  const title = normalizeString(body.title, TITLE_MAX);
  const artist = normalizeString(body.artist, ARTIST_MAX);
  if (!mbid || !title || !artist) {
    return res.status(400).json({ error: 'mbid, title, artist는 필수입니다.' });
  }

  // Already registered? Short-circuit with the existing slug so the
  // modal can redirect the user to the album page instead of firing
  // the external-fetch pipeline again.
  const existingAlbum = getCachedAlbum(mbid);
  if (existingAlbum) {
    return res.status(200).json({
      ok: true,
      existed: true,
      mbid,
      slug: existingAlbum.slug || mbid,
    });
  }

  // Daily cap on non-admin submissions. Counted against albums the
  // user created today (via requested_by_user_id), not against
  // album_requests rows — the table is legacy now. Admin bypasses.
  if (!user.is_admin) {
    const submittedToday = queryGet(
      `SELECT COUNT(*) AS n FROM albums
       WHERE requested_by_user_id = ?
         AND DATE(created_at) = DATE('now')`,
      [user.id]
    ) as { n: number };
    if (submittedToday.n >= USER_DAILY_ALBUM_CAP) {
      return res.status(429).json({
        error: `하루 ${USER_DAILY_ALBUM_CAP}개까지 등록할 수 있어요. 내일 다시 시도해주세요.`,
      });
    }
  }

  try {
    // Dynamic import matches the approve path — keeps us out of a
    // circular dep between albums.ts and albumRequests.ts.
    const { getOrFetchAlbumBaseForSubmission } = await import('./albums.js');
    const result = await getOrFetchAlbumBaseForSubmission(mbid, {
      requestedByUserId: user.id,
    });
    if (!result) {
      return res.status(404).json({
        error: '외부 소스에서 이 앨범을 찾지 못했어요. 다시 검색해 주세요.',
      });
    }
    // Freshly-cached row is now queryable.
    const cached = getCachedAlbum(mbid);
    res.json({
      ok: true,
      existed: false,
      mbid,
      slug: cached?.slug || mbid,
    });
  } catch (err) {
    console.error('[album-requests] submission failed:', err);
    res.status(500).json({ error: '앨범 등록에 실패했어요. 잠시 뒤 다시 시도해주세요.' });
  }
});

// ─── GET /api/album-requests/search?q=… ───────────────────────────────
//
// MusicBrainz + Discogs search used by the album-request modal that
// logged-in users see. /api/search still gates its external path
// behind admin (the nav search bar is for finding already-registered
// albums, and mixing in external results there would be noise) — this
// endpoint is the user-facing equivalent, scoped to "I want to request
// an album" and rate-limited so MB doesn't hate us.
router.get('/album-requests/search', requireAuth, searchLimiter, async (req, res) => {
  const query = (req.query.q as string || '').trim();
  if (!query || query.length < 2) {
    return res.json({ albums: [] });
  }
  try {
    const albums = await searchExternalMerged(query);
    res.json({ albums });
  } catch (err) {
    console.error('[album-requests/search] failed:', err);
    res.json({ albums: [] });
  }
});

// ─── GET /api/album-requests ─────────────────────────────────────────
//
// Admin notification feed — powers the red count badge on the admin
// avatar pill. Only user-submitted albums show up here. Admin-direct
// registrations land pending too, but they don't need to ping the
// admin who just registered them, so the `requested_by_user_id IS
// NOT NULL` filter excludes those rows.
router.get('/album-requests', requireAdmin, (_req, res) => {
  const rows = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks, a.created_at,
            COALESCE(u.display_name, u.name) AS user_name,
            u.avatar_url AS user_avatar,
            u.id AS user_id
     FROM albums a
     JOIN users u ON u.id = a.requested_by_user_id
     WHERE a.reviews_crawled_at IS NULL
     ORDER BY a.created_at DESC`
  );

  res.json({
    requests: rows.map((r: any) => ({
      mbid: r.slug || r.mbid,
      title: r.title,
      artist: r.artist_name,
      year: r.release_year,
      coverArtUrl: r.cover_art_url,
      coverArtFallbacks: (() => {
        try {
          return r.cover_art_fallbacks ? JSON.parse(r.cover_art_fallbacks) : [];
        } catch {
          return [];
        }
      })(),
      createdAt: r.created_at,
      requester: r.user_id
        ? {
            userId: r.user_id,
            userName: r.user_name,
            userAvatar: r.user_avatar,
          }
        : null,
    })),
  });
});

// ─── POST /api/album-requests/:mbid/approve ───────────────────────────
//
// Admin approve → triggers the existing register flow by hitting
// GET /api/albums/:mbid on the same server. That path caches the album
// and kicks off the Claude pipeline (reviews, pronunciation, similar).
// All pending rows for this mbid are marked approved at once so the
// request surfaces disappear for every requester in one shot.
//
// Implementation note: we call the cache/fetch helper directly rather
// than HTTP-self-loop to keep the logic synchronous and easier to
// error-handle. getOrFetchAlbumBase lives in routes/albums.ts though,
// so we dynamically import it to avoid a circular dep.
// ─── POST /api/album-requests/:mbid/approve ───────────────────────────
//
// Admin action. The album row already exists (user-submitted via the
// new POST /album-requests flow). This stamps reviews_crawled_at and
// fires the Claude review-search warm-up — after which the card
// un-dims on the home grid and the detail page's review section
// starts populating. Idempotent: stamping an already-approved row
// kicks the warm-up again, which is a cached no-op.
//
// The `mbid` param may be a slug or raw mbid; we resolve both.
router.post('/album-requests/:mbid/approve', requireAdmin, async (req, res) => {
  const param = req.params.mbid as string;
  if (!param) return res.status(400).json({ error: 'mbid 누락' });

  // Accept either slug or raw mbid. Try raw first, then slug lookup.
  let cached = getCachedAlbum(param);
  if (!cached) {
    cached = queryGet(
      `SELECT mbid FROM albums WHERE slug = ? LIMIT 1`,
      [param]
    ) as { mbid: string } | null;
  }
  if (!cached) {
    return res.status(404).json({ error: '앨범을 찾을 수 없습니다.' });
  }
  const realMbid = (cached as any).mbid;

  // Rolling-24h spend ceiling — the per-album pipeline cap in
  // reviews.ts doesn't stop back-to-back approvals from summing to
  // real money. Gate at the route level so a hot click doesn't
  // start another ~$0.05 pipeline once the day's budget is exhausted.
  const spend = getRollingDailyClaudeSpendUsd();
  if (spend >= ROLLING_24H_USD_CAP) {
    return res.status(429).json({
      error: `지난 24시간 Claude 지출이 $${spend.toFixed(2)} (한도 $${ROLLING_24H_USD_CAP.toFixed(2)}) 에 도달했어요. 나중에 다시 시도해주세요.`,
    });
  }

  try {
    const { approveAlbumRequest } = await import('./albums.js');
    await approveAlbumRequest(realMbid);
  } catch (err) {
    console.error('[album-requests] approve failed:', err);
    return res.status(500).json({ error: '리뷰 수집을 시작하지 못했어요.' });
  }

  res.json({ ok: true, mbid: realMbid });
});

// 거절(discard) 엔드포인트는 제거됨 — admin은 승인하거나
// DELETE /api/albums/:id 로 완전 삭제하는 두 선택지만 가진다.

// ─── GET /api/me/album-requests ───────────────────────────────────────
//
// Auth'd user's own registration history for the Profile page. Queries
// `albums` directly (not the legacy album_requests table) since the
// new flow creates the album row immediately. Status is derived from
// reviews_crawled_at: NULL → 'pending' (admin hasn't run review crawl
// yet), non-NULL → 'approved'. Discarded no longer exists — admin
// deletion just removes the row.
router.get('/me/album-requests', requireAuth, (req, res) => {
  const user = req.user as AppUser;
  const rows = queryAll(
    `SELECT id, mbid, slug, title, artist_name, release_year,
            cover_art_url, created_at, reviews_crawled_at
     FROM albums
     WHERE requested_by_user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [user.id]
  );
  res.json({
    requests: rows.map((r: any) => ({
      id: r.id,
      mbid: r.slug || r.mbid,
      title: r.title,
      artist: r.artist_name,
      year: r.release_year,
      coverArtUrl: r.cover_art_url,
      status: r.reviews_crawled_at ? 'approved' : 'pending',
      createdAt: r.created_at,
      decidedAt: r.reviews_crawled_at,
    })),
  });
});

export default router;
