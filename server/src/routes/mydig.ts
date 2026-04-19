import { Router } from 'express';
import { queryGet, queryAll } from '../db/index.js';
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

router.get('/mydig/:username', (req, res) => {
  const raw = String(req.params.username || '').trim();
  if (!raw) return res.status(400).json({ error: '사용자명이 필요합니다.' });

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

export default router;
