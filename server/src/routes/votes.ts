import { Router } from 'express';
import { queryGet, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';

const router = Router();

// POST /api/albums/:id/vote  body: { vote: 'up' | 'down' | null }
router.post('/albums/:id/vote', requireAuth, (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk((req.params.id as string));
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const { vote } = req.body as { vote?: 'up' | 'down' | null };

  if (vote !== 'up' && vote !== 'down' && vote !== null) {
    return res.status(400).json({ error: 'vote must be "up", "down", or null' });
  }

  try {
    if (vote === null) {
      execute(`DELETE FROM album_votes WHERE user_id = ? AND album_id = ?`, [user.id, albumPk]);
    } else {
      const existing = queryGet(
        `SELECT id, vote FROM album_votes WHERE user_id = ? AND album_id = ?`,
        [user.id, albumPk]
      );
      if (existing) {
        if (existing.vote === vote) {
          // Same vote twice → toggle off
          execute(`DELETE FROM album_votes WHERE id = ?`, [existing.id]);
        } else {
          execute(`UPDATE album_votes SET vote = ? WHERE id = ?`, [vote, existing.id]);
        }
      } else {
        execute(
          `INSERT INTO album_votes (user_id, album_id, vote) VALUES (?, ?, ?)`,
          [user.id, albumPk, vote]
        );
      }
    }

    const counts = queryGet(
      `SELECT
         SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END) AS down
       FROM album_votes WHERE album_id = ?`,
      [albumPk]
    );
    const userVote = queryGet(
      `SELECT vote FROM album_votes WHERE user_id = ? AND album_id = ?`,
      [user.id, albumPk]
    );

    res.json({
      upvotes: counts?.up || 0,
      downvotes: counts?.down || 0,
      userVote: userVote?.vote || null,
    });
  } catch (err) {
    console.error('[votes] failed:', err);
    res.status(500).json({ error: 'Vote failed' });
  }
});

export default router;
