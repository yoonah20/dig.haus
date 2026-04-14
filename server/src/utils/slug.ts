import anyAscii from 'any-ascii';
import { queryGet } from '../db/index.js';

/**
 * Generate a URL-safe slug from artist + album title.
 * - Transliterates non-Latin characters (CJK, Korean, etc.)
 * - Lowercases, replaces spaces with hyphens, strips special chars
 * - Always appends year when available (e.g. `hellripper-coronach-2026`)
 * - Falls back to "artist-{id}" if transliteration produces empty result
 */
export function generateSlug(
  artist: string,
  title: string,
  year?: string | number | null,
  fallbackId?: string | number | null
): string {
  let base = slugify(`${artist} ${title}`);

  // If transliteration produced nothing useful, fallback
  if (base.length < 2 && fallbackId) {
    base = slugify(artist) || 'album';
    base = `${base}-${fallbackId}`;
  }

  const yearStr = year != null && String(year).trim().length > 0 ? String(year).trim() : null;
  let slug = yearStr ? `${base}-${yearStr}` : base;

  // Collision handling: append incrementing counter (reissue of same base+year)
  let counter = 2;
  while (queryGet('SELECT mbid FROM albums WHERE slug = ?', [slug])) {
    slug = yearStr ? `${base}-${yearStr}-${counter}` : `${base}-${counter}`;
    counter++;
  }

  return slug;
}

function slugify(text: string): string {
  return anyAscii(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // remove special chars
    .replace(/\s+/g, '-')          // spaces → hyphens
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
}

/**
 * Look up album by slug or mbid (backward compat).
 * Also accepts legacy slugs without a year suffix — matches any current slug
 * of the form `{given}-YYYY` or `{given}-YYYY-N`.
 */
export function resolveAlbumId(slugOrMbid: string): { mbid: string } | null {
  // Exact slug match
  const bySlug = queryGet('SELECT mbid FROM albums WHERE slug = ?', [slugOrMbid]);
  if (bySlug) return { mbid: bySlug.mbid };

  // Exact mbid match
  const byMbid = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [slugOrMbid]);
  if (byMbid) return { mbid: byMbid.mbid };

  // Legacy slug without year → new slug with `-YYYY` appended (maybe `-YYYY-N`)
  const byYearSuffix = queryGet(
    `SELECT mbid FROM albums WHERE slug LIKE ? AND slug GLOB ? LIMIT 1`,
    [`${slugOrMbid}-%`, `${slugOrMbid}-[0-9][0-9][0-9][0-9]*`]
  );
  if (byYearSuffix) return { mbid: byYearSuffix.mbid };

  return null;
}

/**
 * Resolve slug-or-mbid to the numeric albums.id primary key.
 * Used by Phase 2 tables (album_votes, purchase_links) that join on albums(id).
 */
export function resolveAlbumPk(slugOrMbid: string): number | null {
  const row = queryGet(
    'SELECT id FROM albums WHERE slug = ? OR mbid = ? LIMIT 1',
    [slugOrMbid, slugOrMbid]
  );
  return row?.id ?? null;
}

