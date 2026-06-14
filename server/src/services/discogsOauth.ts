import axios from 'axios';
import https from 'https';
import crypto from 'crypto';

// Discogs uses OAuth 1.0a. We sign with the PLAINTEXT method, which is
// allowed because every call goes over HTTPS — the signature is simply
// "<consumerSecret>&<tokenSecret>" (tokenSecret empty during the
// request-token step). HMAC-SHA1 would add a base-string canonicalisation
// dance for no security gain on top of TLS, so PLAINTEXT is the right call
// here. The personal-access-token path in `discogs.ts` is unrelated — it's
// for app-level public reads, whereas this module mints per-user tokens.

const BASE = 'https://api.discogs.com';
const httpsAgent = new https.Agent({ family: 4 });
const USER_AGENT = 'dig.haus/1.0';

function consumer(): { key: string; secret: string } {
  return {
    key: process.env.DISCOGS_CONSUMER_KEY || '',
    secret: process.env.DISCOGS_CONSUMER_SECRET || '',
  };
}

export function discogsOauthConfigured(): boolean {
  const c = consumer();
  return !!(c.key && c.secret);
}

// RFC 3986 percent-encoding — stricter than encodeURIComponent (also
// escapes ! * ' ( )), required for OAuth header values.
function enc(v: string): string {
  return encodeURIComponent(v).replace(
    /[!*'()]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

function authHeader(
  extra: Record<string, string>,
  tokenSecret: string = ''
): string {
  const c = consumer();
  const params: Record<string, string> = {
    oauth_consumer_key: c.key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'PLAINTEXT',
    oauth_signature: `${enc(c.secret)}&${enc(tokenSecret)}`,
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extra,
  };
  const parts = Object.entries(params)
    .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
    .join(', ');
  return `OAuth ${parts}`;
}

function parseFormResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

/**
 * Step 1 of the OAuth dance: obtain a temporary request token. The
 * callback URL is passed dynamically here (not bound to the app's
 * registered callback) so the same Discogs app serves both localhost and
 * production by varying DISCOGS_CALLBACK_URL.
 */
export async function getRequestToken(
  callbackUrl: string
): Promise<{ token: string; tokenSecret: string }> {
  const res = await axios.get(`${BASE}/oauth/request_token`, {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: authHeader({ oauth_callback: callbackUrl }),
    },
    httpsAgent,
    responseType: 'text',
  });
  const parsed = parseFormResponse(res.data);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error('discogs request_token: missing token in response');
  }
  return { token: parsed.oauth_token, tokenSecret: parsed.oauth_token_secret };
}

/** The URL we redirect the user's browser to so they can authorize. */
export function getAuthorizeUrl(requestToken: string): string {
  return `https://www.discogs.com/oauth/authorize?oauth_token=${enc(requestToken)}`;
}

/**
 * Step 3: exchange the authorized request token + verifier for a
 * long-lived access token. `requestTokenSecret` is the secret returned by
 * getRequestToken (stashed in the session across the redirect).
 */
export async function getAccessToken(
  requestToken: string,
  verifier: string,
  requestTokenSecret: string
): Promise<{ token: string; tokenSecret: string }> {
  const res = await axios.post(
    `${BASE}/oauth/access_token`,
    null,
    {
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: authHeader(
          { oauth_token: requestToken, oauth_verifier: verifier },
          requestTokenSecret
        ),
      },
      httpsAgent,
      responseType: 'text',
    }
  );
  const parsed = parseFormResponse(res.data);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error('discogs access_token: missing token in response');
  }
  return { token: parsed.oauth_token, tokenSecret: parsed.oauth_token_secret };
}

/** Resolve the Discogs username behind an access token. */
export async function getIdentity(
  accessToken: string,
  accessSecret: string
): Promise<{ username: string; id: number }> {
  const data = await signedGet(`${BASE}/oauth/identity`, accessToken, accessSecret);
  return { username: data.username, id: data.id };
}

/**
 * Generic authenticated GET on behalf of a linked user. Used for the
 * live ownership/wantlist lookups that back the album-page badge — these
 * read straight from Discogs (memo-cached upstream) instead of a stored
 * mirror of the collection.
 */
export async function signedGet(
  url: string,
  accessToken: string,
  accessSecret: string
): Promise<any> {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: authHeader({ oauth_token: accessToken }, accessSecret),
    },
    httpsAgent,
    // Don't throw on 404 — the collection-membership endpoint returns it
    // as a legitimate "not owned" signal for some shapes.
    validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
  });
  return res.status === 404 ? null : res.data;
}
