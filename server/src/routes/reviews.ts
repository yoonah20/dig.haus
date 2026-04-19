import { Router } from 'express';
import { execute, queryGet } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { resolveAlbumId } from '../utils/slug.js';

const router = Router();

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
