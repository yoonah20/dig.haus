import { Router } from 'express';
import { queryGet, queryAll } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

// GET /api/admin/stats — dashboard overview
router.get('/stats', (_req, res) => {
  const totalAlbums = queryGet(`SELECT COUNT(*) AS n FROM albums`)?.n || 0;
  const albumsToday = queryGet(
    `SELECT COUNT(*) AS n FROM albums WHERE DATE(created_at) = DATE('now')`
  )?.n || 0;
  const totalUsers = queryGet(`SELECT COUNT(*) AS n FROM users`)?.n || 0;
  const votesToday = queryGet(
    `SELECT
       SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down
     FROM album_votes WHERE DATE(created_at) = DATE('now')`
  );

  const recentAlbums = queryAll(
    `SELECT id, mbid, slug, title, artist_name, created_at, cover_art_url, cover_art_fallbacks
     FROM albums ORDER BY created_at DESC LIMIT 20`
  ).map((a: any) => ({
    id: a.id,
    mbid: a.slug || a.mbid,
    title: a.title,
    artist: a.artist_name,
    createdAt: a.created_at,
    coverArtUrl: a.cover_art_url,
    coverArtFallbacks: a.cover_art_fallbacks ? JSON.parse(a.cover_art_fallbacks) : [],
  }));

  const recentUsers = queryAll(
    `SELECT id, email, name, avatar_url, is_admin, created_at
     FROM users ORDER BY created_at DESC LIMIT 20`
  ).map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatar_url,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
  }));

  res.json({
    totalAlbums,
    albumsToday,
    totalUsers,
    votesToday: {
      up: votesToday?.up || 0,
      down: votesToday?.down || 0,
    },
    recentAlbums,
    recentUsers,
  });
});

export default router;
