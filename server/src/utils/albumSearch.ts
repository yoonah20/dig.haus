import { queryAll } from '../db/index.js';

// Strip artist/album separators that copy-pastes from other sites
// drag in. "Skymning - Stormchoirs" / "Skymning – Stormchoirs" /
// "Skymning : Stormchoirs" / "DARKWATER / Human" should behave the
// same as "Skymning Stormchoirs"; otherwise the punctuation
// propagates as a literal token, confusing both the LIKE clause and
// MusicBrainz's query parser.
//
// Only strips separators surrounded by whitespace, so intra-word
// punctuation like "AC-DC", "AC/DC" or "Sigur Rós" is preserved.
//
// Character class: ASCII hyphen + Unicode hyphen-and-dashes block
// (U+2010 hyphen, U+2011 non-breaking, U+2012 figure dash,
// U+2013 en dash, U+2014 em dash, U+2015 horizontal bar) + colon
// + pipe + middle dot (U+00B7) + forward slash.
const SEPARATOR_RE = /\s+[-‐-―:|·/]+\s+/g;

export function normalizeSearchQuery(raw: string): string {
  return raw
    .replace(SEPARATOR_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DbSearchResult {
  // Numeric primary key — added 2026-05-17 so callers that need to
  // mutate the album (add to a crate, etc.) don't have to round-trip
  // through a separate mbid → id lookup. The home search bar treats
  // it as optional.
  id: number;
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
  const query = normalizeSearchQuery(rawQuery);
  if (!query) return [];

  const like = `%${query}%`;
  // Ranking tiers, in priority order:
  //   1. Exact title or artist match
  //   2. Prefix title or artist match
  //   3. Canonical studio LP — primary_type='Album' AND no secondary
  //      types (Live / Compilation / Soundtrack / Remix / Demo /
  //      DJ-mix / Mixtape / Interview / Spokenword pull the album
  //      OUT of this tier). NULL primary_type is treated as canonical
  //      so legacy rows that pre-date the column aren't penalised.
  //      Empty `'[]'` and NULL on secondary_types both behave as
  //      "no secondary qualifier".
  //   4. Recency — release_date DESC. Operator-requested tiebreaker
  //      so newer releases within the same tier surface first.
  const rows = queryAll(
    `SELECT id, slug, mbid, title, artist_name, release_date, release_year,
            label_name, cover_art_url, cover_art_fallbacks
     FROM albums
     WHERE LOWER(title) LIKE LOWER(?)
        OR LOWER(artist_name) LIKE LOWER(?)
     ORDER BY
       CASE WHEN LOWER(title) = LOWER(?) OR LOWER(artist_name) = LOWER(?) THEN 0 ELSE 1 END,
       CASE WHEN LOWER(title) LIKE LOWER(?) OR LOWER(artist_name) LIKE LOWER(?) THEN 0 ELSE 1 END,
       CASE WHEN (primary_type = 'Album' OR primary_type IS NULL)
                 AND (secondary_types IS NULL OR secondary_types = '' OR secondary_types = '[]')
            THEN 0 ELSE 1 END,
       COALESCE(release_date, release_year || '-01-01') DESC
     LIMIT ?`,
    [like, like, query, query, `${query}%`, `${query}%`, limit]
  );

  return rows.map((a: any) => ({
    id: a.id,
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
