import { Router } from 'express';
import { queryGet, queryAll, execute, getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

// Phase 3a skeleton — reads a user's mydig page by username.
// Returns empty-furniture state for every user right now; item
// population lands in 3b (Vinyl Wall), 3c (Shelf), 3d (Crate).
//
// Shape is designed so the client can render the full 4-layer
// layout on day one: `vinylWall` / `shelf` / `crates` arrays are
// always present but may be empty. Consumers iterate the FIXED
// slot counts (22 wall, 6 shelf) and render placeholder frames
// for positions that have no item yet.

interface ResolvedUser {
  id: number;
  username: string;
  display_name: string | null;
  name: string | null;
  email: string;
  avatar_url: string | null;
  custom_avatar_url: string | null;
  mydig_public: number | null;
  vinyl_wall_theme: string | null;
}

function resolveUserByUsername(username: string): ResolvedUser | null {
  return queryGet(
    `SELECT id, username, display_name, name, email, avatar_url,
            custom_avatar_url, mydig_public, vinyl_wall_theme
     FROM users
     WHERE LOWER(username) = LOWER(?)`,
    [username]
  ) as ResolvedUser | null;
}

// Sub-paths that must reach their dedicated handlers further down
// the file rather than be captured by :username. Without this
// guard, Express matches by registration order — GET /mydig/candidates
// hit this handler first with username="candidates" and returned 404,
// so the picker search silently failed. Listing them explicitly is
// more defensive than relying on file ordering; future routes can
// add themselves here.
const MYDIG_RESERVED_SUBPATHS = new Set(['candidates', 'vinyl-wall']);

router.get('/mydig/:username', (req, res, next) => {
  const raw = String(req.params.username || '').trim();
  if (!raw) return res.status(400).json({ error: '사용자명이 필요합니다.' });
  if (MYDIG_RESERVED_SUBPATHS.has(raw)) return next();

  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === user.id;
  const isPublic = user.mydig_public === null || user.mydig_public === 1;

  // Privacy gate — non-owners on a private page get a minimal
  // identity payload so the client can render the "under
  // construction" placeholder without crashing.
  if (!isPublic && !isOwner) {
    return res.json({
      user: {
        username: user.username,
        displayName: user.display_name || user.name,
        avatarUrl: user.custom_avatar_url || user.avatar_url,
        isOwner: false,
      },
      isPublic: false,
      vinylWall: [],
      shelf: [],
      crates: [],
    });
  }

  // Vinyl Wall — items by position. Server returns exactly what's
  // saved (no padding to 15); the client fills blanks when
  // rendering. Additionally LEFT JOINs user_reviews for the page
  // owner so each wall item can surface whether they've left a
  // comment on that album — client renders a small speech-bubble
  // badge on covers that have one. Joined user_review is the
  // owner's own (vinyl_wall_items.user_id matches user_reviews.
  // user_id), not the viewer's; the bubble tells visitors "fpp
  // wrote about this one" rather than "you wrote about this one."
  const wallRows = queryAll(
    `SELECT vwi.position, a.id AS album_id, a.mbid, a.slug, a.title,
            a.artist_name, a.release_date, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks,
            ur.emoji AS user_review_emoji,
            ur.body AS user_review_body
     FROM vinyl_wall_items vwi
     JOIN albums a ON a.id = vwi.album_id
     LEFT JOIN user_reviews ur
       ON ur.album_id = a.id AND ur.user_id = vwi.user_id
     WHERE vwi.user_id = ?
     ORDER BY vwi.position ASC`,
    [user.id]
  );

  // Shelf — up to 6 bins, each optionally typed to a genre, each
  // holding a flat list of albums in flip-through order.
  const shelfRows = queryAll(
    `SELECT ss.id AS slot_id, ss.position, ss.genre_id,
            g.slug AS genre_slug, g.name_ko AS genre_name_ko,
            g.name_en AS genre_name_en
     FROM shelf_slots ss
     LEFT JOIN genres g ON g.id = ss.genre_id
     WHERE ss.user_id = ?
     ORDER BY ss.position ASC`,
    [user.id]
  );
  const shelfItemsBySlot = new Map<number, any[]>();
  if (shelfRows.length > 0) {
    const slotIds = shelfRows.map((r: any) => r.slot_id);
    const placeholders = slotIds.map(() => '?').join(',');
    const items = queryAll(
      `SELECT si.slot_id, si.position, a.id AS album_id, a.mbid, a.slug,
              a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
       FROM shelf_items si
       JOIN albums a ON a.id = si.album_id
       WHERE si.slot_id IN (${placeholders})
       ORDER BY si.slot_id, si.position ASC`,
      slotIds
    );
    for (const item of items) {
      const existing = shelfItemsBySlot.get(item.slot_id);
      if (existing) existing.push(item);
      else shelfItemsBySlot.set(item.slot_id, [item]);
    }
  }

  // Crates — positions 0-5 are the front-page visible set; we
  // filter here so the placeholder row can just iterate whatever
  // we return. Extras (position >= 6) stay server-side.
  const crateRows = queryAll(
    `SELECT id AS crate_id, position, title, description
     FROM crate_boxes
     WHERE user_id = ? AND position < 6
     ORDER BY position ASC`,
    [user.id]
  );
  const crateItemsByCrate = new Map<number, any[]>();
  if (crateRows.length > 0) {
    const crateIds = crateRows.map((r: any) => r.crate_id);
    const placeholders = crateIds.map(() => '?').join(',');
    const items = queryAll(
      `SELECT ci.crate_id, ci.position, a.id AS album_id, a.mbid, a.slug,
              a.title, a.artist_name, a.cover_art_url, a.cover_art_fallbacks
       FROM crate_items ci
       JOIN albums a ON a.id = ci.album_id
       WHERE ci.crate_id IN (${placeholders})
       ORDER BY ci.crate_id, ci.position ASC`,
      crateIds
    );
    for (const item of items) {
      const existing = crateItemsByCrate.get(item.crate_id);
      if (existing) existing.push(item);
      else crateItemsByCrate.set(item.crate_id, [item]);
    }
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.name,
      avatarUrl: user.custom_avatar_url || user.avatar_url,
      isOwner,
    },
    isPublic,
    vinylWallTheme: user.vinyl_wall_theme,
    vinylWall: wallRows.map((r: any) => {
      // userReviewEmoji: the emoji the page owner picked for their
      // 50자 평 on this album, OR '💬' if they wrote one without an
      // emoji. Null if no review. Client uses this flag to conditionally
      // render the cartoon speech bubble on the cover.
      let userReviewEmoji: string | null = null;
      if (r.user_review_emoji) userReviewEmoji = String(r.user_review_emoji);
      else if (r.user_review_body) userReviewEmoji = '💬';
      return {
        position: r.position,
        album: {
          id: r.album_id,
          mbid: r.mbid,
          slug: r.slug,
          title: r.title,
          artist: r.artist_name,
          releaseDate: r.release_date,
          releaseYear: r.release_year,
          coverArtUrl: r.cover_art_url,
          coverArtFallbacks: r.cover_art_fallbacks
            ? JSON.parse(r.cover_art_fallbacks)
            : [],
        },
        userReviewEmoji,
      };
    }),
    shelf: shelfRows.map((r: any) => ({
      slotId: r.slot_id,
      position: r.position,
      genre: r.genre_id
        ? {
            id: r.genre_id,
            slug: r.genre_slug,
            nameKo: r.genre_name_ko,
            nameEn: r.genre_name_en,
          }
        : null,
      items: (shelfItemsBySlot.get(r.slot_id) ?? []).map((it: any) => ({
        position: it.position,
        album: {
          id: it.album_id,
          mbid: it.mbid,
          slug: it.slug,
          title: it.title,
          artist: it.artist_name,
          coverArtUrl: it.cover_art_url,
          coverArtFallbacks: it.cover_art_fallbacks
            ? JSON.parse(it.cover_art_fallbacks)
            : [],
        },
      })),
    })),
    crates: crateRows.map((r: any) => ({
      crateId: r.crate_id,
      position: r.position,
      title: r.title,
      description: r.description,
      items: (crateItemsByCrate.get(r.crate_id) ?? []).map((it: any) => ({
        position: it.position,
        album: {
          id: it.album_id,
          mbid: it.mbid,
          slug: it.slug,
          title: it.title,
          artist: it.artist_name,
          coverArtUrl: it.cover_art_url,
          coverArtFallbacks: it.cover_art_fallbacks
            ? JSON.parse(it.cover_art_fallbacks)
            : [],
        },
      })),
    })),
  });
});

// ─── PUT /api/mydig/vinyl-wall/items — bulk-replace wall placement ──────
//
// Single-shot save: client sends the full 22-slot state (array of
// { position, albumId } objects; missing positions are empty slots
// that get deleted), server wipes + reinserts in a transaction. This
// keeps edit-mode undo / reorder trivial on the client (mutate an
// in-memory array, submit when done) and makes the server API tiny.
// Duplicates (same album_id in multiple positions) are allowed per
// the Phase 3 principles — UNIQUE is only on (user_id, position).
// PATCH /api/mydig/vinyl-wall/theme — free-form title for the
// current wall. Null / empty string clears it (the client falls
// back to "my dig" on render when cleared).
router.patch('/mydig/vinyl-wall/theme', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as { theme?: unknown };
  let theme: string | null;
  if (body.theme === null || body.theme === undefined) {
    theme = null;
  } else if (typeof body.theme === 'string') {
    const trimmed = body.theme.trim().slice(0, 80);
    theme = trimmed.length > 0 ? trimmed : null;
  } else {
    return res.status(400).json({ error: 'theme은 문자열 또는 null이어야 해요.' });
  }
  try {
    execute(`UPDATE users SET vinyl_wall_theme = ? WHERE id = ?`, [theme, me.id]);
    res.json({ ok: true, theme });
  } catch (err) {
    console.error('[mydig/theme] patch failed:', err);
    res.status(500).json({ error: '테마 저장 실패' });
  }
});

router.put('/mydig/vinyl-wall/items', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items array 필요' });
  }

  // Validate shape + constraints before touching the DB.
  const normalised: Array<{ position: number; albumId: number }> = [];
  const seenPositions = new Set<number>();
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') continue;
    const position = (raw as any).position;
    const albumId = (raw as any).albumId;
    if (!Number.isInteger(position) || position < 0 || position >= 15) {
      return res.status(400).json({ error: `position은 0-14 정수여야 해요 (${position})` });
    }
    if (!Number.isInteger(albumId) || albumId <= 0) {
      return res.status(400).json({ error: 'albumId가 잘못되었어요.' });
    }
    if (seenPositions.has(position)) {
      return res.status(400).json({ error: `중복된 position ${position}` });
    }
    seenPositions.add(position);
    normalised.push({ position, albumId });
  }

  const db = getDb();
  const tx = db.transaction((items: typeof normalised) => {
    db.prepare(`DELETE FROM vinyl_wall_items WHERE user_id = ?`).run(me.id);
    const insert = db.prepare(
      `INSERT INTO vinyl_wall_items (user_id, album_id, position)
       VALUES (?, ?, ?)`
    );
    for (const it of items) insert.run(me.id, it.albumId, it.position);
  });

  try {
    tx(normalised);
    res.json({ ok: true, count: normalised.length });
  } catch (err) {
    console.error('[mydig/wall] replace failed:', err);
    res.status(500).json({ error: 'Vinyl Wall 저장 실패' });
  }
});

// ─── GET /api/mydig/candidates — edit-mode picker source ────────────────
//
// Searches the full albums table (not 샀음-filtered — mydig is
// identity expression, not inventory per CLAUDE.md). Optional tab
// switches:
//   - source=all         → full DB
//   - source=collection  → albums the user marked 샀음
//   - source=wantlist    → albums the user marked 살거
//   - source=crate       → albums in any of the user's own crates
// Query `q` is fuzzy match on title+artist. Limited to 30 to keep
// the picker responsive.
router.get('/mydig/candidates', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const source = String(req.query.source || 'all');
  const q = String(req.query.q || '').trim();
  const pattern = q ? `%${q.toLowerCase()}%` : null;

  const selectClause = `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name,
                               a.release_date, a.release_year,
                               a.cover_art_url, a.cover_art_fallbacks`;
  const searchFilter = pattern
    ? `(LOWER(a.title) LIKE ? OR LOWER(a.artist_name) LIKE ?)`
    : null;
  const limitClause = `ORDER BY a.id DESC LIMIT 30`;

  try {
    let rows: any[] = [];
    if (source === 'collection') {
      // Distinct because a user may own multiple formats of the same
      // album (vinyl + CD, etc.) and each is a separate collections row.
      const where = ['c.user_id = ?'];
      const params: any[] = [me.id];
      if (searchFilter) {
        where.push(searchFilter);
        params.push(pattern, pattern);
      }
      rows = queryAll(
        `${selectClause}
         FROM albums a
         JOIN collections c ON c.album_id = a.id
         WHERE ${where.join(' AND ')}
         GROUP BY a.id
         ${limitClause}`,
        params
      );
    } else if (source === 'wantlist') {
      const where = ['w.user_id = ?'];
      const params: any[] = [me.id];
      if (searchFilter) {
        where.push(searchFilter);
        params.push(pattern, pattern);
      }
      rows = queryAll(
        `${selectClause}
         FROM albums a
         JOIN wants w ON w.album_id = a.id
         WHERE ${where.join(' AND ')}
         GROUP BY a.id
         ${limitClause}`,
        params
      );
    } else if (source === 'crate') {
      const where = ['cb.user_id = ?'];
      const params: any[] = [me.id];
      if (searchFilter) {
        where.push(searchFilter);
        params.push(pattern, pattern);
      }
      rows = queryAll(
        `${selectClause}
         FROM albums a
         JOIN crate_items ci ON ci.album_id = a.id
         JOIN crate_boxes cb ON cb.id = ci.crate_id
         WHERE ${where.join(' AND ')}
         GROUP BY a.id
         ${limitClause}`,
        params
      );
    } else {
      // Default: search across the full catalog.
      const where: string[] = [];
      const params: any[] = [];
      if (searchFilter) {
        where.push(searchFilter);
        params.push(pattern, pattern);
      }
      rows = queryAll(
        `${selectClause}
         FROM albums a
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ${limitClause}`,
        params
      );
    }

    res.json({
      albums: rows.map((r: any) => ({
        id: r.id,
        mbid: r.mbid,
        slug: r.slug,
        title: r.title,
        artist: r.artist_name,
        releaseYear: r.release_year,
        coverArtUrl: r.cover_art_url,
        coverArtFallbacks: r.cover_art_fallbacks ? JSON.parse(r.cover_art_fallbacks) : [],
      })),
    });
  } catch (err) {
    console.error('[mydig/candidates] failed:', err);
    res.status(500).json({ error: '후보 검색 실패' });
  }
});

// ─── Vinyl-wall snapshots ─────────────────────────────────────
//
// Archive copies of the wall at a moment in time. Owner creates
// one from the current wall; each snapshot is either private
// (owner-only) or public (visitors see it in the list and can
// open /my/:username/snap/:slug). Snapshots preserve the album
// references as they were when captured — albums that get
// deleted later render as empty slots on the snapshot, not
// re-written history.

function todayDateSlug(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Sanitise a name into a URL-friendly slug. Keeps a-z/0-9/Hangul/
// hyphens/underscores, collapses whitespace to hyphens, strips
// everything else. If the result is empty (name was all removed
// characters) falls back to today's date so we always have
// something deterministic.
function slugifyName(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const normalised = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_ᄀ-ᇿ㄰-㆏가-힯]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalised.slice(0, 40) || todayDateSlug();
}

// Resolve a collision-free slug for (user_id, slug). Tries the
// plain slug first, then slug-2 / slug-3 / ... up to a sane cap.
function resolveSnapshotSlug(db: ReturnType<typeof getDb>, userId: number, base: string): string {
  const check = db.prepare(
    `SELECT 1 FROM vinyl_wall_snapshots WHERE user_id = ? AND slug = ?`
  );
  if (!check.get(userId, base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!check.get(userId, candidate)) return candidate;
  }
  // Beyond 1000 snapshots on the same base slug we just append a
  // timestamp shard — should never happen in practice but the
  // loop needs a terminator.
  return `${base}-${Date.now().toString(36)}`;
}

// POST /api/mydig/vinyl-wall/snapshots — capture current wall
// as a snapshot. Name is optional (defaults to today's date);
// isPublic defaults to false.
router.post('/mydig/vinyl-wall/snapshots', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as { name?: unknown; isPublic?: unknown };

  // Name: trim + cap at 60 chars. Fall back to today's date.
  let name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 60) name = name.slice(0, 60);
  if (!name) name = todayDateSlug();
  const isPublic = body.isPublic === true ? 1 : 0;
  const baseSlug = slugifyName(name);

  const db = getDb();
  try {
    const slug = resolveSnapshotSlug(db, me.id, baseSlug);

    const tx = db.transaction(() => {
      const snapStmt = db.prepare(
        `INSERT INTO vinyl_wall_snapshots (user_id, slug, name, is_public) VALUES (?, ?, ?, ?)`
      );
      const snapInfo = snapStmt.run(me.id, slug, name, isPublic);
      const snapId = snapInfo.lastInsertRowid as number;

      const currentItems = db.prepare(
        `SELECT album_id, position FROM vinyl_wall_items WHERE user_id = ? ORDER BY position`
      ).all(me.id) as Array<{ album_id: number; position: number }>;

      if (currentItems.length > 0) {
        const itemStmt = db.prepare(
          `INSERT INTO vinyl_wall_snapshot_items (snapshot_id, album_id, position) VALUES (?, ?, ?)`
        );
        for (const it of currentItems) itemStmt.run(snapId, it.album_id, it.position);
      }

      return { snapId, itemCount: currentItems.length };
    });

    const { snapId, itemCount } = tx();
    res.status(201).json({
      id: snapId,
      slug,
      name,
      isPublic: isPublic === 1,
      itemCount,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[mydig/snapshots] create failed:', err);
    res.status(500).json({ error: '스냅샷 저장 실패' });
  }
});

// PATCH /api/mydig/vinyl-wall/snapshots/:id — rename / toggle
// public. Owner-only. Slug stays immutable once created so
// existing URLs don't break.
router.patch('/mydig/vinyl-wall/snapshots/:id', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid snapshot id' });
  }
  const body = (req.body ?? {}) as { name?: unknown; isPublic?: unknown };

  const existing = queryGet(
    `SELECT id, user_id, name, is_public FROM vinyl_wall_snapshots WHERE id = ?`,
    [id]
  );
  if (!existing) return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  if (existing.user_id !== me.id) {
    return res.status(403).json({ error: '권한이 없어요.' });
  }

  const patches: string[] = [];
  const values: any[] = [];
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: '이름은 비어있을 수 없어요.' });
    patches.push('name = ?');
    values.push(name);
  }
  if (typeof body.isPublic === 'boolean') {
    patches.push('is_public = ?');
    values.push(body.isPublic ? 1 : 0);
  }
  if (patches.length === 0) {
    return res.status(400).json({ error: '변경사항이 없어요.' });
  }
  values.push(id);

  try {
    execute(
      `UPDATE vinyl_wall_snapshots SET ${patches.join(', ')} WHERE id = ?`,
      values
    );
    const updated = queryGet(
      `SELECT id, slug, name, is_public AS isPublic, created_at AS createdAt FROM vinyl_wall_snapshots WHERE id = ?`,
      [id]
    );
    res.json({
      ...updated,
      isPublic: updated.isPublic === 1,
    });
  } catch (err) {
    console.error('[mydig/snapshots] patch failed:', err);
    res.status(500).json({ error: '스냅샷 수정 실패' });
  }
});

// DELETE /api/mydig/vinyl-wall/snapshots/:id — owner-only.
router.delete('/mydig/vinyl-wall/snapshots/:id', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid snapshot id' });
  }
  const existing = queryGet(
    `SELECT user_id FROM vinyl_wall_snapshots WHERE id = ?`,
    [id]
  );
  if (!existing) return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  if (existing.user_id !== me.id) {
    return res.status(403).json({ error: '권한이 없어요.' });
  }
  try {
    execute(`DELETE FROM vinyl_wall_snapshots WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[mydig/snapshots] delete failed:', err);
    res.status(500).json({ error: '스냅샷 삭제 실패' });
  }
});

// GET /api/mydig/:username/snapshots — list. Owner sees all
// (private + public); visitors see only public. Lightweight
// rollup per row — item count instead of the full item list,
// the detail endpoint below fills that in on demand.
router.get('/mydig/:username/snapshots', (req, res) => {
  const raw = String(req.params.username || '').trim();
  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === user.id;
  const mydigPublic = user.mydig_public === null || user.mydig_public === 1;
  if (!isOwner && !mydigPublic) {
    // Whole page is private — don't reveal that there are any
    // snapshots either.
    return res.json({ snapshots: [] });
  }

  const whereVis = isOwner ? '' : ' AND is_public = 1';
  const rows = queryAll(
    `SELECT s.id, s.slug, s.name, s.is_public AS isPublic, s.created_at AS createdAt,
            (SELECT COUNT(*) FROM vinyl_wall_snapshot_items i WHERE i.snapshot_id = s.id) AS itemCount
     FROM vinyl_wall_snapshots s
     WHERE s.user_id = ?${whereVis}
     ORDER BY s.created_at DESC, s.id DESC`,
    [user.id]
  ) as Array<any>;
  res.json({
    snapshots: rows.map((r) => ({ ...r, isPublic: r.isPublic === 1 })),
  });
});

// GET /api/mydig/:username/snapshots/:slug — full snapshot
// detail with joined album metadata. Visitor access gated by
// both mydig_public and is_public.
router.get('/mydig/:username/snapshots/:slug', (req, res) => {
  const raw = String(req.params.username || '').trim();
  const slug = String(req.params.slug || '').trim();
  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === user.id;
  const mydigPublic = user.mydig_public === null || user.mydig_public === 1;

  const snap = queryGet(
    `SELECT id, slug, name, is_public AS isPublic, created_at AS createdAt
     FROM vinyl_wall_snapshots WHERE user_id = ? AND slug = ?`,
    [user.id, slug]
  );
  if (!snap) return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  if (!isOwner && (!mydigPublic || snap.isPublic !== 1)) {
    return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  }

  const items = queryAll(
    `SELECT i.position, a.id AS album_id, a.mbid, a.slug AS album_slug,
            a.title, a.artist_name AS artist,
            a.release_date AS releaseDate, a.release_year AS releaseYear,
            a.cover_art_url AS coverArtUrl, a.cover_art_fallbacks AS coverArtFallbacks
     FROM vinyl_wall_snapshot_items i
     LEFT JOIN albums a ON a.id = i.album_id
     WHERE i.snapshot_id = ?
     ORDER BY i.position`,
    [snap.id]
  ) as Array<any>;

  res.json({
    snapshot: {
      id: snap.id,
      slug: snap.slug,
      name: snap.name,
      isPublic: snap.isPublic === 1,
      createdAt: snap.createdAt,
    },
    user: {
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.custom_avatar_url ?? user.avatar_url,
      isOwner,
    },
    items: items.map((r) => ({
      position: r.position,
      // album may be null if it was deleted after the snapshot was taken
      album: r.album_id
        ? {
            id: r.album_id,
            mbid: r.mbid,
            slug: r.album_slug,
            title: r.title,
            artist: r.artist,
            releaseDate: r.releaseDate,
            releaseYear: r.releaseYear,
            coverArtUrl: r.coverArtUrl,
            coverArtFallbacks: r.coverArtFallbacks ? JSON.parse(r.coverArtFallbacks) : [],
          }
        : null,
    })),
  });
});

export default router;
