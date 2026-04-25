import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

const MAX_NON_WHITESPACE_CHARS = 50;
const MIN_NON_WHITESPACE_CHARS = 5;

// Per-user upsert limiter: 3 posts / minute. Guards against casual
// spam without blocking a user who legitimately wants to fix a typo
// on their own comment a couple of times. Admin endpoints (delete on
// someone else's review) go through a different surface.
//
// Admin bypasses entirely — same rationale as albumRequests' skipIfAdmin:
// the limiter is an abuse guard for normal users, not a throttle on the
// site owner's own seeding / smoke-testing of the endpoint.
const upsertLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req.user as AppUser | undefined)?.id;
    return uid ? `u:${uid}` : (req.ip || 'anon');
  },
  skip: (req) => !!(req.user as AppUser | undefined)?.is_admin,
  message: { error: '잠시 뒤에 다시 시도해주세요 (1분에 최대 3개).' },
});

function flattenBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Collapse all whitespace (incl. newlines) into single spaces; trim ends.
  return raw.replace(/\s+/g, ' ').trim();
}

function nonWhitespaceLength(s: string): number {
  return s.replace(/\s/g, '').length;
}

function normalizeEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Emojis can be multi-codepoint (ZWJ sequences, skin tones). Count grapheme
  // clusters and require exactly one. 24 UTF-16 units is a generous ceiling.
  if (trimmed.length > 24) return null;
  try {
    const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
    if (SegmenterCtor) {
      const seg = new SegmenterCtor('und', { granularity: 'grapheme' });
      const count = [...seg.segment(trimmed)].length;
      if (count !== 1) return null;
    } else if (trimmed.length > 12) {
      return null;
    }
  } catch {
    if (trimmed.length > 12) return null;
  }
  return trimmed;
}

function normalizeRating(raw: unknown): 'up' | 'down' | 'soso' | null {
  if (raw === 'up' || raw === 'down' || raw === 'soso') return raw;
  return null;
}

interface Row {
  id: number;
  body: string;
  emoji: string | null;
  rating: 'up' | 'down' | 'soso' | null;
  created_at: string;
  // NULL when the review author has deleted their account — the body is
  // preserved but the user reference is anonymised.
  user_id: number | null;
  user_name: string | null;
  user_avatar: string | null;
  // Up/down-vote tallies for the author across all albums. Rendered as
  // "👍 N  👎 M" under the speaker's name — a lightweight profile
  // signal so readers can tell a heavy voter from a one-time commenter.
  // Percentages omitted here (the hover card carries those).
  user_upvote_count: number | null;
  user_downvote_count: number | null;
}

function serialize(row: Row) {
  return {
    id: row.id,
    body: row.body,
    emoji: row.emoji,
    rating: row.rating,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    userUpvoteCount: row.user_upvote_count ?? 0,
    userDownvoteCount: row.user_downvote_count ?? 0,
  };
}

// GET /api/user-reviews/feed — public cross-album feed
//
// Powers the homepage comment ticker. Pure ORDER BY RANDOM() buried
// today's 50자 평 in the long tail of older ones, so the weighting
// now leans on recency: sort key = random jitter + age_in_days × 30.
// Fresh comments cluster near the top of the pick, older ones
// surface occasionally via the random jitter. Reviews with an empty
// body (shouldn't exist post-validation but defensive) are skipped
// so the ticker never shows a blank bubble.

router.get('/user-reviews/feed', (req, res) => {
  const limitRaw = parseInt((req.query.limit as string) || '', 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 60) : 30;

  const rows = queryAll(
    `SELECT ur.id, ur.body, ur.emoji, ur.rating, ur.created_at, ur.user_id,
            COALESCE(u.display_name, u.name) AS user_name,
            COALESCE(u.custom_avatar_url, u.avatar_url) AS user_avatar,
            (SELECT COUNT(*) FROM album_votes av
             WHERE av.user_id = ur.user_id AND av.vote = 'up') AS user_upvote_count,
            (SELECT COUNT(*) FROM album_votes av
             WHERE av.user_id = ur.user_id AND av.vote = 'down') AS user_downvote_count,
            a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            a.cover_art_url AS album_cover,
            a.cover_art_fallbacks AS album_cover_fallbacks
     FROM user_reviews ur
     INNER JOIN albums a ON a.id = ur.album_id
     LEFT JOIN users u ON u.id = ur.user_id
     WHERE LENGTH(TRIM(ur.body)) > 0
     ORDER BY
       (ABS(RANDOM()) % 1000) +
       (julianday('now') - julianday(ur.created_at)) * 30
     LIMIT ?`,
    [limit]
  ) as Array<{
    id: number;
    body: string;
    emoji: string | null;
    rating: 'up' | 'down' | 'soso' | null;
    created_at: string;
    user_id: number | null;
    user_name: string | null;
    user_avatar: string | null;
    user_upvote_count: number | null;
    user_downvote_count: number | null;
    album_slug: string | null;
    album_mbid: string | null;
    album_title: string;
    album_artist: string | null;
    album_cover: string | null;
    album_cover_fallbacks: string | null;
  }>;

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      body: r.body,
      emoji: r.emoji,
      rating: r.rating,
      createdAt: r.created_at,
      userId: r.user_id,
      userName: r.user_name,
      userAvatar: r.user_avatar,
      userUpvoteCount: r.user_upvote_count ?? 0,
      userDownvoteCount: r.user_downvote_count ?? 0,
      // Prefer the stable slug, fall back to mbid if slug backfill hasn't
      // reached this album yet.
      albumSlug: r.album_slug || r.album_mbid || '',
      albumTitle: r.album_title,
      albumArtist: r.album_artist,
      albumCoverUrl: r.album_cover,
      albumCoverFallbacks: r.album_cover_fallbacks
        ? (() => {
            try {
              return JSON.parse(r.album_cover_fallbacks);
            } catch {
              return [];
            }
          })()
        : [],
    })),
  });
});

// GET /api/albums/:id/user-reviews — public
router.get('/albums/:id/user-reviews', (req, res) => {
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  // COALESCE so the comment card picks up the user's customised
  // display name / avatar if they set one in /profile. Google values
  // stay as the fallback when no override exists.
  const rows = queryAll(
    `SELECT ur.id, ur.body, ur.emoji, ur.rating, ur.created_at, ur.user_id,
            COALESCE(u.display_name, u.name) AS user_name,
            COALESCE(u.custom_avatar_url, u.avatar_url) AS user_avatar,
            (SELECT COUNT(*) FROM album_votes av
             WHERE av.user_id = ur.user_id AND av.vote = 'up') AS user_upvote_count,
            (SELECT COUNT(*) FROM album_votes av
             WHERE av.user_id = ur.user_id AND av.vote = 'down') AS user_downvote_count
     FROM user_reviews ur
     LEFT JOIN users u ON u.id = ur.user_id
     WHERE ur.album_id = ?
     ORDER BY ur.updated_at DESC, ur.id DESC`,
    [albumPk]
  ) as Row[];

  res.json({ userReviews: rows.map(serialize) });
});

// POST /api/albums/:id/user-reviews — auth, upsert (one review per user per album)
router.post('/albums/:id/user-reviews', requireAuth, upsertLimiter, (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const body = flattenBody((req.body ?? {}).body);
  if (!body) return res.status(400).json({ error: '본문을 입력해주세요.' });
  const bodyLen = nonWhitespaceLength(body);
  if (bodyLen < MIN_NON_WHITESPACE_CHARS) {
    return res.status(400).json({
      error: `공백을 제외하고 최소 ${MIN_NON_WHITESPACE_CHARS}자 이상 작성해주세요.`,
    });
  }
  if (bodyLen > MAX_NON_WHITESPACE_CHARS) {
    return res.status(400).json({ error: '공백을 제외하고 50자 이하로 작성해주세요.' });
  }
  const emoji = normalizeEmoji((req.body ?? {}).emoji);
  const rating = normalizeRating((req.body ?? {}).rating);
  if (!rating) {
    return res.status(400).json({ error: '이 앨범에 대해 굿굿/쏘쏘/별루를 선택해주세요.' });
  }

  try {
    execute(
      `INSERT INTO user_reviews (album_id, user_id, body, emoji, rating)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(album_id, user_id) DO UPDATE SET
         body = excluded.body,
         emoji = excluded.emoji,
         rating = excluded.rating,
         updated_at = datetime('now')`,
      [albumPk, user.id, body, emoji, rating]
    );

    // Keep album_votes in sync with the review's rating:
    //   up   → upvote row
    //   down → downvote row
    //   soso → no row (doesn't count toward up/down tallies)
    if (rating === 'up' || rating === 'down') {
      const existingVote = queryGet(
        `SELECT id, vote FROM album_votes WHERE user_id = ? AND album_id = ?`,
        [user.id, albumPk]
      ) as { id: number; vote: 'up' | 'down' } | null;
      if (existingVote) {
        if (existingVote.vote !== rating) {
          execute(`UPDATE album_votes SET vote = ? WHERE id = ?`, [rating, existingVote.id]);
        }
      } else {
        execute(
          `INSERT INTO album_votes (user_id, album_id, vote) VALUES (?, ?, ?)`,
          [user.id, albumPk, rating]
        );
      }
    } else {
      // 'soso' — explicitly remove the user's up/down vote so it does not
      // influence the album's tallies.
      execute(
        `DELETE FROM album_votes WHERE user_id = ? AND album_id = ?`,
        [user.id, albumPk]
      );
    }

    const row = queryGet(
      `SELECT ur.id, ur.body, ur.emoji, ur.rating, ur.created_at, ur.user_id,
              COALESCE(u.display_name, u.name) AS user_name,
              COALESCE(u.custom_avatar_url, u.avatar_url) AS user_avatar,
              (SELECT COUNT(*) FROM album_votes av
               WHERE av.user_id = ur.user_id AND av.vote = 'up') AS user_upvote_count,
              (SELECT COUNT(*) FROM album_votes av
               WHERE av.user_id = ur.user_id AND av.vote = 'down') AS user_downvote_count
       FROM user_reviews ur
       LEFT JOIN users u ON u.id = ur.user_id
       WHERE ur.album_id = ? AND ur.user_id = ?`,
      [albumPk, user.id]
    ) as Row | null;

    if (!row) return res.status(500).json({ error: 'Failed to load saved review' });
    res.json({ userReview: serialize(row) });
  } catch (err) {
    console.error('[user-reviews] upsert failed:', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// DELETE /api/user-reviews/:id — owner or admin
router.delete('/user-reviews/:id', requireAuth, (req, res) => {
  const user = req.user!;
  const reviewId = parseInt(req.params.id as string, 10);
  if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid id' });

  const existing = queryGet(
    `SELECT user_id, album_id FROM user_reviews WHERE id = ?`,
    [reviewId]
  ) as { user_id: number | null; album_id: number } | null;

  if (!existing) return res.status(404).json({ error: 'Review not found' });
  // A NULL user_id means the author has deleted their account — only an
  // admin can remove anonymised reviews after the fact.
  if (existing.user_id !== user.id && !user.is_admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    execute(`DELETE FROM user_reviews WHERE id = ?`, [reviewId]);
    // The review's thumbs IS the author's 굿굿/별루 vote on the album —
    // deleting the review also withdraws their vote so the album's count
    // drops by 1. Always targets the review author, even when an admin
    // performs the delete.
    execute(
      `DELETE FROM album_votes WHERE user_id = ? AND album_id = ?`,
      [existing.user_id, existing.album_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[user-reviews] delete failed:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
