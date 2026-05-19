import { searchReviewUrls } from './serper.js';
import {
  scrapeReviewFromUrl,
  EXCLUDED_URL_PATH_PATTERNS,
  isHostBlacklisted,
  getWhitelistedHostsFromDb,
  normalizeReviewUrl,
} from './reviews.js';
import { selectEditorialReviewUrls, generateKoreanSummary } from './claude.js';
import { getCachedAlbum, updateAlbumFields, getCachedReviews } from '../utils/cache.js';
import { execute, queryAll } from '../db/index.js';

// Server-side port of the client's CurationProgressContext.processAlbum
// pipeline. Same three steps (discover → scrape × N → summary), same
// constants, same per-host serialisation — see that file for the
// reasoning behind each number. Carved out so user-submission auto-
// curation can run without depending on the browser tab staying open,
// and so the admin ⚡ flow can migrate to a single source of truth.
//
// The original /reviews/{discover,add-url,generate-summary} HTTP
// endpoints stay in place for the admin UI; this module calls the
// underlying services (searchReviewUrls, scrapeReviewFromUrl,
// generateKoreanSummary) directly without going through the HTTP
// adminClaudeLimiter — the global serial queue below already bounds
// concurrency to one album at a time.

const AUTO_CURATION_TARGET_SAVED = 15;
const AUTO_CURATION_MAX_ATTEMPTS = 25;
const CHUNK_SIZE = 12;
const SUMMARY_MAX_ATTEMPTS = 3;
const SUMMARY_BACKOFF_MS = [0, 2000, 5000];

// Kill switch for the user-submission auto-trigger. The service itself
// still exports runAutoCuration so admin paths could call it directly
// in the future; this flag only gates the implicit enqueue on user
// album-requests. Default on — flip to '0' if abuse shows up.
const ENABLED = process.env.AUTO_REVIEW_COLLECTION !== '0';

export interface AutoCurationResult {
  mbid: string;
  urlsFound: number;
  urlsSaved: number;
  duplicates: number;
  failures: number;
  summaryGenerated: boolean;
  status: 'done' | 'failed' | 'no-urls' | 'skipped-already-curated';
  error?: string;
}

// Per-mbid progress snapshot exposed via GET /api/albums/:id/auto-
// curation-status. The album page polls this while reviews_crawled_at
// IS NULL so a user who just registered can see "리뷰 발굴 중 5/15"
// instead of the static digman + 답답한 침묵 the previous rev gave them.
// Pure in-memory — a server restart clears state, same as the queue
// itself, so the polling client just stops seeing in-flight progress.
export type CurationPhase =
  | 'queued'
  | 'discovering'
  | 'scraping'
  | 'summarizing';

export interface CurationProgress {
  mbid: string;
  phase: CurationPhase;
  urlsFound: number;
  urlsSaved: number;
  startedAt: string;
}

const progressByMbid = new Map<string, CurationProgress>();

export function getAutoCurationProgress(mbid: string): CurationProgress | null {
  return progressByMbid.get(mbid) ?? null;
}

export async function runAutoCuration(mbid: string): Promise<AutoCurationResult> {
  const album = getCachedAlbum(mbid);
  if (!album) {
    return emptyResult(mbid, 'failed', 'album-not-found');
  }
  // Defensive guard: if something curated this album between enqueue
  // and pickup (admin clicked ⚡, or a previous queued run for the
  // same mbid already finished), skip. Avoids burning a Serper +
  // Haiku-pick call to discover URLs we already have.
  if (album.reviews_crawled_at) {
    return emptyResult(mbid, 'skipped-already-curated');
  }

  const artist: string = album.artist_name;
  const title: string = album.title;
  console.log(`[auto-curation] start ${artist} / ${title} (${mbid})`);

  // Initialise progress; transitions update phase + counters in place
  // so the polling client always sees the latest snapshot. drain() is
  // responsible for clearing the entry on completion, regardless of
  // outcome (done / failed / no-urls).
  progressByMbid.set(mbid, {
    mbid,
    phase: 'discovering',
    urlsFound: 0,
    urlsSaved: 0,
    startedAt: new Date().toISOString(),
  });

  // Step 1: discover. Mirrors /api/albums/:id/reviews/discover.
  let candidates: string[] = [];
  try {
    const searchResults = await searchReviewUrls(artist, title);
    const domainFiltered = searchResults.filter((c) => {
      try {
        const parsed = new URL(c.url);
        const host = parsed.hostname.toLowerCase();
        if (isHostBlacklisted(host)) return false;
        const pathKey = parsed.pathname + parsed.search;
        if (EXCLUDED_URL_PATH_PATTERNS.some((re) => re.test(pathKey))) return false;
        return true;
      } catch {
        return false;
      }
    });

    const existingUrls = queryAll(
      `SELECT full_review_url FROM reviews WHERE album_mbid = ?`,
      [mbid]
    ) as Array<{ full_review_url: string }>;
    const existingKeys = new Set(
      existingUrls.map((r) => normalizeReviewUrl(r.full_review_url))
    );
    const filtered = domainFiltered.filter(
      (c) => !existingKeys.has(normalizeReviewUrl(c.url))
    );

    if (filtered.length === 0) {
      console.log(`[auto-curation] ${mbid}: no candidates after filter`);
      return emptyResult(mbid, 'no-urls');
    }

    const picked = await selectEditorialReviewUrls(artist, title, filtered);
    if (picked.length === 0) {
      return emptyResult(mbid, 'no-urls');
    }
    const whitelist = getWhitelistedHostsFromDb();
    const isWhitelisted = (u: string): boolean => {
      try {
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        if (whitelist.has(h)) return true;
        for (const entry of whitelist) {
          if (h === entry || h.endsWith(`.${entry}`)) return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    candidates = [
      ...picked.filter(isWhitelisted),
      ...picked.filter((u) => !isWhitelisted(u)),
    ].slice(0, AUTO_CURATION_MAX_ATTEMPTS);
  } catch (err) {
    console.error(`[auto-curation] discover failed for ${mbid}:`, (err as Error).message);
    return emptyResult(mbid, 'failed', 'discover-failed');
  }

  // Transition into scraping phase. urlsFound is fixed for the run;
  // urlsSaved ticks up as each scrape commits a row.
  updateProgress(mbid, {
    phase: 'scraping',
    urlsFound: candidates.length,
  });

  // Step 2: chunked scrape with backfill + per-host serialisation.
  // See CurationProgressContext for the reasoning on CHUNK_SIZE,
  // dynamic chunk shrinking near target, and host bucketing.
  let saved = 0;
  let failed = 0;
  let attempted = 0;
  while (attempted < candidates.length && saved < AUTO_CURATION_TARGET_SAVED) {
    const roomLeft = AUTO_CURATION_TARGET_SAVED - saved;
    const chunkSize = Math.max(1, Math.min(CHUNK_SIZE, roomLeft));
    const chunk = candidates.slice(attempted, attempted + chunkSize);
    attempted += chunk.length;

    const byHost = new Map<string, string[]>();
    for (const url of chunk) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        host = url;
      }
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host)!.push(url);
    }

    await Promise.all(
      [...byHost.values()].map(async (urls) => {
        for (const url of urls) {
          try {
            const outcome = await scrapeReviewFromUrl(url, artist, title, mbid);
            if (outcome.kind === 'fail') {
              failed++;
              continue;
            }
            const r = outcome.review;
            execute(
              `INSERT INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(album_mbid, source_name) DO UPDATE SET
                 score = excluded.score,
                 score_max = excluded.score_max,
                 excerpt = excluded.excerpt,
                 excerpt_ko = excluded.excerpt_ko,
                 full_review_url = excluded.full_review_url,
                 scraped_at = datetime('now')`,
              [
                mbid,
                r.sourceName,
                r.score,
                r.scoreMax,
                r.excerpt,
                r.excerptKo,
                r.fullReviewUrl,
              ]
            );
            // discover() already filtered URLs we have on file, so a
            // collision here is the two-URLs-same-source_name edge
            // case (e.g., two pitchfork pages for the same album).
            // The UPSERT handles it; we just count saved++ either way
            // — undercounting saves slightly in that rare case but
            // matches the client pipeline's behaviour.
            saved++;
            updateProgress(mbid, { urlsSaved: saved });
          } catch (err) {
            console.error(
              `[auto-curation] scrape ${url} failed:`,
              (err as Error).message
            );
            failed++;
          }
        }
      })
    );
  }

  // Step 3: summary with retries.
  let summaryOk = false;
  const existing = getCachedReviews(mbid) || [];
  if (existing.length >= 2) {
    updateProgress(mbid, { phase: 'summarizing' });
    for (let attempt = 0; attempt < SUMMARY_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const backoff = SUMMARY_BACKOFF_MS[attempt] ?? 0;
        if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      }
      try {
        const summary = await generateKoreanSummary(
          title,
          artist,
          existing.map((r: any) => ({
            source: r.source_name,
            score: r.manual_score ?? r.score,
            excerpt: r.excerpt,
          }))
        );
        const fields: Record<string, any> = {
          // Stamp regardless of summary success — same policy as the
          // admin generate-summary endpoint.
          reviews_crawled_at: new Date().toISOString(),
        };
        if (summary) {
          fields.korean_summary = summary;
          fields.korean_summary_generated_at = new Date().toISOString();
        }
        updateAlbumFields(mbid, fields);
        summaryOk = !!summary;
        break;
      } catch (err) {
        console.warn(
          `[auto-curation] summary attempt ${attempt + 1} failed for ${mbid}:`,
          (err as Error).message
        );
      }
    }
    // If all retries threw before any update ran, still stamp the
    // crawl marker so the album card un-dims — the absence of a
    // summary is acceptable, leaving the album in "pending" state
    // forever isn't.
    if (!summaryOk) {
      const after = getCachedAlbum(mbid);
      if (after && !after.reviews_crawled_at) {
        updateAlbumFields(mbid, { reviews_crawled_at: new Date().toISOString() });
      }
    }
  } else if (saved > 0 || existing.length > 0) {
    // 0 or 1 review total — not enough for a meaningful summary, but
    // we did look. Stamp so the pending badge clears.
    updateAlbumFields(mbid, { reviews_crawled_at: new Date().toISOString() });
  }

  console.log(
    `[auto-curation] done ${mbid}: saved=${saved} failed=${failed} summary=${summaryOk}`
  );

  return {
    mbid,
    urlsFound: candidates.length,
    urlsSaved: saved,
    duplicates: 0,
    failures: failed,
    summaryGenerated: summaryOk,
    status: 'done',
  };
}

function updateProgress(mbid: string, patch: Partial<CurationProgress>): void {
  const current = progressByMbid.get(mbid);
  if (!current) return;
  progressByMbid.set(mbid, { ...current, ...patch });
}

function isUnreleased(releaseDate: string | null | undefined): boolean {
  if (!releaseDate) return false;
  const match = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
}

function emptyResult(
  mbid: string,
  status: AutoCurationResult['status'],
  error?: string
): AutoCurationResult {
  return {
    mbid,
    urlsFound: 0,
    urlsSaved: 0,
    duplicates: 0,
    failures: 0,
    summaryGenerated: false,
    status,
    error,
  };
}

// ─── Global FIFO queue ─────────────────────────────────────────────────
//
// User submissions feed into a single in-process serial queue. One album
// curates at a time; subsequent enqueues wait. This satisfies the "API
// 한꺼번에 안 때리기" requirement without needing per-user buckets,
// global concurrency caps, or time-based throttling — the curation
// itself already fans out to CHUNK_SIZE=12 concurrent scrapes, and
// stacking those across users multiplies external pressure without
// gain at the invite-only audience size we're operating at.
//
// In-memory state: a server restart drops the queue. That's fine — the
// affected albums stay reviews_crawled_at IS NULL and the admin
// dashboard's pending list picks them up for manual ⚡ recovery, same
// state as today's pre-rollout behaviour.

const queue: string[] = [];
const queuedSet = new Set<string>(); // dedup against same-mbid double-enqueue
let working = false;

export function enqueueAutoCuration(mbid: string): void {
  if (!ENABLED) {
    console.log(`[auto-curation] disabled by env, skipping ${mbid}`);
    return;
  }
  if (queuedSet.has(mbid)) {
    return;
  }
  // Unreleased albums: pre-orders / future-dated rows have no reviews
  // out there yet, so Serper would burn a query for zero return and
  // the album would still get reviews_crawled_at stamped, hiding it
  // from a future re-run on release day. Skip entirely and let the
  // existing admin-pending queue pick it up after release. Parses
  // YYYY-MM-DD prefix only; year-only / NULL release_date falls
  // through to the curation path (matches AlbumCard.parseReleaseTimestamp).
  const album = getCachedAlbum(mbid);
  if (album && isUnreleased(album.release_date)) {
    console.log(
      `[auto-curation] skipping ${mbid} — unreleased (release_date=${album.release_date})`
    );
    return;
  }
  queuedSet.add(mbid);
  queue.push(mbid);
  // Seed a 'queued' progress entry immediately so the polling client
  // can show "리뷰 수집 대기 중..." between submission and the moment
  // drain() picks the album up. runAutoCuration overwrites this with
  // the live phase on entry.
  progressByMbid.set(mbid, {
    mbid,
    phase: 'queued',
    urlsFound: 0,
    urlsSaved: 0,
    startedAt: new Date().toISOString(),
  });
  if (!working) {
    // Detach from the caller (the album-requests POST) so it can
    // respond immediately. setImmediate yields the event loop once
    // first, ensuring the HTTP response flushes before we start
    // burning Claude + Serper time.
    setImmediate(() => {
      drain().catch((err) =>
        console.error('[auto-curation] queue drain error:', err)
      );
    });
  }
}

async function drain(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length > 0) {
      const mbid = queue.shift()!;
      queuedSet.delete(mbid);
      try {
        await runAutoCuration(mbid);
      } catch (err) {
        console.error(`[auto-curation] run threw for ${mbid}:`, err);
      } finally {
        // Always clear progress state — the polling client transitions
        // from "in-flight" → null on this exact step and uses that
        // edge to refetch the album. Holding stale state past a run
        // would block the refresh signal.
        progressByMbid.delete(mbid);
      }
    }
  } finally {
    working = false;
  }
}

// Test/observability hook — admin endpoint can read this to surface
// "리뷰 자동 수집 큐: N개 대기" in the dashboard if we want it later.
export function getAutoCurationQueueDepth(): number {
  return queue.length + (working ? 1 : 0);
}
