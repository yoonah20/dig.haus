// Shared localStorage key + helpers for "admin has seen pending
// registrations up to this timestamp". The Admin page writes the
// current time on mount; the nav badge (LoginButton) filters the
// pending-request list to only albums newer than that timestamp.
//
// Firing 'admin-pending-seen' as a window event keeps the two
// components in sync in the same tab (the native `storage` event
// only fires across tabs).

export const ADMIN_SEEN_PENDING_KEY = 'admin:pending:seenAt';
export const ADMIN_PENDING_SEEN_EVENT = 'admin-pending-seen';

export function markPendingSeen(): void {
  try {
    localStorage.setItem(ADMIN_SEEN_PENDING_KEY, new Date().toISOString());
    window.dispatchEvent(new Event(ADMIN_PENDING_SEEN_EVENT));
  } catch {
    // private mode etc. — badge just won't clear, harmless.
  }
}

export function readPendingSeen(): string | null {
  try {
    return localStorage.getItem(ADMIN_SEEN_PENDING_KEY);
  } catch {
    return null;
  }
}
