import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getCachedAlbum } from '../utils/cache.js';
import { searchExternalMerged } from '../utils/externalSearch.js';
import type { AppUser } from '../auth/passport.js';

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
// User-submitted request for an album to be added to dig.haus. Writes
// one row; does NOT trigger any Claude (review search, pronunciation,
// similar-albums). Those run only on admin approve.
router.post(
  '/album-requests',
  requireAuth,
  createDailyLimiter,
  createBurstLimiter,
  (req, res) => {
  const user = req.user as AppUser;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const mbid = normalizeString(body.mbid, 64);
  const title = normalizeString(body.title, TITLE_MAX);
  const artist = normalizeString(body.artist, ARTIST_MAX);
  if (!mbid || !title || !artist) {
    return res.status(400).json({ error: 'mbid, title, artist는 필수입니다.' });
  }

  // Already registered? Nothing to request.
  const existingAlbum = getCachedAlbum(mbid);
  if (existingAlbum) {
    return res.status(400).json({ error: '이미 등록된 앨범입니다.' });
  }

  // Soft dedup: same user can't have a pending request for the same
  // mbid twice. Other users still can — multiple users requesting the
  // same album is the "social proof" signal for admin.
  const dupe = queryGet(
    `SELECT id FROM album_requests
     WHERE user_id = ? AND mbid = ? AND status = 'pending'`,
    [user.id, mbid]
  );
  if (dupe) {
    return res.status(409).json({ error: '이미 요청하신 앨범입니다.' });
  }

  const yearRaw = Number(body.year);
  const year = Number.isFinite(yearRaw) && yearRaw > 0 ? Math.floor(yearRaw) : null;
  const coverArtUrl = normalizeString(body.coverArtUrl, 500);
  const notes = normalizeString(body.notes, NOTES_MAX);

  try {
    execute(
      `INSERT INTO album_requests
         (user_id, mbid, title, artist_name, release_year, cover_art_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, mbid, title, artist, year, coverArtUrl, notes]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[album-requests] insert failed:', err);
    res.status(500).json({ error: '요청 저장에 실패했습니다.' });
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

// ─── GET /api/album-requests?status=pending ───────────────────────────
//
// Admin-only list. Rows with the same mbid (multiple users requesting
// the same album) collapse into one entry here — the admin acts on the
// album, not on the individual request. request_count + a compact
// requester list powers the social-proof bit on the request card.
router.get('/album-requests', requireAdmin, (req, res) => {
  const statusRaw = (req.query.status as string) || 'pending';
  const status =
    statusRaw === 'approved' || statusRaw === 'discarded' ? statusRaw : 'pending';

  // json_group_array + json_object bundles the requester list per row
  // so the UI can render a stack of avatars without an N+1 follow-up
  // call. Nulls (deleted-account requesters) are kept as `{id:null,...}`
  // so the count still reflects reality.
  const rows = queryAll(
    `SELECT ar.mbid,
            MAX(ar.title) AS title,
            MAX(ar.artist_name) AS artist_name,
            MAX(ar.release_year) AS release_year,
            MAX(ar.cover_art_url) AS cover_art_url,
            MIN(ar.created_at) AS first_requested_at,
            COUNT(*) AS request_count,
            json_group_array(
              json_object(
                'id', ar.id,
                'userId', ar.user_id,
                'userName', COALESCE(u.display_name, u.name),
                'userAvatar', COALESCE(u.custom_avatar_url, u.avatar_url),
                'notes', ar.notes,
                'createdAt', ar.created_at
              )
            ) AS requesters_json
     FROM album_requests ar
     LEFT JOIN users u ON u.id = ar.user_id
     WHERE ar.status = ?
     GROUP BY ar.mbid
     ORDER BY request_count DESC, first_requested_at DESC`,
    [status]
  );

  res.json({
    requests: rows.map((r: any) => ({
      mbid: r.mbid,
      title: r.title,
      artist: r.artist_name,
      year: r.release_year,
      coverArtUrl: r.cover_art_url,
      firstRequestedAt: r.first_requested_at,
      requestCount: r.request_count,
      requesters: (() => {
        try {
          return JSON.parse(r.requesters_json);
        } catch {
          return [];
        }
      })(),
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
router.post('/album-requests/:mbid/approve', requireAdmin, async (req, res) => {
  const mbid = req.params.mbid as string;
  if (!mbid) return res.status(400).json({ error: 'mbid 누락' });

  const any = queryGet(
    `SELECT id FROM album_requests WHERE mbid = ? AND status = 'pending' LIMIT 1`,
    [mbid]
  );
  if (!any) {
    return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
  }

  try {
    const { approveAlbumRequest } = await import('./albums.js');
    await approveAlbumRequest(mbid);
  } catch (err) {
    console.error('[album-requests] approve/fetch failed:', err);
    return res.status(500).json({ error: '앨범 데이터를 가져오지 못했습니다.' });
  }

  execute(
    `UPDATE album_requests
     SET status = 'approved', decided_at = datetime('now')
     WHERE mbid = ? AND status = 'pending'`,
    [mbid]
  );
  res.json({ ok: true, mbid });
});

// ─── POST /api/album-requests/:mbid/discard ───────────────────────────
router.post('/album-requests/:mbid/discard', requireAdmin, (req, res) => {
  const mbid = req.params.mbid as string;
  if (!mbid) return res.status(400).json({ error: 'mbid 누락' });

  const result = execute(
    `UPDATE album_requests
     SET status = 'discarded', decided_at = datetime('now')
     WHERE mbid = ? AND status = 'pending'`,
    [mbid]
  );
  // execute() wrapper returns void; no row count here, but we treat a
  // zero-row discard as a 404 anyway — check presence first.
  // (Skipped the extra SELECT — the discard is idempotent enough that
  //  double-clicks return ok safely.)
  void result;
  res.json({ ok: true });
});

// ─── GET /api/me/album-requests ───────────────────────────────────────
//
// Auth'd user's own request history for the Profile page. Returns all
// statuses so the user can see pending / approved / discarded outcomes.
router.get('/me/album-requests', requireAuth, (req, res) => {
  const user = req.user as AppUser;
  const rows = queryAll(
    `SELECT id, mbid, title, artist_name, release_year, cover_art_url,
            status, created_at, decided_at
     FROM album_requests
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [user.id]
  );
  res.json({
    requests: rows.map((r: any) => ({
      id: r.id,
      mbid: r.mbid,
      title: r.title,
      artist: r.artist_name,
      year: r.release_year,
      coverArtUrl: r.cover_art_url,
      status: r.status,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    })),
  });
});

export default router;
