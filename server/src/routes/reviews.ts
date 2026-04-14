import { Router } from 'express';
import { execute, queryGet } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

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

export default router;
