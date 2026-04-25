import { Router } from 'express';
import { getDb, queryAll, queryGet } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

// Admin-curated 15-album home wall (5-5-5 to match mydig). Mirrors
// the mydig vinyl-wall data shape (album_id, position) minus the
// user_id — this is a single global wall, not per-user. Plus a
// singleton meta row (theme + description) that renders as the
// graffiti header above the wall. Public GET; admin-only PUT for
// bulk replace + PATCH for meta edit.

const router = Router();

router.get('/home/features', (_req, res) => {
  const rows = queryAll(
    `SELECT hf.position, hf.note,
            a.mbid, a.slug, a.title, a.artist,
            a.cover_art_url AS coverArtUrl,
            a.cover_art_fallbacks AS coverArtFallbacks,
            a.cover_dominant_color AS coverDominantColor,
            a.spotify_url AS spotifyUrl,
            a.release_date AS releaseDate
     FROM home_features hf
     JOIN albums a ON a.id = hf.album_id
     ORDER BY hf.position ASC`
  );
  // TEMP DEBUG — remove once home-features save round-trip is confirmed
  const rawCount = (queryGet(
    'SELECT COUNT(*) AS c FROM home_features'
  ) as { c: number } | null)?.c;
  console.log(
    '[home/features GET] rawHomeFeatures rows=',
    rawCount,
    'joined rows=',
    rows.length
  );

  const items = rows.map((row: any) => ({
    position: row.position,
    note: row.note,
    album: {
      mbid: row.mbid,
      slug: row.slug,
      title: row.title,
      artist: row.artist,
      coverArtUrl: row.coverArtUrl,
      coverArtFallbacks: row.coverArtFallbacks
        ? JSON.parse(row.coverArtFallbacks)
        : [],
      coverDominantColor: row.coverDominantColor ?? null,
      spotifyUrl: row.spotifyUrl ?? null,
      releaseDate: row.releaseDate ?? null,
    },
  }));

  const metaRow = queryGet(
    'SELECT theme, description FROM home_meta WHERE id = 1'
  ) as { theme: string | null; description: string | null } | null;

  res.json({
    items,
    meta: {
      theme: metaRow?.theme ?? null,
      description: metaRow?.description ?? null,
    },
  });
});

router.patch('/home/meta', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { theme?: unknown; description?: unknown };
  const theme =
    typeof body.theme === 'string' ? body.theme.slice(0, 80) : null;
  const description =
    typeof body.description === 'string'
      ? body.description.slice(0, 240)
      : null;
  const db = getDb();
  db.prepare(
    `UPDATE home_meta SET theme = ?, description = ?, updated_at = datetime('now') WHERE id = 1`
  ).run(theme, description);
  res.json({ ok: true });
});

router.put('/home/features/items', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items array 필요' });
  }

  // Accepts mbid OR slug as the album identifier, matching the
  // slug-or-mbid convention used by resolveAlbumId / album-page
  // routing. /api/albums/search collapses both into a single field
  // (slug || mbid) so the admin picker can pass that straight
  // through; we resolve to album_id before the transaction starts.
  type Raw = { position: number; mbid: string; note: string | null };
  const normalised: Raw[] = [];
  const seenPositions = new Set<number>();
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') continue;
    const position = (raw as any).position;
    const mbid = (raw as any).mbid;
    const noteRaw = (raw as any).note;
    if (!Number.isInteger(position) || position < 0 || position >= 15) {
      return res.status(400).json({ error: `position은 0-14 정수여야 해요 (${position})` });
    }
    if (typeof mbid !== 'string' || mbid.trim().length === 0) {
      return res.status(400).json({ error: 'mbid가 잘못되었어요.' });
    }
    if (seenPositions.has(position)) {
      return res.status(400).json({ error: `중복된 position ${position}` });
    }
    const note =
      typeof noteRaw === 'string' && noteRaw.trim().length > 0
        ? noteRaw.trim().slice(0, 200)
        : null;
    seenPositions.add(position);
    normalised.push({ position, mbid: mbid.trim(), note });
  }

  const db = getDb();
  const findId = db.prepare(
    'SELECT id FROM albums WHERE mbid = ? OR slug = ?'
  );
  const resolved: Array<{ position: number; albumId: number; note: string | null }> = [];
  for (const it of normalised) {
    const row = findId.get(it.mbid, it.mbid) as { id: number } | undefined;
    if (!row) {
      return res.status(400).json({ error: `알 수 없는 앨범: ${it.mbid}` });
    }
    resolved.push({ position: it.position, albumId: row.id, note: it.note });
  }

  const tx = db.transaction((items: typeof resolved) => {
    db.prepare('DELETE FROM home_features').run();
    const insert = db.prepare(
      `INSERT INTO home_features (album_id, position, note)
       VALUES (?, ?, ?)`
    );
    for (const it of items) insert.run(it.albumId, it.position, it.note);
  });

  try {
    tx(resolved);
    // TEMP DEBUG — verify the rows are visible right after the
    // transaction returns. If this count mismatches resolved.length,
    // something is wrong with the transaction itself; if it matches
    // but the next GET still returns 0 we know the read path is the
    // problem.
    const postWriteCount = (queryGet(
      'SELECT COUNT(*) AS c FROM home_features'
    ) as { c: number } | null)?.c;
    const sample = queryAll(
      'SELECT position, album_id FROM home_features ORDER BY position LIMIT 5'
    );
    console.log(
      '[home/features PUT] tx complete, count(*) =',
      postWriteCount,
      'sample =',
      sample
    );
    res.json({ ok: true, count: resolved.length });
  } catch (err) {
    console.error('[home/features] replace failed:', err);
    res.status(500).json({ error: 'Feature Records 저장 실패' });
  }
});

export default router;
