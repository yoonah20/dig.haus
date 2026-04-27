import { Router } from 'express';
import { queryGet, queryAll, execute, getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';
import { ensureCoverDominantColor } from '../utils/coverColor.js';
import { ensureAlbumPreview } from '../utils/albumPreview.js';
import {
  loadCoverDataUrl,
  renderToasterPng,
  type ToasterSlot,
} from '../services/toasterRenderer.js';

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
  vinyl_wall_theme: string | null;
  vinyl_wall_description: string | null;
}

function resolveUserByUsername(username: string): ResolvedUser | null {
  return queryGet(
    `SELECT id, username, display_name, name, email, avatar_url,
            custom_avatar_url, vinyl_wall_theme,
            vinyl_wall_description
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
            a.cover_dominant_color, a.spotify_url,
            a.preview_track_url, a.preview_track_name, a.preview_lookup_at,
            ur.emoji AS user_review_emoji,
            ur.body AS user_review_body,
            ur.rating AS user_review_rating
     FROM vinyl_wall_items vwi
     JOIN albums a ON a.id = vwi.album_id
     LEFT JOIN user_reviews ur
       ON ur.album_id = a.id AND ur.user_id = vwi.user_id
     WHERE vwi.user_id = ?
     ORDER BY vwi.position ASC`,
    [user.id]
  );

  // Fire-and-forget enrichments for any wall album that hasn't
  // been hydrated yet. Two parallel tracks:
  //   - dominant colour (tints the hover vinyl disc)
  //   - Spotify preview URL (powers the hover play chip)
  // Both short-circuit via their own DB checks + in-process
  // de-dupe, so calling them every request is cheap once the
  // data is populated. First render sees nulls; next fetch
  // carries the values.
  for (const r of wallRows as any[]) {
    if (!r.cover_dominant_color && (r.cover_art_url || r.spotify_url)) {
      void ensureCoverDominantColor(
        r.album_id,
        r.cover_art_url,
        r.spotify_url ?? null
      );
    }
    if (!r.preview_track_url && r.spotify_url) {
      void ensureAlbumPreview(r.album_id, r.spotify_url);
    }
  }

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
    vinylWallTheme: user.vinyl_wall_theme,
    vinylWallDescription: user.vinyl_wall_description,
    vinylWall: wallRows.map((r: any) => {
      // userReview: whatever 50자 평 the page owner wrote for this
      // album. Null when there's no review. Client shows the body
      // in a hover-only speech bubble; the bubble no longer
      // surfaces by default. Emoji is carried separately so the
      // client can prepend it inside the bubble.
      const userReview =
        r.user_review_body
          ? {
              body: String(r.user_review_body),
              emoji: r.user_review_emoji ? String(r.user_review_emoji) : null,
              rating: r.user_review_rating ? String(r.user_review_rating) : null,
            }
          : null;
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
          coverDominantColor: r.cover_dominant_color ?? null,
          spotifyUrl: r.spotify_url ?? null,
          previewTrackUrl: r.preview_track_url ?? null,
          previewTrackName: r.preview_track_name ?? null,
        },
        userReview,
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
  const body = (req.body ?? {}) as { theme?: unknown; description?: unknown };

  // Theme (one-line h1 title). null/undefined = no change. Empty
  // string from the client is treated as "clear back to default".
  let themePatch: { value: string | null } | null = null;
  if (body.theme !== undefined) {
    if (body.theme === null) {
      themePatch = { value: null };
    } else if (typeof body.theme === 'string') {
      const trimmed = body.theme.trim().slice(0, 80);
      themePatch = { value: trimmed.length > 0 ? trimmed : null };
    } else {
      return res.status(400).json({ error: 'theme은 문자열 또는 null이어야 해요.' });
    }
  }

  // Description (longer subtitle). Same null-or-string rules,
  // wider cap because this is a sentence of context, not a
  // label.
  let descriptionPatch: { value: string | null } | null = null;
  if (body.description !== undefined) {
    if (body.description === null) {
      descriptionPatch = { value: null };
    } else if (typeof body.description === 'string') {
      const trimmed = body.description.trim().slice(0, 240);
      descriptionPatch = { value: trimmed.length > 0 ? trimmed : null };
    } else {
      return res
        .status(400)
        .json({ error: 'description은 문자열 또는 null이어야 해요.' });
    }
  }

  if (!themePatch && !descriptionPatch) {
    return res.status(400).json({ error: '변경사항이 없어요.' });
  }

  try {
    const sets: string[] = [];
    const values: any[] = [];
    if (themePatch) {
      sets.push('vinyl_wall_theme = ?');
      values.push(themePatch.value);
    }
    if (descriptionPatch) {
      sets.push('vinyl_wall_description = ?');
      values.push(descriptionPatch.value);
    }
    values.push(me.id);
    execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
    res.json({
      ok: true,
      theme: themePatch?.value,
      description: descriptionPatch?.value,
    });
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
  const LIMIT = 30;
  // Offset for infinite-scroll pagination. Capped at a big-enough
  // ceiling so a malformed client can't paginate forever.
  const rawOffset = parseInt(String(req.query.offset || '0'), 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0
    ? Math.min(rawOffset, 10_000)
    : 0;

  const selectClause = `SELECT a.id, a.mbid, a.slug, a.title, a.artist_name,
                               a.release_date, a.release_year,
                               a.cover_art_url, a.cover_art_fallbacks`;
  const searchFilter = pattern
    ? `(LOWER(a.title) LIKE ? OR LOWER(a.artist_name) LIKE ?)`
    : null;
  // a.id DESC == registration-recent first (AUTOINCREMENT PK is
  // monotonic with insertion). Users find what they just added at
  // the top of the picker. Release-date ordering would bury newly
  // registered older albums — bad for the "add-then-place" flow.
  const limitClause = `ORDER BY a.id DESC LIMIT ${LIMIT} OFFSET ${offset}`;

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
    } else if (source === 'upvote') {
      // Albums the user marked 굿굿. Mirror of 'collection' but
      // against album_votes with vote='up'. GROUP BY a.id is a
      // no-op here (album_votes has UNIQUE(user_id, album_id)) but
      // kept for consistency with the other source branches.
      const where = ['v.user_id = ?', "v.vote = 'up'"];
      const params: any[] = [me.id];
      if (searchFilter) {
        where.push(searchFilter);
        params.push(pattern, pattern);
      }
      rows = queryAll(
        `${selectClause}
         FROM albums a
         JOIN album_votes v ON v.album_id = a.id
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

    // `nextOffset` is the value the client should send as ?offset
    // on the next page fetch — null signals "no more results" so
    // the infinite-scroll hook can stop asking. We assume more
    // pages remain whenever the current page came back full.
    const nextOffset = rows.length === LIMIT ? offset + LIMIT : null;
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
      nextOffset,
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

// POST /api/mydig/vinyl-wall/snapshots — capture a wall state as
// a snapshot. Name is optional (defaults to today's date);
// isPublic defaults to false.
//
// By default the snapshot mirrors the owner's live wall. When the
// editor wants to save an in-flight draft (e.g. a "scratch" wall
// the owner built without committing to the live wall yet), it
// can pass `items: [{ position, albumId }, …]` in the body and the
// snapshot will capture that arrangement instead of reading from
// vinyl_wall_items. Positions outside 0..14 and unknown album ids
// are filtered out server-side so a bad client can't land garbage
// rows.
router.post('/mydig/vinyl-wall/snapshots', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const body = (req.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    isPublic?: unknown;
    items?: unknown;
  };

  // Name: trim + cap at 60 chars. Fall back to today's date.
  let name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 60) name = name.slice(0, 60);
  if (!name) name = todayDateSlug();
  // Description: trim + cap at 240 chars (same as live wall). Empty
  // string collapses to null so the renderer can skip the subtitle.
  let description: string | null = null;
  if (typeof body.description === 'string') {
    const trimmed = body.description.trim().slice(0, 240);
    description = trimmed.length > 0 ? trimmed : null;
  }
  const isPublic = body.isPublic === true ? 1 : 0;
  const baseSlug = slugifyName(name);

  // Draft items, if supplied. Validated as the same shape the wall
  // PUT endpoint accepts — a trust-but-verify pass so we don't
  // insert rows with invalid positions or non-integer album ids.
  let draftItems: Array<{ position: number; album_id: number }> | null = null;
  if (Array.isArray(body.items)) {
    const cleaned: Array<{ position: number; album_id: number }> = [];
    for (const raw of body.items) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const position = Number(rec.position);
      const albumId = Number(rec.albumId);
      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position >= 15 ||
        !Number.isInteger(albumId) ||
        albumId <= 0
      ) {
        continue;
      }
      cleaned.push({ position, album_id: albumId });
    }
    draftItems = cleaned;
  }

  const db = getDb();
  try {
    const slug = resolveSnapshotSlug(db, me.id, baseSlug);

    const tx = db.transaction(() => {
      const snapStmt = db.prepare(
        `INSERT INTO vinyl_wall_snapshots (user_id, slug, name, description, is_public) VALUES (?, ?, ?, ?, ?)`
      );
      const snapInfo = snapStmt.run(me.id, slug, name, description, isPublic);
      const snapId = snapInfo.lastInsertRowid as number;

      // Source the items from the supplied draft when one was sent;
      // otherwise read the live wall. Either way it's a flat list
      // of { position, album_id } rows we insert in order.
      const sourceItems: Array<{ album_id: number; position: number }> =
        draftItems !== null
          ? draftItems
          : (db
              .prepare(
                `SELECT album_id, position FROM vinyl_wall_items WHERE user_id = ? ORDER BY position`
              )
              .all(me.id) as Array<{ album_id: number; position: number }>);

      if (sourceItems.length > 0) {
        const itemStmt = db.prepare(
          `INSERT INTO vinyl_wall_snapshot_items (snapshot_id, album_id, position) VALUES (?, ?, ?)`
        );
        for (const it of sourceItems) itemStmt.run(snapId, it.album_id, it.position);
      }

      return { snapId, itemCount: sourceItems.length };
    });

    const { snapId, itemCount } = tx();
    res.status(201).json({
      id: snapId,
      slug,
      name,
      description,
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
  const body = (req.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    isPublic?: unknown;
  };

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
  // description: string → trimmed/capped (empty collapses to null),
  // null → explicit clear, undefined → leave alone. Matches the
  // wall-theme PATCH semantics so clients can reuse the same
  // "only send what changed" pattern.
  if (body.description !== undefined) {
    if (body.description === null) {
      patches.push('description = ?');
      values.push(null);
    } else if (typeof body.description === 'string') {
      const trimmed = body.description.trim().slice(0, 240);
      patches.push('description = ?');
      values.push(trimmed.length > 0 ? trimmed : null);
    } else {
      return res.status(400).json({
        error: 'description은 문자열 또는 null이어야 해요.',
      });
    }
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
      `SELECT id, slug, name, description, is_public AS isPublic, created_at AS createdAt FROM vinyl_wall_snapshots WHERE id = ?`,
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

// PUT /api/mydig/vinyl-wall/snapshots/:id/items — owner-only. Bulk
// replace a snapshot's item list, same validation + transaction
// shape as the live-wall PUT. Used when the owner re-opens a
// saved snapshot and rearranges it from the edit surface.
router.put('/mydig/vinyl-wall/snapshots/:id/items', requireAuth, (req, res) => {
  const me = req.user as AppUser;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid snapshot id' });
  }
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items array 필요' });
  }

  const snap = queryGet(
    `SELECT user_id FROM vinyl_wall_snapshots WHERE id = ?`,
    [id]
  );
  if (!snap) return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  if (snap.user_id !== me.id) {
    return res.status(403).json({ error: '권한이 없어요.' });
  }

  // Same validation pass as the live-wall PUT — refuse anything out
  // of 0..14 range or duplicate positions so the snapshot can't end
  // up in a shape the renderer doesn't expect.
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
    db.prepare(
      `DELETE FROM vinyl_wall_snapshot_items WHERE snapshot_id = ?`
    ).run(id);
    const insert = db.prepare(
      `INSERT INTO vinyl_wall_snapshot_items (snapshot_id, album_id, position)
       VALUES (?, ?, ?)`
    );
    for (const it of items) insert.run(id, it.albumId, it.position);
  });

  try {
    tx(normalised);
    res.json({ ok: true, count: normalised.length });
  } catch (err) {
    console.error('[mydig/snapshots] items replace failed:', err);
    res.status(500).json({ error: '스냅샷 저장 실패' });
  }
});

// DELETE /api/mydig/vinyl-wall/snapshots/:id — owner OR admin.
// Admins can prune other users' snapshots (e.g. abandoned / off-
// topic public ones surfacing in the home feed) without owning
// the wall. Other snapshot mutations (rename, items replace,
// visibility toggle) stay owner-only — admin moderation is delete
// only for now.
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
  if (existing.user_id !== me.id && !me.is_admin) {
    return res.status(403).json({ error: '권한이 없어요.' });
  }
  try {
    execute(`DELETE FROM vinyl_wall_snapshots WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err: any) {
    // Surface the sqlite error text in the response so the client
    // alert carries the actual reason (e.g. FK constraint,
    // missing-column after a partial migration). Kept behind a
    // 500 because it's still a server failure — the message just
    // isn't generic any more.
    console.error('[mydig/snapshots] delete failed:', err);
    res.status(500).json({
      error: `스냅샷 삭제 실패: ${err?.message ?? 'unknown'}`,
    });
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

  const whereVis = isOwner ? '' : ' AND is_public = 1';
  const rows = queryAll(
    `SELECT s.id, s.slug, s.name, s.description, s.is_public AS isPublic, s.created_at AS createdAt,
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
// detail with joined album metadata. Visitor access gated only
// by the snapshot's own is_public flag now that the per-user
// mydig_public gate is gone.
router.get('/mydig/:username/snapshots/:slug', (req, res) => {
  const raw = String(req.params.username || '').trim();
  const slug = String(req.params.slug || '').trim();
  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === user.id;

  const snap = queryGet(
    `SELECT id, slug, name, description, is_public AS isPublic, created_at AS createdAt
     FROM vinyl_wall_snapshots WHERE user_id = ? AND slug = ?`,
    [user.id, slug]
  );
  if (!snap) return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  if (!isOwner && snap.isPublic !== 1) {
    return res.status(404).json({ error: '스냅샷을 찾을 수 없어요.' });
  }

  // LEFT JOIN user_reviews on the page owner's own 50자 평 so the
  // snapshot view can render the same hover bubbles the live wall
  // does. Reviews themselves aren't snapshotted — the bubble
  // reflects what the owner currently thinks of the album, not
  // what they said at snapshot time — but that matches how the
  // bubble works everywhere else on the site.
  const items = queryAll(
    `SELECT i.position, a.id AS album_id, a.mbid, a.slug AS album_slug,
            a.title, a.artist_name AS artist,
            a.release_date AS releaseDate, a.release_year AS releaseYear,
            a.cover_art_url AS coverArtUrl, a.cover_art_fallbacks AS coverArtFallbacks,
            a.cover_dominant_color AS coverDominantColor,
            a.spotify_url AS spotifyUrl,
            a.preview_track_url AS previewTrackUrl,
            a.preview_track_name AS previewTrackName,
            ur.body AS user_review_body,
            ur.emoji AS user_review_emoji,
            ur.rating AS user_review_rating
     FROM vinyl_wall_snapshot_items i
     LEFT JOIN albums a ON a.id = i.album_id
     LEFT JOIN user_reviews ur
       ON ur.album_id = i.album_id AND ur.user_id = ?
     WHERE i.snapshot_id = ?
     ORDER BY i.position`,
    [user.id, snap.id]
  ) as Array<any>;
  // Same fire-and-forget enrichment as the live wall.
  for (const r of items) {
    if (
      r.album_id &&
      !r.coverDominantColor &&
      (r.coverArtUrl || r.spotifyUrl)
    ) {
      void ensureCoverDominantColor(
        r.album_id,
        r.coverArtUrl,
        r.spotifyUrl ?? null
      );
    }
    if (r.album_id && !r.previewTrackUrl && r.spotifyUrl) {
      void ensureAlbumPreview(r.album_id, r.spotifyUrl);
    }
  }

  res.json({
    snapshot: {
      id: snap.id,
      slug: snap.slug,
      name: snap.name,
      description: snap.description ?? null,
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
            coverDominantColor: r.coverDominantColor ?? null,
            spotifyUrl: r.spotifyUrl ?? null,
            previewTrackUrl: r.previewTrackUrl ?? null,
            previewTrackName: r.previewTrackName ?? null,
          }
        : null,
      userReview: r.user_review_body
        ? {
            body: String(r.user_review_body),
            emoji: r.user_review_emoji ? String(r.user_review_emoji) : null,
            rating: r.user_review_rating ? String(r.user_review_rating) : null,
          }
        : null,
    })),
  });
});

// ─── 토스터 PNG export ────────────────────────────────────────
//
// Shareable image of a user's vinyl wall (or one of their snapshots)
// in a 3×5 cover grid with per-row "Artist - Album" caption columns,
// dig.haus brand stamp at the bottom. Served as a 1080×1350 PNG —
// Instagram 4:5 portrait, same image fits Twitter / KakaoTalk / X
// inline previews with no extra crop logic. Cover art is fetched
// through the existing fetchAndResize webp cache, so repeated renders
// for the same wall cost no additional external requests.
//
// Public endpoint, no auth — anyone can grab any user's 토스터, the
// same way anyone can view their /my/:username page. Snapshot variant
// honours the snapshot's own is_public flag.

interface ToasterRow {
  position: number;
  album_id: number | null;
  mbid: string | null;
  title: string | null;
  artist_name: string | null;
  cover_art_url: string | null;
  cover_art_fallbacks: string | null;
}

// Compose a download filename from username + label (snapshot name or
// live wall theme). Mirrors the slug rules used elsewhere in the app:
// lowercase a-z0-9, Hangul preserved, spaces → hyphens, capped at 40
// chars so the resulting filename stays under 64 bytes after the
// "{user}-{label}-toaster.png" wrap.
function buildToasterFilename(username: string, label: string | null): string {
  const labelPart = (label || '').trim();
  const slug = labelPart
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug ? `${username}-${slug}-toaster.png` : `${username}-toaster.png`;
}

// Server has to control the download filename because the toaster
// endpoint is cross-origin from the frontend in production (Vercel
// www.dig.haus → Railway api.dig.haus), and browsers ignore the
// <a download> attribute on cross-origin responses for security. The
// only path to a real download is Content-Disposition: attachment
// from the server. Both filename (ASCII fallback) and filename* (RFC
// 5987 percent-encoded UTF-8) are emitted so Korean snapshot names
// survive the round trip on modern browsers and degrade to ASCII on
// anything older.
function setDownloadHeaders(res: import('express').Response, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
}

async function rowsToSlots(rows: ToasterRow[]): Promise<ToasterSlot[]> {
  // Resolve cover URLs in parallel — 15 small webp fetches is much
  // faster as a Promise.all than serially when the cache is cold.
  const slots = await Promise.all(
    rows.map(async (r) => {
      const fallbacks: string[] = r.cover_art_fallbacks
        ? (JSON.parse(r.cover_art_fallbacks) as string[])
        : [];
      const coverDataUrl = await loadCoverDataUrl(r.cover_art_url, fallbacks);
      return {
        position: r.position,
        albumMbid: r.mbid,
        albumTitle: r.title,
        artistName: r.artist_name,
        coverDataUrl,
      } satisfies ToasterSlot;
    })
  );
  return slots;
}

router.get('/mydig/:username/toaster.png', async (req, res) => {
  const raw = String(req.params.username || '').trim();
  if (!raw) return res.status(400).send('username required');
  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).send('not found');

  const wallRows = queryAll(
    `SELECT vwi.position, a.id AS album_id, a.mbid, a.title, a.artist_name,
            a.cover_art_url, a.cover_art_fallbacks
     FROM vinyl_wall_items vwi
     JOIN albums a ON a.id = vwi.album_id
     WHERE vwi.user_id = ?
     ORDER BY vwi.position ASC`,
    [user.id]
  ) as ToasterRow[];

  try {
    const slots = await rowsToSlots(wallRows);
    const png = await renderToasterPng({
      username: user.username,
      themeTitle: user.vinyl_wall_theme,
      slots,
    });
    res.setHeader('Content-Type', 'image/png');
    // 1 hour public cache — wall changes are infrequent and the
    // OG-image preview consumers (Twitter / Kakao) cache aggressively
    // anyway. If admins start tweaking copy in real time we can lower
    // this; for now an hour balances freshness against re-render cost.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (req.query.download !== undefined) {
      setDownloadHeaders(res, buildToasterFilename(user.username, user.vinyl_wall_theme));
    }
    res.send(png);
  } catch (err) {
    console.error('[toaster]', (err as Error).message);
    res.status(500).send('render failed');
  }
});

router.get('/mydig/:username/snapshots/:slug/toaster.png', async (req, res) => {
  const raw = String(req.params.username || '').trim();
  const slug = String(req.params.slug || '').trim();
  const user = resolveUserByUsername(raw);
  if (!user) return res.status(404).send('not found');

  const viewer = req.user as AppUser | undefined;
  const isOwner = !!viewer && viewer.id === user.id;

  const snap = queryGet(
    `SELECT id, name, is_public AS isPublic
     FROM vinyl_wall_snapshots WHERE user_id = ? AND slug = ?`,
    [user.id, slug]
  ) as { id: number; name: string; isPublic: number } | null;
  if (!snap) return res.status(404).send('not found');
  if (!isOwner && snap.isPublic !== 1) {
    return res.status(404).send('not found');
  }

  const items = queryAll(
    `SELECT i.position, a.id AS album_id, a.mbid, a.title, a.artist_name,
            a.cover_art_url, a.cover_art_fallbacks
     FROM vinyl_wall_snapshot_items i
     LEFT JOIN albums a ON a.id = i.album_id
     WHERE i.snapshot_id = ?
     ORDER BY i.position ASC`,
    [snap.id]
  ) as ToasterRow[];

  try {
    const slots = await rowsToSlots(items);
    const png = await renderToasterPng({
      username: user.username,
      // Snapshot name takes precedence over the live wall theme so
      // the share image actually reflects what the user labelled
      // this archived state as.
      themeTitle: snap.name || user.vinyl_wall_theme,
      slots,
    });
    res.setHeader('Content-Type', 'image/png');
    // Snapshots are immutable except for name/description/visibility,
    // so cache aggressively. Cache key is the URL which already
    // includes the slug — different snapshot, different URL, no
    // collision risk.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.query.download !== undefined) {
      setDownloadHeaders(res, buildToasterFilename(user.username, snap.name));
    }
    res.send(png);
  } catch (err) {
    console.error('[toaster]', (err as Error).message);
    res.status(500).send('render failed');
  }
});

export default router;
