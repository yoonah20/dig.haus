// CLI wrapper around services/albumDedupe.ts. The same detection + delete
// logic backs the /admin 정리 page; this is the shell-based fallback for
// running against an arbitrary DB (a downloaded prod copy, a local dev DB).
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
import {
  findDuplicates,
  deleteDeletableDuplicates,
  type DuplicateEntry,
} from '../src/services/albumDedupe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'diggershaus.db');

const db = new Database(dbPath, { readonly: !APPLY });
db.pragma('foreign_keys = ON');

const entries = findDuplicates(db);
const deletable = entries.filter((e) => e.status === 'deletable');
const blocked = entries.filter((e) => e.status === 'has_data');
const suspicious = entries.filter((e) => e.status === 'suspicious');

const line = (e: DuplicateEntry) => {
  const y = e.year ? ` (${e.year})` : '';
  return `  #${e.id} ${e.slug} [${e.mbid}]  →  keep #${e.canonicalId} ${e.canonicalSlug} [${e.canonicalMbid}]  "${e.artist} — ${e.title}"${y}`;
};

console.log(`\ndedupe-albums — ${APPLY ? 'APPLY' : 'dry-run'}`);
console.log(`db: ${dbPath}`);

if (entries.length === 0) {
  console.log('\nNo counter-suffix duplicates found. Nothing to do.\n');
  db.close();
  process.exit(0);
}

console.log(`\n== deletable (empty duplicates): ${deletable.length} ==`);
for (const e of deletable) {
  console.log(line(e));
  if (e.similarCount > 0)
    console.log(`      (will also drop ${e.similarCount} similar_albums rows)`);
}

if (blocked.length) {
  console.log(`\n== SKIPPED — has data, needs manual merge: ${blocked.length} ==`);
  for (const e of blocked) {
    console.log(line(e));
    console.log(
      `      data: ${e.blocking.map((b) => `${b.table}=${b.count}`).join(', ')}`
    );
  }
}

if (suspicious.length) {
  console.log(
    `\n== SKIPPED — slug looks like a dup but artist/title differ (likely NOT a duplicate): ${suspicious.length} ==`
  );
  for (const e of suspicious) {
    console.log(line(e));
    console.log(`      dup:       "${e.artist} — ${e.title}"`);
    console.log(`      canonical: "${e.canonicalArtist} — ${e.canonicalTitle}"`);
  }
}

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

const { deleted, refused } = deleteDeletableDuplicates(
  db,
  deletable.map((e) => e.id)
);
console.log(`\ndone: deleted ${deleted.length}/${deletable.length}`);
if (refused.length) {
  console.log('refused (left intact):');
  for (const r of refused) console.log(`  #${r.id}: ${r.reason}`);
}
console.log('');
db.close();
