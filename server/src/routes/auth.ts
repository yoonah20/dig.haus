import { Router } from 'express';
import passport from 'passport';
import type { AppUser } from '../auth/passport.js';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

router.get('/google', (req, res, next) => {
  if (!googleConfigured()) {
    return res.redirect(`${CLIENT_URL}/?auth=not_configured`);
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!googleConfigured()) {
    return res.redirect(`${CLIENT_URL}/?auth=not_configured`);
  }
  passport.authenticate('google', {
    failureRedirect: `${CLIENT_URL}/?auth=failed`,
    successRedirect: `${CLIENT_URL}/?auth=ok`,
  })(req, res, next);
});

router.get('/me', (req, res) => {
  const user = req.user as AppUser | undefined;
  if (!user) return res.json({ user: null });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      isAdmin: !!user.is_admin,
    },
  });
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session?.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });
});

export default router;
