// Detect and remove accidental duplicate album registrations.
//
// Same-mbid re-registration is deduped by getOrFetchAlbumBase, so a true
// duplicate always carries a fresh mbid (e.g. a `discogs-xxxx` fallback
// alongside the MusicBrainz release-group for the same record). That new
// mbid is why the slug collided and picked up the `-N` counter suffix from
// generateSlug (server/src/utils/slug.ts). So the signal is: a `base-N`
// (N>=2) slug whose base is another album's slug AND whose artist+title
// match the base row.
//
// Deletion is conservative. Only a duplicate carrying NO data worth keeping
// is deletable; any duplicate with user data (votes, 50자 평, purchase
// links, crate/wall/home references, wishlists) or scraped reviews is
// classified `has_data` and left for a manual merge decision, and a slug
// that looks like a counter dup but whose artist/title diverge is flagged
// `suspicious`. similar_albums is cheap regenerable data — it neither
// blocks a delete nor is preserved; it's cleaned up with the row.
//
// The tables that reference albums are discovered at runtime via PRAGMA,
// not hard-coded, so this stays correct as the schema drifts (샀음/살거
// having moved from collections/wants into crate_items is the motivating
// example). Shared by the /api/admin/duplicates route and the CLI script.

import type Database from 'better-sqlite3';

// similar_albums is cheap auto-regenerated data — its presence doesn't
// justify keeping a duplicate around, and it's cleaned up on delete.
const NON_BLOCKING_MBID_TABLES = new Set(['similar_albums']);

export type DuplicateStatus = 'deletable' | 'has_data' | 'suspicious';

export interface DuplicateEntry {
  id: number;
  slug: string;
  mbid: string;
  artist: string | null;
  title: string | null;
  year: number | null;
  cover: string | null;
  canonicalId: number;
  canonicalSlug: string;
  canonicalMbid: string;
  canonicalArtist: string | null;
  canonicalTitle: string | null;
  canonicalCover: string | null;
  status: DuplicateStatus;
  // Non-empty referencing data that blocks an automatic delete.
  blocking: { table: string; count: number }[];
  // similar_albums rows that would be cleaned up alongside a delete.
  similarCount: number;
}

interface AlbumRow {
  id: number;
  slug: string;
  mbid: string;
  artist_name: string | null;
  title: string | null;
  release_year: number | null;
  cover_art_url: string | null;
}

const norm = (s: string | null) =>
  (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

interface FkRef {
  table: string;
  col: string;
}

// Discover every table that references albums(id) and every table that
// carries a loose album_mbid link.
function referencingTables(db: Database.Database): {
  fkRefs: FkRef[];
  mbidTables: string[];
} {
  const tables = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]
  ).map((r) => r.name as string);

  const fkRefs: FkRef[] = [];
  const mbidTables: string[] = [];

  for (const t of tables) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[]) {
      if (fk.table === 'albums' && fk.to === 'id') {
        fkRefs.push({ table: t, col: fk.from });
      }
    }
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(
      (c) => c.name
    );
    if (cols.includes('album_mbid')) mbidTables.push(t);
  }
  return { fkRefs, mbidTables };
}

export function findDuplicates(db: Database.Database): DuplicateEntry[] {
  const { fkRefs, mbidTables } = referencingTables(db);

  const albums = db
    .prepare(
      `SELECT id, slug, mbid, artist_name, title, release_year, cover_art_url
       FROM albums WHERE slug IS NOT NULL AND slug != ''`
    )
    .all() as AlbumRow[];
  const bySlug = new Map(albums.map((a) => [a.slug, a]));

  const countByAlbumId = (table: string, col: string, id: number): number =>
    (
      db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`).get(id) as any
    ).n;
  const countByMbid = (table: string, mbid: string): number =>
    (
      db
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE album_mbid = ?`)
        .get(mbid) as any
    ).n;

  const entries: DuplicateEntry[] = [];

  for (const a of albums) {
    const m = /^(.+)-(\d+)$/.exec(a.slug);
    if (!m) continue;
    const base = m[1];
    const n = parseInt(m[2], 10);
    if (n < 2) continue; // generateSlug's counter starts at 2
    const canonical = bySlug.get(base);
    if (!canonical || canonical.id === a.id) continue;

    const suspicious =
      norm(canonical.artist_name) !== norm(a.artist_name) ||
      norm(canonical.title) !== norm(a.title);

    const blocking: { table: string; count: number }[] = [];
    let similarCount = 0;

    for (const fk of fkRefs) {
      const c = countByAlbumId(fk.table, fk.col, a.id);
      if (c > 0) blocking.push({ table: fk.table, count: c });
    }
    for (const t of mbidTables) {
      const c = countByMbid(t, a.mbid);
      if (c === 0) continue;
      if (NON_BLOCKING_MBID_TABLES.has(t)) similarCount += c;
      else blocking.push({ table: t, count: c });
    }

    const status: DuplicateStatus = suspicious
      ? 'suspicious'
      : blocking.length > 0
        ? 'has_data'
        : 'deletable';

    entries.push({
      id: a.id,
      slug: a.slug,
      mbid: a.mbid,
      artist: a.artist_name,
      title: a.title,
      year: a.release_year,
      cover: a.cover_art_url,
      canonicalId: canonical.id,
      canonicalSlug: canonical.slug,
      canonicalMbid: canonical.mbid,
      canonicalArtist: canonical.artist_name,
      canonicalTitle: canonical.title,
      canonicalCover: canonical.cover_art_url,
      status,
      blocking,
      similarCount,
    });
  }

  return entries;
}

// UNIQUE indexes on `table` that include `keyCol`, returned as the *other*
// columns of each such index — i.e. the columns that (together with the
// album key) define what "the same row" means, so we can detect a collision
// before re-pointing a row at the canonical album. An index that is unique
// on keyCol alone comes back as [].
function uniqueConflictGroups(
  db: Database.Database,
  table: string,
  keyCol: string
): string[][] {
  const groups: string[][] = [];
  for (const idx of db.prepare(`PRAGMA index_list("${table}")`).all() as any[]) {
    if (!idx.unique) continue;
    const cols = (
      db.prepare(`PRAGMA index_info("${idx.name}")`).all() as any[]
    ).map((c) => c.name);
    if (cols.includes(keyCol)) groups.push(cols.filter((c) => c !== keyCol));
  }
  return groups;
}

// Re-point every row that links to `dupKey` so it links to `canonKey`
// instead. Where moving a row would collide with an existing canonical row
// on a UNIQUE constraint (same user's vote, same review source, ...), the
// earlier-created row wins — rowid is monotonic with insertion, so the
// smaller rowid is the one made first ("먼저 만들어진 것 우선") — and the
// loser is dropped. Reports and other child rows ride along on rowid, or
// cascade-delete with their parent.
function moveRows(
  db: Database.Database,
  table: string,
  keyCol: string,
  dupKey: string | number,
  canonKey: string | number
): void {
  const groups = uniqueConflictGroups(db, table, keyCol);
  if (groups.length === 0) {
    db.prepare(`UPDATE "${table}" SET "${keyCol}" = ? WHERE "${keyCol}" = ?`).run(
      canonKey,
      dupKey
    );
    return;
  }

  const dupRows = db
    .prepare(`SELECT rowid AS _rid, * FROM "${table}" WHERE "${keyCol}" = ?`)
    .all(dupKey) as any[];
  const moveOne = db.prepare(
    `UPDATE "${table}" SET "${keyCol}" = ? WHERE rowid = ?`
  );
  const dropByRowid = db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`);

  for (const row of dupRows) {
    const conflicts: number[] = [];
    for (const others of groups) {
      if (others.length === 0) {
        const ex = db
          .prepare(`SELECT rowid AS r FROM "${table}" WHERE "${keyCol}" = ?`)
          .all(canonKey) as any[];
        conflicts.push(...ex.map((e) => e.r));
        continue;
      }
      const where = others.map((c) => `"${c}" IS ?`).join(' AND ');
      const ex = db
        .prepare(
          `SELECT rowid AS r FROM "${table}" WHERE "${keyCol}" = ? AND ${where}`
        )
        .all(canonKey, ...others.map((c) => row[c])) as any[];
      conflicts.push(...ex.map((e) => e.r));
    }

    if (conflicts.length === 0) {
      moveOne.run(canonKey, row._rid);
    } else if (row._rid < Math.min(...conflicts)) {
      // Duplicate's row was created first → it wins; drop the canonical
      // collisions, then move it over.
      for (const r of conflicts) dropByRowid.run(r);
      moveOne.run(canonKey, row._rid);
    } else {
      dropByRowid.run(row._rid);
    }
  }
}

// Merge a duplicate into its canonical album: move every referencing row
// (reviews, votes, 50자 평, purchase links, crate/wall/home refs, ...) onto
// the canonical album, drop the regenerable similar_albums rows, then delete
// the now-empty duplicate. Suspicious entries (artist/title diverge) are
// refused — those are probably genuinely different albums. Returns the
// canonical mbid so the caller can re-run the Korean review summary now that
// the reviews are combined.
export function mergeDuplicate(
  db: Database.Database,
  id: number
): {
  ok: boolean;
  canonicalMbid?: string;
  canonicalId?: number;
  reason?: string;
} {
  const entry = findDuplicates(db).find((e) => e.id === id);
  if (!entry) return { ok: false, reason: 'not a duplicate' };
  if (entry.status === 'suspicious') return { ok: false, reason: 'suspicious' };

  const { fkRefs, mbidTables } = referencingTables(db);

  const run = db.transaction(() => {
    for (const t of mbidTables) {
      if (NON_BLOCKING_MBID_TABLES.has(t)) {
        db.prepare(`DELETE FROM "${t}" WHERE album_mbid = ?`).run(entry.mbid);
        continue;
      }
      moveRows(db, t, 'album_mbid', entry.mbid, entry.canonicalMbid);
    }
    for (const fk of fkRefs) {
      moveRows(db, fk.table, fk.col, entry.id, entry.canonicalId);
    }
    db.prepare('DELETE FROM albums WHERE id = ?').run(entry.id);
  });

  try {
    run();
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
  return {
    ok: true,
    canonicalMbid: entry.canonicalMbid,
    canonicalId: entry.canonicalId,
  };
}

// Delete the given album ids, but ONLY those currently classified
// `deletable` — the safety gate is re-evaluated here so a stale or
// hand-crafted request can never remove a duplicate that carries data.
// Returns which ids were deleted and which were refused (with a reason).
export function deleteDeletableDuplicates(
  db: Database.Database,
  ids: number[]
): { deleted: number[]; refused: { id: number; reason: string }[] } {
  const wanted = new Set(ids);
  const entries = findDuplicates(db);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const deleted: number[] = [];
  const refused: { id: number; reason: string }[] = [];

  const delSimilar = db.prepare(
    'DELETE FROM similar_albums WHERE album_mbid = ?'
  );
  const delAlbum = db.prepare('DELETE FROM albums WHERE id = ?');
  const runOne = db.transaction((e: DuplicateEntry) => {
    delSimilar.run(e.mbid);
    delAlbum.run(e.id);
  });

  for (const id of wanted) {
    const e = byId.get(id);
    if (!e) {
      refused.push({ id, reason: 'not a duplicate' });
      continue;
    }
    if (e.status !== 'deletable') {
      refused.push({ id, reason: e.status });
      continue;
    }
    try {
      runOne(e);
      deleted.push(id);
    } catch (err: any) {
      // A FK RESTRICT violation means a referencing row appeared that we
      // didn't count — leave the row intact and report it.
      refused.push({ id, reason: err.message });
    }
  }

  return { deleted, refused };
}
