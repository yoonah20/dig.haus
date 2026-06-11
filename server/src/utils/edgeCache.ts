import type { Request, Response } from 'express';

// Cloudflare's /api cache rule is "use origin Cache-Control when present,
// bypass when absent" — so a response that sends this header is edge-
// cacheable for every viewer, logged-in or not.
//
// Post-mutation freshness is the client's job, not a reason to skip the
// edge: client/src/lib/axios.ts appends a `v=<generation>` query param to
// hot GETs and bumps the generation after every successful mutation, so
// the refetch lands on a fresh cache key and goes straight to origin.
// (The previous approach — omitting the header whenever req.user was set —
// made the operator pay the full KR→LAX→origin round trip on every call,
// and still served stale anon-seeded HITs anyway, since CF answers HITs
// before the origin ever sees the request.)
//
// Residual gap: a mutation on one device doesn't bump another device's
// generation, so a second logged-in device can read a stale entry for up
// to s-maxage. Acceptable for the single-operator default.
//
// Only use this on responses that are identical for every viewer. If the
// body varies by viewer, use setAnonEdgeCache below instead.
export function setEdgeCache(res: Response, value: string) {
  res.set('Cache-Control', value);
}

// For responses that vary by viewer (e.g. album base includes the caller's
// own userVote): only anonymous responses may seed the edge, because a
// logged-in body cached under the shared key would leak that user's state
// to everyone else. Known gap: an anon-seeded entry can still be served
// to a logged-in request (CF HITs don't consult the origin), briefly
// hiding per-user fields like the viewer's own vote — closing that needs
// a bypass-on-session-cookie condition on the CF Cache Rule, at the cost
// of logged-in users losing all edge HITs on that path.
export function setAnonEdgeCache(req: Request, res: Response, value: string) {
  if (!req.user) res.set('Cache-Control', value);
}
