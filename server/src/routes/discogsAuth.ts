import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { execute } from '../db/index.js';
import type { AppUser } from '../auth/passport.js';
import {
  discogsOauthConfigured,
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  getIdentity,
} from '../services/discogsOauth.js';
import { getDiscogsCollectionStats } from '../services/discogs.js';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

function callbackUrl(): string {
  return (
    process.env.DISCOGS_CALLBACK_URL ||
    `http://localhost:${process.env.PORT || 3001}/auth/discogs/callback`
  );
}

// Start the OAuth 1.0a dance. Requires a logged-in dig.haus user — the
// link is attached to that account. We stash the request-token secret and
// the dig.haus user id in the session so the callback (a top-level browser
// redirect back from discogs.com) can finish the exchange and know whom to
// attach the credentials to.
router.get('/discogs', requireAuth, async (req, res) => {
  if (!discogsOauthConfigured()) {
    return res.redirect(`${CLIENT_URL}/profile?discogs=not_configured`);
  }
  const user = req.user as AppUser;
  try {
    const { token, tokenSecret } = await getRequestToken(callbackUrl());
    const sess = req.session as any;
    sess.discogsRequestToken = token;
    sess.discogsRequestSecret = tokenSecret;
    sess.discogsUserId = user.id;
    return res.redirect(getAuthorizeUrl(token));
  } catch (err) {
    console.error('[discogs-auth] request_token failed:', (err as Error).message);
    return res.redirect(`${CLIENT_URL}/profile?discogs=failed`);
  }
});

// Callback from Discogs after the user authorizes. Exchanges the verifier
// for an access token, resolves the Discogs username, and persists the
// credentials on the user row.
router.get('/discogs/callback', async (req, res) => {
  const sess = req.session as any;
  const oauthToken = String(req.query.oauth_token || '');
  const verifier = String(req.query.oauth_verifier || '');
  const requestSecret = sess.discogsRequestSecret as string | undefined;
  const userId = sess.discogsUserId as number | undefined;

  // Discogs sends the user back here with ?denied=<token> if they reject
  // the authorization prompt.
  if (req.query.denied) {
    return res.redirect(`${CLIENT_URL}/profile?discogs=denied`);
  }
  if (!oauthToken || !verifier || !requestSecret || !userId) {
    return res.redirect(`${CLIENT_URL}/profile?discogs=failed`);
  }

  try {
    const access = await getAccessToken(oauthToken, verifier, requestSecret);
    const identity = await getIdentity(access.token, access.tokenSecret);
    execute(
      `UPDATE users
         SET discogs_username = ?,
             discogs_access_token = ?,
             discogs_access_secret = ?,
             discogs_linked_at = datetime('now')
       WHERE id = ?`,
      [identity.username, access.token, access.tokenSecret, userId]
    );
    // Clear the handshake scratch state.
    delete sess.discogsRequestToken;
    delete sess.discogsRequestSecret;
    delete sess.discogsUserId;
    return res.redirect(`${CLIENT_URL}/profile?discogs=ok`);
  } catch (err) {
    console.error('[discogs-auth] access_token/identity failed:', (err as Error).message);
    return res.redirect(`${CLIENT_URL}/profile?discogs=failed`);
  }
});

// Collection + wantlist counts for the linked user — the profile card's
// "Discogs 컬렉션 N장" line. Cheap live read (memo-cached upstream), no
// stored collection. Returns {linked:false} when the user hasn't linked.
router.get('/discogs/stats', requireAuth, async (req, res) => {
  const user = req.user as AppUser;
  if (
    !user.discogs_username ||
    !user.discogs_access_token ||
    !user.discogs_access_secret
  ) {
    return res.json({ linked: false });
  }
  try {
    const stats = await getDiscogsCollectionStats(
      user.discogs_username,
      user.discogs_access_token,
      user.discogs_access_secret
    );
    res.json({ linked: true, ...stats });
  } catch (err) {
    console.error('[discogs-auth] stats failed:', (err as Error).message);
    res.status(502).json({ error: 'discogs stats failed' });
  }
});

// Unlink — drops the stored credentials. We don't revoke on Discogs's
// side (OAuth 1.0a has no programmatic revoke); the user can revoke the
// app from their Discogs settings if they want the token killed there.
router.delete('/discogs', requireAuth, (req, res) => {
  const user = req.user as AppUser;
  execute(
    `UPDATE users
       SET discogs_username = NULL,
           discogs_access_token = NULL,
           discogs_access_secret = NULL,
           discogs_linked_at = NULL
     WHERE id = ?`,
    [user.id]
  );
  res.json({ ok: true });
});

export default router;
