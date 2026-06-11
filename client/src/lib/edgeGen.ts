// Edge-cache generation counter. Hot GET endpoints are cached at the
// Cloudflare edge for every viewer (see server/src/utils/edgeCache.ts);
// after a mutation, React Query's invalidation refetches the same URL —
// which the edge would happily answer with the stale entry it cached
// before the mutation. Bumping this counter changes the `v` query param
// the axios interceptor appends to API GETs, so the post-mutation
// refetch lands on a fresh cache key and goes straight to origin.
//
// sessionStorage (not memory) so a reload right after a mutation still
// reads fresh data; per-tab scope is fine — another tab's stale window
// is bounded by s-maxage anyway. Guarded because sessionStorage can
// throw in some privacy modes; falling back to memory-only just narrows
// the reload case back to the s-maxage window.
const KEY = 'edge:gen';

function read(): number {
  try {
    return Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

let gen = read();

export function edgeGen(): number {
  return gen;
}

export function bumpEdgeGen(): void {
  gen += 1;
  try {
    sessionStorage.setItem(KEY, String(gen));
  } catch {
    // memory-only fallback
  }
}
