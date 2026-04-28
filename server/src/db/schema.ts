import type Database from 'better-sqlite3';
import { deriveUsernameFromEmail } from '../utils/username.js';

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

  // Admin-curated whitelist: hosts the admin trusts as editorial review
  // sources. Does NOT act as a hard gate — the discover pipeline keeps
  // collecting from all hosts — but the Haiku URL picker's result gets
  // re-ordered so whitelist hosts surface first. This lets admin lean
  // toward proven sources when scanning 15-25 discovery candidates
  // without silently dropping long-tail editorial outlets that haven't
  // earned the whitelist yet. Host normalisation matches the existing
  // domain-blacklist check in reviews.ts (strip www., lowercase).
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_whitelist (
      host TEXT PRIMARY KEY,
      added_at TEXT DEFAULT (datetime('now')),
      note TEXT
    )
  `);

  // Admin-curated blacklist: hosts that should be refused at the scrape
  // layer, same effect as the hardcoded EXCLUDED_URL_DOMAINS list in
  // services/reviews.ts. Two separate layers on purpose: the hardcoded
  // list is baseline ("never, for structural reasons" — shops,
  // aggregators, user-review communities) and survives server
  // restarts even if the DB is wiped; this table is operational
  // ("admin noticed a new bad source and wants it gone right now")
  // with a reason field so future-admin knows why a host is here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_blacklist (
      host TEXT PRIMARY KEY,
      added_at TEXT DEFAULT (datetime('now')),
      reason TEXT
    )
  `);

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

  // Invitation gate. Email present here = allowed to complete a Google
  // OAuth signup. Existing users get grandfathered into this list via
  // the `seed-invited-emails-from-users-2026-04-28` runOnce migration
  // below, so the gate ships transparently for anyone who was already
  // logged in. New visitors land in `pending_signups` instead and an
  // admin promotes them by inserting their email here (either via the
  // /api/admin/invitations endpoint or directly via SQL).
  db.exec(`
    CREATE TABLE IF NOT EXISTS invited_emails (
      email TEXT PRIMARY KEY,
      invited_at TEXT DEFAULT (datetime('now')),
      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT
    )
  `);

  // Pending signup queue — every Google OAuth attempt by an
  // un-invited email lands here. Stores the verified Google profile
  // (name + avatar) so admin sees who's asking before deciding to
  // promote into invited_emails. attempt_count + last_attempt_at let
  // the admin tell a curious one-time visitor from someone who's
  // actually waiting on approval. Once admin approves (= adds the
  // email to invited_emails) the row stays here as a record but the
  // user's next OAuth attempt completes the signup.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_signups (
      email TEXT PRIMARY KEY,
      google_id TEXT,
      name TEXT,
      avatar_url TEXT,
      first_attempt_at TEXT DEFAULT (datetime('now')),
      last_attempt_at TEXT DEFAULT (datetime('now')),
      attempt_count INTEGER DEFAULT 1,
      notified_at TEXT
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

  // 샀음 / 살거 used to live in dedicated `collections` + `wants`
  // tables. Both were absorbed into the crate system in 2026-04-28
  // (post-Phase 3 roadmap item 2) — the 샀음 / 살거 distinction is
  // no longer load-bearing; existing data was copied into per-user
  // 샀음 + 살거 crates and the legacy tables dropped (see the
  // `migrate-collections-wants-to-crates-2026-04-28` runOnce block
  // further down). Fresh installs never create these tables.

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

  // Drop the Phase 4 L0c bench tables. The whole local-LLM curation
  // plan was parked on 2026-04-27 after Pre-L0 spot checks showed no
  // currently-available local model passes the bar (see
  // docs/phase4-nightly-pipeline.md for the failure-mode log). The
  // bench harness was scaffolded earlier in the same session and
  // touched production DB at deploy; this migration cleans it up so
  // we don't carry orphan tables. If a future model passes Pre-L0
  // and the bench harness is wanted again, it lives in git at
  // c051df8 and can be cherry-picked + re-applied.
  runOnce(db, 'drop-phase4-bench-tables-2026-04-27', () => {
    db.exec('DROP TABLE IF EXISTS bench_scores');
    db.exec('DROP TABLE IF EXISTS bench_outputs');
    db.exec('DROP TABLE IF EXISTS bench_sources');
    db.exec('DROP TABLE IF EXISTS bench_runs');
    console.log('[migration] dropped Phase 4 bench tables (plan parked)');
  });

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
    // Stored as "r,g,b" (0-255). Extracted once server-side from the
    // cover image so the mydig vinyl disc underneath each album can
    // tint into a "coloured pressing". Null = not yet extracted /
    // extraction failed; next wall fetch retries.
    'cover_dominant_color TEXT',
    // Spotify 30-second preview for the mydig hover play-chip. URL
    // is the raw `preview_url` field from the Spotify track object
    // (public, no auth, CDN-cached). Name is the display string the
    // play overlay uses. `lookup_at` is set even on failure so we
    // don't thrash Spotify re-fetching albums that have no previews.
    'preview_track_url TEXT',
    'preview_track_name TEXT',
    'preview_lookup_at TEXT',
    // Multi-artist credit. JSON array of `{name, mbid}` entries —
    // populated from MusicBrainz's `artist-credit` whenever an album
    // is fetched fresh. NULL on legacy rows; display layer falls
    // back to `artist_name` (single-artist string) when absent.
    // `artist_name` is now also populated as a comma-joined string
    // of all credit names so list endpoints that don't return the
    // structured array still surface the full collab text.
    'artist_credit_json TEXT',
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
    // separately below.
    'username TEXT',
    // Free-form title for the vinyl wall — displays as the h1 on
    // /my/:username. Owner-editable; NULL falls back to "my dig"
    // on render. Same role as a snapshot's name field: a place
    // for the user to frame the theme of their current wall
    // ("2026 spring picks", "raining sunday", etc.).
    'vinyl_wall_theme TEXT',
    // Optional longer subtitle shown under the vinyl-wall theme
    // on /my/:username. Owner-editable; null renders nothing.
    // Separate from the one-line theme because owners want a
    // short title AND a sentence of context ("what I've been
    // hooked on this month") without cramming both into the h1.
    'vinyl_wall_description TEXT',
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

  // The legacy `format-aware-collections-wants-2026-04-18` migration
  // (which recreated collections + wants with a per-format UNIQUE)
  // lived here. It became dead code after the 2026-04-28 absorption —
  // collections and wants are dropped before any other queries can
  // run, so a per-format rebuild is irrelevant. Removed entirely
  // rather than left as a no-op because the body referenced the
  // legacy tables and would error on fresh DBs that never had them.

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

  // Second round of purges for blacklist additions post the 04-21
  // sweep (newnoisemagazine and ultimatemetal, plus anydecentmusic /
  // musicboard added today). Separate runOnce key so databases that
  // already absorbed the first purge still pick these up on next
  // boot. Also cleans up any review rows whose excerpt or Korean
  // translation devolved into a "검색 결과가 없다 / no results found"
  // meta-commentary — those pages were never actually reviews, and
  // the Claude extractor wrote the no-results phrasing straight into
  // the excerpt before the rejection pattern landed.
  runOnce(db, 'purge-blacklisted-review-urls-2026-04-22', () => {
    const urlPatterns = [
      '%newnoisemagazine.com/%',
      '%ultimatemetal.com/%',
      '%anydecentmusic.com/%',
      '%musicboard.app/%',
    ];
    let total = 0;
    for (const p of urlPatterns) {
      const info = db.prepare('DELETE FROM reviews WHERE full_review_url LIKE ?').run(p);
      total += info.changes as number;
    }
    // Text-based: reviews whose excerpt (either language) reads as
    // a "no results found" meta-commentary. String match is cheap;
    // the column sizes are small enough that a full-table scan is
    // fine for a one-shot migration.
    const textPatterns = [
      '%검색 결과가 없%',
      '%검색 결과를 찾을 수 없%',
      '%no search results found%',
      '%no results found for%',
    ];
    for (const p of textPatterns) {
      const info = db
        .prepare(
          'DELETE FROM reviews WHERE excerpt LIKE ? OR excerpt_ko LIKE ?'
        )
        .run(p, p);
      total += info.changes as number;
    }
    if (total > 0) {
      console.log(`[migration] purged ${total} blacklisted / no-result review rows`);
    }
  });

  // Re-sweep for sputnikmusic soundoff URLs that slipped through after
  // the first 2026-04-21 purge. A new one was reported after the add-
  // url path started going through the manual-paste flow (which
  // bypassed the discover-level EXCLUDED_URL_PATH_PATTERNS check
  // until the scrape-level guard landed). New runOnce key because the
  // earlier one is already marked done on production.
  runOnce(db, 'purge-soundoff-review-urls-2026-04-22b', () => {
    const info = db
      .prepare("DELETE FROM reviews WHERE full_review_url LIKE ?")
      .run('%sputnikmusic.com/soundoff.php%');
    if ((info.changes as number) > 0) {
      console.log(`[migration] purged ${info.changes} soundoff review rows`);
    }
  });

  // Purge sputnikmusic /list.php?memberid=… review rows. These are user-
  // curated album lists with one-line commentary per pick, not editorial
  // reviews — same class of mistake as soundoff.php. The path-pattern
  // filter that catches future scrapes landed alongside this migration;
  // existing rows get cleaned up here.
  runOnce(db, 'purge-sputnik-list-review-urls-2026-04-28', () => {
    const info = db
      .prepare("DELETE FROM reviews WHERE full_review_url LIKE ?")
      .run('%sputnikmusic.com/list.php?%memberid=%');
    if ((info.changes as number) > 0) {
      console.log(`[migration] purged ${info.changes} sputnik list.php review rows`);
    }
  });

  // Add two hosts that surfaced in the post-Phase 3 backlog review:
  // bangertv.com (video reviews — body is a YouTube embed plus a
  // one-line blurb, no editorial prose) and everyalbumever.com (a
  // podcast — every /episodes/* page is a show note for an audio
  // episode, with Apple/Spotify show links and a single-paragraph
  // description). Both pages match enough surface signals (the word
  // "review" in title and slug) that the URL-discovery pipeline keeps
  // pulling them in; blacklisting at the source layer cuts them off
  // before scraping. INSERT OR IGNORE so a later admin re-enable
  // wouldn't get clobbered.
  runOnce(db, 'seed-source-blacklist-podcast-video-2026-04-28', () => {
    const rows: Array<[string, string]> = [
      ['bangertv.com', 'video review (YouTube embed, no editorial body)'],
      ['everyalbumever.com', 'podcast (episode landing page)'],
    ];
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO source_blacklist (host, reason) VALUES (?, ?)`
    );
    let inserted = 0;
    for (const [host, reason] of rows) {
      const r = stmt.run(host, reason);
      if ((r.changes as number) > 0) inserted++;
    }
    if (inserted > 0) {
      console.log(
        `[migration] seeded source_blacklist with ${inserted} podcast/video host(s)`
      );
    }
  });

  // Purge any review rows that landed before the blacklist additions
  // above. Same pattern as purge-blacklisted-review-urls-2026-04-21 —
  // host filter only stops future saves, so historical rows linger
  // until a one-shot DELETE runs.
  runOnce(db, 'purge-blacklisted-review-urls-2026-04-28', () => {
    const patterns = [
      '%bangertv.com/%',
      '%everyalbumever.com/%',
    ];
    let total = 0;
    for (const p of patterns) {
      const info = db.prepare('DELETE FROM reviews WHERE full_review_url LIKE ?').run(p);
      total += info.changes as number;
    }
    if (total > 0) {
      console.log(`[migration] purged ${total} podcast/video review rows`);
    }
  });

  // Purge review rows whose excerpt text is the LLM admitting it
  // couldn't load / verify the page ("페이지가 로드되지 않아 리뷰 내용을
  // 확인할 수 없다" and similar). Future scrapes are blocked by the
  // rejection-pattern guard in scrapeReviewFromUrl; this is the
  // one-shot cleanup of what slipped through before the guard
  // landed. Both excerpt and excerpt_ko checked since the LLM
  // sometimes echoes the error in only one of the two fields.
  runOnce(db, 'purge-page-load-failure-excerpts-2026-04-28', () => {
    const textPatterns = [
      '%페이지가 로드되지 않%',
      '%페이지가 정상적으로 로드되지 않%',
      '%페이지가 열리지 않%',
      '%페이지가 뜨지 않%',
      '%리뷰 내용을 확인할 수 없%',
      '%리뷰를 확인할 수 없%',
      '%페이지 내용을 확인할 수 없%',
      '%page failed to load%',
      "%couldn't load this page%",
      '%unable to load the page%',
      '%failed to load the review%',
    ];
    let total = 0;
    for (const p of textPatterns) {
      const info = db
        .prepare('DELETE FROM reviews WHERE excerpt LIKE ? OR excerpt_ko LIKE ?')
        .run(p, p);
      total += info.changes as number;
    }
    if (total > 0) {
      console.log(`[migration] purged ${total} page-load-failure review rows`);
    }
  });

  // One-shot recovery for "black metal" — accidental × click on the
  // tag chip blacklisted it and stripped it from every album that
  // carried it. The (mbid, original-casing) pairs below come straight
  // from the local sanitised copy of production, so they reflect the
  // pre-strip state for every album that had the tag at the time of
  // the last sanitise. Per-album:
  //   1. Load current genres array
  //   2. If "black metal" (case-insensitive) is already present, skip
  //   3. Else append the original casing the album had locally
  // Idempotent — re-running doesn't double-add. Albums that exist on
  // local but not on production are silently skipped (UPDATE matches
  // 0 rows). Also removes "black metal" from tag_blacklist so future
  // auto-imports stop filtering it; the new admin panel surfaces this
  // for ad-hoc undo, but bundling it here closes the loop in one
  // migration.
  runOnce(db, 'restore-black-metal-tag-2026-04-28', () => {
    const pairs: Array<[string, string]> = [
      ['discogs-36762688', 'Black Metal'],
      ['895665dd-deb1-43bb-b7ed-eafcadc00bd4', 'black metal'],
      ['2e38be3f-86fd-43a4-bb65-0e30bfa6e448', 'black metal'],
      ['discogs-master-1813051', 'Black Metal'],
      ['1f60bc0e-fd14-4586-ae80-642ed5be5b67', 'black metal'],
      ['discogs-master-3597101', 'Black Metal'],
      ['28041d3b-8463-4fce-91bd-b0879ff295ad', 'black metal'],
      ['644114e0-22b4-4506-8fc3-c049a8af1e5e', 'black metal'],
      ['edf2b0df-99fb-431b-8313-72efa67490fb', 'black metal'],
      ['ecc06a4f-3ce4-4113-9002-ce77ee7d2602', 'black metal'],
      ['548115be-915c-4c7b-b0c2-15c2ea4645af', 'black metal'],
      ['2ecf6610-9a5e-4cf5-855a-a8dbedd45374', 'black metal'],
      ['a0aa3f41-7be3-4d99-9199-43e249a2ca6b', 'black metal'],
      ['6b9e46cd-6ca9-4c92-b66d-59a12aa70926', 'black metal'],
      ['1a4372b7-10a2-47f5-8030-beed91d68d01', 'black metal'],
      ['91253c00-7cab-455b-af01-609bcd21bc9d', 'black metal'],
      ['discogs-master-4157134', 'Black Metal'],
      ['09d724db-741a-4b59-83f0-8833c8790700', 'Black Metal'],
    ];
    const select = db.prepare('SELECT genres FROM albums WHERE mbid = ?');
    const update = db.prepare('UPDATE albums SET genres = ? WHERE mbid = ?');
    let restored = 0;
    let skipped = 0;
    let missing = 0;
    for (const [mbid, casing] of pairs) {
      const row = select.get(mbid) as { genres: string | null } | undefined;
      if (!row) {
        missing++;
        continue;
      }
      let arr: unknown;
      try {
        arr = row.genres ? JSON.parse(row.genres) : [];
      } catch {
        arr = [];
      }
      const tags = Array.isArray(arr)
        ? arr.filter((t): t is string => typeof t === 'string')
        : [];
      if (tags.some((t) => t.toLowerCase() === 'black metal')) {
        skipped++;
        continue;
      }
      tags.push(casing);
      update.run(JSON.stringify(tags), mbid);
      restored++;
    }
    const unbanned = db
      .prepare("DELETE FROM tag_blacklist WHERE tag = 'black metal'")
      .run();
    console.log(
      `[migration] restore-black-metal-tag: restored=${restored}, already-had=${skipped}, missing-on-prod=${missing}, blacklist-removed=${unbanned.changes}`
    );
  });

  // Drop the vestigial users.mydig_public column. The page-level gate
  // it was sized for went away when mydig went public-by-default;
  // snapshots carry their own is_public flag and no read/write path
  // has referenced this column since. SQLite 3.35+ supports DROP
  // COLUMN natively (better-sqlite3 v12 ships with 3.45+), and the
  // migrateTable definition above no longer lists the column so a
  // fresh DB never gains it.
  runOnce(db, 'drop-users-mydig-public-2026-04-28', () => {
    try {
      db.exec('ALTER TABLE users DROP COLUMN mydig_public');
      console.log('[migration] dropped users.mydig_public column');
    } catch (err: any) {
      if (err.message?.includes('no such column')) return;
      throw err;
    }
  });

  // home_walls migration lives near the home_walls CREATE TABLE
  // block further down — moving it up here would put it before the
  // table exists at boot time. See `migrate-home-meta-to-home-walls-2026-04-28`.

  // Grandfather every currently-registered user's email into
  // invited_emails so the OAuth gate doesn't bounce people who were
  // already logged in when the gate landed. INSERT OR IGNORE skips any
  // email that's somehow already in the invite list (hand-seeded,
  // re-run, etc.). invited_by is left NULL because the grandfather
  // origin is the migration itself, not a particular admin.
  runOnce(db, 'seed-invited-emails-from-users-2026-04-28', () => {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO invited_emails (email, note)
         SELECT email, 'grandfathered from users at gate rollout'
         FROM users
         WHERE email IS NOT NULL AND email != ''`
      )
      .run();
    console.log(
      `[migration] grandfathered ${result.changes} existing users into invited_emails`
    );
  });

  // Move hosts out of the code-level EXCLUDED_URL_DOMAINS into the DB
  // source_blacklist. The hardcoded baseline keeps shops / SNS /
  // streaming / YouTube (platform shapes that will never carry
  // editorial reviews); these 33 were all trust-decisions — admin-
  // overridable calls about aggregators, paywalled outlets, reliably
  // bot-blocked sites, podcast landing pages, and user-review
  // communities — so they belong in the editable layer. Entries use
  // INSERT OR IGNORE so re-seeding doesn't clobber admin edits to
  // reason fields; the added_at timestamp is set to the migration run
  // time via the DEFAULT column default.
  runOnce(db, 'seed-source-blacklist-from-hardcoded-2026-04-22', () => {
    const rows: Array<[string, string]> = [
      // Score aggregators — user ratings or meta-rollups of other
      // outlets, not editorial criticism on their own merit.
      ['rateyourmusic.com', 'aggregator (user ratings)'],
      ['albumoftheyear.org', 'aggregator (user ratings)'],
      ['metacritic.com', 'aggregator (score rollup)'],
      ['metal-archives.com', 'aggregator (user-submitted reviews)'],
      ['rockreport.be', 'aggregator (re-posts other outlets)'],
      ['anydecentmusic.com', 'aggregator (meta score collection)'],
      ['metalmusicarchives.com', 'aggregator (user ratings + snippets)'],
      // Paywalled outlets where only the teaser is publicly visible,
      // so the scraper has nothing usable to excerpt.
      ['medium.com', 'paywall (body behind sign-in)'],
      ['rockhard.de', 'paywall (subscriber-only body)'],
      ['metal-hammer.de', 'paywall (subscriber-only body)'],
      // Reliably bot-blocked / Cloudflare-walled sites. Even when Jina
      // bypasses, ordinary readers clicking the saved URL would hit
      // the same wall.
      ['newnoisemagazine.com', 'bot-blocked (Cloudflare 403)'],
      ['metalstorm.net', 'bot-blocked / reader wall'],
      ['ghostcultmag.com', 'bot-blocked / reader wall'],
      ['theprogspace.com', 'bot-blocked / reader wall'],
      ['headbangerslifestyle.com', 'bot-blocked / reader wall'],
      ['progarchives.com', 'bot-blocked / reader wall'],
      ['treblezine.com', 'bot-blocked / reader wall'],
      ['myglobalmind.com', 'bot-blocked / reader wall'],
      ['brooklynvegan.com', 'bot-blocked / reader wall'],
      ['grande-rock.com', 'bot-blocked / reader wall'],
      ['wallofsoundau.com', 'bot-blocked / reader wall'],
      ['sonicperspectives.com', 'bot-blocked / reader wall'],
      ['metalinjection.net', 'bot-blocked / reader wall'],
      ['alreadyheard.com', 'bot-blocked / reader wall'],
      ['metalwani.com', 'bot-blocked / reader wall'],
      ['metalcrypt.com', 'bot-blocked / reader wall'],
      ['metalkingdom.net', 'bot-blocked / reader wall'],
      // Podcast outlets — episode description pages, not editorial
      // text reviews.
      ['iheart.com', 'podcast (episode description, not review)'],
      ['metalepidemic.com', 'podcast (episode landing page)'],
      // User-review community sites — each page is a single user's
      // take, not editorial. Scraper launders them as editorial.
      ['ultimatemetal.com', 'forum / user-generated posts'],
      ['musicboard.app', 'user-review community (Letterboxd-style)'],
      ['allmusic.com', 'user blurbs dominate niche-genre pages'],
      ['debaser.it', 'user-review community (Italian, RYM-style)'],
    ];
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO source_blacklist (host, reason) VALUES (?, ?)`
    );
    let inserted = 0;
    for (const [host, reason] of rows) {
      const r = stmt.run(host, reason);
      if ((r.changes as number) > 0) inserted++;
    }
    console.log(
      `[migration] seeded source_blacklist with ${inserted}/${rows.length} new hosts`
    );
  });

  // Vinyl Wall sized down from 22 to 15 slots (5/5/5) after the
  // late-night pendant scene redesign. Any rows left at positions
  // 15-21 from the brief 5-5-6-6 experiment are dropped so fresh
  // /my/:username visits don't render ghost LPs outside the new
  // grid. No-op in normal case (feature just launched, hardly any
  // real users yet).
  runOnce(db, 'vinyl-wall-trim-to-15-2026-04-22', () => {
    const info = db
      .prepare('DELETE FROM vinyl_wall_items WHERE position >= 15')
      .run();
    if ((info.changes as number) > 0) {
      console.log(`[migration] pruned ${info.changes} vinyl_wall_items with position >= 15`);
    }
  });

  // Second trim: 15 → 10 slots (5/5). Third row of the wall was
  // getting clipped at the baseboard on the pendant scene, and the
  // "top-10 favourites" framing reads tighter than the earlier
  // "15 favourites" did. Positions 10-14 dropped — users who had
  // placed records in the third row will see those slots gone on
  // next visit and can re-place the kept 10 via the edit modal.
  runOnce(db, 'vinyl-wall-trim-to-10-2026-04-23', () => {
    const info = db
      .prepare('DELETE FROM vinyl_wall_items WHERE position >= 10')
      .run();
    if ((info.changes as number) > 0) {
      console.log(`[migration] pruned ${info.changes} vinyl_wall_items with position >= 10`);
    }
  });

  // Rewrite legacy email-shaped usernames. Phase 1 stored the full
  // email as users.username because the NOT NULL column existed from
  // day one and OAuth didn't yet need a URL-safe slug. Phase 3 mydig
  // surfaces usernames in /my/:username, so /my/fpp@dig.haus was
  // showing up when we want /my/fpp. Rewrite every row whose
  // username contains '@' to the sanitised local part, respecting
  // already-clean usernames as "taken" so collisions get a numeric
  // suffix. Deterministic order (id ASC) so admin sees stable
  // results on re-runs if the runOnce marker got cleared for any
  // reason.
  runOnce(db, 'rewrite-email-shaped-usernames-2026-04-22', () => {
    const affected = db
      .prepare(
        `SELECT id, email, username FROM users
         WHERE username IS NOT NULL AND instr(username, '@') > 0
         ORDER BY id`
      )
      .all() as Array<{ id: number; email: string; username: string }>;
    if (affected.length === 0) return;

    const clean = db
      .prepare(
        `SELECT LOWER(username) AS username FROM users
         WHERE username IS NOT NULL AND instr(username, '@') = 0`
      )
      .all() as Array<{ username: string }>;
    const taken = new Set(clean.map((r) => r.username));

    const updateStmt = db.prepare('UPDATE users SET username = ? WHERE id = ?');
    for (const row of affected) {
      const source = row.email || row.username;
      const next = deriveUsernameFromEmail(source, taken);
      updateStmt.run(next, row.id);
      taken.add(next.toLowerCase());
    }
    console.log(
      `[migration] rewrote ${affected.length} email-shaped usernames to URL-safe slugs`
    );
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
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_vinyl_wall_items_user_position
     ON vinyl_wall_items(user_id, position)`
  );

  // Vinyl-wall snapshots — archival copy of the wall at a moment in
  // time. Owner creates one from the current wall, names it (default
  // falls to a date slug on the server), marks it private or public.
  // Public snapshots are reachable at /my/:username/snap/:slug; the
  // list of snapshots on /my/:username filters to public for
  // visitors and shows all for the owner.
  //
  // Album FK deliberately lacks CASCADE — an album getting removed
  // shouldn't retroactively re-write history; the snapshot row stays
  // with a null join on render. The client renders missing albums
  // as an empty slot with a muted "삭제된 앨범" tag.
  db.exec(`
    CREATE TABLE IF NOT EXISTS vinyl_wall_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_vinyl_wall_snapshots_user_created
     ON vinyl_wall_snapshots(user_id, created_at DESC)`
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS vinyl_wall_snapshot_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES vinyl_wall_snapshots(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
      UNIQUE(snapshot_id, position)
    )
  `);

  // Existing DBs created the table with a stale `position < 10`
  // CHECK from the brief 10-slot wall era. Wall is 15 slots again,
  // so INSERTs for positions 10-14 fail that check and roll back
  // the whole snapshot-create transaction — symptom: "스냅샷 저장
  // 실패" with no snapshot row ever persisted. Rebuild the table
  // with the current `< 15` check, copy existing rows across, and
  // recreate the index.
  //
  // runOnce already wraps fn() in its own BEGIN/COMMIT, so this
  // block must not start its own transaction. Earlier revision did
  // and the nested BEGIN failed silently, leaving every DB on the
  // stale check.
  runOnce(db, 'vinyl-wall-snapshot-items-position-lt15-2026-04-23', () => {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='vinyl_wall_snapshot_items'`)
      .get() as { sql?: string } | undefined;
    if (!row?.sql) return;
    if (!/position\s*<\s*10/.test(row.sql)) return; // already on < 15

    db.exec('ALTER TABLE vinyl_wall_snapshot_items RENAME TO vinyl_wall_snapshot_items__legacy');
    db.exec(`
      CREATE TABLE vinyl_wall_snapshot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES vinyl_wall_snapshots(id) ON DELETE CASCADE,
        album_id INTEGER NOT NULL REFERENCES albums(id),
        position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
        UNIQUE(snapshot_id, position)
      )
    `);
    db.exec(
      `INSERT INTO vinyl_wall_snapshot_items (id, snapshot_id, album_id, position)
       SELECT id, snapshot_id, album_id, position FROM vinyl_wall_snapshot_items__legacy`
    );
    db.exec('DROP TABLE vinyl_wall_snapshot_items__legacy');
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_vinyl_wall_snapshot_items_snapshot
       ON vinyl_wall_snapshot_items(snapshot_id, position)`
    );
    console.log('[migration] vinyl_wall_snapshot_items: position CHECK rewritten from < 10 to < 15');
  });
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_vinyl_wall_snapshot_items_snapshot
     ON vinyl_wall_snapshot_items(snapshot_id, position)`
  );

  // Snapshots grew a description field alongside the live wall's
  // own description: the owner can now explain what a given
  // archived wall was about, which would otherwise be stuck in the
  // snapshot name. Existing rows stay at NULL → rendered as no
  // subtitle.
  migrateTable(db, 'vinyl_wall_snapshots', [
    'description TEXT',
  ]);

  // Follows — lightweight directed "I want to keep an eye on this
  // person's digs" edge. No mutual / friend semantics; follower +
  // followee are distinct and ordered. Composite PK doubles as
  // dedup so a second POST is a harmless no-op. CHECK prevents
  // self-follows server-side; the follow UI gates the button too
  // but the DB-level guard keeps malicious curl out.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_follows (
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, followee_id),
      CHECK (follower_id != followee_id)
    )
  `);

  // Home wall — admin-curated 15 albums on the home page, laid out
  // as 5-5-5 to match mydig's vinyl wall (the home page IS dig.haus's
  // own mydig now). Single global table, not per-user; admin manages
  // via PUT /api/home/features/items. Position constraint walked from
  // < 5 to < 15 in this iteration; old data is dropped because the
  // upper-page lead "Feature Records" framing is gone — the home
  // wall is now the same furniture as personal mydig walls and the
  // 5-pick concept doesn't carry over.
  runOnce(db, 'home_features_15_slots_2026_04_25', () => {
    db.exec('DROP TABLE IF EXISTS home_features');
  });
  // Home walls — multi-wall carousel surface for the hero on `/`. The
  // singleton home_meta + flat home_features pair was the v0 shape;
  // walls extend that into N curated tracks (이번 주 발굴 / 시즌 무드
  // / etc.) each with their own backdrop + LP set + title positions
  // + ink/shadow tokens. v1 ships with three walls matching the three
  // backdrops already in client/public/backdrops/ (basement_purple,
  // basement_gray, basement5).
  //
  // Per-wall HERO_THEME tokens (ink_color / shadow_css / wall_color)
  // are stored on the row rather than in the heroTheme.ts singleton,
  // because basement5 is a light surface that needs dark ink while
  // basement_purple needs cream — one global token can't serve both.
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_walls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL UNIQUE,
      backdrop_file TEXT NOT NULL,
      theme TEXT,
      description TEXT,
      header_top_px INTEGER DEFAULT 102,
      header_left_px INTEGER DEFAULT 305,
      header_rotation_deg INTEGER DEFAULT -1,
      plastic_scale_pct INTEGER DEFAULT 15,
      plastic_offset_x_px INTEGER DEFAULT 5,
      plastic_offset_y_px INTEGER DEFAULT 0,
      plastic_blend_mode TEXT DEFAULT 'normal',
      lp_size INTEGER DEFAULT 357,
      lp_gap INTEGER DEFAULT 30,
      upper_lp_x_start INTEGER DEFAULT 531,
      lower_lp_x_start INTEGER DEFAULT 531,
      upper_lp_y INTEGER DEFAULT 279,
      lower_lp_y INTEGER DEFAULT 752,
      title_font_size INTEGER DEFAULT 67,
      title_rotation_deg INTEGER DEFAULT -1,
      ink_color TEXT NOT NULL DEFAULT '#f5e6c8',
      shadow_css TEXT NOT NULL DEFAULT '0 1px 2px rgba(0, 0, 0, 0.45)',
      wall_color TEXT NOT NULL DEFAULT '#4c3c54',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Seed 3 walls with the three shipped hero_*.avif backdrops + sampled
  // HERO_THEME tokens (the dominant-color + luminance-flip logic
  // server/scripts/extract-hero-theme.ts uses). The hero_* set
  // replaced the earlier basement_* generation after the operator
  // judged the third wall (the plant variant) too murky and decided
  // to swap the whole carousel onto a coordinated set of three
  // afternoon / purple / basement walls at the same source
  // dimensions (2912×1464). INSERT OR IGNORE makes this idempotent
  // — admin tweaks survive re-runs of schema init.
  db.exec(
    `INSERT OR IGNORE INTO home_walls (id, position, backdrop_file, theme, description, ink_color, shadow_css, wall_color)
     VALUES
       (1, 0, 'hero_afternoon.avif', 'dig.haus / 이번 달 픽', '운영자가 한 달 동안 발굴한 15장', '#1a1208', '0 1px 2px rgba(255, 245, 220, 0.55)', '#cc9c74'),
       (2, 1, 'hero_purple.avif', NULL, NULL, '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', '#4c3c54'),
       (3, 2, 'hero_basement.avif', NULL, NULL, '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', '#242424')`
  );
  // home_features now keys per (wall_id, position) — same 15-slot
  // shape as before but multiplied across walls. Fresh DBs get this
  // schema directly; existing DBs migrate in the runOnce below.
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wall_id INTEGER NOT NULL REFERENCES home_walls(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
      note TEXT,
      pinned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(wall_id, position)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_home_features_position
     ON home_features(wall_id, position)`
  );

  // home_meta CREATE TABLE block + four home_meta-* runOnce blocks
  // (header_position / plastic_overlay / plastic_blend_mode /
  // hero_tuner) used to live here. They were the v0 source of truth
  // for the singleton home wall. The migration runOnce below copies
  // their data into home_walls(id=1) and drops the table; existing
  // DBs that had applied those four runOnces already are unaffected
  // (markers stay set in schema_migrations as historical record),
  // and fresh DBs no longer create home_meta at all because the new
  // home_walls table is the source of truth.

  // Move the home wall from the singleton home_meta + flat
  // home_features pair into the multi-wall home_walls + home_features-
  // with-wall_id shape. Idempotent — both halves of the migration
  // gate on schema state (does home_meta exist? does home_features
  // have a wall_id column?) so re-running is a no-op.
  //
  // Two halves:
  //   1. UPDATE home_walls(id=1) with whatever values home_meta(id=1)
  //      held (theme, description, tuner cols). Without this step,
  //      existing DBs would lose the admin's previously-tuned LP
  //      positions / title rotation / etc. — the seed INSERT above
  //      uses defaults that pre-date the admin's tuning session.
  //   2. Recreate home_features with the new wall_id + composite
  //      UNIQUE constraint, copying old rows with wall_id = 1 (the
  //      pre-existing home_features always implicitly belonged to the
  //      one home_meta wall). The CREATE TABLE IF NOT EXISTS above
  //      can't change UNIQUE constraints on an existing table, hence
  //      the rename + recreate dance here.
  //
  // Drops home_meta after copying — it's no longer the source of
  // truth and leaving it would invite future code to read stale data.
  runOnce(db, 'migrate-home-meta-to-home-walls-2026-04-28', () => {
    const homeMetaExists = db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='home_meta' LIMIT 1`
      )
      .get();
    if (homeMetaExists) {
      const meta = db
        .prepare(`SELECT * FROM home_meta WHERE id = 1`)
        .get() as Record<string, unknown> | undefined;
      if (meta) {
        const cols = [
          'theme', 'description',
          'header_top_px', 'header_left_px', 'header_rotation_deg',
          'plastic_scale_pct', 'plastic_offset_x_px', 'plastic_offset_y_px',
          'plastic_blend_mode',
          'lp_size', 'lp_gap',
          'upper_lp_x_start', 'lower_lp_x_start', 'upper_lp_y', 'lower_lp_y',
          'title_font_size', 'title_rotation_deg',
        ];
        const present = cols.filter((c) => c in meta);
        if (present.length > 0) {
          const setClause = present.map((c) => `${c} = ?`).join(', ');
          db.prepare(`UPDATE home_walls SET ${setClause} WHERE id = 1`).run(
            ...present.map((c) => meta[c] as any)
          );
        }
      }
      db.exec('DROP TABLE home_meta');
      console.log('[migration] copied home_meta → home_walls(id=1) and dropped home_meta');
    }

    const featCols = db
      .prepare(`PRAGMA table_info(home_features)`)
      .all() as Array<{ name: string }>;
    const hasWallId = featCols.some((c) => c.name === 'wall_id');
    if (!hasWallId && featCols.length > 0) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        CREATE TABLE home_features__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wall_id INTEGER NOT NULL REFERENCES home_walls(id) ON DELETE CASCADE,
          album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
          note TEXT,
          pinned_at TEXT DEFAULT (datetime('now')),
          UNIQUE(wall_id, position)
        )
      `);
      db.exec(
        `INSERT INTO home_features__new (id, wall_id, album_id, position, note, pinned_at)
         SELECT id, 1, album_id, position, note, pinned_at FROM home_features`
      );
      db.exec('DROP TABLE home_features');
      db.exec('ALTER TABLE home_features__new RENAME TO home_features');
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_home_features_position
         ON home_features(wall_id, position)`
      );
      db.exec('PRAGMA foreign_keys = ON');
      const moved = db
        .prepare(`SELECT COUNT(*) AS n FROM home_features WHERE wall_id = 1`)
        .get() as { n: number };
      console.log(
        `[migration] recreated home_features with wall_id; ${moved.n} rows assigned to wall 1`
      );
    }
  });

  // Walls 2 and 3 originally seeded with basement_gray + basement5 in
  // the carousel landing — operator review judged the two visually
  // too similar (both warm-grey-ish). The new pair is basement_black
  // (cold dark surface) + basement_plant (dark olive). This runOnce
  // swaps the visual identity (backdrop_file + the three theme
  // tokens) on rows 2 and 3, but leaves theme / description / items
  // / tuner positions alone so any admin curation done in the
  // window between the two backdrop pairs survives. Sampled values
  // come from server/scripts/extract-hero-theme.ts run against each
  // file (both walls land on luminance ≈ 0.14, so cream ink with a
  // dark drop shadow is right for both).
  runOnce(db, 'swap-walls-2-3-to-black-and-plant-2026-04-28', () => {
    const upd = db.prepare(
      `UPDATE home_walls
         SET backdrop_file = ?,
             wall_color = ?,
             ink_color = ?,
             shadow_css = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    );
    upd.run('basement_black.avif', '#242424', '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', 2);
    upd.run('basement_plant.avif', '#2c240c', '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', 3);
    console.log('[migration] swapped walls 2 + 3 to basement_black + basement_plant');
  });

  // Walls 2 and 3 inherited the schema defaults for the LP / title
  // tuner cols (lpSize 357, upperLpY 279, lowerLpY 752, etc.) while
  // wall 1 carried the operator's tuned values (lpSize 336, upper
  // 345, lower 811, plasticScalePct 2, etc.). Once admin started
  // populating walls 2 + 3 with LPs, the records sat in the wrong
  // positions against the new backdrops because the tuner was off.
  // One-shot copy of wall 1's tuner state onto walls 2 + 3 — uses a
  // dynamic SELECT so the migration tracks whatever wall 1 holds at
  // run time (production may have different tuned values from local
  // dev). Backdrop / theme / description / items are deliberately
  // not part of the copy — only positional / sizing tuner state.
  // Swap the entire carousel onto the new hero_*.avif set the
  // operator generated to replace the basement_* trio (afternoon
  // moves to wall 1 as the first-impression light surface, purple
  // shifts down to wall 2, basement-black takes wall 3). Only the
  // visual identity columns (backdrop_file + the three theme
  // tokens) are touched; theme / description / items / tuner
  // positions are preserved so any admin curation already on those
  // walls survives the swap. New per-wall ink/shadow/wall_color
  // tokens come from the same dominant-color sampler the extract
  // script uses — wall 1 (cream-tan) gets dark ink, walls 2 + 3
  // keep cream against their darker surfaces.
  runOnce(db, 'swap-walls-to-hero-set-2026-04-28-evening', () => {
    const upd = db.prepare(
      `UPDATE home_walls
         SET backdrop_file = ?,
             wall_color = ?,
             ink_color = ?,
             shadow_css = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    );
    upd.run('hero_afternoon.avif', '#cc9c74', '#1a1208', '0 1px 2px rgba(255, 245, 220, 0.55)', 1);
    upd.run('hero_purple.avif', '#4c3c54', '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', 2);
    upd.run('hero_basement.avif', '#242424', '#f5e6c8', '0 1px 2px rgba(0, 0, 0, 0.45)', 3);
    console.log(
      '[migration] swapped carousel onto hero_afternoon + hero_purple + hero_basement'
    );
  });

  runOnce(db, 'unify-walls-2-3-tuner-with-wall-1-2026-04-28', () => {
    const tunerCols = [
      'lp_size',
      'lp_gap',
      'upper_lp_x_start',
      'lower_lp_x_start',
      'upper_lp_y',
      'lower_lp_y',
      'header_top_px',
      'header_left_px',
      'header_rotation_deg',
      'title_font_size',
      'title_rotation_deg',
      'plastic_scale_pct',
      'plastic_offset_x_px',
      'plastic_offset_y_px',
      'plastic_blend_mode',
    ];
    const setClause = tunerCols
      .map((c) => `${c} = (SELECT ${c} FROM home_walls WHERE id = 1)`)
      .join(', ');
    const result = db
      .prepare(
        `UPDATE home_walls
            SET ${setClause}, updated_at = datetime('now')
          WHERE id IN (2, 3)`
      )
      .run();
    console.log(
      `[migration] unified tuner values from wall 1 onto walls 2+3 (${result.changes} rows)`
    );
  });
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_follows_followee_created
     ON user_follows(followee_id, created_at DESC)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_follows_follower_created
     ON user_follows(follower_id, created_at DESC)`
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

  // Tag blacklist — admin-curated list of genre/tag strings that
  // should never appear on any album. Populated implicitly when
  // admin × a tag in TagEditor (the PATCH /albums/:id/tags handler
  // diffs old vs new and inserts the removed tags here). cleanGenres
  // reads this set as an additional filter on top of the hard-coded
  // EXCLUDED_TAGS, so even if a Last.fm / MusicBrainz refresh tries
  // to re-introduce a tag it stays gone.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
      added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tag_blacklist_tag ON tag_blacklist(tag COLLATE NOCASE)`
  );

  // Crate — user-named container of unlimited capacity, replaces the
  // legacy collections + wants tables (post-Phase 3 roadmap item 2).
  // is_public defaults to 0: per the design discussion, "남들 눈치
  // 안 보고 일단 담을 수 있는" private dumping ground is the natural
  // first state; owner flips public on the crates they want surfaced.
  // position kept for future drag-reorder UI but not currently
  // surfaced — list reads ORDER BY position ASC, ties broken by id.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crate_boxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, position)
    )
  `);
  migrateTable(db, 'crate_boxes', ['is_public INTEGER NOT NULL DEFAULT 0']);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_crate_boxes_user_position
     ON crate_boxes(user_id, position)`
  );

  // crate_items: one row per (crate, album). UNIQUE on (crate_id,
  // album_id) so the "담기" toggle stays idempotent — repeat clicks
  // can't double-stuff the same album. The legacy schema had
  // UNIQUE(crate_id, position) plus a position column; that's
  // unnecessary for v1 (no reorder UI yet) and made dedupe-on-add
  // awkward, so the rebuild below drops it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crate_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crate_id INTEGER NOT NULL REFERENCES crate_boxes(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(crate_id, album_id)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_crate_items_crate_created
     ON crate_items(crate_id, created_at DESC)`
  );

  // Rebuild legacy crate_items (had position UNIQUE + position column)
  // into the new shape. Idempotent via runOnce; the CREATE IF NOT
  // EXISTS above lands fresh DBs on the new schema directly, so this
  // block only does anything on a DB that already had the old shape.
  runOnce(db, 'crate-items-rebuild-no-position-2026-04-28', () => {
    const cols = db.prepare('PRAGMA table_info(crate_items)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'position')) return; // already new shape
    db.exec(`
      CREATE TABLE crate_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crate_id INTEGER NOT NULL REFERENCES crate_boxes(id) ON DELETE CASCADE,
        album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(crate_id, album_id)
      )
    `);
    // Dedupe on (crate_id, album_id) at copy time — the old UNIQUE
    // was on position, so duplicates by album within a crate were
    // technically allowed and may exist.
    db.exec(`
      INSERT INTO crate_items_new (crate_id, album_id, created_at)
      SELECT crate_id, album_id, MIN(created_at)
      FROM crate_items
      GROUP BY crate_id, album_id
    `);
    db.exec(`DROP TABLE crate_items`);
    db.exec(`ALTER TABLE crate_items_new RENAME TO crate_items`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_crate_items_crate_created
       ON crate_items(crate_id, created_at DESC)`
    );
    console.log('[migration] crate_items rebuilt without position column');
  });

  // One-time absorption of collections + wants into per-user crates.
  // Each user with rows in either table gets a 샀음 + 살거 crate
  // (or skips the side that has no rows). Existing user-created
  // crates are unaffected; the new ones tail-append to position so
  // they don't collide with whatever's already there. After the
  // copy, the legacy tables are dropped — going forward 샀음/살거
  // are just two ordinary user crates with no special status, so
  // the owner can rename, delete, or set them public freely.
  runOnce(db, 'migrate-collections-wants-to-crates-2026-04-28', () => {
    const collectionsExists = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collections'`)
      .get();
    const wantsExists = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wants'`)
      .get();
    if (!collectionsExists && !wantsExists) return;

    // Build the union of user_ids from whichever legacy tables
    // happen to exist. Both are always created together by current
    // schema, but local dev DBs in the wild have ended up with only
    // one (the format-aware migration in 2026-04 was the last code
    // path that touched both, and an interrupted run could leave a
    // half-migrated state). Handle each independently.
    const userIdsSet = new Set<number>();
    if (collectionsExists) {
      const r = db
        .prepare(`SELECT DISTINCT user_id FROM collections`)
        .all() as Array<{ user_id: number }>;
      for (const { user_id } of r) userIdsSet.add(user_id);
    }
    if (wantsExists) {
      const r = db
        .prepare(`SELECT DISTINCT user_id FROM wants`)
        .all() as Array<{ user_id: number }>;
      for (const { user_id } of r) userIdsSet.add(user_id);
    }

    let crateRows = 0;
    let itemRows = 0;
    for (const user_id of userIdsSet) {
      const nextPosRow = db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM crate_boxes WHERE user_id = ?'
        )
        .get(user_id) as { p: number };
      let nextPos = nextPosRow.p;

      const ensureCrate = (title: string, isPublic: number): number => {
        const existing = db
          .prepare(
            'SELECT id FROM crate_boxes WHERE user_id = ? AND title = ? LIMIT 1'
          )
          .get(user_id, title) as { id: number } | undefined;
        if (existing) return existing.id;
        const result = db
          .prepare(
            `INSERT INTO crate_boxes (user_id, position, title, is_public)
             VALUES (?, ?, ?, ?)`
          )
          .run(user_id, nextPos++, title, isPublic);
        crateRows += 1;
        return Number(result.lastInsertRowid);
      };

      if (collectionsExists) {
        const ownedAlbums = db
          .prepare(
            `SELECT DISTINCT album_id FROM collections WHERE user_id = ?`
          )
          .all(user_id) as Array<{ album_id: number }>;
        if (ownedAlbums.length > 0) {
          // Existing 샀음 surfaces (album page count, profile pill)
          // were public-by-default — preserve that visibility on
          // migration so a user who had visible counts doesn't
          // suddenly have a private crate where there was previously
          // a public stat.
          const ownedCrate = ensureCrate('샀음', 1);
          const ins = db.prepare(
            `INSERT OR IGNORE INTO crate_items (crate_id, album_id) VALUES (?, ?)`
          );
          for (const { album_id } of ownedAlbums) {
            const r = ins.run(ownedCrate, album_id);
            itemRows += r.changes;
          }
        }
      }

      if (wantsExists) {
        const wantedAlbums = db
          .prepare(
            `SELECT DISTINCT album_id FROM wants WHERE user_id = ?`
          )
          .all(user_id) as Array<{ album_id: number }>;
        if (wantedAlbums.length > 0) {
          const wantCrate = ensureCrate('살거', 1);
          const ins = db.prepare(
            `INSERT OR IGNORE INTO crate_items (crate_id, album_id) VALUES (?, ?)`
          );
          for (const { album_id } of wantedAlbums) {
            const r = ins.run(wantCrate, album_id);
            itemRows += r.changes;
          }
        }
      }
    }

    db.exec(`DROP TABLE IF EXISTS collections`);
    db.exec(`DROP TABLE IF EXISTS wants`);
    console.log(
      `[migration] absorbed collections/wants into crates: ${userIdsSet.size} users, ${crateRows} crates, ${itemRows} items; legacy tables dropped`
    );
  });

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
