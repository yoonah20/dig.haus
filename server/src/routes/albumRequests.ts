import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getCachedAlbum, cacheAlbum, updateAlbumFields } from '../utils/cache.js';
import { searchExternalMerged } from '../utils/externalSearch.js';
import { extractAlbumFromUrl } from '../services/albumUrlExtract.js';
import { enqueueAutoCuration } from '../services/autoCuration.js';
import { generateSlug } from '../utils/slug.js';
import type { AppUser } from '../auth/passport.js';

// Max albums a non-admin can submit in one calendar day. Caps spam
// without getting in the way of a motivated curator adding a batch.
// Admin bypasses this cap entirely.
const USER_DAILY_ALBUM_CAP = 50;

const router = Router();

function userKey(req: { user?: unknown; ip?: string }): string {
  const uid = (req.user as AppUser | undefined)?.id;
  if (uid) return `u:${uid}`;
  // ipKeyGenerator canonicalises IPv6 to a /56 subnet so a single
  // user can't bypass the per-IP limit by rotating IPv6 addresses
  // within their ISP range. express-rate-limit v8 hard-fails at
  // startup if a custom keyGenerator references req.ip without going
  // through this helper.
  return req.ip ? ipKeyGenerator(req.ip) : 'anon';
}

// Admin bypass for both create limiters. Admin curation sessions
// regularly involve dropping many albums at once (e.g. a label's 2025
// discography seed), and the "5/min" burst + "500/day" ceiling were
// designed as abuse guards for normal users, not as throttles on the
// site owner's own curation work. Keeping the limiters enforced for
// everyone else.
function skipIfAdmin(req: any): boolean {
  return !!(req.user as AppUser | undefined)?.is_admin;
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
  skip: skipIfAdmin,
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
  skip: skipIfAdmin,
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
    // Fire-and-forget auto-curation. enqueueAutoCuration appends to a
    // global serial queue; one album at a time, so a burst of user
    // submissions doesn't multiply external-API pressure. Skipped
    // entirely for the manual-entry route — synthetic mbid albums
    // are unlikely to have Serper-discoverable review coverage.
    enqueueAutoCuration(mbid);
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

// ─── POST /api/album-requests/manual ──────────────────────────────────
//
// Hand-entered album registration — for when MusicBrainz and Discogs
// both come up empty (small-label tape releases, regional pressings,
// pre-release titles MB hasn't indexed yet, etc.). Skips the entire
// external-fetch pipeline and inserts directly into `albums` with a
// synthetic mbid prefix `manual-{uuid}` so downstream code that
// depends on the column being unique stays happy and the row's
// origin is obvious from the id alone.
//
// reviews_crawled_at stays NULL so the row joins the same admin
// "리뷰 수집 대기" queue as MB-sourced submissions; the rest of the
// site (votes, 50자 평, collections, purchase links, mydig wall)
// works against a manual album the same as any other row because
// every join key is `mbid` and we generate a real one.
//
// Cover art: optional URL only at MVP. The dig.haus custom-cover
// upload pipeline already exists for replacing covers post-create,
// so users who want to upload a file can register first (no cover)
// then swap it from the album page.
router.post(
  '/album-requests/manual',
  requireAuth,
  createDailyLimiter,
  createBurstLimiter,
  async (req, res) => {
    const user = req.user as AppUser;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const title = normalizeString(body.title, TITLE_MAX);
    const artist = normalizeString(body.artist, ARTIST_MAX);
    if (!title || !artist) {
      return res.status(400).json({ error: 'artist, title는 필수입니다.' });
    }

    // Year: optional, 4-digit 1900-2099 only. Anything else falls
    // through to NULL — better to leave it empty than to record a
    // bogus year that the home grid would order wrong.
    const yearRaw = normalizeString(body.year, 4);
    const year =
      yearRaw && /^(19|20)\d{2}$/.test(yearRaw) ? yearRaw : null;

    const format = normalizeString(body.format, 64);
    const label = normalizeString(body.label, 200);
    const coverArtUrl = normalizeString(body.coverArtUrl, 600);
    if (coverArtUrl && !/^https?:\/\//i.test(coverArtUrl)) {
      return res.status(400).json({
        error: '커버 이미지 URL은 http(s)://로 시작해야 해요.',
      });
    }

    // Daily cap mirrors the regular submission path so the manual
    // route can't be used as a quota-bypass channel.
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

    // Synthetic mbid — UUID is overkill for collision-safety against
    // the daily volume we see, but the manual- prefix is the actual
    // signal here (it tells downstream "this row was hand-entered, no
    // MB metadata to fall back on"). Using crypto.randomUUID keeps
    // the id opaque + URL-safe.
    const mbid = `manual-${randomUUID()}`;
    const slug = generateSlug(artist, title, year, mbid);

    try {
      cacheAlbum({
        mbid,
        slug,
        title,
        artist_name: artist,
        // artist_credit array form — mirrors what the MB path passes
        // so consumers reading artist_credit_json don't have to
        // special-case the manual route.
        artist_credit: [{ name: artist, mbid: null }],
        release_year: year ? parseInt(year, 10) : null,
        // Synthesise a Jan-1 date so the home grid's "released within
        // 30 days" NEW sticker rule has *something* to compare; users
        // who care about exact release day can't get it from manual
        // entries today (the form doesn't expose month/day).
        release_date: year ? `${year}-01-01` : null,
        format,
        label_name: label,
        cover_art_url: coverArtUrl,
      });

      // requested_by_user_id is not part of cacheAlbum's column list;
      // stamp it via updateAlbumFields just like the MB-sourced flow
      // does after getOrFetchAlbumBaseForSubmission.
      updateAlbumFields(mbid, { requested_by_user_id: user.id });

      res.json({ ok: true, mbid, slug });
    } catch (err) {
      console.error('[album-requests/manual] failed:', err);
      res
        .status(500)
        .json({ error: '앨범 등록에 실패했어요. 잠시 뒤 다시 시도해주세요.' });
    }
  }
);

// ─── POST /api/album-requests/extract-from-url ────────────────────────
//
// Companion to the text-search box on the registration modal. Accepts a
// store / streaming / music-site URL and returns {artist, title} so the
// modal can pre-fill its search field and hand the user over to the
// normal MusicBrainz lookup flow. No Claude involved — the service
// tries Discogs's release/master API first (canonical), then falls
// back to scraping OG tags (works for Bandcamp, Spotify, Apple Music,
// most shops). If both layers fail we return 404 so the UI can tell
// the user to type the name in manually.
//
// Rate-limited via the existing searchLimiter (30/min per user) — same
// ballpark as text search and plenty of headroom for a user
// iterating on URL paste. SSRF guards live inside extractAlbumFromUrl.
router.post(
  '/album-requests/extract-from-url',
  requireAuth,
  searchLimiter,
  async (req, res) => {
    const raw = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!raw.trim()) {
      return res.status(400).json({ error: 'URL이 필요합니다.' });
    }
    try {
      const result = await extractAlbumFromUrl(raw);
      if (!result) {
        return res.status(404).json({
          error: '이 URL에서 아티스트·앨범 정보를 찾지 못했어요. 직접 입력해 주세요.',
        });
      }
      res.json(result);
    } catch (err) {
      console.error('[album-requests/extract-from-url] failed:', err);
      res.status(500).json({ error: 'URL 분석 중 오류가 발생했어요.' });
    }
  }
);

// ─── GET /api/album-requests ─────────────────────────────────────────
//
// Admin notification feed — powers the red count badge on the admin
// avatar pill. Only *non-admin* user submissions surface here. Three
// exclusions:
//   • `requested_by_user_id IS NULL` — fully-direct admin registrations
//     (e.g. seed inserts) never had a requester (INNER JOIN handles)
//   • `u.is_admin = 0` — any admin in the users table
//   • `a.requested_by_user_id != $callingAdminId` — belt-and-suspenders
//     against an admin whose `users.is_admin` somehow drifts from 1
//     (e.g. an env-var blip on a re-login resetting the flag while
//     they're already in /admin via session). The session admin id
//     is authoritative for "this person is admin right now", so we
//     skip their own registrations regardless of the DB column state.
router.get('/album-requests', requireAdmin, (req, res) => {
  const adminUserId = (req.user as AppUser).id;
  const rows = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks, a.created_at,
            COALESCE(u.display_name, u.name) AS user_name,
            u.avatar_url AS user_avatar,
            u.id AS user_id
     FROM albums a
     JOIN users u ON u.id = a.requested_by_user_id
     WHERE a.reviews_crawled_at IS NULL
       AND COALESCE(u.is_admin, 0) = 0
       AND a.requested_by_user_id != ?
     ORDER BY a.created_at DESC`,
    [adminUserId]
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
  // canDelete is 1 iff nothing foreign has attached to the album
  // since submission — the requester gets to retract a mis-upload
  // while it's still pristine, but once anyone else has reviewed /
  // voted / saved / added a purchase link, or admin has run the
  // scrape pipeline (reviews row), the retraction path closes.
  // User's own votes / reviews / etc. don't count — self-activity
  // on your own submission shouldn't lock you out of deleting it.
  const rows = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.release_year,
            a.cover_art_url, a.created_at, a.reviews_crawled_at,
            (
              (SELECT COUNT(*) FROM reviews WHERE album_mbid = a.mbid)
              + (SELECT COUNT(*) FROM user_reviews WHERE album_id = a.id AND user_id != ?)
              + (SELECT COUNT(*) FROM album_votes WHERE album_id = a.id AND user_id != ?)
              + (SELECT COUNT(*) FROM purchase_links WHERE album_id = a.id AND user_id != ?)
              + (SELECT COUNT(DISTINCT cb.user_id)
                 FROM crate_items ci JOIN crate_boxes cb ON cb.id = ci.crate_id
                 WHERE ci.album_id = a.id AND cb.user_id != ?)
            ) AS foreign_engagement
     FROM albums a
     WHERE a.requested_by_user_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    [user.id, user.id, user.id, user.id, user.id]
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
      canDelete: (r.foreign_engagement ?? 0) === 0,
    })),
  });
});

export default router;
