import { Router } from 'express';
import { execute, queryGet } from '../db/index.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { resolveAlbumId } from '../utils/slug.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

const REVIEW_REPORT_REASONS = new Set([
  'wrong-album',
  'bad-translation',
  'not-a-review',
]);

// ─── DELETE /api/reviews/:reviewId — admin delete a single review ───────

router.delete('/:reviewId', requireAdmin, (req, res) => {
  const reviewId = parseInt(req.params.reviewId as string, 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  const existing = queryGet('SELECT id FROM reviews WHERE id = ?', [reviewId]);
  if (!existing) {
    return res.status(404).json({ error: 'Review not found' });
  }

  try {
    execute('DELETE FROM reviews WHERE id = ?', [reviewId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ─── POST /api/reviews/:reviewId/report — user flag a bad review ────────
//
// Non-admin escape hatch for review cards that came in wrong: the
// scrape pipeline occasionally lands an interview / news piece / a
// review of a different album / a poorly machine-translated excerpt.
// Three fixed reasons mirror the purchase-link report pattern. Admin
// is allowed to call this too (no harm, dashboard handles dedup),
// but the client UI only exposes the affordance to non-admins —
// admin has direct delete / rescrape / edit-excerpt controls on the
// same card and doesn't need the report queue indirection.
router.post('/:reviewId/report', requireAuth, (req, res) => {
  const user = req.user as AppUser;
  const reviewId = parseInt(req.params.reviewId as string, 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  const exists = queryGet('SELECT id FROM reviews WHERE id = ?', [reviewId]);
  if (!exists) return res.status(404).json({ error: 'Review not found' });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  if (!REVIEW_REPORT_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Invalid reason' });
  }

  try {
    execute(
      `INSERT INTO review_reports (review_id, user_id, reason)
       VALUES (?, ?, ?)`,
      [reviewId, user.id, reason]
    );
    res.json({ ok: true });
  } catch (err: any) {
    // UNIQUE(review_id, user_id) — treat as idempotent. Matches the
    // purchase_link_reports pattern: the first report is already on
    // file, the second click is a no-op from the user's perspective.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 신고한 리뷰입니다.' });
    }
    console.error('[reviews/report] insert failed:', err);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// ─── DELETE /api/reviews/album/:id — wipe all reviews for an album ──────
//
// Used by the pending-notice "🗑️ 리뷰 전체 삭제" button (admin wants
// to start the review collection over after a bad crawl). Clears the
// cached reviews and the derived korean_summary so the album reverts
// to the un-summarised state. Deliberately KEEPS the album row and
// resets reviews_crawled_at to NULL so the pending-notice reappears.
router.delete('/album/:id', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const album = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!album) {
    return res.status(404).json({ error: 'Album not found' });
  }

  try {
    const deleted = execute('DELETE FROM reviews WHERE album_mbid = ?', [mbid]);
    execute(
      `UPDATE albums
       SET korean_summary = NULL,
           korean_summary_generated_at = NULL,
           reviews_crawled_at = NULL
       WHERE mbid = ?`,
      [mbid]
    );
    res.json({ ok: true, deleted: deleted.changes });
  } catch (error) {
    console.error('[reviews] bulk delete error:', error);
    res.status(500).json({ error: 'Failed to delete reviews' });
  }
});

export default router;
