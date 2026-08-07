import cron from 'node-cron';
import { queryAll, queryGet } from '../db/index.js';
import { updateAlbumFields } from '../utils/cache.js';
import { getMasterMarketData } from '../services/discogs.js';
import { searchTrack } from '../services/spotify.js';
import { enqueueAutoCuration } from '../services/autoCuration.js';

// Release-day sync. Albums are often registered as pre-orders — before
// they exist on Discogs/Spotify and before any review is published — so
// their store links are frequently absent OR auto-matched to the WRONG
// release (a different pressing, a same-name album, a placeholder), and
// reviews_crawled_at stays NULL. This job watches release dates and,
// once an album is out, re-resolves the store links and kicks off the
// review-collection pipeline (reviews start appearing around release
// day).
//
// Two independent passes, gated differently on purpose:
//
//   Link refresh — re-searched daily for the 7 days following release
//   (the window IS the retry cutoff: an album ages out after a week).
//   We refresh rather than fill-only because the pre-release value is
//   often wrong, not just missing — so we re-search from scratch (no
//   pinned discogs_id) and overwrite. Only overwrite when the lookup
//   returns a hit; a null result leaves the existing link intact rather
//   than blanking it on a transient miss. Discogs/Spotify calls are
//   cheap, so daily re-resolution over a 7-day window is fine.
//
//   Review enqueue — fired EXACTLY ONCE, on the single run where the
//   release date equals "today". autoCuration leaves reviews_crawled_at
//   NULL when it finds nothing, so a date-range gate would silently
//   re-crawl every day until reviews appear; the exact-day match is
//   what enforces the "발매 당일 1회만" policy (accepting that an album
//   with no reviews out yet on that day is a permanent miss). Reviews
//   cost ~$0.01/album, so we do not want an accidental daily retry.
//
// KST/UTC note: the cron fires at 04:00 Asia/Seoul (= 19:00 UTC the
// day before), so a bare date('now') resolves to the PRIOR UTC calendar
// day — an album released on KST day D would not match until the 04:00
// KST run of D+1. We compare against date('now', '+9 hours') instead so
// the gate is anchored to the KST calendar day: an album released on KST
// day D first matches on the 04:00 KST run of D itself. The JS-side
// isUnreleased() guard in autoCuration uses the same KST boundary so the
// review enqueue isn't skipped as "not out yet" on that 04:00 run.

interface AlbumRow {
  mbid: string;
  artist_name: string;
  title: string;
  discogs_url: string | null;
  spotify_url: string | null;
}

/**
 * Re-resolve an album's Discogs / Spotify links from a fresh lookup and
 * overwrite the stored values. Pre-release rows often carry a link that
 * was auto-matched to the wrong release, so this re-searches from
 * scratch (no pinned discogs_id) rather than trusting the existing id.
 * Only overwrites when the lookup returns a hit — a null result leaves
 * the current link intact so a transient miss can't blank a good link.
 * Returns which links it wrote (found a value for).
 */
export async function syncSingleAlbumRelease(
  mbid: string
): Promise<{ discogs: boolean; spotify: boolean }> {
  const row = queryGet(
    'SELECT mbid, artist_name, title, discogs_url, spotify_url FROM albums WHERE mbid = ?',
    [mbid]
  ) as AlbumRow | undefined;

  const result = { discogs: false, spotify: false };
  if (!row || !row.artist_name || !row.title) return result;

  try {
    // knownMasterId = null forces a fresh master search instead of
    // re-pulling whatever (possibly wrong) master the pre-release row
    // pinned. discogs_id is rewritten from the fresh result.
    const fresh = await getMasterMarketData(row.artist_name, row.title, null);
    if (fresh?.discogsUrl) {
      const formats = fresh.formats || [];
      updateAlbumFields(mbid, {
        discogs_url: fresh.discogsUrl,
        discogs_id: fresh.masterId || null,
        discogs_formats_json:
          formats.length > 0 ? JSON.stringify(formats) : null,
        discogs_formats_updated_at: new Date().toISOString(),
      });
      result.discogs = true;
    }
  } catch (err) {
    console.error(
      `[release-sync] discogs lookup failed for ${mbid}:`,
      (err as Error).message
    );
  }

  try {
    // searchTrack searches type=album (misleading name) and already
    // does the quoted / primary-artist / de-parenthesised / free-text
    // fallback chain plus 429 cooldown handling. First hit wins,
    // matching the "1건이라도 매칭되면 자동 반영" decision.
    const { url } = await searchTrack(row.artist_name, row.title);
    if (url) {
      updateAlbumFields(mbid, { spotify_url: url });
      result.spotify = true;
    }
  } catch (err) {
    console.error(
      `[release-sync] spotify lookup failed for ${mbid}:`,
      (err as Error).message
    );
  }

  return result;
}

export async function runReleaseSync(): Promise<{
  linkCandidates: number;
  discogsRefreshed: number;
  spotifyRefreshed: number;
  reviewsQueued: number;
}> {
  // Pass 1: link refresh for everything released in the last 7 days —
  // no "link missing" filter, because a wrong pre-release link needs
  // re-resolving just as much as an absent one. date(release_date) is
  // NULL for year-only / year-month values, which cleanly excludes
  // imprecise dates the way autoCuration's isUnreleased() also refuses
  // to act on them. Sequential await keeps the Discogs/Spotify fan-out
  // gentle — no p-limit needed at this catalogue size.
  const linkCandidates = queryAll(
    `SELECT mbid
     FROM albums
     WHERE date(release_date) IS NOT NULL
       AND date(release_date) <= date('now', '+9 hours')
       AND date(release_date) >= date('now', '+9 hours', '-7 days')
       AND artist_name IS NOT NULL
       AND title IS NOT NULL
     ORDER BY release_date DESC`
  ) as Array<{ mbid: string }>;

  let discogsRefreshed = 0;
  let spotifyRefreshed = 0;
  for (const a of linkCandidates) {
    try {
      const r = await syncSingleAlbumRelease(a.mbid);
      if (r.discogs) discogsRefreshed++;
      if (r.spotify) spotifyRefreshed++;
    } catch (err) {
      console.error(
        `[release-sync] link sync threw for ${a.mbid}:`,
        (err as Error).message
      );
    }
  }

  // Pass 2: review enqueue for albums whose release date is exactly
  // today. enqueueAutoCuration is a no-op for reviews_crawled_at rows
  // and dedups against its own in-flight queue, but we filter here too
  // so the count reflects real enqueues.
  const reviewCandidates = queryAll(
    `SELECT mbid FROM albums
     WHERE date(release_date) = date('now', '+9 hours')
       AND reviews_crawled_at IS NULL`
  ) as Array<{ mbid: string }>;

  for (const a of reviewCandidates) {
    enqueueAutoCuration(a.mbid);
  }

  console.log(
    `[release-sync] links: ${discogsRefreshed} discogs + ${spotifyRefreshed} spotify refreshed across ${linkCandidates.length} candidate(s); reviews: ${reviewCandidates.length} enqueued`
  );

  return {
    linkCandidates: linkCandidates.length,
    discogsRefreshed,
    spotifyRefreshed,
    reviewsQueued: reviewCandidates.length,
  };
}

export function startReleaseSyncScheduler(): void {
  // 04:00 KST daily — after rankScheduler (00:00) and labelFeedPoller
  // (03:00) so the three daily jobs don't overlap. No initial run on
  // boot: link backfill + review crawls burn external quota, and a
  // fresh deploy shouldn't re-scan the whole release window every time
  // it restarts. Entry points: this daily tick, the per-album admin
  // resync (POST /api/albums/:id/sync-release), and the batch admin
  // trigger (POST /api/admin/run-release-sync) — the batch one recovers a
  // day whose 04:00 tick was missed because a redeploy landed on it.
  cron.schedule(
    '0 4 * * *',
    () => {
      runReleaseSync().catch((err) => {
        console.error('[release-sync] run threw:', err);
      });
    },
    { timezone: 'Asia/Seoul' }
  );

  console.log('[release-sync] Scheduler started (04:00 KST daily)');
}
