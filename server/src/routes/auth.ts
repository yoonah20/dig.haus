import { Router } from 'express';
import passport from 'passport';
import { PendingApprovalError, type AppUser } from '../auth/passport.js';

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
  // Custom callback (rather than passport.authenticate's
  // success/failureRedirect shortcuts) so we can distinguish a real
  // OAuth failure from an un-invited email getting bounced into the
  // pending queue. PendingApprovalError surfaces from
  // upsertGoogleUser → done(err) here, and we redirect to
  // /?auth=pending so the client shows the awaiting-approval banner.
  passport.authenticate('google', (err: any, user: AppUser | false) => {
    if (err instanceof PendingApprovalError) {
      return res.redirect(`${CLIENT_URL}/?auth=pending`);
    }
    if (err || !user) {
      return res.redirect(`${CLIENT_URL}/?auth=failed`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.redirect(`${CLIENT_URL}/?auth=failed`);
      }
      return res.redirect(`${CLIENT_URL}/?auth=ok`);
    });
  })(req, res, next);
});

router.get('/me', (req, res) => {
  const user = req.user as AppUser | undefined;
  if (!user) return res.json({ user: null });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      // Effective display fields — custom value wins, Google value as fallback.
      name: user.display_name || user.name,
      avatarUrl: user.custom_avatar_url || user.avatar_url,
      // Raw fields too, so the profile editor can distinguish "no custom value
      // set yet" from "custom value equals the Google default".
      googleName: user.name,
      googleAvatarUrl: user.avatar_url,
      displayName: user.display_name,
      customAvatarUrl: user.custom_avatar_url,
      instagramHandle: user.instagram_handle,
      mydigUsername: user.username ?? null,
      isAdmin: !!user.is_admin,
      // Discogs link status — only the username is exposed, never the
      // stored tokens.
      discogsUsername: user.discogs_username ?? null,
      discogsLinkedAt: user.discogs_linked_at ?? null,
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
