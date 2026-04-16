import express, { Router } from 'express';
import { CACHE_MAX_AGE_SECONDS } from '../utils/coverImage.js';
import { AVATARS_DIR } from '../services/avatarHost.js';

const router = Router();

// Avatar filenames are content-hashed (per user) so a re-upload produces a
// new file. Safe to cache aggressively.
router.use(
  express.static(AVATARS_DIR, {
    immutable: true,
    maxAge: CACHE_MAX_AGE_SECONDS * 1000,
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'image/webp');
    },
  })
);

export default router;
