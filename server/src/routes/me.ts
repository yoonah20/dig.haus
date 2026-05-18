import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { queryGet, queryAll, execute, transaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { hostAvatarFromBuffer, AvatarError, AVATARS_DIR, AVATARS_ROUTE } from '../services/avatarHost.js';
import { USERNAME_RE, RESERVED_USERNAMES } from '../utils/username.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

// 5 MB limit; reject non-images at the multer layer. Sharp still validates.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(null, false);
  },
});

const DISPLAY_NAME_MAX = 20;
const INSTAGRAM_MAX = 30;
const INSTAGRAM_RE = /^[a-zA-Z0-9._]+$/;

function normalizeDisplayName(raw: unknown): string | null | 'invalid' {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'invalid';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > DISPLAY_NAME_MAX) return 'invalid';
  return trimmed;
}

function normalizeInstagram(raw: unknown): string | null | 'invalid' {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'invalid';
  const stripped = raw.trim().replace(/^@+/, '');
  if (!stripped) return null;
  if (stripped.length > INSTAGRAM_MAX) return 'invalid';
  if (!INSTAGRAM_RE.test(stripped)) return 'invalid';
  return stripped;
}

function effectiveUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name || row.name,
    avatarUrl: row.custom_avatar_url || row.avatar_url,
    googleName: row.name,
    googleAvatarUrl: row.avatar_url,
    displayName: row.display_name,
    customAvatarUrl: row.custom_avatar_url,
    instagramHandle: row.instagram_handle,
    mydigUsername: row.username ?? null,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };
}

// ─── GET /api/me/profile — self profile + content counts ──────────────────

router.get('/me/profile', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const row = queryGet(`SELECT * FROM users WHERE id = ?`, [me.id]);
  if (!row) return res.status(404).json({ error: 'User not found' });

  const reviewCount = queryGet(
    `SELECT COUNT(*) AS c FROM user_reviews WHERE user_id = ?`,
    [me.id]
  )?.c || 0;
  const votes = queryGet(
    `SELECT
       SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down
     FROM album_votes WHERE user_id = ?`,
    [me.id]
  );
  const up = votes?.up || 0;
  const down = votes?.down || 0;

  res.json({
    user: effectiveUser(row),
    stats: { reviewCount, upvoteCount: up, downvoteCount: down },
  });
});

// ─── PATCH /api/me/profile — display_name + instagram_handle ──────────────

// Allowlist mapping API field → DB column. Drives both the validators
// dispatch and the UPDATE assembly below; nothing else in this handler
// composes a column name from request data, so a future field add can
// only land by extending this object — closes off accidental dynamic
// column injection if a contributor copies the dispatcher pattern.
const PROFILE_FIELD_MAP = {
  displayName: { column: 'display_name', normalize: normalizeDisplayName, errorMessage: `표시 이름은 ${DISPLAY_NAME_MAX}자 이내의 문자열이어야 합니다.` },
  instagramHandle: { column: 'instagram_handle', normalize: normalizeInstagram, errorMessage: `Instagram 핸들은 영문/숫자/점/밑줄만 사용해 ${INSTAGRAM_MAX}자 이내로 입력해주세요.` },
} as const;

router.patch('/me/profile', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Array<{ column: string; value: string | null }> = [];

  for (const [apiField, spec] of Object.entries(PROFILE_FIELD_MAP)) {
    if (!(apiField in body)) continue;
    const v = spec.normalize(body[apiField]);
    if (v === 'invalid') {
      return res.status(400).json({ error: spec.errorMessage });
    }
    updates.push({ column: spec.column, value: v });
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const sets = updates.map((u) => `${u.column} = ?`).join(', ');
  const values = [...updates.map((u) => u.value), me.id];
  execute(`UPDATE users SET ${sets} WHERE id = ?`, values);

  const row = queryGet(`SELECT * FROM users WHERE id = ?`, [me.id]);
  res.json({ user: effectiveUser(row) });
});

// ─── PATCH /api/me/username — set or change the mydig URL slug ────────────
//
// Used by the mydig onboarding modal on first /my/* visit when the
// user hasn't claimed a username yet, and by the profile page for
// later changes. Validation mirrors the CLAUDE.md spec: lowercase
// a-z0-9 with _ and -, 3-20 chars, not-already-taken. The partial
// unique index on LOWER(username) added in the 3a schema enforces
// case-insensitive uniqueness at the DB level — we check up front
// here for a friendlier error. USERNAME_RE + RESERVED_USERNAMES come
// from utils/username.ts so the OAuth upsert, the legacy-email
// rewrite migration, and this endpoint share one source of truth.

router.patch('/me/username', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const raw = (req.body ?? {}).username;
  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'username 이 필요합니다.' });
  }
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: '영문 소문자/숫자로 3-20자, 하이픈/밑줄만 허용돼요. (시작과 끝은 영숫자)',
    });
  }
  if (RESERVED_USERNAMES.has(username)) {
    return res.status(409).json({ error: '이 이름은 예약돼 있어서 사용할 수 없어요.' });
  }

  // Uniqueness check — excluding the current user so they can
  // rename to their own existing value (no-op save) without collision.
  const conflict = queryGet(
    `SELECT id FROM users WHERE LOWER(username) = ? AND id != ?`,
    [username, me.id]
  );
  if (conflict) {
    return res.status(409).json({ error: '이미 사용 중인 이름이에요.' });
  }

  try {
    execute(`UPDATE users SET username = ? WHERE id = ?`, [username, me.id]);
    res.json({ ok: true, username });
  } catch (err) {
    console.error('[me/username] update failed:', err);
    res.status(500).json({ error: '저장에 실패했어요.' });
  }
});

// ─── POST /api/me/avatar — upload (multipart) ─────────────────────────────

router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  const me = req.user as AppUser;
  const file = (req as any).file as { buffer: Buffer; size: number } | undefined;
  if (!file || !file.buffer || !file.buffer.length) {
    return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
  }

  try {
    const publicUrl = await hostAvatarFromBuffer(me.id, file.buffer);
    execute(`UPDATE users SET custom_avatar_url = ? WHERE id = ?`, [publicUrl, me.id]);
    const row = queryGet(`SELECT * FROM users WHERE id = ?`, [me.id]);
    res.json({ user: effectiveUser(row) });
  } catch (err) {
    if (err instanceof AvatarError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[me/avatar] upload failed:', err);
    res.status(500).json({ error: '아바타 저장에 실패했습니다.' });
  }
});

// ─── DELETE /api/me/avatar — revert to Google default ─────────────────────

router.delete('/me/avatar', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  execute(`UPDATE users SET custom_avatar_url = NULL WHERE id = ?`, [me.id]);
  const row = queryGet(`SELECT * FROM users WHERE id = ?`, [me.id]);
  res.json({ user: effectiveUser(row) });
});

// ─── GET /api/me/reviews — all my 50자 평 across albums ───────────────────

router.get('/me/reviews', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const rows = queryAll(
    `SELECT ur.id, ur.body, ur.emoji, ur.rating, ur.created_at, ur.updated_at,
            a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            a.cover_art_url AS album_cover, a.cover_art_fallbacks AS album_cover_fallbacks
     FROM user_reviews ur
     LEFT JOIN albums a ON a.id = ur.album_id
     WHERE ur.user_id = ?
     ORDER BY ur.updated_at DESC, ur.id DESC`,
    [me.id]
  );
  res.json({
    reviews: rows.map((r: any) => ({
      id: r.id,
      body: r.body,
      emoji: r.emoji,
      rating: r.rating,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      albumSlug: r.album_slug || r.album_mbid,
      albumTitle: r.album_title,
      albumArtist: r.album_artist,
      albumCoverUrl: r.album_cover,
      albumCoverFallbacks: r.album_cover_fallbacks
        ? (() => {
            try {
              return JSON.parse(r.album_cover_fallbacks);
            } catch {
              return [];
            }
          })()
        : [],
    })),
  });
});

// ─── GET /api/me/upvotes — albums I've 굿굿'd ─────────────────────────────
// ─── GET /api/me/downvotes — albums I've 별루'd ───────────────────────────
//
// Both routes share one handler builder — they differ only by vote
// direction and response key. The profile page renders both lists so a
// user can see *which* albums fed their 굿굿 / 별루 totals, not just the
// counts on the activity card.

function makeVoteListHandler(direction: 'up' | 'down', responseKey: 'upvotes' | 'downvotes') {
  return (req: any, res: any) => {
    const me = req.user as AppUser;
    const rows = queryAll(
      `SELECT a.id, a.slug, a.mbid, a.title, a.artist_name,
              a.cover_art_url, a.cover_art_fallbacks,
              v.created_at AS voted_at
       FROM album_votes v
       JOIN albums a ON a.id = v.album_id
       WHERE v.user_id = ? AND v.vote = ?
       ORDER BY v.created_at DESC, v.id DESC`,
      [me.id, direction]
    );
    res.json({
      [responseKey]: rows.map((a: any) => ({
        slug: a.slug || a.mbid,
        title: a.title,
        artist: a.artist_name,
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
        votedAt: a.voted_at,
      })),
    });
  };
}

router.get('/me/upvotes', requireAuth, makeVoteListHandler('up', 'upvotes'));
router.get('/me/downvotes', requireAuth, makeVoteListHandler('down', 'downvotes'));

// ─── GET /api/me/collection — albums I own ────────────────────────────────
//
// Grouped by album so each title appears once even if the user marked
// multiple formats (vinyl + CD etc.); `formats` carries the set.
// /me/collection and /me/wantlist were removed when collections and
// wants were absorbed into crates (2026-04-28). Profile + crate UIs
// now read from /api/mydig/crates instead — the 샀음/살거 distinction
// is no longer first-class, so a unified crate listing replaces both
// endpoints.

// ─── DELETE /api/me — hard-delete account ─────────────────────────────────
//
// Removes the user account but preserves their public contributions:
//   user_reviews.user_id → NULL (ON DELETE SET NULL) — 50자 평 stays
//   album_votes.user_id  → NULL (ON DELETE SET NULL) — 굿굿/별루 stays
//   purchase_links.user_id, album_dna.added_by_user_id → NULLed
//     (album-level content contributed by the user)
//
//   wishlists, dig_journal_posts → deleted explicitly
//   crate_boxes (+ crate_items via ON DELETE CASCADE) → deleted via
//     the user delete cascade
//
// The anonymised rows surface as "탈퇴한 사용자" on the client. Also
// removes the uploaded avatar file from disk if any.

router.delete('/me', requireAuth, (req, res) => {
  const me = req.user as AppUser;

  // Look up the custom avatar path BEFORE the delete so we can unlink the
  // webp file after the DB rows go away.
  const row = queryGet(
    `SELECT custom_avatar_url FROM users WHERE id = ?`,
    [me.id]
  ) as { custom_avatar_url: string | null } | null;

  try {
    transaction(() => {
      // Private library items — not public, safe to remove.
      execute(`DELETE FROM wishlists WHERE user_id = ?`, [me.id]);
      execute(`DELETE FROM dig_journal_posts WHERE user_id = ?`, [me.id]);
      // Public album-level content contributed by the user — anonymise.
      execute(`UPDATE purchase_links SET user_id = NULL WHERE user_id = ?`, [me.id]);
      execute(`UPDATE album_dna SET added_by_user_id = NULL WHERE added_by_user_id = ?`, [me.id]);
      // user_reviews / album_votes are anonymised automatically via
      // ON DELETE SET NULL when we drop the users row below.
      execute(`DELETE FROM users WHERE id = ?`, [me.id]);
    });
  } catch (err) {
    console.error('[me] account deletion failed:', err);
    return res.status(500).json({ error: '계정 탈퇴에 실패했습니다.' });
  }

  // Best-effort avatar file cleanup — don't fail the request if this errors.
  if (row?.custom_avatar_url?.startsWith(`${AVATARS_ROUTE}/`)) {
    const filename = row.custom_avatar_url.slice(AVATARS_ROUTE.length + 1);
    // Defensive: reject any filename that tries to escape the dir.
    if (filename && !filename.includes('/') && !filename.includes('..')) {
      const filePath = path.join(AVATARS_DIR, filename);
      fs.promises.unlink(filePath).catch(() => {});
    }
  }

  // Kill the session so the client doesn't stay 'logged in' against a
  // now-nonexistent user row.
  req.logout((logoutErr) => {
    if (logoutErr) {
      // Session destroy can technically fail after the DB delete. Log it
      // and still return success — the user is already gone.
      console.warn('[me] session logout after delete failed:', logoutErr);
    }
    req.session?.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });
});

// ─── GET /api/users/:id/public — popover card data ────────────────────────
//
// No auth — the card shows publicly visible profile bits. Mounted in the
// same router for convenience; see index.ts.

router.get('/users/:id/public', (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const row = queryGet(
    `SELECT id, display_name, name, custom_avatar_url, avatar_url,
            instagram_handle, created_at,
            username, vinyl_wall_theme
     FROM users WHERE id = ?`,
    [id]
  );
  if (!row) return res.status(404).json({ error: 'User not found' });

  const reviewCount = queryGet(
    `SELECT COUNT(*) AS c FROM user_reviews WHERE user_id = ?`,
    [id]
  )?.c || 0;
  const votes = queryGet(
    `SELECT
       SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down
     FROM album_votes WHERE user_id = ?`,
    [id]
  );
  const up = votes?.up || 0;
  const down = votes?.down || 0;
  const total = up + down;

  // Collection-feature counts — how many distinct albums this user
  // owns / wants (DISTINCT so someone with vinyl + CD of the same
  // title counts as one title, not two).
  // Distinct albums across ALL of the user's crates — replaces the
  // separate ownedCount / wantedCount that came from collections +
  // wants pre-2026-04-28. The hover card now surfaces a single
  // "총 N장 담음" stat instead of the previous 샀음 / 살거 split.
  const crateAlbumCount =
    queryGet(
      `SELECT COUNT(DISTINCT ci.album_id) AS c
       FROM crate_items ci
       JOIN crate_boxes cb ON cb.id = ci.crate_id
       WHERE cb.user_id = ?`,
      [id]
    )?.c || 0;
  const crateCount =
    queryGet(
      `SELECT COUNT(*) AS c FROM crate_boxes WHERE user_id = ?`,
      [id]
    )?.c || 0;

  // mydig block. Only populated when the user has claimed a username;
  // the hover card uses that as the gate to decide whether to show a
  // mydig row at all. wallItemCount drives the "공사 중" label client-
  // side — a wall with zero items (regardless of privacy flag) reads
  // as unfinished; any wall with ≥1 item shows its theme title.
  const mydig = row.username
    ? {
        username: row.username as string,
        theme: (row.vinyl_wall_theme as string | null) || null,
        wallItemCount:
          queryGet(
            `SELECT COUNT(*) AS c FROM vinyl_wall_items WHERE user_id = ?`,
            [id]
          )?.c || 0,
      }
    : null;

  // Follow graph — total counts both ways plus the viewer's own
  // "am I following this user?" flag so the hover card can render
  // its follow button without a second request. Viewer == null
  // (anon) short-circuits to false.
  const followerCount =
    queryGet(
      `SELECT COUNT(*) AS c FROM user_follows WHERE followee_id = ?`,
      [id]
    )?.c || 0;
  const followingCount =
    queryGet(
      `SELECT COUNT(*) AS c FROM user_follows WHERE follower_id = ?`,
      [id]
    )?.c || 0;
  const viewer = req.user as { id?: number } | undefined;
  const followingByViewer = viewer?.id
    ? !!queryGet(
        `SELECT 1 AS ok FROM user_follows
         WHERE follower_id = ? AND followee_id = ?`,
        [viewer.id, id]
      )
    : false;

  res.json({
    user: {
      id: row.id,
      name: row.display_name || row.name,
      avatarUrl: row.custom_avatar_url || row.avatar_url,
      instagramHandle: row.instagram_handle,
      createdAt: row.created_at,
    },
    mydig,
    stats: {
      reviewCount,
      upvoteCount: up,
      downvoteCount: down,
      upvotePct: total > 0 ? Math.round((up / total) * 100) : null,
      downvotePct: total > 0 ? Math.round((down / total) * 100) : null,
      crateAlbumCount,
      crateCount,
      followerCount,
      followingCount,
    },
    followingByViewer,
  });
});

export default router;
