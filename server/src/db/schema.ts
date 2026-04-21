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
 * Recreate `tableName` so its FK to `users` uses `ON DELETE SET NULL` on
 * `userIdColumn`, allowing the column to become NULL when a user is deleted.
 * Idempotent: skips when the table already has the clause. Preserves rows.
 *
 * Used to preserve a user's contributions (reviews, votes) after they
 * delete their account — the account row goes away, the content stays,
 * and the user_id is anonymised to NULL.
 */
function migrateUserFkToSetNull(
  db: Database.Database,
  tableName: string,
  userIdColumn: string,
  newCreateSql: string,
  copyColumns: string[]
): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { sql?: string } | undefined;
  if (!row?.sql) return; // table doesn't exist yet — initial CREATE is already correct

  // Already migrated? Check for ON DELETE SET NULL on a FK to users.
  // The pattern is loose enough to tolerate the column/targets being on
  // either side of the REFERENCES clause.
  const setNullRegex =
    /REFERENCES\s+users\s*\([^)]+\)\s+ON\s+DELETE\s+SET\s+NULL/i;
  if (setNullRegex.test(row.sql)) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}__legacy`);
    db.exec(newCreateSql);
    const cols = copyColumns.join(', ');
    db.exec(`INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM ${tableName}__legacy`);
    db.exec(`DROP TABLE ${tableName}__legacy`);
    db.exec('COMMIT');
    console.log(
      `[migration] ${tableName}: recreated with ${userIdColumn} nullable + ON DELETE SET NULL`
    );
  } catch (err: any) {
    db.exec('ROLLBACK');
    console.error(`[migration] ${tableName} SET NULL recreate failed:`, err.message);
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

  // Tracks every URL-scrape attempt that didn't yield a usable review.
  // Purpose is diagnostic — grouping by hostname surfaces sites that
  // consistently fail (bot-walls, dynamic-JS rendering, paywalls,
  // page layouts our Claude prompt doesn't understand) so we can
  // decide which ones are worth site-specific parsers vs. leaving on
  // the paste-in fallback. Intentionally append-only — retries from
  // the same admin produce multiple rows, because the frequency IS
  // the signal.
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      hostname TEXT NOT NULL,
      album_mbid TEXT,
      reason TEXT NOT NULL,
      error_message TEXT,
      failed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scrape_failures_hostname ON scrape_failures(hostname)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scrape_failures_failed_at ON scrape_failures(failed_at)`);

  // Curation runs — one row per album processed by the admin one-click
  // or batch curation pipeline (discover → add-url × N → summary).
  // Used for the "큐레이션 이력" panel in /admin: shows per-album
  // stats (URLs found vs. saved, duplicate count, failure count,
  // whether a summary landed, approximate cost) so admin can see
  // where the pipeline drifted over time without trawling server logs.
  // trigger_kind distinguishes one-click (single album, album page) from
  // batch (checkbox selection, /admin page) even though both use the
  // same pipeline — useful for spotting "my click rate produced N
  // failures today" vs. "that 20-album batch had a bad run".
  db.exec(`
    CREATE TABLE IF NOT EXISTS curation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      album_mbid TEXT NOT NULL,
      album_title TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      urls_found INTEGER NOT NULL DEFAULT 0,
      urls_saved INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      summary_generated INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'done',
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_curation_runs_finished_at ON curation_runs(finished_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_curation_runs_run_id ON curation_runs(run_id)`);

  // Data-collection feed for the Korean-term normalisation list. Every
  // time admin edits a review's excerpt_ko (PATCH /api/albums/reviews/:id/excerpt)
  // we stash the before/after pair here. Intent is NOT to build an
  // undo feature — it's to accumulate a corpus of real corrections so
  // we can periodically diff old→new and extract recurring patterns
  // (ex. "오래된 학교" → "올드 스쿨" showing up 10+ times means it's
  // worth a KO_TERM_REPLACEMENTS entry). Only rows where the text
  // actually changed get logged.
  db.exec(`
    CREATE TABLE IF NOT EXISTS excerpt_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL,
      old_excerpt_ko TEXT,
      new_excerpt_ko TEXT,
      edited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      edited_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_excerpt_edits_edited_at ON excerpt_edits(edited_at)`);

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

  // 샀음 (collections) + 살거 (wants). Per-format ownership — a
  // collector can own the vinyl and want the CD of the same title,
  // so UNIQUE spans (user_id, album_id, format) not just the pair.
  // Fresh installs land on this shape directly; existing installs
  // migrate via the recreate block below.
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'Vinyl'
        CHECK(format IN ('Vinyl','CD','Cassette')),
      press_info TEXT,
      condition TEXT,
      purchase_price REAL,
      purchase_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id, format)
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

  // User-submitted reports on purchase links. A logged-in user who
  // isn't the link's author can flag a link as one of three reasons;
  // UNIQUE(link_id, user_id) prevents the same reporter from spamming
  // multiple reports on the same link (they can delete + re-submit
  // with a different reason if needed). Admin dashboard groups by
  // link_id to surface the most-reported items first.
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_link_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL REFERENCES purchase_links(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL CHECK(reason IN ('soldout','price','expired')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(link_id, user_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_link_reports_link ON purchase_link_reports(link_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_link_reports_created ON purchase_link_reports(created_at DESC)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS album_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK(vote IN ('up','down')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'Vinyl'
        CHECK(format IN ('Vinyl','CD','Cassette')),
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id, format)
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
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

  // One row per Claude API call so the admin dashboard can show a
  // rolling token / web-search / cost breakdown without hitting the
  // Anthropic console. `operation` is a free-form string the call
  // site passes (e.g. 'reviews_search', 'pronunciation') — used for
  // per-operation cost attribution. No FK on model; it's just the
  // string Anthropic returned in the response.
  db.exec(`
    CREATE TABLE IF NOT EXISTS claude_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      web_search_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_claude_usage_created_at ON claude_usage_log(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_claude_usage_operation ON claude_usage_log(operation, created_at DESC)');

  // Shadow-comparison log. Populated only when LLM_COMPARE=1 is set in
  // the environment — each row pairs the primary LLM response (Haiku
  // or Sonnet) with a DeepSeek shadow response for the SAME prompt, so
  // admin can eyeball output quality and cost side-by-side before
  // deciding to switch providers. Fire-and-forget from the hot path
  // (the primary response is returned immediately; shadow runs in the
  // background and inserts when it resolves). prompt_preview is capped
  // at 500 chars — enough to identify the call, not enough to balloon
  // the table with full prompts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_comparison_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      album_mbid TEXT,
      album_title TEXT,
      prompt_preview TEXT,
      primary_model TEXT NOT NULL,
      primary_output TEXT,
      primary_input_tokens INTEGER DEFAULT 0,
      primary_output_tokens INTEGER DEFAULT 0,
      primary_latency_ms INTEGER DEFAULT 0,
      shadow_model TEXT NOT NULL,
      shadow_output TEXT,
      shadow_input_tokens INTEGER DEFAULT 0,
      shadow_output_tokens INTEGER DEFAULT 0,
      shadow_latency_ms INTEGER DEFAULT 0,
      shadow_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_comparison_created_at ON llm_comparison_log(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_comparison_operation ON llm_comparison_log(operation, created_at DESC)');

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
    // Marker set when the expensive review-search pipeline has run
    // against an album. NULL means "user-submitted, not yet approved
    // for review crawl". Home grid dims cards with NULL, and the
    // album-detail review section swaps in a placeholder.
    'reviews_crawled_at TEXT',
    // Non-null when a regular user (not admin) registered this album
    // — powers the "50 per day" cap and the admin's "리뷰 수집 대기"
    // queue. Admin-registered rows stay NULL.
    'requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
  ]);

  // One-time backfill: every album that existed BEFORE we split the
  // pipeline is treated as fully crawled so none of them get dimmed on
  // the home grid. Idempotent via schema_migrations.
  try {
    const row = db
      .prepare(`SELECT name FROM schema_migrations WHERE name = ?`)
      .get('backfill-reviews-crawled-at-2026-04-17') as { name: string } | undefined;
    if (!row) {
      db.exec(
        `UPDATE albums
         SET reviews_crawled_at = COALESCE(updated_at, datetime('now'))
         WHERE reviews_crawled_at IS NULL`
      );
      db.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(
        'backfill-reviews-crawled-at-2026-04-17'
      );
      console.log('[migration] backfilled reviews_crawled_at on existing albums');
    }
  } catch (err) {
    console.error('[migration] backfill reviews_crawled_at failed:', err);
  }

  migrateTable(db, 'reviews', [
    'excerpt_ko TEXT',
    'manual_score REAL',
  ]);

  migrateTable(db, 'users', [
    'google_id TEXT',
    'name TEXT',
    'is_admin INTEGER DEFAULT 0',
    // User-editable overrides. Kept separate from `name`/`avatar_url`
    // (which passport overwrites on every Google login) so custom values
    // survive re-auth.
    'display_name TEXT',
    'custom_avatar_url TEXT',
    'instagram_handle TEXT',
    // Phase 3 mydig. `username` is the URL slug (lowercase a-z0-9_-,
    // 3-20 chars) — no UNIQUE in migrateTable (it's ALTER TABLE which
    // doesn't add constraints), so a partial unique index is added
    // separately below. `mydig_public` is the per-user privacy
    // master toggle; NULL/1 = public, 0 = private (renders under-
    // construction placeholder for non-owners).
    'username TEXT',
    'mydig_public INTEGER DEFAULT 1',
  ]);

  // Partial unique index — enforces uniqueness only on rows that have
  // actually claimed a username. Users who haven't onboarded yet keep
  // `username` NULL without colliding.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
     ON users(LOWER(username))
     WHERE username IS NOT NULL`
  );

  migrateTable(db, 'purchase_links', [
    'store_favicon_url TEXT',
    'format TEXT',
    'note TEXT',
    'is_sold_out INTEGER DEFAULT 0',
    'status TEXT',
  ]);

  // Phase 3a label-tracking feed. Admin subscribes to specific Spotify
  // label names; a daily cron polls `label:"X" tag:new` and fills
  // label_feed_items with whatever albums Spotify's ~14-day "new"
  // window surfaces. Admin then hand-picks which items to promote
  // into the main `albums` table via the feed UI — intentionally
  // NOT automatic, since Spotify's label field is noisy enough that
  // we don't want to pollute the public catalog without human review.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_label_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_polled_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS label_feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracked_label_id INTEGER NOT NULL REFERENCES tracked_labels(id) ON DELETE CASCADE,
      spotify_album_id TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      album_name TEXT NOT NULL,
      release_date TEXT,
      cover_art_url TEXT,
      spotify_url TEXT,
      album_type TEXT,
      total_tracks INTEGER,
      first_seen_at TEXT DEFAULT (datetime('now')),
      dismissed_at TEXT,
      registered_mbid TEXT,
      UNIQUE(tracked_label_id, spotify_album_id)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_label_feed_active
     ON label_feed_items(dismissed_at, registered_mbid)
     WHERE dismissed_at IS NULL AND registered_mbid IS NULL`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_label_feed_release_date
     ON label_feed_items(release_date DESC)`
  );

  // Format-aware collections + wants — one row per (user, album, format).
  // v1 of the ownership feature keyed on (user, album) only and
  // collections had no UNIQUE at all; this migration recreates both
  // tables with UNIQUE(user_id, album_id, format) + format NOT NULL so
  // a collector can own vinyl and want CD of the same title. Any
  // legacy rows from the brief v1 window get format='Vinyl' by
  // default (safe: it's the most common format and the user can
  // re-toggle if wrong). Idempotent via schema_migrations.
  try {
    const row = db
      .prepare(`SELECT name FROM schema_migrations WHERE name = ?`)
      .get('format-aware-collections-wants-2026-04-18') as
      | { name: string }
      | undefined;
    if (!row) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        CREATE TABLE collections_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
          format TEXT NOT NULL DEFAULT 'Vinyl'
            CHECK(format IN ('Vinyl','CD','Cassette')),
          press_info TEXT,
          condition TEXT,
          purchase_price REAL,
          purchase_date TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, album_id, format)
        )
      `);
      db.exec(`
        INSERT INTO collections_new
          (id, user_id, album_id, format, press_info, condition,
           purchase_price, purchase_date, created_at)
        SELECT id, user_id, album_id,
               COALESCE(
                 CASE WHEN format IN ('Vinyl','CD','Cassette') THEN format END,
                 'Vinyl'
               ),
               press_info, condition, purchase_price, purchase_date, created_at
        FROM collections
        WHERE user_id IS NOT NULL AND album_id IS NOT NULL
      `);
      db.exec(`DROP TABLE collections`);
      db.exec(`ALTER TABLE collections_new RENAME TO collections`);

      db.exec(`
        CREATE TABLE wants_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
          format TEXT NOT NULL DEFAULT 'Vinyl'
            CHECK(format IN ('Vinyl','CD','Cassette')),
          note TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, album_id, format)
        )
      `);
      db.exec(`
        INSERT INTO wants_new
          (id, user_id, album_id, format, note, created_at)
        SELECT id, user_id, album_id, 'Vinyl', note, created_at
        FROM wants
        WHERE user_id IS NOT NULL AND album_id IS NOT NULL
      `);
      db.exec(`DROP TABLE wants`);
      db.exec(`ALTER TABLE wants_new RENAME TO wants`);
      db.exec('PRAGMA foreign_keys = ON');

      db.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(
        'format-aware-collections-wants-2026-04-18'
      );
      console.log('[migration] recreated collections + wants with per-format UNIQUE');
    }
  } catch (err) {
    console.error('[migration] format-aware collections/wants failed:', err);
    try { db.exec('PRAGMA foreign_keys = ON'); } catch {}
  }

  // Drop the legacy album_requests table. User submissions have been
  // stored directly on `albums` via `requested_by_user_id` since the
  // pipeline split, and the notifier cron that was the last consumer
  // of this table has been removed. Kept in a runOnce block so local
  // databases that still hold the table get cleaned up on next boot;
  // production already lost the cron reader at the same deploy.
  runOnce(db, 'drop-legacy-album-requests-2026-04-21', () => {
    db.exec('DROP TABLE IF EXISTS album_requests');
    console.log('[migration] dropped legacy album_requests table');
  });

  // Purge reviews saved under URLs the curator has since blacklisted.
  // Historical rows linger after a blacklist addition (the filter only
  // stops future saves), so this one-shot migration wipes any row whose
  // full_review_url matches today's excluded-domain / excluded-path
  // list. Covers:
  //   - sputnikmusic.com/soundoff.php (user-rating aggregator, not editorial)
  //   - metalepidemic.com (podcast stub pages, no prose)
  //   - Social media: x.com, twitter.com, facebook.com, instagram.com,
  //     threads.net, tiktok.com, bsky.app, t.me, reddit.com
  runOnce(db, 'purge-blacklisted-review-urls-2026-04-21', () => {
    const patterns = [
      '%sputnikmusic.com/soundoff.php%',
      '%metalepidemic.com/%',
      '%x.com/%',
      '%twitter.com/%',
      '%facebook.com/%',
      '%instagram.com/%',
      '%threads.net/%',
      '%tiktok.com/%',
      '%bsky.app/%',
      '%t.me/%',
      '%reddit.com/%',
    ];
    let total = 0;
    for (const p of patterns) {
      const info = db.prepare('DELETE FROM reviews WHERE full_review_url LIKE ?').run(p);
      total += info.changes as number;
    }
    if (total > 0) {
      console.log(`[migration] purged ${total} blacklisted review rows`);
    }
  });

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

  // One-time FK migration: recreate user_reviews / album_votes so that
  // deleting a user anonymises the row (user_id → NULL) instead of wiping
  // the content away. The user's own profile disappears, but the 50자 평
  // bodies and 굿굿/별루 votes they left stay attached to the album.
  migrateUserFkToSetNull(db, 'user_reviews', 'user_id', `
    CREATE TABLE user_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      emoji TEXT,
      rating TEXT,
      UNIQUE(album_id, user_id)
    )
  `, ['id', 'album_id', 'user_id', 'body', 'created_at', 'updated_at', 'emoji', 'rating']);

  migrateUserFkToSetNull(db, 'album_votes', 'user_id', `
    CREATE TABLE album_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK(vote IN ('up','down')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, album_id)
    )
  `, ['id', 'user_id', 'album_id', 'vote', 'created_at']);

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

  // ─── Phase 3 mydig tables ──────────────────────────────────────────────
  //
  // See CLAUDE.md "Phase 3 plan" for the layout & interaction model.
  // Summary: Vinyl Wall (22-slot fixed), Shelf (6 genre-scoped bins),
  // Crate (0-N user-defined playlist stacks, 0-5 front-page visible).
  // Duplicates across layers are intentional — no UNIQUE(user, album),
  // only UNIQUE(container, position). Shelf bins are typed via an
  // admin-curated `genres` taxonomy so they stay distinct from Crate
  // (freeform labels).

  db.exec(`
    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_genres_position_active
     ON genres(is_active, position)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS vinyl_wall_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 22),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_vinyl_wall_items_user_position
     ON vinyl_wall_items(user_id, position)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS shelf_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 6),
      genre_id INTEGER REFERENCES genres(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_shelf_slots_user_position
     ON shelf_slots(user_id, position)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS shelf_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL REFERENCES shelf_slots(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slot_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_shelf_items_slot_position
     ON shelf_items(slot_id, position)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS crate_boxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_crate_boxes_user_position
     ON crate_boxes(user_id, position)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS crate_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crate_id INTEGER NOT NULL REFERENCES crate_boxes(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(crate_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_crate_items_crate_position
     ON crate_items(crate_id, position)`
  );

  // One-time seed of the genre taxonomy (admin can edit/extend via
  // /admin later). Order of INSERTs drives initial UI ordering; admin
  // can reorder via position later. Idempotent via INSERT OR IGNORE
  // on the slug UNIQUE constraint.
  runOnce(db, 'seed-genres-initial-2026-04-20', () => {
    const seed: Array<[string, string, string]> = [
      ['death-metal', '데스 메탈', 'Death Metal'],
      ['black-metal', '블랙 메탈', 'Black Metal'],
      ['thrash', '스래시', 'Thrash'],
      ['doom-stoner', '둠 & 스토너', 'Doom & Stoner'],
      ['grind-power', '그라인드코어 & 파워바이올런스', 'Grindcore & Powerviolence'],
      ['hardcore-crust', '하드코어 & 크러스트', 'Hardcore & Crust'],
      ['post-metal-sludge', '포스트메탈 & 슬러지', 'Post-Metal & Sludge'],
      ['progressive', '프로그레시브', 'Progressive'],
      ['trad-heavy', '전통 헤비메탈', 'Traditional Heavy Metal'],
      ['punk-post-punk', '펑크 & 포스트펑크', 'Punk & Post-Punk'],
      ['shoegaze-dreampop', '슈게이즈 & 드림팝', 'Shoegaze & Dreampop'],
      ['indie-rock', '인디 록', 'Indie Rock'],
      ['ambient-drone', '앰비언트 & 드론', 'Ambient & Drone'],
      ['jazz', '재즈', 'Jazz'],
      ['hip-hop', '힙합', 'Hip-Hop'],
      ['electronic', '일렉트로닉', 'Electronic'],
    ];
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO genres (slug, name_ko, name_en, position)
       VALUES (?, ?, ?, ?)`
    );
    seed.forEach(([slug, nameKo, nameEn], idx) => {
      stmt.run(slug, nameKo, nameEn, idx);
    });
    console.log(`[migration] seeded ${seed.length} initial genres`);
  });

  // Purge any Metacritic rows that were ingested before we added it to the
  // exclusion list. Metacritic is an aggregator (re-publishes other sites'
  // scores) so we don't want it competing with primary editorial sources
  // in the average. Idempotent via runOnce.
  runOnce(db, 'purge-metacritic-reviews-2026-04-16', () => {
    const purged = db
      .prepare(`DELETE FROM reviews WHERE LOWER(source_name) LIKE '%metacritic%'`)
      .run();
    if (purged.changes > 0) {
      console.log(`[migration] purge-metacritic-reviews: removed ${purged.changes} rows`);
    }
  });

  // Normalise legacy reviews rows to the /100 storage contract. Two
  // classes of bad data accumulated before we clamped at ingestion:
  //   (a) score_max != 100 from the pre-clamp URL/manual ingestion
  //       path, which let Claude's returned scoreMax pass through. The
  //       score itself is on the native scale (e.g. 8 with score_max
  //       10), so we rescale to /100 before capping.
  //   (b) score > 100 from Claude hallucinations (most recently a
  //       250/100 on a star-rating page we couldn't parse). After
  //       rescaling, anything still above 100 gets capped.
  // Order matters: rescale first (so a genuine 8/10 becomes 80, not
  // capped to 100), then cap. score_max is finally forced to 100 so
  // the home-feed average SQL can assume a fixed denominator.
  runOnce(db, 'clamp-review-scores-2026-04-19', () => {
    const rescale = db
      .prepare(
        `UPDATE reviews
         SET score = ROUND(CAST(score AS REAL) / score_max * 100),
             manual_score = CASE
               WHEN manual_score IS NOT NULL
               THEN ROUND(CAST(manual_score AS REAL) / score_max * 100)
               ELSE NULL
             END
         WHERE score_max IS NOT NULL AND score_max > 0 AND score_max != 100`
      )
      .run();
    const capScore = db
      .prepare(`UPDATE reviews SET score = 100 WHERE score IS NOT NULL AND score > 100`)
      .run();
    const capManual = db
      .prepare(`UPDATE reviews SET manual_score = 100 WHERE manual_score IS NOT NULL AND manual_score > 100`)
      .run();
    const floorScore = db
      .prepare(`UPDATE reviews SET score = 0 WHERE score IS NOT NULL AND score < 0`)
      .run();
    const floorManual = db
      .prepare(`UPDATE reviews SET manual_score = 0 WHERE manual_score IS NOT NULL AND manual_score < 0`)
      .run();
    const fixMax = db
      .prepare(`UPDATE reviews SET score_max = 100 WHERE score_max IS NULL OR score_max != 100`)
      .run();
    if (
      rescale.changes ||
      capScore.changes ||
      capManual.changes ||
      floorScore.changes ||
      floorManual.changes ||
      fixMax.changes
    ) {
      console.log(
        `[migration] clamp-review-scores: rescale=${rescale.changes}, cap>${capScore.changes}/${capManual.changes}, floor<${floorScore.changes}/${floorManual.changes}, max=${fixMax.changes}`
      );
    }
  });

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
