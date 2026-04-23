import { Router } from 'express';
import { execute, queryAll, queryGet } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';

// Phase 3 social layer — "follow" is a one-way "I want to keep an
// eye on this digger" edge. No mutual / friend semantics, no
// activity feed yet (Phase 4). The endpoints here just maintain
// the user_follows table and expose enough data for the follow
// button, the followers/following lists on a profile, and the
// per-viewer "am I following?" flag the popover + mydig header
// need to render their CTA state.

const router = Router();

// POST /api/users/:id/follow — auth required. Idempotent (INSERT
// OR IGNORE on the PK (follower_id, followee_id)), so a retry or
// a double-click is a no-op. Self-follows are rejected both in JS
// and by the table CHECK constraint.
router.post('/users/:id/follow', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const followeeId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(followeeId) || followeeId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (followeeId === me.id) {
    return res.status(400).json({ error: '자기 자신은 팔로우할 수 없어요.' });
  }
  const exists = queryGet(
    `SELECT 1 AS ok FROM users WHERE id = ?`,
    [followeeId]
  );
  if (!exists) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });
  try {
    execute(
      `INSERT OR IGNORE INTO user_follows (follower_id, followee_id)
       VALUES (?, ?)`,
      [me.id, followeeId]
    );
    res.json({ ok: true, following: true });
  } catch (err: any) {
    console.error('[follows] insert failed:', err);
    res.status(500).json({ error: `팔로우 실패: ${err?.message ?? 'unknown'}` });
  }
});

// DELETE /api/users/:id/follow — auth required, idempotent
// (DELETE of a non-existent row just affects 0).
router.delete('/users/:id/follow', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const followeeId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(followeeId) || followeeId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  try {
    execute(
      `DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`,
      [me.id, followeeId]
    );
    res.json({ ok: true, following: false });
  } catch (err: any) {
    console.error('[follows] delete failed:', err);
    res.status(500).json({ error: `언팔로우 실패: ${err?.message ?? 'unknown'}` });
  }
});

// Shared SELECT + mapper for follower/following lists. Returns the
// profile shape the client card / hover row needs to render a
// row: id, username, displayName, avatarUrl, plus the viewer-side
// isFollowing flag so the list can show its own follow buttons
// without a second request per row.
function listProfiles(
  rows: any[],
  viewerId: number | null
): Array<{
  id: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followingByViewer: boolean;
}> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as number);
  const followingSet = new Set<number>();
  if (viewerId) {
    const placeholders = ids.map(() => '?').join(',');
    const hits = queryAll(
      `SELECT followee_id FROM user_follows
       WHERE follower_id = ? AND followee_id IN (${placeholders})`,
      [viewerId, ...ids]
    ) as Array<{ followee_id: number }>;
    for (const h of hits) followingSet.add(h.followee_id);
  }
  return rows.map((r) => ({
    id: r.id,
    username: r.username ?? null,
    displayName: r.display_name || r.name || null,
    avatarUrl: r.custom_avatar_url || r.avatar_url || null,
    followingByViewer: followingSet.has(r.id),
  }));
}

// GET /api/users/:id/followers — who follows this user. Viewer
// sees the list + their own follow state per row. Count is also
// returned so the profile header can render "팔로워 42" without
// a second call.
router.get('/users/:id/followers', (req, res) => {
  const targetId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const viewer = req.user as AppUser | undefined;
  const rows = queryAll(
    `SELECT u.id, u.username, u.display_name, u.name,
            u.custom_avatar_url, u.avatar_url, f.created_at
     FROM user_follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.followee_id = ?
     ORDER BY f.created_at DESC, f.follower_id DESC`,
    [targetId]
  ) as Array<any>;
  res.json({
    count: rows.length,
    users: listProfiles(rows, viewer?.id ?? null),
  });
});

// GET /api/users/:id/following — who this user follows.
router.get('/users/:id/following', (req, res) => {
  const targetId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const viewer = req.user as AppUser | undefined;
  const rows = queryAll(
    `SELECT u.id, u.username, u.display_name, u.name,
            u.custom_avatar_url, u.avatar_url, f.created_at
     FROM user_follows f
     JOIN users u ON u.id = f.followee_id
     WHERE f.follower_id = ?
     ORDER BY f.created_at DESC, f.followee_id DESC`,
    [targetId]
  ) as Array<any>;
  res.json({
    count: rows.length,
    users: listProfiles(rows, viewer?.id ?? null),
  });
});

export default router;
