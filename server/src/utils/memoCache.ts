// Short-lived in-memory TTL cache to coalesce repeated external-API calls
// within a single request burst (e.g. concurrent album views, duplicate
// similar-album lookups). Not a persistence layer — entries expire and the
// process losing the cache is fine.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

function get<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function set<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Wrap an async function so identical invocations (by JSON-stringified args)
 * within the TTL window reuse the pending/completed promise.
 */
export function memoAsync<Args extends any[], R>(
  ns: string,
  fn: (...args: Args) => Promise<R>,
  ttlMs: number
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const key = `${ns}:${JSON.stringify(args)}`;
    const cached = get<Promise<R>>(key);
    if (cached) return cached;
    const p = fn(...args).catch((err) => {
      // Don't cache failures — evict so retries aren't sticky
      store.delete(key);
      throw err;
    });
    set(key, p, ttlMs);
    return p;
  };
}
