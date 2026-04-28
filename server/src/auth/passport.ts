import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { queryGet, queryAll, execute } from '../db/index.js';
import { deriveUsernameFromEmail } from '../utils/username.js';
import { sendPendingSignupNotice } from '../services/email.js';

export interface AppUser {
  id: number;
  google_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: number;
  // User-editable overrides — take precedence over name/avatar_url on
  // display. Google re-login never touches these.
  display_name: string | null;
  custom_avatar_url: string | null;
  instagram_handle: string | null;
  // Phase 3 mydig. `username` is the URL slug (3-20 lowercase chars) —
  // NULL until the user claims one via the onboarding modal.
  username: string | null;
  created_at: string | null;
}

// Sentinel thrown by upsertGoogleUser when an un-invited email tries to
// complete an OAuth signup. The Passport strategy callback below catches
// this and signals the route layer to redirect to the awaiting-approval
// page instead of failing as if the OAuth itself had errored.
export class PendingApprovalError extends Error {
  constructor(public email: string) {
    super('signup awaiting approval');
    this.name = 'PendingApprovalError';
  }
}

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isInvited(email: string): boolean {
  const row = queryGet(
    `SELECT 1 FROM invited_emails WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email]
  );
  return !!row;
}

// Record (or refresh) a pending signup attempt. Idempotent on email —
// repeat attempts bump attempt_count + last_attempt_at instead of
// stacking duplicate rows. Returns true on the first attempt for this
// email so the caller can decide whether to fire the admin email
// notification (only on first appearance, to avoid spamming admin
// every time the user retries).
function upsertPendingSignup(profile: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}): { firstAttempt: boolean } {
  const existing = queryGet(
    `SELECT email, attempt_count FROM pending_signups WHERE LOWER(email) = LOWER(?)`,
    [profile.email]
  ) as { email: string; attempt_count: number } | undefined;

  if (existing) {
    execute(
      `UPDATE pending_signups
         SET google_id = ?, name = ?, avatar_url = ?,
             last_attempt_at = datetime('now'),
             attempt_count = attempt_count + 1
       WHERE LOWER(email) = LOWER(?)`,
      [profile.id, profile.name, profile.avatarUrl, profile.email]
    );
    return { firstAttempt: false };
  }

  execute(
    `INSERT INTO pending_signups (email, google_id, name, avatar_url)
     VALUES (?, ?, ?, ?)`,
    [profile.email, profile.id, profile.name, profile.avatarUrl]
  );
  return { firstAttempt: true };
}

function upsertGoogleUser(profile: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}): AppUser {
  const adminEmails = getAdminEmails();
  const isAdmin = adminEmails.has(profile.email.toLowerCase()) ? 1 : 0;

  const existing = queryGet(
    `SELECT * FROM users WHERE google_id = ? OR email = ? LIMIT 1`,
    [profile.id, profile.email]
  );

  if (existing) {
    execute(
      `UPDATE users SET google_id = ?, name = ?, avatar_url = ?, is_admin = ? WHERE id = ?`,
      [profile.id, profile.name, profile.avatarUrl, isAdmin, existing.id]
    );
    return { ...existing, google_id: profile.id, name: profile.name, avatar_url: profile.avatarUrl, is_admin: isAdmin };
  }

  // Brand-new account creation gates on the invited_emails allowlist.
  // Admin emails are auto-invited so the site owner can never lock
  // themselves out by forgetting to seed their own row before first
  // login.
  if (!isAdmin && !isInvited(profile.email)) {
    const { firstAttempt } = upsertPendingSignup(profile);
    if (firstAttempt) {
      // Fire-and-forget — failure here can't block the OAuth flow,
      // and the row is in pending_signups regardless so the admin
      // can still see + approve from the dashboard.
      sendPendingSignupNotice({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      })
        .then((sent) => {
          if (sent) {
            execute(
              `UPDATE pending_signups SET notified_at = datetime('now') WHERE LOWER(email) = LOWER(?)`,
              [profile.email]
            );
          }
        })
        .catch((err) =>
          console.warn('[auth] pending-signup notice failed:', (err as Error).message)
        );
    }
    throw new PendingApprovalError(profile.email);
  }

  // The legacy users table has NOT NULL username + password_hash from Phase 1.
  // Fill placeholders so new OAuth users satisfy those constraints.
  //
  // Username: derive a URL-safe slug from the email local part so
  // /my/:username renders as /my/fpp instead of /my/fpp@dig.haus.
  // Collision + reserved-word handling goes through
  // deriveUsernameFromEmail. We pass in the current set of taken
  // usernames so two signups with the same local part end up on
  // distinct slugs (first "fpp", second "fpp2", ...).
  const takenRows = queryAll(
    `SELECT LOWER(username) AS username FROM users WHERE username IS NOT NULL`
  ) as Array<{ username: string }>;
  const taken = new Set(takenRows.map((r) => r.username));
  const username = deriveUsernameFromEmail(profile.email, taken);
  execute(
    `INSERT INTO users (google_id, email, username, password_hash, name, avatar_url, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [profile.id, profile.email, username, '', profile.name, profile.avatarUrl, isAdmin]
  );
  const row = queryGet(`SELECT * FROM users WHERE google_id = ?`, [profile.id]);
  return row as AppUser;
}

export function configurePassport(): void {
  const clientID = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ||
    `http://localhost:${process.env.PORT || 3001}/auth/google/callback`;

  if (!clientID || !clientSecret) {
    console.warn(
      '[auth] GOOGLE_CLIENT_ID/SECRET missing — Google OAuth disabled. Set them in server/.env to enable login.'
    );
  } else {
    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL,
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || '';
            if (!email) return done(new Error('Google profile missing email'));
            const user = upsertGoogleUser({
              id: profile.id,
              email,
              name: profile.displayName || email,
              avatarUrl: profile.photos?.[0]?.value || '',
            });
            return done(null, user);
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );
  }

  passport.serializeUser((user, done) => {
    done(null, (user as AppUser).id);
  });

  passport.deserializeUser((id: number, done) => {
    try {
      const user = queryGet(`SELECT * FROM users WHERE id = ?`, [id]);
      done(null, user || null);
    } catch (err) {
      done(err as Error);
    }
  });
}
