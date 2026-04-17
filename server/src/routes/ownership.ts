import { Router } from 'express';
import { queryAll, queryGet, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';

const router = Router();

type OwnershipState = 'owned' | 'wanted' | null;
type Format = 'Vinyl' | 'CD' | 'Cassette';

const ALLOWED_FORMATS = new Set<Format>(['Vinyl', 'CD', 'Cassette']);

function parseState(raw: unknown): OwnershipState | undefined {
  if (raw === null) return null;
  if (raw === 'owned' || raw === 'wanted') return raw;
  return undefined;
}

function parseFormat(raw: unknown): Format | undefined {
  if (typeof raw !== 'string') return undefined;
  return ALLOWED_FORMATS.has(raw as Format) ? (raw as Format) : undefined;
}

function formatsFor(
  table: 'collections' | 'wants',
  userId: number,
  albumPk: number
): Format[] {
  const rows = queryAll(
    `SELECT format FROM ${table} WHERE user_id = ? AND album_id = ?`,
    [userId, albumPk]
  ) as Array<{ format: string }>;
  return rows
    .map((r) => r.format)
    .filter((f): f is Format => ALLOWED_FORMATS.has(f as Format));
}

// PUT /api/albums/:id/ownership
//
// Per-format state: a collector can mark vinyl as 샀음 and CD as
// 살거 on the same album, so every mutation carries a `format` field
// alongside the state. Mutual exclusivity is scoped to (user, album,
// format) — setting owned for vinyl doesn't touch the user's CD
// state. Pass state=null to clear a specific format's state
// entirely.
router.put('/albums/:id/ownership', requireAuth, (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk(req.params.id as string);
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const state = parseState(body.state);
  if (state === undefined) {
    return res.status(400).json({ error: 'state must be owned | wanted | null' });
  }
  const format = parseFormat(body.format);
  if (!format) {
    return res.status(400).json({ error: 'format must be Vinyl | CD | Cassette' });
  }

  // Clear the opposite list for this specific (user, album, format)
  // so the invariant holds regardless of the previous state.
  if (state !== 'wanted') {
    execute(
      `DELETE FROM wants WHERE user_id = ? AND album_id = ? AND format = ?`,
      [user.id, albumPk, format]
    );
  }
  if (state !== 'owned') {
    execute(
      `DELETE FROM collections WHERE user_id = ? AND album_id = ? AND format = ?`,
      [user.id, albumPk, format]
    );
  }

  if (state === 'owned') {
    execute(
      `INSERT OR IGNORE INTO collections (user_id, album_id, format) VALUES (?, ?, ?)`,
      [user.id, albumPk, format]
    );
  } else if (state === 'wanted') {
    execute(
      `INSERT OR IGNORE INTO wants (user_id, album_id, format) VALUES (?, ?, ?)`,
      [user.id, albumPk, format]
    );
  }

  // Fresh aggregates + the caller's per-format lists. Aggregate is
  // DISTINCT user_id — one collector with multiple formats still
  // counts once toward "N people own this".
  const ownedCount =
    (queryGet(
      `SELECT COUNT(DISTINCT user_id) AS c FROM collections WHERE album_id = ?`,
      [albumPk]
    )?.c as number) || 0;
  const wantedCount =
    (queryGet(
      `SELECT COUNT(DISTINCT user_id) AS c FROM wants WHERE album_id = ?`,
      [albumPk]
    )?.c as number) || 0;

  res.json({
    format,
    state,
    ownedCount,
    wantedCount,
    userOwnedFormats: formatsFor('collections', user.id, albumPk),
    userWantedFormats: formatsFor('wants', user.id, albumPk),
  });
});

export default router;
