import { Router } from 'express';
import { queryAll, queryGet, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';

// Local copy of the username → user lookup used in routes/mydig.ts.
// Kept inline to avoid extracting a shared helper just for two
// callers; if a third surface needs this, hoist into utils/username.
function resolveUserByUsername(username: string): { id: number; username: string } | null {
  const row = queryGet(
    `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)`,
    [username]
  ) as { id: number; username: string } | null;
  return row;
}

// Crate CRUD — user-named, unlimited-capacity containers replacing
// the legacy collections + wants tables (post-Phase 3 roadmap item 2).
//
// Auth model:
//   - Mutations require ownership (user can only modify their own
//     crates).
//   - Reads on `GET /api/mydig/users/:username/crates` honour the
//     per-crate is_public flag for non-owner viewers; the owner sees
//     all their crates regardless.
//   - The "is this album in any of my crates?" lookup at
//     `GET /api/mydig/crates/album-membership/:albumId` is owner-
//     scoped and powers the 담기 button on /album/:slug.

const router = Router();

const CRATE_TITLE_MAX = 60;
const CRATE_DESC_MAX = 240;

interface CrateRow {
  id: number;
  user_id: number;
  position: number;
  title: string;
  description: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

// Cover thumbnails for the crate-list card. Up to 4 most recently
// added covers, used as a small stacked preview alongside the
// title and item count.
function coverThumbsForCrate(crateId: number): Array<{
  url: string | null;
  fallbacks: string[];
}> {
  const rows = queryAll(
    `SELECT a.cover_art_url, a.cover_art_fallbacks
     FROM crate_items ci
     JOIN albums a ON a.id = ci.album_id
     WHERE ci.crate_id = ?
     ORDER BY ci.created_at DESC
     LIMIT 4`,
    [crateId]
  ) as Array<{ cover_art_url: string | null; cover_art_fallbacks: string | null }>;
  return rows.map((r) => ({
    url: r.cover_art_url,
    fallbacks: r.cover_art_fallbacks
      ? (() => {
          try {
            return JSON.parse(r.cover_art_fallbacks);
          } catch {
            return [];
          }
        })()
      : [],
  }));
}

function serialiseCrate(row: CrateRow, viewerCanSeeCount = true) {
  const itemCount = viewerCanSeeCount
    ? (queryGet(
        `SELECT COUNT(*) AS c FROM crate_items WHERE crate_id = ?`,
        [row.id]
      )?.c as number) || 0
    : 0;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isPublic: !!row.is_public,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount,
    coverThumbs: coverThumbsForCrate(row.id),
  };
}

// ─── GET /api/mydig/crates — current user's crates ──────────────
//
// Owner-scoped list. Visitors see another user's crates via the
// public `/api/mydig/users/:username/crates` endpoint below.
router.get('/mydig/crates', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const rows = queryAll(
    `SELECT * FROM crate_boxes WHERE user_id = ? ORDER BY position ASC, id ASC`,
    [me.id]
  ) as CrateRow[];
  res.json({
    crates: rows.map((r) => serialiseCrate(r)),
  });
});

// ─── GET /api/mydig/users/:username/crates — public list ───────
//
// Visitor view. Filters to is_public = 1 unless the viewer is the
// owner of the requested mydig.
router.get('/mydig/users/:username/crates', (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  const target = resolveUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'not found' });
  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === target.id;
  const rows = queryAll(
    isOwner
      ? `SELECT * FROM crate_boxes WHERE user_id = ? ORDER BY position ASC, id ASC`
      : `SELECT * FROM crate_boxes WHERE user_id = ? AND is_public = 1 ORDER BY position ASC, id ASC`,
    [target.id]
  ) as CrateRow[];
  res.json({
    crates: rows.map((r) => serialiseCrate(r)),
  });
});

// ─── POST /api/mydig/crates — create ────────────────────────────
router.post('/mydig/crates', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: '제목을 입력해 주세요.' });
  if (title.length > CRATE_TITLE_MAX) {
    return res.status(400).json({ error: `제목은 ${CRATE_TITLE_MAX}자 이내` });
  }
  const description = req.body?.description != null
    ? String(req.body.description).trim().slice(0, CRATE_DESC_MAX) || null
    : null;
  const isPublic = req.body?.isPublic === true ? 1 : 0;

  const nextPos = (queryGet(
    `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM crate_boxes WHERE user_id = ?`,
    [me.id]
  )?.p as number) ?? 0;

  try {
    const result = execute(
      `INSERT INTO crate_boxes (user_id, position, title, description, is_public)
       VALUES (?, ?, ?, ?, ?)`,
      [me.id, nextPos, title, description, isPublic]
    );
    const row = queryGet(
      `SELECT * FROM crate_boxes WHERE id = ?`,
      [result.lastInsertRowid]
    ) as CrateRow;
    res.status(201).json({ crate: serialiseCrate(row) });
  } catch (err) {
    console.error('[crates] create failed:', err);
    res.status(500).json({ error: '상자 만들기 실패' });
  }
});

// Helper: load + ownership-check a crate. Returns null and writes
// the appropriate error response if the crate doesn't exist or the
// caller doesn't own it.
function loadOwnCrate(req: any, res: any): CrateRow | null {
  const me = req.user as AppUser;
  const id = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return null;
  }
  const row = queryGet(
    `SELECT * FROM crate_boxes WHERE id = ?`,
    [id]
  ) as CrateRow | null;
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return null;
  }
  if (row.user_id !== me.id) {
    res.status(403).json({ error: 'not yours' });
    return null;
  }
  return row;
}

// ─── GET /api/mydig/crates/:id — detail (items grid) ───────────
//
// Public if the crate is_public = 1, otherwise owner-only.
router.get('/mydig/crates/:id', (req, res) => {
  const id = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const row = queryGet(
    `SELECT * FROM crate_boxes WHERE id = ?`,
    [id]
  ) as CrateRow | null;
  if (!row) return res.status(404).json({ error: 'not found' });
  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === row.user_id;
  if (!isOwner && row.is_public !== 1) {
    return res.status(404).json({ error: 'not found' });
  }
  const items = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks, ci.created_at AS added_at
     FROM crate_items ci
     JOIN albums a ON a.id = ci.album_id
     WHERE ci.crate_id = ?
     ORDER BY ci.created_at DESC`,
    [row.id]
  ) as Array<{
    id: number;
    mbid: string;
    slug: string | null;
    title: string;
    artist_name: string;
    release_year: number | null;
    cover_art_url: string | null;
    cover_art_fallbacks: string | null;
    added_at: string;
  }>;
  res.json({
    crate: serialiseCrate(row),
    isOwner,
    items: items.map((a) => ({
      id: a.id,
      mbid: a.mbid,
      slug: a.slug,
      title: a.title,
      artist: a.artist_name,
      releaseYear: a.release_year,
      coverArtUrl: a.cover_art_url,
      coverArtFallbacks: a.cover_art_fallbacks
        ? (() => {
            try {
              return JSON.parse(a.cover_art_fallbacks);
            } catch {
              return [];
            }
          })()
        : [],
      addedAt: a.added_at,
    })),
  });
});

// ─── PATCH /api/mydig/crates/:id — rename / describe / toggle public
router.patch('/mydig/crates/:id', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  const updates: string[] = [];
  const params: any[] = [];
  if (req.body?.title != null) {
    const title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: '제목을 비울 수 없어요.' });
    if (title.length > CRATE_TITLE_MAX) {
      return res.status(400).json({ error: `제목은 ${CRATE_TITLE_MAX}자 이내` });
    }
    updates.push('title = ?');
    params.push(title);
  }
  if (req.body?.description !== undefined) {
    const desc = req.body.description == null
      ? null
      : String(req.body.description).trim().slice(0, CRATE_DESC_MAX) || null;
    updates.push('description = ?');
    params.push(desc);
  }
  if (req.body?.isPublic !== undefined) {
    updates.push('is_public = ?');
    params.push(req.body.isPublic === true ? 1 : 0);
  }
  if (!updates.length) {
    return res.json({ crate: serialiseCrate(row) });
  }
  updates.push(`updated_at = datetime('now')`);
  params.push(row.id);
  execute(`UPDATE crate_boxes SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = queryGet(
    `SELECT * FROM crate_boxes WHERE id = ?`,
    [row.id]
  ) as CrateRow;
  res.json({ crate: serialiseCrate(updated) });
});

// ─── DELETE /api/mydig/crates/:id ───────────────────────────────
//
// crate_items.crate_id has ON DELETE CASCADE so item rows are
// removed automatically.
router.delete('/mydig/crates/:id', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  execute(`DELETE FROM crate_boxes WHERE id = ?`, [row.id]);
  res.json({ ok: true });
});

// ─── POST /api/mydig/crates/:id/items — add album ──────────────
//
// Idempotent via UNIQUE(crate_id, album_id). Repeat hits return
// the existing item row.
router.post('/mydig/crates/:id/items', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  const albumId = parseInt(String(req.body?.albumId), 10);
  if (!Number.isFinite(albumId)) {
    return res.status(400).json({ error: 'albumId required' });
  }
  const album = queryGet(`SELECT id FROM albums WHERE id = ?`, [albumId]);
  if (!album) return res.status(404).json({ error: 'album not found' });

  execute(
    `INSERT OR IGNORE INTO crate_items (crate_id, album_id) VALUES (?, ?)`,
    [row.id, albumId]
  );
  // Bump the crate's updated_at so list views can sort by recency.
  execute(
    `UPDATE crate_boxes SET updated_at = datetime('now') WHERE id = ?`,
    [row.id]
  );
  res.json({ ok: true });
});

// ─── DELETE /api/mydig/crates/:id/items/:albumId ───────────────
router.delete('/mydig/crates/:id/items/:albumId', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  const albumId = parseInt(String(req.params.albumId), 10);
  if (!Number.isFinite(albumId)) {
    return res.status(400).json({ error: 'invalid albumId' });
  }
  execute(
    `DELETE FROM crate_items WHERE crate_id = ? AND album_id = ?`,
    [row.id, albumId]
  );
  execute(
    `UPDATE crate_boxes SET updated_at = datetime('now') WHERE id = ?`,
    [row.id]
  );
  res.json({ ok: true });
});

// ─── GET /api/mydig/crates/album-membership/:albumId ──────────
//
// Returns the IDs of the caller's crates that contain the given
// album, plus the count of distinct users who have it in any
// public crate. Drives the 담기 button: a checkmark on each crate
// the album is already in, and the public count next to the chip.
router.get('/mydig/crates/album-membership/:albumId', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const albumId = parseInt(String(req.params.albumId), 10);
  if (!Number.isFinite(albumId)) {
    return res.status(400).json({ error: 'invalid albumId' });
  }
  const rows = queryAll(
    `SELECT cb.id
     FROM crate_items ci
     JOIN crate_boxes cb ON cb.id = ci.crate_id
     WHERE cb.user_id = ? AND ci.album_id = ?`,
    [me.id, albumId]
  ) as Array<{ id: number }>;
  res.json({ crateIds: rows.map((r) => r.id) });
});

export default router;
