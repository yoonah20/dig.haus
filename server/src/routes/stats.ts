import { Router } from 'express';
import { queryGet } from '../db/index.js';

const router = Router();

// GET /api/stats/site — public site-wide counts for the global footer.
// No auth, intentionally tiny payload (two COUNT(*)s on small tables).
// Client caches with a 10-min staleTime, so this gets hit at most once
// per page-load session.
router.get('/site', (_req, res) => {
  const users = (queryGet(`SELECT COUNT(*) AS c FROM users`)?.c as number) || 0;
  const albums = (queryGet(`SELECT COUNT(*) AS c FROM albums`)?.c as number) || 0;
  res.json({ users, albums });
});

export default router;
