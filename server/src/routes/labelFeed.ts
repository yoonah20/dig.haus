import { Router } from 'express';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  searchAlbumsByLabel,
  searchTrack,
} from '../services/spotify.js';
import { searchAlbums as searchMbAlbums } from '../services/musicbrainz.js';
import { searchMasterUrl, searchRelease } from '../services/discogs.js';
import { searchVideo } from '../services/youtube.js';
import { searchBandcamp } from '../services/bandcamp.js';
import { cacheAlbum, updateAlbumFields, getCachedAlbum } from '../utils/cache.js';
import { generateSlug } from '../utils/slug.js';
import { pollSingleLabelById, runLabelFeedPoll } from '../jobs/labelFeedPoller.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

// All routes in this file are admin-only.
router.use(requireAdmin);

// ─── Tracked labels CRUD ────────────────────────────────────────────────

router.get('/tracked-labels', (_req, res) => {
  const rows = queryAll(
    `SELECT tl.id, tl.spotify_label_name, tl.display_name,
            tl.is_active, tl.created_at, tl.last_polled_at,
            (SELECT COUNT(*) FROM label_feed_items
             WHERE tracked_label_id = tl.id
               AND dismissed_at IS NULL
               AND registered_mbid IS NULL) AS pending_count
     FROM tracked_labels tl
     ORDER BY tl.is_active DESC, tl.created_at ASC`
  );
  res.json({ labels: rows });
});

// Preview — test-run a label name against Spotify BEFORE saving it, so
// admin can verify spelling / label namespace (Profound Lore vs.
// "Profound Lore Records") before committing.
router.post('/tracked-labels/preview', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name 필요' });
  if (name.length > 120) return res.status(400).json({ error: 'name 너무 김' });

  try {
    const albums = await searchAlbumsByLabel(name, 10);
    res.json({
      count: albums.length,
      samples: albums.slice(0, 5).map((a) => ({
        artist: a.artistName,
        title: a.albumName,
        releaseDate: a.releaseDate,
        coverArtUrl: a.coverArtUrl,
      })),
    });
  } catch (err) {
    console.error('[label-feed] preview failed:', err);
    res.status(500).json({ error: 'Spotify 조회 실패' });
  }
});

router.post('/tracked-labels', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const displayName =
    typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim().slice(0, 120)
      : null;
  if (!name || name.length > 120) {
    return res.status(400).json({ error: 'name 필요 (1-120자)' });
  }
  try {
    const existing = queryGet(
      `SELECT id FROM tracked_labels WHERE spotify_label_name = ?`,
      [name]
    ) as { id: number } | undefined;
    if (existing) {
      return res.status(409).json({ error: '이미 추적 중인 레이블입니다.' });
    }
    const result = execute(
      `INSERT INTO tracked_labels (spotify_label_name, display_name, is_active)
       VALUES (?, ?, 1)`,
      [name, displayName]
    );
    const id = Number(result.lastInsertRowid);
    // Immediate poll so the feed populates right away instead of
    // waiting for tomorrow's 03:00 KST cron.
    const pollResult = await pollSingleLabelById(id);
    res.json({ ok: true, id, initialPoll: pollResult });
  } catch (err) {
    console.error('[label-feed] create failed:', err);
    res.status(500).json({ error: '레이블 추가 실패' });
  }
});

router.patch('/tracked-labels/:id', (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  const updates: string[] = [];
  const params: any[] = [];
  if (typeof req.body?.isActive === 'boolean') {
    updates.push('is_active = ?');
    params.push(req.body.isActive ? 1 : 0);
  }
  if (typeof req.body?.displayName === 'string') {
    updates.push('display_name = ?');
    params.push(req.body.displayName.trim().slice(0, 120) || null);
  }
  if (updates.length === 0) return res.status(400).json({ error: '업데이트할 필드 없음' });
  params.push(id);
  try {
    const result = execute(
      `UPDATE tracked_labels SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[label-feed] update failed:', err);
    res.status(500).json({ error: '업데이트 실패' });
  }
});

router.delete('/tracked-labels/:id', (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  try {
    // CASCADE on the FK takes label_feed_items with it.
    const result = execute(`DELETE FROM tracked_labels WHERE id = ?`, [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[label-feed] delete failed:', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// Manually trigger a poll for a specific label — useful right after
// deploy or when admin wants to force-refresh without waiting for
// 03:00 KST. Defaults to 'recent' (wider 2-year window) so the feed
// isn't empty for labels that haven't released anything in the last
// 14 days; the daily cron still uses tag:new for tighter updates.
router.post('/tracked-labels/:id/poll', async (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  const result = await pollSingleLabelById(id, 'recent');
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, ...result });
});

// Refresh every active tracked label at once. Used by the panel-level
// "🔄 전체 새로고침" button so admin doesn't have to click each row's
// per-label refresh. Same 'recent' window as the per-label refresh.
router.post('/tracked-labels/poll-all', async (_req, res) => {
  try {
    const result = await runLabelFeedPoll('recent');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[label-feed] poll-all failed:', err);
    res.status(500).json({ error: '전체 폴링 실패' });
  }
});

// ─── Label feed items ───────────────────────────────────────────────────

router.get('/label-feed', (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50));
  try {
    const rows = queryAll(
      `SELECT fi.id, fi.tracked_label_id, fi.spotify_album_id,
              fi.artist_name, fi.album_name, fi.release_date,
              fi.cover_art_url, fi.spotify_url, fi.album_type, fi.total_tracks,
              fi.first_seen_at,
              tl.spotify_label_name, tl.display_name
       FROM label_feed_items fi
       JOIN tracked_labels tl ON tl.id = fi.tracked_label_id
       WHERE fi.dismissed_at IS NULL
         AND fi.registered_mbid IS NULL
       ORDER BY fi.release_date DESC, fi.first_seen_at DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[label-feed] list failed:', err);
    res.status(500).json({ error: '피드 조회 실패' });
  }
});

router.post('/label-feed/:id/dismiss', (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });
  try {
    const result = execute(
      `UPDATE label_feed_items SET dismissed_at = datetime('now') WHERE id = ?`,
      [id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[label-feed] dismiss failed:', err);
    res.status(500).json({ error: '처리 실패' });
  }
});

// Register a feed item into the main albums table. Conservative MB
// match first (same artist name case-insensitive + matching year), and
// fall back to synthetic `sp-{spotify_id}` mbid when MB doesn't have
// the album (common for new releases — MB's volunteer indexing lags
// release by weeks). A synthetic-mbid row carries Spotify's metadata
// plus whatever parallel streaming lookups give us, but skips the
// expected-MB-shape enrichments (genres, label_id, discography) —
// those fill in later if MB eventually indexes the album.
router.post('/label-feed/:id/register', async (req, res) => {
  const id = parseInt((req.params.id as string), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id 잘못됨' });

  const item = queryGet(
    `SELECT id, spotify_album_id, artist_name, album_name, release_date,
            cover_art_url, spotify_url
     FROM label_feed_items
     WHERE id = ? AND dismissed_at IS NULL AND registered_mbid IS NULL`,
    [id]
  ) as
    | {
        id: number;
        spotify_album_id: string;
        artist_name: string;
        album_name: string;
        release_date: string | null;
        cover_art_url: string | null;
        spotify_url: string | null;
      }
    | undefined;
  if (!item) return res.status(404).json({ error: '피드 항목 없음 또는 이미 처리됨' });

  const adminUserId = (req.user as AppUser | undefined)?.id ?? null;
  const year = (item.release_date || '').slice(0, 4);

  // MB match attempt — conservative: artist name case-insensitive +
  // year match. Any ambiguity (two candidates matching, artist name
  // differs slightly) falls through to the synthetic path. We lean
  // towards correctness over coverage here.
  let matched: 'mb' | 'spotify' = 'spotify';
  let mbid: string | null = null;

  try {
    const query = `artist:"${item.artist_name}" AND release:"${item.album_name}"`;
    const mbResults = await searchMbAlbums(query);
    const candidate = mbResults.find(
      (r) =>
        r.artist.toLowerCase() === item.artist_name.toLowerCase() &&
        (!year || r.year === year || r.year === `${parseInt(year, 10) - 1}` || r.year === `${parseInt(year, 10) + 1}`)
    );
    if (candidate) {
      mbid = candidate.mbid;
      matched = 'mb';
    }
  } catch (err) {
    console.warn('[label-feed] MB lookup threw:', (err as Error).message);
  }

  try {
    if (matched === 'mb' && mbid) {
      // Delegate to the full fetch-and-cache path so we get genres,
      // label, discography, streaming links in one shot.
      const { getOrFetchAlbumBaseForSubmission } = await import('./albums.js');
      await getOrFetchAlbumBaseForSubmission(mbid, {
        requestedByUserId: adminUserId ?? undefined,
      });
      const cached = getCachedAlbum(mbid);
      if (!cached) {
        throw new Error('MB fetch returned no cached row');
      }
      execute(
        `UPDATE label_feed_items SET registered_mbid = ? WHERE id = ?`,
        [mbid, id]
      );
      return res.json({
        ok: true,
        matched,
        mbid,
        slug: cached.slug,
      });
    }

    // Synthetic-mbid path. Spotify already gave us most of the needed
    // row fields; streaming links we probe in parallel. Discogs
    // searches are best-effort — they run even without an MB mbid
    // because their internal search is text-based on (artist, title).
    mbid = `sp-${item.spotify_album_id}`;
    const slug = generateSlug(item.artist_name, item.album_name, year || null, mbid);

    const [spResult, ytResult, bcResult, dcMasterResult] = await Promise.allSettled([
      searchTrack(item.artist_name, item.album_name),
      searchVideo(item.artist_name, item.album_name),
      searchBandcamp(item.artist_name, item.album_name),
      searchMasterUrl(item.artist_name, item.album_name),
    ]);
    const spotifyUrl =
      item.spotify_url ||
      (spResult.status === 'fulfilled' ? spResult.value?.url : null) ||
      null;
    const youtubeUrl = ytResult.status === 'fulfilled' ? ytResult.value || null : null;
    const bandcampUrl =
      bcResult.status === 'fulfilled' ? bcResult.value?.url || null : null;
    let discogsUrl =
      dcMasterResult.status === 'fulfilled' ? dcMasterResult.value : null;
    if (!discogsUrl) {
      try {
        const dcRelease = await searchRelease(item.artist_name, item.album_name);
        discogsUrl = dcRelease?.url || null;
      } catch {
        discogsUrl = null;
      }
    }

    cacheAlbum({
      mbid,
      slug,
      title: item.album_name,
      artist_name: item.artist_name,
      release_date: item.release_date || null,
      release_year: year || null,
      cover_art_url: item.cover_art_url,
      spotify_url: spotifyUrl,
      youtube_url: youtubeUrl,
      bandcamp_url: bandcampUrl,
      discogs_url: discogsUrl,
    });
    // cacheAlbum's INSERT doesn't carry requested_by_user_id —
    // back-fill separately so admin attribution lands correctly.
    if (adminUserId) {
      updateAlbumFields(mbid, { requested_by_user_id: adminUserId });
    }

    execute(
      `UPDATE label_feed_items SET registered_mbid = ? WHERE id = ?`,
      [mbid, id]
    );
    return res.json({ ok: true, matched, mbid, slug });
  } catch (err) {
    console.error('[label-feed] register failed:', err);
    return res.status(500).json({
      error: '등록 중 오류가 발생했습니다.',
      detail: (err as Error).message,
    });
  }
});

export default router;
