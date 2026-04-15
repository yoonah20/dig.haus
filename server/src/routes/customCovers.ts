import express, { Router } from 'express';
import { CACHE_MAX_AGE_SECONDS } from '../utils/coverImage.js';
import { CUSTOM_COVERS_DIR } from '../services/customCoverHost.js';

const router = Router();

// Admin-hosted covers are immutable — the filename is a content hash, so a
// new URL means a new file. Long cache is safe.
router.use(
  express.static(CUSTOM_COVERS_DIR, {
    immutable: true,
    maxAge: CACHE_MAX_AGE_SECONDS * 1000,
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'image/webp');
    },
  })
);

export default router;
