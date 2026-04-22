// Username conventions shared across the OAuth upsert, the migration
// that rewrote legacy email-shaped usernames, and the PATCH /me/
// username route's validation.

// Same regex the profile page enforces: lowercase a-z / digits / `_`
// / `-`, 3-20 chars, must start and end with an alphanumeric. The
// trailing `?` technically permits a single-char name; downstream
// callers compose this with length checks to keep the 3-20 floor.
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,18}[a-z0-9])?$/;

// Routes / brand names we refuse even when they'd technically pass
// the regex. Kept in sync with RESERVED_USERNAMES in routes/me.ts
// (imported from here to avoid a drift-prone second copy).
export const RESERVED_USERNAMES: Set<string> = new Set([
  'admin', 'api', 'about', 'help', 'login', 'logout', 'signup', 'signin',
  'auth', 'settings', 'profile', 'me', 'my', 'we', 'us', 'they',
  'home', 'explore', 'search', 'albums', 'album', 'artist', 'artists',
  'dig', 'digger', 'diggers', 'dighaus', 'staff', 'support',
  'terms', 'privacy', 'legal', 'contact', 'feedback',
]);

// Take the local part of an email, sanitise it down to the regex's
// allowed character set, and trim to the 3-20 length window.
//
// Email local parts can contain `.` and `+` (both valid per RFC 5322)
// that the username regex rejects; replace those with `-` so the
// useful structure survives. Anything else outside [a-z0-9_-] gets
// stripped. Very short results get padded with `x` so a local part
// like "jk" lands on "jkx0" instead of failing the length floor.
function sanitizeBase(email: string): string {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  let base = local.replace(/[.+]/g, '-').replace(/[^a-z0-9_-]/g, '');
  // Regex requires alphanumeric at both ends — strip hyphens /
  // underscores that would have leaked to either edge.
  base = base.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (base.length > 20) base = base.slice(0, 20);
  if (base.length < 3) {
    base = (base + 'x0').slice(0, 3);
  }
  if (!base) {
    base = `u${Math.random().toString(36).slice(2, 7)}`;
  }
  return base;
}

// Resolve a collision-free username for `email`. `taken` is a set of
// lowercased usernames already assigned in the DB; callers add the
// return value back into this set when batch-assigning (e.g. the
// legacy-rewrite migration). Pattern:
//   first candidate: sanitised local part
//   retry: base + "2", base + "3", ... (base truncated if the
//   suffix would push past 20 chars)
// Reserved names and existing names both trigger the suffix loop.
export function deriveUsernameFromEmail(email: string, taken: Set<string>): string {
  const base = sanitizeBase(email);
  let candidate = base;
  let suffix = 2;
  while (RESERVED_USERNAMES.has(candidate) || taken.has(candidate)) {
    const suf = String(suffix);
    const maxBase = 20 - suf.length;
    candidate = base.slice(0, Math.max(1, maxBase)) + suf;
    suffix++;
    if (suffix > 9999) {
      // Sanity escape — shouldn't fire for any real inbox but keeps
      // the loop from running away if someone's email hash happens
      // to collide with 10k reserved/existing names.
      candidate = `u${Date.now().toString(36).slice(-6)}`;
      break;
    }
  }
  return candidate;
}
