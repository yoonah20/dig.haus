import { queryGet, queryAll, execute } from '../db/index.js';

export function getCachedAlbum(mbid: string): any | null {
  return queryGet('SELECT * FROM albums WHERE mbid = ?', [mbid]);
}

export function cacheAlbum(data: Record<string, any>): void {
  const genres = Array.isArray(data.genres) ? JSON.stringify(data.genres) : (data.genres ?? null);
  const similarAi = Array.isArray(data.similar_albums_ai)
    ? JSON.stringify(data.similar_albums_ai)
    : (data.similar_albums_ai ?? null);
  // artist_credit accepts either a pre-stringified JSON or an array
  // of `{name, mbid}` entries. Most callers pass the array straight
  // from MusicBrainz, but the Discogs path builds it inline as a
  // single-element array, so handle both shapes here rather than
  // forcing each call site to stringify.
  const artistCreditJson = Array.isArray(data.artist_credit)
    ? JSON.stringify(data.artist_credit)
    : (data.artist_credit_json ?? null);
  // secondary_types is stored as a JSON-encoded string array even
  // when empty (`'[]'`) so the search ORDER BY can test against a
  // single canonical "no secondary qualifier" representation. NULL
  // means "we never resolved this album's release-group type"
  // (legacy / Discogs-only registration) — ranked alongside non-
  // canonical until the admin backfill fills it in.
  const secondaryTypes = Array.isArray(data.secondary_types)
    ? JSON.stringify(data.secondary_types)
    : (data.secondary_types ?? null);

  execute(`
    INSERT INTO albums (
      mbid, slug, title, artist_name, artist_mbid, artist_credit_json,
      label_name, label_id,
      release_year, release_date, format, genres, cover_art_url, cover_art_fallbacks,
      spotify_url, youtube_url, bandcamp_url,
      discogs_id, discogs_artist_id, discogs_url, discogs_median_price, discogs_lowest_price, discogs_copies_for_sale,
      discogs_formats_json, discogs_formats_updated_at,
      korean_summary, korean_summary_generated_at,
      similar_albums_ai, similar_albums_ai_generated_at,
      primary_type, secondary_types,
      updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      datetime('now')
    )
    ON CONFLICT(mbid) DO UPDATE SET
      slug = COALESCE(excluded.slug, slug),
      title = COALESCE(excluded.title, title),
      artist_name = COALESCE(excluded.artist_name, artist_name),
      artist_mbid = COALESCE(excluded.artist_mbid, artist_mbid),
      artist_credit_json = COALESCE(excluded.artist_credit_json, artist_credit_json),
      label_name = COALESCE(excluded.label_name, label_name),
      label_id = COALESCE(excluded.label_id, label_id),
      release_year = COALESCE(excluded.release_year, release_year),
      release_date = COALESCE(excluded.release_date, release_date),
      format = COALESCE(excluded.format, format),
      genres = COALESCE(excluded.genres, genres),
      cover_art_url = COALESCE(excluded.cover_art_url, cover_art_url),
      cover_art_fallbacks = COALESCE(excluded.cover_art_fallbacks, cover_art_fallbacks),
      spotify_url = COALESCE(excluded.spotify_url, spotify_url),
      youtube_url = COALESCE(excluded.youtube_url, youtube_url),
      bandcamp_url = COALESCE(excluded.bandcamp_url, bandcamp_url),
      discogs_id = COALESCE(excluded.discogs_id, discogs_id),
      discogs_artist_id = COALESCE(excluded.discogs_artist_id, discogs_artist_id),
      discogs_url = COALESCE(excluded.discogs_url, discogs_url),
      discogs_median_price = COALESCE(excluded.discogs_median_price, discogs_median_price),
      discogs_lowest_price = COALESCE(excluded.discogs_lowest_price, discogs_lowest_price),
      discogs_copies_for_sale = COALESCE(excluded.discogs_copies_for_sale, discogs_copies_for_sale),
      discogs_formats_json = COALESCE(excluded.discogs_formats_json, discogs_formats_json),
      discogs_formats_updated_at = COALESCE(excluded.discogs_formats_updated_at, discogs_formats_updated_at),
      korean_summary = COALESCE(excluded.korean_summary, korean_summary),
      korean_summary_generated_at = COALESCE(excluded.korean_summary_generated_at, korean_summary_generated_at),
      similar_albums_ai = COALESCE(excluded.similar_albums_ai, similar_albums_ai),
      similar_albums_ai_generated_at = COALESCE(excluded.similar_albums_ai_generated_at, similar_albums_ai_generated_at),
      primary_type = COALESCE(excluded.primary_type, primary_type),
      secondary_types = COALESCE(excluded.secondary_types, secondary_types),
      updated_at = datetime('now')
  `, [
    data.mbid ?? null, data.slug ?? null, data.title ?? null, data.artist_name ?? null, data.artist_mbid ?? null, artistCreditJson,
    data.label_name ?? null, data.label_id ?? null,
    data.release_year ?? null, data.release_date ?? null, data.format ?? null, genres, data.cover_art_url ?? null,
    data.cover_art_fallbacks ? JSON.stringify(data.cover_art_fallbacks) : null,
    data.spotify_url ?? null,
    data.youtube_url ?? null, data.bandcamp_url ?? null,
    data.discogs_id ?? null, data.discogs_artist_id ?? null, data.discogs_url ?? null,
    data.discogs_median_price ?? null, data.discogs_lowest_price ?? null, data.discogs_copies_for_sale ?? null,
    data.discogs_formats_json ?? null, data.discogs_formats_json ? new Date().toISOString() : null,
    data.korean_summary ?? null, data.korean_summary_generated_at ?? null,
    similarAi, data.similar_albums_ai_generated_at ?? null,
    data.primary_type ?? null, secondaryTypes,
  ]);
}

export function updateAlbumFields(mbid: string, fields: Record<string, any>): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value ?? null);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = datetime(\'now\')');
  values.push(mbid);
  execute(`UPDATE albums SET ${sets.join(', ')} WHERE mbid = ?`, values);
}

export function getCachedReviews(albumMbid: string): any[] | null {
  const rows = queryAll(
    'SELECT * FROM reviews WHERE album_mbid = ?',
    [albumMbid]
  );
  return rows.length > 0 ? rows : null;
}

export function cacheReviews(albumMbid: string, reviews: Array<Record<string, any>>): void {
  execute('DELETE FROM reviews WHERE album_mbid = ?', [albumMbid]);
  for (const review of reviews) {
    execute(
      `INSERT OR REPLACE INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        albumMbid,
        review.source_name ?? null,
        review.score ?? null,
        review.score_max ?? null,
        review.excerpt ?? null,
        review.excerpt_ko ?? null,
        review.full_review_url ?? null,
      ]
    );
  }
}

export function getCachedArtist(mbid: string): any | null {
  return queryGet('SELECT * FROM artists WHERE mbid = ?', [mbid]);
}

export function cacheArtist(data: Record<string, any>): void {
  const genres = Array.isArray(data.genres) ? JSON.stringify(data.genres) : (data.genres ?? null);

  execute(`
    INSERT INTO artists (mbid, name, bio, photo_url, genres, last_fm_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(mbid) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      bio = COALESCE(excluded.bio, bio),
      photo_url = COALESCE(excluded.photo_url, photo_url),
      genres = COALESCE(excluded.genres, genres),
      last_fm_url = COALESCE(excluded.last_fm_url, last_fm_url),
      updated_at = datetime('now')
  `, [
    data.mbid ?? null, data.name ?? null, data.bio ?? null,
    data.photo_url ?? null, genres, data.last_fm_url ?? null,
  ]);
}

export function isKoreanSummaryCached(mbid: string): boolean {
  const row = queryGet('SELECT korean_summary FROM albums WHERE mbid = ? AND korean_summary IS NOT NULL', [mbid]);
  return !!row;
}

