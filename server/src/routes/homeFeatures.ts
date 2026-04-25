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
  // albums column is `artist_name`, not `artist` — alias to keep the
  // client payload field stable.
  const rows = queryAll(
    `SELECT hf.position, hf.note,
            a.mbid, a.slug, a.title,
            a.artist_name AS artist,
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

  const metaRow = queryGet(
    `SELECT theme, description,
            header_top_px AS headerTopPx,
            header_left_px AS headerLeftPx,
            header_rotation_deg AS headerRotationDeg
     FROM home_meta WHERE id = 1`
  ) as {
    theme: string | null;
    description: string | null;
    headerTopPx: number | null;
    headerLeftPx: number | null;
    headerRotationDeg: number | null;
  } | null;

  res.json({
    items,
    meta: {
      theme: metaRow?.theme ?? null,
      description: metaRow?.description ?? null,
      // Defaults match the originally-hardcoded constants from the
      // first header pass — return them when the column is null so
      // the client doesn't have to know the fallback values.
      headerTopPx: metaRow?.headerTopPx ?? -120,
      headerLeftPx: metaRow?.headerLeftPx ?? 4,
      headerRotationDeg: metaRow?.headerRotationDeg ?? -4,
    },
  });
});

router.patch('/home/meta', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as {
    theme?: unknown;
    description?: unknown;
    headerTopPx?: unknown;
    headerLeftPx?: unknown;
    headerRotationDeg?: unknown;
  };
  // Each field is treated as "don't touch" when missing rather than
  // "clear to null"; the editor only sends the fields that actually
  // changed (matches the mydig vinyl-wall/theme PATCH behaviour).
  const sets: string[] = [];
  const args: any[] = [];
  if ('theme' in body) {
    sets.push('theme = ?');
    args.push(
      typeof body.theme === 'string' ? body.theme.slice(0, 80) : null
    );
  }
  if ('description' in body) {
    sets.push('description = ?');
    args.push(
      typeof body.description === 'string'
        ? body.description.slice(0, 240)
        : null
    );
  }
  // Position knobs — clamped to a sensible range so a stray giant
  // value can't push the header into orbit, but wide enough that the
  // admin can move it freely within and around the wall area.
  const clampInt = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.max(min, Math.min(max, Math.round(v)));
  };
  if ('headerTopPx' in body) {
    const v = clampInt(body.headerTopPx, -800, 800);
    if (v === null) {
      return res.status(400).json({ error: 'headerTopPx는 정수여야 해요.' });
    }
    sets.push('header_top_px = ?');
    args.push(v);
  }
  if ('headerLeftPx' in body) {
    const v = clampInt(body.headerLeftPx, -800, 1200);
    if (v === null) {
      return res.status(400).json({ error: 'headerLeftPx는 정수여야 해요.' });
    }
    sets.push('header_left_px = ?');
    args.push(v);
  }
  if ('headerRotationDeg' in body) {
    const v = clampInt(body.headerRotationDeg, -45, 45);
    if (v === null) {
      return res.status(400).json({ error: 'headerRotationDeg는 정수(-45~45)여야 해요.' });
    }
    sets.push('header_rotation_deg = ?');
    args.push(v);
  }
  if (sets.length === 0) {
    return res.json({ ok: true });
  }
  sets.push("updated_at = datetime('now')");
  const db = getDb();
  db.prepare(
    `UPDATE home_meta SET ${sets.join(', ')} WHERE id = 1`
  ).run(...args);
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
    res.json({ ok: true, count: resolved.length });
  } catch (err) {
    console.error('[home/features] replace failed:', err);
    res.status(500).json({ error: 'Feature Records 저장 실패' });
  }
});

export default router;
