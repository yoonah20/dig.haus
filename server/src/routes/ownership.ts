import { Router } from 'express';
import { queryGet, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';

const router = Router();

type OwnershipState = 'owned' | 'wanted' | null;

function parseState(raw: unknown): OwnershipState | undefined {
  if (raw === null) return null;
  if (raw === 'owned' || raw === 'wanted') return raw;
  return undefined;
}

// PUT /api/albums/:id/ownership
//
// Single endpoint covering all transitions: pass state 'owned' to put
// the album in the caller's 샀음 collection, 'wanted' for 살거
// wantlist, or null to clear both. The two lists are mutually
// exclusive — setting one always removes the other so the UI buttons
// can render as a two-way radio. Idempotent: re-submitting the same
// state is a no-op.
router.put('/albums/:id/ownership', requireAuth, (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const state = parseState((req.body ?? {}).state);
  if (state === undefined) {
    return res.status(400).json({ error: 'state must be owned | wanted | null' });
  }

  // Always clear the opposite list first — keeps the invariant that a
  // user is in at most one of (collections, wants) per album.
  if (state !== 'wanted') {
    execute(`DELETE FROM wants WHERE user_id = ? AND album_id = ?`, [
      user.id,
      albumPk,
    ]);
  }
  if (state !== 'owned') {
    execute(`DELETE FROM collections WHERE user_id = ? AND album_id = ?`, [
      user.id,
      albumPk,
    ]);
  }

  if (state === 'owned') {
    execute(
      `INSERT OR IGNORE INTO collections (user_id, album_id) VALUES (?, ?)`,
      [user.id, albumPk]
    );
  } else if (state === 'wanted') {
    execute(`INSERT OR IGNORE INTO wants (user_id, album_id) VALUES (?, ?)`, [
      user.id,
      albumPk,
    ]);
  }

  // Return the fresh counts + the caller's current state so the
  // client can update without a follow-up GET.
  const ownedCount =
    (queryGet(`SELECT COUNT(*) AS c FROM collections WHERE album_id = ?`, [
      albumPk,
    ])?.c as number) || 0;
  const wantedCount =
    (queryGet(`SELECT COUNT(*) AS c FROM wants WHERE album_id = ?`, [albumPk])
      ?.c as number) || 0;

  res.json({
    state,
    ownedCount,
    wantedCount,
  });
});

export default router;
