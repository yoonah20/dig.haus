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
}

function resolveUserByUsername(username: string): ResolvedUser | null {
  return queryGet(
    `SELECT id, username, display_name, name, email, avatar_url,
            custom_avatar_url, mydig_public
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

  // Vinyl Wall — up to 22 items by position. Server returns
  // exactly what's saved (no padding to 22); the client is
  // responsible for filling blanks when rendering the 5-5-6-6
  // grid, so reorder / delete animations don't need server
  // round trips.
  const wallRows = queryAll(
    `SELECT vwi.position, a.id AS album_id, a.mbid, a.slug, a.title,
            a.artist_name, a.release_date, a.release_year,
            a.cover_art_url, a.cover_art_fallbacks
     FROM vinyl_wall_items vwi
     JOIN albums a ON a.id = vwi.album_id
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
    vinylWall: wallRows.map((r: any) => ({
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
    })),
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

export default router;
