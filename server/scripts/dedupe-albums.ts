// Detect and remove accidental duplicate album registrations.
//
// A duplicate happens when the same album is registered twice under two
// different mbids (e.g. a MusicBrainz release-group and a `discogs-xxxx`
// fallback for the same record). Same-mbid re-registration is deduped by
// getOrFetchAlbumBase, so a true duplicate always carries a *new* mbid —
// which is exactly why its slug collided and picked up the `-N` counter
// suffix from generateSlug (server/src/utils/slug.ts). So the signal we
// key on is: slug `base-N` (N>=2) where `base` is another album's slug,
// AND the two rows share artist + title.
//
// Deletion policy (decided with the owner 2026-07-06): only auto-delete a
// duplicate that carries NO data worth keeping. If the duplicate has any
// user data (votes, 50자 평, purchase links, crate/wall/home references,
// wishlists) or scraped reviews, it is REPORTED and left in place for a
// manual merge decision — never silently deleted. similar_albums is the
// one exception: it's cheap auto-regenerated data, so it doesn't block a
// delete (and is cleaned up along with the row).
//
// The set of tables that reference albums is discovered at runtime via
// PRAGMA, not hard-coded, because the live schema drifts (샀음/살거 moved
// from collections/wants into crate_items, etc.) and the seed fixture is
// an old snapshot. Whatever the connected DB actually has, we count it.
//
// Usage:
//   cd server && npx tsx scripts/dedupe-albums.ts            # dry-run (report only)
//   cd server && npx tsx scripts/dedupe-albums.ts --apply    # delete the empty duplicates
//   DB_PATH=/path/to/prod.db npx tsx scripts/dedupe-albums.ts --apply
//
// Always run the dry-run first and read the report before --apply.

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'diggershaus.db');

// similar_albums is cheap auto-regenerated data — its presence doesn't
// justify keeping a duplicate around, and it's cleaned up on delete.
const NON_BLOCKING_MBID_TABLES = new Set(['similar_albums']);

interface AlbumRow {
  id: number;
  slug: string;
  mbid: string;
  artist_name: string | null;
  title: string | null;
  release_year: number | null;
}

const norm = (s: string | null) =>
  (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const db = new Database(dbPath, { readonly: !APPLY });
db.pragma('foreign_keys = ON');

// --- discover every table that references albums, and how ---------------
const allTables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
  .all()
  .map((r: any) => r.name as string);

interface FkRef {
  table: string;
  col: string;
  onDelete: string;
}
const fkRefs: FkRef[] = [];
const mbidTables: string[] = [];

for (const t of allTables) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[]) {
    if (fk.table === 'albums' && fk.to === 'id') {
      fkRefs.push({ table: t, col: fk.from, onDelete: fk.on_delete });
    }
  }
  const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(
    (c) => c.name
  );
  if (cols.includes('album_mbid')) mbidTables.push(t);
}

// Prepared counters keyed by (table, kind).
const countByAlbumId = (table: string, col: string, id: number): number =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`).get(id) as any)
    .n;
const countByMbid = (table: string, mbid: string): number =>
  (
    db
      .prepare(`SELECT COUNT(*) n FROM ${table} WHERE album_mbid = ?`)
      .get(mbid) as any
  ).n;

// --- find duplicate groups ----------------------------------------------
const albums = db
  .prepare(
    `SELECT id, slug, mbid, artist_name, title, release_year FROM albums
     WHERE slug IS NOT NULL AND slug != ''`
  )
  .all() as AlbumRow[];
const bySlug = new Map(albums.map((a) => [a.slug, a]));

interface DupInfo {
  dup: AlbumRow;
  canonical: AlbumRow;
  suspicious: boolean; // slug looks like a counter dup but artist/title differ
  blocking: { table: string; count: number }[]; // non-empty data that blocks delete
  similarCount: number;
}

const dups: DupInfo[] = [];

for (const a of albums) {
  const m = /^(.+)-(\d+)$/.exec(a.slug);
  if (!m) continue;
  const base = m[1];
  const n = parseInt(m[2], 10);
  if (n < 2) continue; // generateSlug's counter starts at 2
  const canonical = bySlug.get(base);
  if (!canonical) continue; // base isn't a real slug → not a counter dup
  if (canonical.id === a.id) continue;

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

  dups.push({ dup: a, canonical, suspicious, blocking, similarCount });
}

// --- report --------------------------------------------------------------
console.log(`\ndedupe-albums — ${APPLY ? 'APPLY' : 'dry-run'}`);
console.log(`db: ${dbPath}`);
console.log(
  `albums scanned: ${albums.length} | album-id FK tables: ${fkRefs.length} | mbid tables: ${mbidTables.length}`
);

if (dups.length === 0) {
  console.log('\nNo counter-suffix duplicates found. Nothing to do.\n');
  db.close();
  process.exit(0);
}

const deletable = dups.filter((d) => !d.suspicious && d.blocking.length === 0);
const blocked = dups.filter((d) => !d.suspicious && d.blocking.length > 0);
const suspicious = dups.filter((d) => d.suspicious);

const line = (d: DupInfo) => {
  const y = d.dup.release_year ? ` (${d.dup.release_year})` : '';
  return `  #${d.dup.id} ${d.dup.slug} [${d.dup.mbid}]  →  keep #${d.canonical.id} ${d.canonical.slug} [${d.canonical.mbid}]  "${d.dup.artist_name} — ${d.dup.title}"${y}`;
};

console.log(`\n== deletable (empty duplicates): ${deletable.length} ==`);
for (const d of deletable) {
  console.log(line(d));
  if (d.similarCount > 0)
    console.log(`      (will also drop ${d.similarCount} similar_albums rows)`);
}

if (blocked.length) {
  console.log(
    `\n== SKIPPED — has data, needs manual merge: ${blocked.length} ==`
  );
  for (const d of blocked) {
    console.log(line(d));
    console.log(
      `      data: ${d.blocking.map((b) => `${b.table}=${b.count}`).join(', ')}`
    );
  }
}

if (suspicious.length) {
  console.log(
    `\n== SKIPPED — slug looks like a dup but artist/title differ (likely NOT a duplicate): ${suspicious.length} ==`
  );
  for (const d of suspicious) {
    console.log(line(d));
    console.log(
      `      dup:       "${d.dup.artist_name} — ${d.dup.title}"`
    );
    console.log(
      `      canonical: "${d.canonical.artist_name} — ${d.canonical.title}"`
    );
  }
}

// --- apply ---------------------------------------------------------------
if (!APPLY) {
  console.log(
    `\nDry-run only. Re-run with --apply to delete the ${deletable.length} empty duplicate(s).\n`
  );
  db.close();
  process.exit(0);
}

if (deletable.length === 0) {
  console.log('\nNothing to delete (no empty duplicates).\n');
  db.close();
  process.exit(0);
}

const delSimilar = db.prepare('DELETE FROM similar_albums WHERE album_mbid = ?');
const delAlbum = db.prepare('DELETE FROM albums WHERE id = ?');

let deleted = 0;
const failures: { id: number; slug: string; err: string }[] = [];

const runOne = db.transaction((d: DupInfo) => {
  delSimilar.run(d.dup.mbid);
  delAlbum.run(d.dup.id);
});

for (const d of deletable) {
  try {
    runOne(d);
    deleted++;
    console.log(`deleted #${d.dup.id} ${d.dup.slug}`);
  } catch (e: any) {
    // A FK RESTRICT violation here means a referencing row appeared that we
    // didn't count (schema drift) — leave the row intact and report it.
    failures.push({ id: d.dup.id, slug: d.dup.slug, err: e.message });
  }
}

console.log(`\ndone: deleted ${deleted}/${deletable.length}`);
if (failures.length) {
  console.log(`failed (left intact):`);
  for (const f of failures) console.log(`  #${f.id} ${f.slug}: ${f.err}`);
}
console.log('');
db.close();
