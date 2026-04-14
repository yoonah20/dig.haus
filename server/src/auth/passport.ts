import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { queryGet, execute } from '../db/index.js';

export interface AppUser {
  id: number;
  google_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: number;
}

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
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

  // The legacy users table has NOT NULL username + password_hash from Phase 1.
  // Fill placeholders so new OAuth users satisfy those constraints.
  execute(
    `INSERT INTO users (google_id, email, username, password_hash, name, avatar_url, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [profile.id, profile.email, profile.email, '', profile.name, profile.avatarUrl, isAdmin]
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
