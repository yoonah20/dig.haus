import { Router } from 'express';
import { queryAll } from '../db/index.js';
import { setEdgeCache } from '../utils/edgeCache.js';

const router = Router();

// Homepage activity feeds — cross-user aggregates the home page
// pulls into its side rail. Separate from mydig.ts so home-level
// concerns don't get tangled with per-user mydig routes, and so
// future home aggregates (e.g. "recently joined" / "오늘의 디거")
// have a clear place to land.

// GET /api/home/snapshots — recent publicly-published wall
// snapshots across all users, latest first. Gated on the
// snapshot's own is_public flag. The per-user mydig_public page
// gate was dropped when mydig went public-by-default.
//
// `limit` is soft-capped server-side so a malicious query can't
// pull the whole table. The client typically asks for 3-ish.
router.get('/home/snapshots', (req, res) => {
  // Anonymous-equivalent read: response doesn't vary by viewer. Let
  // Cloudflare hold it at the edge so KR users don't pay the trans-
  // Pacific RTT to us-west2 for every homepage load. New public
  // snapshots become visible within s-maxage seconds. A logged-in
  // owner sees their freshly-published snapshot at once via the
  // client's post-mutation cache-key bump.
  setEdgeCache(res, 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');

  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 20) : 6;

  const snapshots = queryAll(
    `SELECT s.id, s.slug, s.name, s.created_at AS createdAt,
            u.id AS userId, u.username,
            u.display_name AS displayName, u.name AS fallbackName,
            u.custom_avatar_url AS customAvatarUrl,
            u.avatar_url AS avatarUrl
     FROM vinyl_wall_snapshots s
     JOIN users u ON u.id = s.user_id
     WHERE s.is_public = 1
       AND u.username IS NOT NULL
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ?`,
    [limit]
  ) as Array<any>;

  if (snapshots.length === 0) {
    return res.json({ snapshots: [] });
  }

  // Fetch all items for the returned snapshots in one query, then
  // group in memory. LEFT JOIN albums so an album that was deleted
  // after the snapshot was taken still lands as a positioned slot
  // with album=null — the client can render an empty rail cell
  // there rather than silently dropping the position.
  const ids = snapshots.map((s) => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = queryAll(
    `SELECT i.snapshot_id AS snapshotId, i.position,
            a.id AS albumId, a.mbid, a.slug AS albumSlug,
            a.title, a.artist_name AS artist,
            a.cover_art_url AS coverArtUrl,
            a.cover_art_fallbacks AS coverArtFallbacks
     FROM vinyl_wall_snapshot_items i
     LEFT JOIN albums a ON a.id = i.album_id
     WHERE i.snapshot_id IN (${placeholders})
     ORDER BY i.snapshot_id, i.position ASC`,
    ids
  ) as Array<any>;

  const itemsBySnap = new Map<number, any[]>();
  for (const it of items) {
    const existing = itemsBySnap.get(it.snapshotId);
    const entry = {
      position: it.position,
      album: it.albumId
        ? {
            id: it.albumId,
            mbid: it.mbid,
            slug: it.albumSlug,
            title: it.title,
            artist: it.artist,
            coverArtUrl: it.coverArtUrl,
            coverArtFallbacks: it.coverArtFallbacks
              ? JSON.parse(it.coverArtFallbacks)
              : [],
          }
        : null,
    };
    if (existing) existing.push(entry);
    else itemsBySnap.set(it.snapshotId, [entry]);
  }

  res.json({
    snapshots: snapshots.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      createdAt: s.createdAt,
      user: {
        id: s.userId,
        username: s.username,
        displayName: s.displayName || s.fallbackName,
        avatarUrl: s.customAvatarUrl || s.avatarUrl,
      },
      items: itemsBySnap.get(s.id) ?? [],
    })),
  });
});

export default router;
