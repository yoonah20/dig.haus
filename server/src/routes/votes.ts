import { Router } from 'express';
import { queryGet, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';

const router = Router();

// Sync the user's 굿굿 / 별루 default crates to mirror their vote
// state on this album. The seed-default-crates migration guarantees
// both crates exist for every user, but we keep the SELECT as the
// source of truth in case future code paths create users mid-flight
// or seeded crates get re-created. Repeat votes are idempotent via
// the SQL primitives — INSERT OR IGNORE never duplicates, DELETE no-
// ops when the row is already absent.
function syncVoteCrates(userId: number, albumId: number, vote: 'up' | 'down' | null) {
  const up = queryGet(
    `SELECT id FROM crate_boxes WHERE user_id = ? AND title = '굿굿' AND is_default = 1`,
    [userId]
  ) as { id: number } | undefined;
  const down = queryGet(
    `SELECT id FROM crate_boxes WHERE user_id = ? AND title = '별루' AND is_default = 1`,
    [userId]
  ) as { id: number } | undefined;
  if (!up || !down) return; // user pre-dates the seed; next boot heals it

  if (vote === 'up') {
    execute(`INSERT OR IGNORE INTO crate_items (crate_id, album_id) VALUES (?, ?)`, [up.id, albumId]);
    execute(`DELETE FROM crate_items WHERE crate_id = ? AND album_id = ?`, [down.id, albumId]);
  } else if (vote === 'down') {
    execute(`INSERT OR IGNORE INTO crate_items (crate_id, album_id) VALUES (?, ?)`, [down.id, albumId]);
    execute(`DELETE FROM crate_items WHERE crate_id = ? AND album_id = ?`, [up.id, albumId]);
  } else {
    execute(`DELETE FROM crate_items WHERE crate_id = ? AND album_id = ?`, [up.id, albumId]);
    execute(`DELETE FROM crate_items WHERE crate_id = ? AND album_id = ?`, [down.id, albumId]);
  }
}

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
    // Resolved final state on this album for the user — used by
    // syncVoteCrates below to mirror into the 굿굿 / 별루 crates. The
    // "toggle off" branch (same vote twice) lands on null.
    let resolved: 'up' | 'down' | null = vote;
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
          resolved = null;
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
    syncVoteCrates(user.id, albumPk, resolved);

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

    // Mirror the final vote state onto any existing review the user has for
    // this album so the 50자 평 speech-bubble badge stays perfectly in sync
    // with the 굿굿/별루 buttons:
    //   up   button pressed  → review.rating = 'up'
    //   down button pressed  → review.rating = 'down'
    //   neither pressed      → review.rating = 'soso' (쏘쏘)
    // UPDATE is a no-op when the user has no review yet.
    const mirroredRating: 'up' | 'down' | 'soso' = userVote?.vote ?? 'soso';
    execute(
      `UPDATE user_reviews SET rating = ? WHERE user_id = ? AND album_id = ?`,
      [mirroredRating, user.id, albumPk]
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
