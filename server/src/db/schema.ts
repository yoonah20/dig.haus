import type Database from 'better-sqlite3';

/**
 * Auto-migration: compare schema-defined columns with actual DB columns
 * and ALTER TABLE ADD COLUMN for any that are missing.
 */
function migrateTable(db: Database.Database, tableName: string, expectedColumns: string[]): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

  if (rows.length === 0) return; // table doesn't exist yet

  const existing = new Set(rows.map((r) => r.name));

  for (const col of expectedColumns) {
    const colName = col.trim().split(/\s+/)[0];
    if (!colName || existing.has(colName)) continue;
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col}`);
      console.log(`[migration] Added column ${tableName}.${colName}`);
    } catch (err: any) {
      if (!err.message?.includes('duplicate')) {
        console.error(`[migration] Failed to add ${tableName}.${colName}:`, err.message);
      }
    }
  }
}

/**
 * Recreate `tableName` with a new schema if its CREATE TABLE SQL does not already
 * include `ON DELETE CASCADE` on a FK to `fkTargetTable`. Preserves existing rows.
 */
function migrateToCascade(
  db: Database.Database,
  tableName: string,
  fkTargetTable: string,
  newCreateSql: string,
  copyColumns: string[]
): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { sql?: string } | undefined;
  if (!row?.sql) return; // table doesn't exist yet — initial CREATE already has CASCADE

  const cascadeRegex = new RegExp(
    `REFERENCES\\s+${fkTargetTable}\\s*\\([^)]+\\)\\s+ON\\s+DELETE\\s+CASCADE`,
    'i'
  );
  if (cascadeRegex.test(row.sql)) return; // already migrated

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}__legacy`);
    db.exec(newCreateSql);
    const cols = copyColumns.join(', ');
    db.exec(`INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM ${tableName}__legacy`);
    db.exec(`DROP TABLE ${tableName}__legacy`);
    db.exec('COMMIT');
    console.log(`[migration] ${tableName}: recreated with ON DELETE CASCADE to ${fkTargetTable}`);
  } catch (err: any) {
    db.exec('ROLLBACK');
    console.error(`[migration] ${tableName} CASCADE recreate failed:`, err.message);
    throw err;
  }
}

/**
 * Backfill a `-YYYY` year suffix onto any album slug that doesn't already have
 * one. Detects an existing year suffix permissively (ends in `-YYYY` or
 * `-YYYY-N`) so we don't double-append. Handles collisions by appending an
 * incrementing counter.
 */
function migrateSlugsAppendYear(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, slug, release_year, release_date
       FROM albums
       WHERE slug IS NOT NULL AND slug != ''`
    )
    .all() as Array<{
      id: number;
      slug: string;
      release_year: number | null;
      release_date: string | null;
    }>;

  const hasYearSuffix = (slug: string) => /-\d{4}(-\d+)?$/.test(slug);

  for (const row of rows) {
    if (hasYearSuffix(row.slug)) continue;

    const fromYear = row.release_year ?? undefined;
    const fromDate = row.release_date?.substring(0, 4);
    const year =
      fromYear && Number.isFinite(fromYear)
        ? String(fromYear)
        : fromDate && /^\d{4}$/.test(fromDate)
          ? fromDate
          : null;
    if (!year) continue;

    const base = `${row.slug}-${year}`;
    let candidate = base;
    let counter = 2;
    while (true) {
      const clash = db
        .prepare('SELECT id FROM albums WHERE slug = ? AND id != ?')
        .get(candidate, row.id);
      if (!clash) break;
      candidate = `${base}-${counter}`;
      counter++;
    }

    db.prepare('UPDATE albums SET slug = ? WHERE id = ?').run(candidate, row.id);
    console.log(`[migration] slug: ${row.slug} → ${candidate}`);
  }
}

/**
 * Run `fn` at most once per database, keyed by `name`. Uses the
 * `schema_migrations` table as a marker so the effect is idempotent across
 * server restarts. Intended for one-off data fixes (not schema DDL).
 */
function runOnce(db: Database.Database, name: string, fn: () => void): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const already = db
    .prepare('SELECT 1 FROM schema_migrations WHERE name = ?')
    .get(name);
  if (already) return;
  try {
    db.exec('BEGIN');
    fn();
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    db.exec('COMMIT');
    console.log(`[migration] applied: ${name}`);
  } catch (err: any) {
    db.exec('ROLLBACK');
    console.error(`[migration] ${name} failed:`, err?.message || err);
  }
}

export function initializeDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discogs_id INTEGER,
      mbid TEXT,
      name TEXT NOT NULL,
      founding_year INTEGER,
      country TEXT,
      genre_focus TEXT,
      logo_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mbid TEXT UNIQUE,
      slug TEXT UNIQUE,
      title TEXT NOT NULL,
      artist_name TEXT,
      artist_mbid TEXT,
      label_name TEXT,
      label_id INTEGER REFERENCES labels(id),
      release_year INTEGER,
      release_date TEXT,
      format TEXT,
      genres TEXT,
      cover_art_url TEXT,
      cover_art_fallbacks TEXT,
      spotify_url TEXT,
      apple_music_url TEXT,
      apple_music_embed_url TEXT,
      youtube_url TEXT,
      bandcamp_url TEXT,
      discogs_id INTEGER,
      discogs_artist_id INTEGER,
      discogs_url TEXT,
      discogs_median_price REAL,
      discogs_lowest_price REAL,
      discogs_copies_for_sale INTEGER,
      discogs_formats_json TEXT,
      discogs_formats_updated_at TEXT,
      artist_ko TEXT,
      title_ko TEXT,
      title_meaning TEXT,
      korean_summary TEXT,
      korean_summary_generated_at TEXT,
      similar_albums_ai TEXT,
      similar_albums_ai_generated_at TEXT,
      similar_albums_lastfm TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mbid TEXT UNIQUE,
      name TEXT NOT NULL,
      bio TEXT,
      photo_url TEXT,
      genres TEXT,
      last_fm_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_mbid TEXT NOT NULL,
      source_name TEXT NOT NULL,
      score REAL,
      score_max REAL,
      excerpt TEXT,
      excerpt_ko TEXT,
      full_review_url TEXT,
      manual_score REAL,
      scraped_at TEXT DEFAULT (datetime('now')),
      UNIQUE(album_mbid, source_name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS similar_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_mbid TEXT NOT NULL,
      similar_album_mbid TEXT,
      similar_album_title TEXT,
      similar_album_artist TEXT,
      reason_korean TEXT,
      source TEXT CHECK(source IN ('ai','lastfm','community')),
      upvotes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wishlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      album_id INTEGER REFERENCES albums(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      album_id INTEGER REFERENCES albums(id),
      format TEXT,
      press_info TEXT,
      condition TEXT,
      purchase_price REAL,
      purchase_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      url TEXT NOT NULL,
      store_name TEXT,
      store_favicon_url TEXT,
      price REAL,
      currency TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS album_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK(vote IN ('up','down')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      album_id INTEGER REFERENCES albums(id),
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dig_journal_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      album_id INTEGER REFERENCES albums(id),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      emoji TEXT,
      rating TEXT,
      UNIQUE(album_id, user_id)
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_user_reviews_album_id ON user_reviews(album_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_reviews_created_at ON user_reviews(created_at DESC)');
  migrateTable(db, 'user_reviews', ['emoji TEXT', 'rating TEXT']);

  db.exec(`
    CREATE TABLE IF NOT EXISTS album_dna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_album_id INTEGER REFERENCES albums(id),
      to_album_id INTEGER REFERENCES albums(id),
      relationship_type TEXT CHECK(relationship_type IN ('influenced_by','influenced')),
      upvotes INTEGER DEFAULT 0,
      added_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Auto-migrate
  migrateTable(db, 'albums', [
    'release_date TEXT',
    'discogs_artist_id INTEGER',
    'cover_art_fallbacks TEXT',
    'discogs_formats_json TEXT',
    'discogs_formats_updated_at TEXT',
    'apple_music_embed_url TEXT',
    'artist_ko TEXT',
    'title_ko TEXT',
    'title_meaning TEXT',
    'similar_albums_lastfm TEXT',
    'slug TEXT',
    'rank_score INTEGER DEFAULT 0',
    'rank_updated_at TEXT',
    'is_vinyl_wall INTEGER DEFAULT 0',
  ]);

  migrateTable(db, 'reviews', [
    'excerpt_ko TEXT',
    'manual_score REAL',
  ]);

  migrateTable(db, 'users', [
    'google_id TEXT',
    'name TEXT',
    'is_admin INTEGER DEFAULT 0',
  ]);

  migrateTable(db, 'purchase_links', [
    'store_favicon_url TEXT',
    'format TEXT',
    'note TEXT',
    'is_sold_out INTEGER DEFAULT 0',
    'status TEXT',
  ]);

  // Backfill: pre-existing sold-out rows lose no fidelity when we swap to the
  // `status` enum. Idempotent — admins who later edit the row can only do so
  // via `status`, so once it's set this WHERE clause no longer matches.
  try {
    db.exec(
      "UPDATE purchase_links SET status = 'soldout' WHERE is_sold_out = 1 AND (status IS NULL OR status = '')"
    );
  } catch {}

  // One-time FK migration: recreate album_votes / purchase_links with ON DELETE CASCADE
  // if an older database was created without it. Safe: preserves existing rows.
  migrateToCascade(db, 'album_votes', 'albums', `
    CREATE TABLE album_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK(vote IN ('up','down')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `, ['id', 'user_id', 'album_id', 'vote', 'created_at']);

  migrateToCascade(db, 'purchase_links', 'albums', `
    CREATE TABLE purchase_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      url TEXT NOT NULL,
      store_name TEXT,
      store_favicon_url TEXT,
      price REAL,
      currency TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `, ['id', 'album_id', 'user_id', 'url', 'store_name', 'store_favicon_url', 'price', 'currency', 'note', 'created_at']);

  migrateSlugsAppendYear(db);

  // Indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_albums_mbid ON albums(mbid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_artists_mbid ON artists(mbid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_album_mbid ON reviews(album_mbid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_similar_albums_album_mbid ON similar_albums(album_mbid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_albums_artist_mbid ON albums(artist_mbid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_album_votes_album_id ON album_votes(album_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_album_votes_user_id ON album_votes(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_album_votes_created_at ON album_votes(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_links_album_id ON purchase_links(album_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_albums_rank_score ON albums(rank_score DESC)');

  // One-off reset of stray votes on two specific albums. Runs once per DB
  // (tracked in schema_migrations). Clears album_votes and the mirrored
  // user_reviews.rating for each target; leaves review bodies intact.
  runOnce(db, 'reset-votes-incubus-hblockx-2026-04-15', () => {
    const slugs = [
      'incubus-beyond-the-unknown-1990',
      'h-blockx-time-to-move-1994',
    ];
    for (const slug of slugs) {
      const album = db
        .prepare('SELECT id FROM albums WHERE slug = ?')
        .get(slug) as { id: number } | undefined;
      if (!album) continue;
      const delVotes = db
        .prepare('DELETE FROM album_votes WHERE album_id = ?')
        .run(album.id);
      const clearRatings = db
        .prepare('UPDATE user_reviews SET rating = NULL WHERE album_id = ?')
        .run(album.id);
      console.log(
        `[migration] ${slug}: cleared ${delVotes.changes} votes, ${clearRatings.changes} review ratings`
      );
    }
  });
}
