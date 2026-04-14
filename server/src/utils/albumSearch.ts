import { queryAll } from '../db/index.js';

export interface DbSearchResult {
  mbid: string;
  title: string;
  artist: string;
  year: string | null;
  format: string | null;
  label: string | null;
  coverArtUrl: string | null;
  coverArtFallbacks: string[];
}

export function searchAlbumsInDb(rawQuery: string, limit = 25): DbSearchResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const like = `%${query}%`;
  const rows = queryAll(
    `SELECT slug, mbid, title, artist_name, release_date, release_year,
            label_name, cover_art_url, cover_art_fallbacks
     FROM albums
     WHERE LOWER(title) LIKE LOWER(?)
        OR LOWER(artist_name) LIKE LOWER(?)
     ORDER BY
       CASE WHEN LOWER(title) = LOWER(?) OR LOWER(artist_name) = LOWER(?) THEN 0 ELSE 1 END,
       CASE WHEN LOWER(title) LIKE LOWER(?) OR LOWER(artist_name) LIKE LOWER(?) THEN 0 ELSE 1 END,
       COALESCE(release_date, release_year || '-01-01') DESC
     LIMIT ?`,
    [like, like, query, query, `${query}%`, `${query}%`, limit]
  );

  return rows.map((a: any) => ({
    mbid: a.slug || a.mbid,
    title: a.title,
    artist: a.artist_name,
    year:
      a.release_date?.substring(0, 4) ||
      (a.release_year != null ? String(a.release_year) : null),
    format: null,
    label: a.label_name,
    coverArtUrl: a.cover_art_url,
    coverArtFallbacks: a.cover_art_fallbacks
      ? JSON.parse(a.cover_art_fallbacks)
      : [],
  }));
}
