import type { Request, Response } from 'express';

// Cloudflare's /api cache rule is "use origin Cache-Control when present,
// bypass when absent" — so the way to keep a request out of the edge cache
// is to not send the header at all.
//
// Logged-in requests must always skip the edge cache. The original
// unconditional headers made the operator's own page-load seed a CF cache
// entry, and after a mutation (scrape finished, review deleted, 50자 평
// posted) the client's refetch got that stale entry back for up to
// s-maxage + stale-while-revalidate — the page looked like it never
// refreshed until a much later reload. React-Query invalidation can't fix
// that; the staleness lives at the edge, not in the client.
//
// Anonymous traffic — the latency-sensitive majority (search / share-link
// entries paying trans-Pacific RTT) — still gets the edge cache.
//
// Residual gap: an anonymous visitor can seed an entry that CF then serves
// to a logged-in request (CF answers HITs before consulting the origin, so
// the absent header can't help there). Closing that needs a bypass-on-
// session-cookie condition on the CF Cache Rule itself.
export function setAnonEdgeCache(req: Request, res: Response, value: string) {
  if (!req.user) res.set('Cache-Control', value);
}
