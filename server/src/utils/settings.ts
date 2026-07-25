import { queryGet, execute } from '../db/index.js';

// Tiny key-value settings store over the app_settings table. Reads are
// cached in-process because resolvePrimaryModel() hits getSetting on every
// LLM call; the cache is written through on every set/clear so it never
// goes stale within the single Railway process. A null value is cached
// too, so a missing key doesn't re-query on every call.
const cache = new Map<string, string | null>();

export function getSetting(key: string): string | null {
  if (cache.has(key)) return cache.get(key) as string | null;
  const row = queryGet('SELECT value FROM app_settings WHERE key = ?', [key]) as
    | { value?: string }
    | undefined;
  const value = row?.value ?? null;
  cache.set(key, value);
  return value;
}

export function setSetting(key: string, value: string): void {
  execute(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
  cache.set(key, value);
}

export function clearSetting(key: string): void {
  execute('DELETE FROM app_settings WHERE key = ?', [key]);
  cache.set(key, null);
}
