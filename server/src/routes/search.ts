import { Router } from 'express';
import { searchAlbumsInDb } from '../utils/albumSearch.js';
import { searchExternalMerged } from '../utils/externalSearch.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

// GET /api/search?q=query
// Admin: full MusicBrainz + Discogs external search.
// Everyone else: falls back to DB-only search over registered albums —
// this powers the nav search bar (finding albums that exist on
// dig.haus). The external-search path for the album-request flow
// lives at /api/album-requests/search, auth-gated + rate-limited
// there.
router.get('/', async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) {
    return res.json({ albums: [] });
  }

  const user = req.user as AppUser | undefined;
  const isAdmin = !!user?.is_admin;

  if (!isAdmin) {
    try {
      return res.json({ albums: searchAlbumsInDb(query) });
    } catch (error) {
      console.error('DB search fallback error:', error);
      return res.json({ albums: [] });
    }
  }

  try {
    const albums = await searchExternalMerged(query);
    res.json({ albums });
  } catch (error) {
    console.error('Search error:', error);
    res.json({ albums: [] });
  }
});

export default router;
