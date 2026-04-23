import { execute, queryGet } from '../db/index.js';
import { fetchAlbumPreview } from '../services/spotify.js';

// Idempotent extract-and-store for the mydig hover-play chip. Flow
// mirrors coverColor: wall payload includes whatever's in the row,
// a null-or-stale row fires a background lookup, the next fetch
// carries the result. Lookup timestamp is always written even on
// failure so Spotify-null albums don't get re-queried every page
// render.

// Shelf life on the "no preview found" sentinel: after this many
// days we try again. Spotify's preview-url availability changes
// as rights deals shift around, so a long-term null isn't always
// permanent. 60 days balances "don't thrash the API" against
// "eventually pick up newly-available previews".
const RELOOKUP_AFTER_DAYS = 60;

const inflight = new Map<number, Promise<void>>();

export async function ensureAlbumPreview(
  albumId: number,
  spotifyUrl: string | null
): Promise<void> {
  if (!spotifyUrl) return;
  const row = queryGet(
    `SELECT preview_track_url, preview_lookup_at
     FROM albums WHERE id = ?`,
    [albumId]
  ) as
    | { preview_track_url: string | null; preview_lookup_at: string | null }
    | undefined;
  if (!row) return;
  // Already populated → nothing to do.
  if (row.preview_track_url) return;
  // Recently checked and came back null → skip.
  if (row.preview_lookup_at) {
    const last = Date.parse(row.preview_lookup_at);
    if (Number.isFinite(last)) {
      const age = Date.now() - last;
      if (age < RELOOKUP_AFTER_DAYS * 24 * 60 * 60 * 1000) return;
    }
  }
  const pending = inflight.get(albumId);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const result = await fetchAlbumPreview(spotifyUrl);
      if (result) {
        execute(
          `UPDATE albums
           SET preview_track_url = ?,
               preview_track_name = ?,
               preview_lookup_at = datetime('now')
           WHERE id = ?`,
          [result.previewUrl, result.trackName, albumId]
        );
      } else {
        // Stamp lookup_at so re-lookups back off; leave URL/name
        // null so the client keeps the disc without a play chip.
        execute(
          `UPDATE albums
           SET preview_lookup_at = datetime('now')
           WHERE id = ?`,
          [albumId]
        );
      }
    } finally {
      inflight.delete(albumId);
    }
  })();
  inflight.set(albumId, promise);
  return promise;
}
