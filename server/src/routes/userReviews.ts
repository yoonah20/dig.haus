import { Router } from 'express';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';

const router = Router();

const MAX_NON_WHITESPACE_CHARS = 50;

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

interface Row {
  id: number;
  body: string;
  emoji: string | null;
  created_at: string;
  user_id: number;
  user_name: string | null;
  user_avatar: string | null;
}

function serialize(row: Row) {
  return {
    id: row.id,
    body: row.body,
    emoji: row.emoji,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
  };
}

// GET /api/albums/:id/user-reviews — public
router.get('/albums/:id/user-reviews', (req, res) => {
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const rows = queryAll(
    `SELECT ur.id, ur.body, ur.emoji, ur.created_at, ur.user_id,
            u.name AS user_name, u.avatar_url AS user_avatar
     FROM user_reviews ur
     LEFT JOIN users u ON u.id = ur.user_id
     WHERE ur.album_id = ?
     ORDER BY ur.updated_at DESC, ur.id DESC`,
    [albumPk]
  ) as Row[];

  res.json({ userReviews: rows.map(serialize) });
});

// POST /api/albums/:id/user-reviews — auth, upsert (one review per user per album)
router.post('/albums/:id/user-reviews', requireAuth, (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const body = flattenBody((req.body ?? {}).body);
  if (!body) return res.status(400).json({ error: '본문을 입력해주세요.' });
  if (nonWhitespaceLength(body) > MAX_NON_WHITESPACE_CHARS) {
    return res.status(400).json({ error: '공백을 제외하고 50자 이하로 작성해주세요.' });
  }
  const emoji = normalizeEmoji((req.body ?? {}).emoji);

  try {
    execute(
      `INSERT INTO user_reviews (album_id, user_id, body, emoji)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(album_id, user_id) DO UPDATE SET
         body = excluded.body,
         emoji = excluded.emoji,
         updated_at = datetime('now')`,
      [albumPk, user.id, body, emoji]
    );

    const row = queryGet(
      `SELECT ur.id, ur.body, ur.emoji, ur.created_at, ur.user_id,
              u.name AS user_name, u.avatar_url AS user_avatar
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
    `SELECT user_id FROM user_reviews WHERE id = ?`,
    [reviewId]
  ) as { user_id: number } | null;

  if (!existing) return res.status(404).json({ error: 'Review not found' });
  if (existing.user_id !== user.id && !user.is_admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    execute(`DELETE FROM user_reviews WHERE id = ?`, [reviewId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[user-reviews] delete failed:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
