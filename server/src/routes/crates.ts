import { Router } from 'express';
import { queryAll, queryGet, execute, transaction } from '../db/index.js';
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
  is_default: number;
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
    isDefault: !!row.is_default,
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

// ─── PUT /api/mydig/crates/order — bulk reorder ────────────────
//
// Body: { orderedIds: number[] } — every crate the caller owns,
// in the new display order. Position 0 = leftmost in the bar (the
// crate that opens by default for visitors). Two-phase update in a
// transaction: first bump every position to a negative offset so
// the UNIQUE(user_id, position) constraint can't trip on midway
// collisions, then re-assign 0..n-1.
router.put('/mydig/crates/order', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds : null;
  if (!ids) return res.status(400).json({ error: 'orderedIds required' });
  const parsed = ids
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
    .filter((v) => !Number.isNaN(v));
  if (parsed.length !== ids.length) {
    return res.status(400).json({ error: 'orderedIds must be all numbers' });
  }

  // Caller must own every crate in the list. Mismatched count
  // catches both "id belongs to someone else" and "id was deleted
  // between fetch and reorder."
  const placeholders = parsed.map(() => '?').join(',');
  const owned = queryAll(
    `SELECT id FROM crate_boxes WHERE id IN (${placeholders}) AND user_id = ?`,
    [...parsed, me.id]
  ) as Array<{ id: number }>;
  if (owned.length !== parsed.length) {
    return res.status(403).json({ error: '본인 상자들만 정렬할 수 있어요.' });
  }

  try {
    transaction(() => {
      // Phase 1: shove every targeted row to a negative position so
      // the UNIQUE(user_id, position) constraint can't collide mid-
      // update. Use id as the negative offset (always unique per
      // user since id is the table-wide PK).
      for (const id of parsed) {
        execute(
          `UPDATE crate_boxes SET position = -id WHERE id = ? AND user_id = ?`,
          [id, me.id]
        );
      }
      // Phase 2: reassign 0..n-1 in the requested order.
      parsed.forEach((id, idx) => {
        execute(
          `UPDATE crate_boxes SET position = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [idx, id, me.id]
        );
      });
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[crates] reorder failed:', err);
    res.status(500).json({ error: '정렬 저장 실패' });
  }
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
  // Public-by-default — the mydig redesign (2026-05-17) makes crates
  // the primary identity surface so visibility is the natural default.
  // Owner explicitly sets isPublic: false to opt a crate private.
  const isPublic = req.body?.isPublic === false ? 0 : 1;

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
  // Floor displays at most FLOOR_CAP items — the most recently added
  // ones. Older items remain in the crate (count is still in
  // crate.itemCount so the client can render a "+N장 더" overflow
  // badge). Cap dropped from 30 → 20 on 2026-05-17 per operator
  // feedback that the carpet starts to feel crowded past 20.
  const FLOOR_CAP = 20;
  const items = queryAll(
    `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks,
            ci.position_x, ci.position_y, ci.rotation,
            ci.created_at AS added_at,
            ur.body AS owner_review_body,
            ur.emoji AS owner_review_emoji
     FROM crate_items ci
     JOIN albums a ON a.id = ci.album_id
     LEFT JOIN user_reviews ur
       ON ur.album_id = ci.album_id AND ur.user_id = ?
     WHERE ci.crate_id = ?
     ORDER BY ci.created_at DESC
     LIMIT ?`,
    [row.user_id, row.id, FLOOR_CAP]
  ) as Array<{
    id: number;
    mbid: string;
    slug: string | null;
    title: string;
    artist_name: string;
    release_year: number | null;
    cover_art_url: string | null;
    cover_art_fallbacks: string | null;
    position_x: number | null;
    position_y: number | null;
    rotation: number | null;
    added_at: string;
    owner_review_body: string | null;
    owner_review_emoji: string | null;
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
      // Normalised floor coordinates [0, 1] × [0, 1]. NULL = "not yet
      // placed, let the client lay it out via the default flow."
      positionX: a.position_x,
      positionY: a.position_y,
      rotation: a.rotation,
      addedAt: a.added_at,
      // Owner's 50자 평 on this album, if any — surfaced in the
      // floor hover label so the cover can carry the owner's own
      // line about it. NULL when the owner hasn't written one.
      ownerReview: a.owner_review_body
        ? {
            body: String(a.owner_review_body),
            emoji: a.owner_review_emoji ? String(a.owner_review_emoji) : null,
          }
        : null,
    })),
  });
});

// ─── PATCH /api/mydig/crates/:id/items/:albumId/layout — owner drag
//
// Persists a single record's floor coordinates after the owner drags
// it on the mydig floor. All three fields optional individually but
// at least one must be present. Coordinates are in normalised [0, 1]
// floor units so the layout survives viewport resize. Rotation is in
// degrees, no constraint (client clamps to a sensible range).
router.patch('/mydig/crates/:id/items/:albumId/layout', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  const albumId = parseInt(String(req.params.albumId || ''), 10);
  if (!Number.isFinite(albumId)) return res.status(400).json({ error: 'invalid albumId' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const params: any[] = [];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const x = num(body.positionX);
  const y = num(body.positionY);
  const r = num(body.rotation);
  if (x !== null) { sets.push('position_x = ?'); params.push(x); }
  if (y !== null) { sets.push('position_y = ?'); params.push(y); }
  if (r !== null) { sets.push('rotation = ?'); params.push(r); }
  if (sets.length === 0) return res.status(400).json({ error: 'no layout fields supplied' });

  params.push(row.id, albumId);
  const result = execute(
    `UPDATE crate_items SET ${sets.join(', ')} WHERE crate_id = ? AND album_id = ?`,
    params
  );
  if (result.changes === 0) return res.status(404).json({ error: 'item not in crate' });
  res.json({ ok: true });
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
    // Default crates (굿굿 / 별루) have fixed titles — the vote
    // auto-sync layer keys off title to find the right crate.
    // Description and isPublic stay freely editable.
    if (row.is_default && title !== row.title) {
      return res.status(403).json({ error: '기본 상자는 이름을 바꿀 수 없어요.' });
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
// removed automatically. Default crates (굿굿 / 별루) are locked —
// owner can hide them via isPublic but not delete.
router.delete('/mydig/crates/:id', requireAuth, (req, res) => {
  const row = loadOwnCrate(req, res);
  if (!row) return;
  if (row.is_default) {
    return res.status(403).json({ error: '기본 상자는 삭제할 수 없어요.' });
  }
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

// ─── Guestbook (방명록) — per-crate comments ──────────────────
//
// Visitor leaves a top-level note; the crate owner can reply (single
// thread depth — reply.parent_id points at the top-level row, replies
// can't have replies). Body capped at 500 chars. Read access mirrors
// the crate's is_public flag; write access requires auth, with the
// reply restriction enforced here.

const COMMENT_BODY_MAX = 500;

interface CommentRow {
  id: number;
  crate_id: number;
  user_id: number;
  parent_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  custom_avatar_url: string | null;
}

function serialiseComment(row: CommentRow, crateOwnerId: number) {
  return {
    id: row.id,
    parentId: row.parent_id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatarUrl: row.custom_avatar_url || row.avatar_url,
      isCrateOwner: row.user_id === crateOwnerId,
    },
  };
}

// GET — public if crate is_public, else owner-only. Returns flat list
// ordered by created_at ASC; client groups by parent_id.
router.get('/mydig/crates/:id/comments', (req, res) => {
  const id = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const crate = queryGet(
    `SELECT id, user_id, is_public FROM crate_boxes WHERE id = ?`,
    [id]
  ) as { id: number; user_id: number; is_public: number } | null;
  if (!crate) return res.status(404).json({ error: 'not found' });
  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === crate.user_id;
  if (!isOwner && crate.is_public !== 1) {
    return res.status(404).json({ error: 'not found' });
  }
  const rows = queryAll(
    `SELECT cc.id, cc.crate_id, cc.user_id, cc.parent_id, cc.body,
            cc.created_at, cc.updated_at,
            u.username, u.display_name, u.avatar_url, u.custom_avatar_url
     FROM crate_comments cc
     JOIN users u ON u.id = cc.user_id
     WHERE cc.crate_id = ?
     ORDER BY cc.created_at ASC`,
    [id]
  ) as CommentRow[];
  res.json({ comments: rows.map((r) => serialiseComment(r, crate.user_id)) });
});

// POST — top-level note or owner reply. Body required, capped at
// COMMENT_BODY_MAX chars. parent_id (optional) must reference a
// top-level row in the same crate AND the caller must be the crate
// owner — otherwise visitors could spoof "owner replies."
router.post('/mydig/crates/:id/comments', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const id = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const crate = queryGet(
    `SELECT id, user_id, is_public FROM crate_boxes WHERE id = ?`,
    [id]
  ) as { id: number; user_id: number; is_public: number } | null;
  if (!crate) return res.status(404).json({ error: 'not found' });
  const isOwner = me.id === crate.user_id;
  if (!isOwner && crate.is_public !== 1) {
    return res.status(404).json({ error: 'not found' });
  }
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: '내용을 입력해 주세요.' });
  if (body.length > COMMENT_BODY_MAX) {
    return res.status(400).json({ error: `${COMMENT_BODY_MAX}자 이내로 적어주세요.` });
  }
  let parentId: number | null = null;
  if (req.body?.parentId != null) {
    const p = parseInt(String(req.body.parentId), 10);
    if (!Number.isFinite(p)) return res.status(400).json({ error: 'invalid parentId' });
    // Reply rules: parent must exist in this crate AND be top-level
    // (no nested threading) AND caller must be the crate owner.
    if (!isOwner) {
      return res.status(403).json({ error: '답글은 상자 주인만 달 수 있어요.' });
    }
    const parent = queryGet(
      `SELECT id, parent_id FROM crate_comments WHERE id = ? AND crate_id = ?`,
      [p, id]
    ) as { id: number; parent_id: number | null } | null;
    if (!parent) return res.status(404).json({ error: '원댓글을 찾을 수 없어요.' });
    if (parent.parent_id != null) {
      return res.status(400).json({ error: '답글의 답글은 안 돼요.' });
    }
    parentId = p;
  }
  const result = execute(
    `INSERT INTO crate_comments (crate_id, user_id, parent_id, body)
     VALUES (?, ?, ?, ?)`,
    [id, me.id, parentId, body]
  );
  const row = queryGet(
    `SELECT cc.id, cc.crate_id, cc.user_id, cc.parent_id, cc.body,
            cc.created_at, cc.updated_at,
            u.username, u.display_name, u.avatar_url, u.custom_avatar_url
     FROM crate_comments cc
     JOIN users u ON u.id = cc.user_id
     WHERE cc.id = ?`,
    [result.lastInsertRowid]
  ) as CommentRow;
  res.status(201).json({ comment: serialiseComment(row, crate.user_id) });
});

// DELETE — caller must be the comment author OR the crate owner.
// CASCADE on parent_id self-ref drops the replies along with a
// top-level deletion.
router.delete('/mydig/crates/:id/comments/:commentId', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const crateId = parseInt(String(req.params.id || ''), 10);
  const commentId = parseInt(String(req.params.commentId || ''), 10);
  if (!Number.isFinite(crateId) || !Number.isFinite(commentId)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const crate = queryGet(
    `SELECT id, user_id FROM crate_boxes WHERE id = ?`,
    [crateId]
  ) as { id: number; user_id: number } | null;
  if (!crate) return res.status(404).json({ error: 'not found' });
  const comment = queryGet(
    `SELECT id, user_id FROM crate_comments WHERE id = ? AND crate_id = ?`,
    [commentId, crateId]
  ) as { id: number; user_id: number } | null;
  if (!comment) return res.status(404).json({ error: 'not found' });
  if (comment.user_id !== me.id && crate.user_id !== me.id) {
    return res.status(403).json({ error: '삭제 권한이 없어요.' });
  }
  execute(`DELETE FROM crate_comments WHERE id = ?`, [commentId]);
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
