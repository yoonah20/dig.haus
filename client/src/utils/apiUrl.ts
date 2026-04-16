// Client-side helper for resolving backend-relative URLs against the API
// origin. The server stores uploaded avatars and custom covers as
// site-relative paths ("/api/avatars/u1-v1-abc.webp"), which only load
// correctly when the client is served from the same origin as the API.
//
// In split-origin deployments (e.g. client on dig.haus, API on
// api.dig.haus), a bare `<img src="/api/avatars/…">` resolves against the
// client's origin and 404s. Prefixing API_BASE here routes the request to
// the backend so uploads actually appear on screen.
//
// External URLs (http://, https://) and non-/api paths pass through
// unchanged so we don't break anything that already works.

const API_BASE = import.meta.env.VITE_API_URL || '';

export function resolveApiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/api/') || url.startsWith('/auth/')) {
    return `${API_BASE}${url}`;
  }
  return url;
}
