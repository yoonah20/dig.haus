import cron from 'node-cron';
import { queryAll, queryGet, execute } from '../db/index.js';
import { searchAlbumsByLabel, type LabelSearchMode } from '../services/spotify.js';

// Phase 3a label-tracking feed. Runs once a day and polls Spotify
// `label:"X" tag:new` for each active tracked_label. New albums land
// in label_feed_items where admin manually picks what to promote
// into the main `albums` table. Intentionally not auto-promoting —
// Spotify's label field is noisy enough (imprints, regional splits,
// user-generated labels) that we want a human gate.
//
// Cleanup pass in the same run: entries that sat 30 days without
// being registered or dismissed get auto-dismissed so the feed
// doesn't pile up stale items.

export const LABEL_FEED_STALE_DAYS = 30;

interface TrackedLabelRow {
  id: number;
  spotify_label_name: string;
}

export async function pollTrackedLabel(
  trackedLabelId: number,
  labelName: string,
  mode: LabelSearchMode = 'new'
): Promise<{ found: number; inserted: number }> {
  let inserted = 0;
  let found = 0;
  try {
    // Date window + label-name fallback are inside searchAlbumsByLabel
    // so preview / cron / manual refresh all see the same set. No
    // album_type filter here — singles are useful pre-release signals
    // and the feed UI tags each row so admin can dismiss types they
    // don't care about.
    const albums = await searchAlbumsByLabel(labelName, 50, mode);
    found = albums.length;
    for (const a of albums) {
      const result = execute(
        `INSERT INTO label_feed_items
           (tracked_label_id, spotify_album_id, artist_name, album_name,
            release_date, cover_art_url, spotify_url, album_type, total_tracks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tracked_label_id, spotify_album_id) DO NOTHING`,
        [
          trackedLabelId,
          a.spotifyAlbumId,
          a.artistName,
          a.albumName,
          a.releaseDate || null,
          a.coverArtUrl,
          a.spotifyUrl,
          a.albumType,
          a.totalTracks || null,
        ]
      );
      if (result.changes > 0) inserted++;
    }
    execute(
      `UPDATE tracked_labels SET last_polled_at = datetime('now') WHERE id = ?`,
      [trackedLabelId]
    );
  } catch (err) {
    console.error(`[label-feed] poll failed for "${labelName}":`, (err as Error).message);
  }
  return { found, inserted };
}

export async function runLabelFeedPoll(
  mode: LabelSearchMode = 'new'
): Promise<{ totalFound: number; totalInserted: number; labelCount: number }> {
  const labels = queryAll(
    `SELECT id, spotify_label_name FROM tracked_labels
     WHERE COALESCE(is_active, 1) = 1
     ORDER BY id ASC`
  ) as TrackedLabelRow[];

  let totalFound = 0;
  let totalInserted = 0;
  if (labels.length === 0) {
    console.log('[label-feed] no active tracked labels; skipping');
  } else {
    for (const label of labels) {
      const { found, inserted } = await pollTrackedLabel(
        label.id,
        label.spotify_label_name,
        mode
      );
      totalFound += found;
      totalInserted += inserted;
      console.log(
        `[label-feed] "${label.spotify_label_name}" (${mode}): ${found} found, ${inserted} new`
      );
    }
  }

  // Cleanup: stale items (undismissed + unregistered + older than N days)
  // get auto-dismissed so the feed UI doesn't balloon.
  try {
    const res = execute(
      `UPDATE label_feed_items
       SET dismissed_at = datetime('now')
       WHERE dismissed_at IS NULL
         AND registered_mbid IS NULL
         AND first_seen_at < datetime('now', ?)`,
      [`-${LABEL_FEED_STALE_DAYS} days`]
    );
    if (res.changes > 0) {
      console.log(`[label-feed] auto-dismissed ${res.changes} stale item(s)`);
    }
  } catch (err) {
    console.error('[label-feed] stale cleanup failed:', (err as Error).message);
  }

  return { totalFound, totalInserted, labelCount: labels.length };
}

export function startLabelFeedPoller(): void {
  // 03:00 KST daily — after the rank scheduler (00:00 KST) and before
  // Korean users wake up. Spotify typically drops new releases Friday
  // UTC mid-morning; polling once/day keeps us within a few hours of
  // new arrivals without hammering the API.
  cron.schedule(
    '0 3 * * *',
    () => {
      runLabelFeedPoll().catch((err) => {
        console.error('[label-feed] run threw:', err);
      });
    },
    { timezone: 'Asia/Seoul' }
  );

  // No initial run on startup — label list is usually empty right after
  // deploy, and admin-added labels get an immediate preview poll via
  // the POST /tracked-labels endpoint so we don't wait for 03:00.
  console.log('[label-feed] Scheduler started (03:00 KST daily)');
}

/**
 * Called after admin adds a new label or clicks 🔄 manually. Defaults
 * to 'recent' (wider 2-year window + 120-day filter) so the feed has
 * content even on labels that haven't released anything in the last
 * 14 days.
 */
export async function pollSingleLabelById(
  id: number,
  mode: LabelSearchMode = 'recent'
): Promise<{
  found: number;
  inserted: number;
} | null> {
  const row = queryGet(
    `SELECT id, spotify_label_name FROM tracked_labels WHERE id = ?`,
    [id]
  ) as TrackedLabelRow | undefined;
  if (!row) return null;
  return pollTrackedLabel(row.id, row.spotify_label_name, mode);
}
