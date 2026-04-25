import { Router } from 'express';
import { getDb, queryAll } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

// Admin-curated 5-album rail shown on the home page above the main
// grid. Mirrors the mydig vinyl-wall data shape (album_id, position)
// minus the user_id — this is a single global rail, not per-user.
// Public GET; admin-only PUT for bulk replace.

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

  res.json({ items });
});

router.put('/home/features/items', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items array 필요' });
  }

  // Accepts mbid rather than DB albumId so the admin client can
  // pass results straight from /api/albums/search (which returns
  // mbid). Server resolves mbid → album_id under the hood; rejects
  // unknown mbids before the transaction starts.
  type Raw = { position: number; mbid: string; note: string | null };
  const normalised: Raw[] = [];
  const seenPositions = new Set<number>();
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') continue;
    const position = (raw as any).position;
    const mbid = (raw as any).mbid;
    const noteRaw = (raw as any).note;
    if (!Number.isInteger(position) || position < 0 || position >= 5) {
      return res.status(400).json({ error: `position은 0-4 정수여야 해요 (${position})` });
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
  const findId = db.prepare('SELECT id FROM albums WHERE mbid = ?');
  const resolved: Array<{ position: number; albumId: number; note: string | null }> = [];
  for (const it of normalised) {
    const row = findId.get(it.mbid) as { id: number } | undefined;
    if (!row) {
      return res.status(400).json({ error: `알 수 없는 mbid: ${it.mbid}` });
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
    res.json({ ok: true, count: resolved.length });
  } catch (err) {
    console.error('[home/features] replace failed:', err);
    res.status(500).json({ error: 'Feature Records 저장 실패' });
  }
});

export default router;
