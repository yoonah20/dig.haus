import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';

// Global state for the admin "one-click curation" flow. Lives at the app
// root so a run started on an album page keeps producing progress lines
// even after admin navigates away to /admin or to another album. Phase C's
// checkbox-batch flow from the admin page reuses the same context — each
// batch is just a queue of albumIds fed in one after another via startRun.
//
// Pipeline per album:
//   1. POST /albums/:id/reviews/discover      (Serper → Haiku pick)
//   2. For each picked URL: POST /reviews/add-url (Jina → DeepSeek extract
//      + Korean translate). Concurrency-limited chunks of 5.
//   3. POST /albums/:id/reviews/generate-summary (Sonnet aggregate)
//
// Every failure is logged and processing continues — a single bad URL
// shouldn't sink the batch. Admin reads the log in the floating panel
// and can re-run missing pieces manually from the album page.

// Bumped 5 → 8 (2026-04-21). 15-save target hits in 2 chunks instead
// of 3; DeepSeek's free-tier rate allowance (~60 RPM observed) has
// plenty of headroom at 12 concurrent, and Jina Reader is unrate-
// limited. The chunk still waits on its slowest URL, so net speedup
// is roughly (n-1)×(avg chunk time) across the run.
//
// Bumped 8 → 12 (2026-05-09) after the [reviews/timing] log showed
// fetch=70% of total wall time with a long-tail (p90=15.5s, p95=
// 16.5s); more concurrent slots means a 16s straggler doesn't
// monopolise the chunk while 7 fast pages wait. Paired with per-
// host serialisation in the dispatch loop below so the same site
// never gets two simultaneous hits — that was the failure mode the
// earlier "stay at 8" guard was protecting against, now solved
// directly instead of via a global cap.
const CHUNK_SIZE = 12;

// Auto-curation targets *successful* saves (15) rather than just
// slicing the first 15 URLs — if some fail (403, Cloudflare, not-a-
// review detection, etc.) we keep drawing from the remaining discover
// candidates until we hit the target or exhaust the list. MAX_ATTEMPTS
// caps scrape cost / runtime in the pathological case where every
// candidate fails. Haiku's discover list is ordered by editorial rank
// (majors first), so the backfill pulls from the next tier down — same
// quality gradient, just lower in the ranking.
const AUTO_CURATION_TARGET_SAVED = 15;
const AUTO_CURATION_MAX_ATTEMPTS = 25;

// Summary generation retry. Network blips and transient upstream errors
// (Anthropic 429 / 503, Railway cold-start timeouts) were dropping the
// summary step entirely on otherwise-successful runs. Three attempts
// with a linear backoff covers those without turning a genuine 400
// ("need 2+ reviews") into a slow failure.
const SUMMARY_MAX_ATTEMPTS = 3;
const SUMMARY_BACKOFF_MS = [0, 2000, 5000];

// The earlier hardcoded PRIORITY_REVIEW_DOMAINS list and the client-
// side orderByPriority helper were removed once the admin-managed
// source_whitelist table landed. The /reviews/discover endpoint now
// returns URLs already re-ordered by that whitelist (whitelisted
// hosts first, their relative order preserved) and reports a
// whitelistedCount so this context can still surface "우선 도메인 N개
// 발견" in the curation log without maintaining its own list. Admin
// curates the whitelist manually through the SourcesPanel — there is
// no baseline preferred list on the client anymore.

export interface CurationLogLine {
  id: string;
  albumMbid: string;
  albumTitle: string;
  message: string;
  kind: 'info' | 'success' | 'warn' | 'error';
  at: number;
}

export interface CurationAlbumResult {
  albumMbid: string;
  albumTitle: string;
  urlsFound: number;
  urlsSaved: number;
  duplicates: number;
  failures: number;
  summaryGenerated: boolean;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface CurationRunState {
  runId: string;
  albums: CurationAlbumResult[];
  currentIndex: number;
  log: CurationLogLine[];
  startedAt: number;
  finished: boolean;
}

interface CurationProgressAPI {
  run: CurationRunState | null;
  isRunning: boolean;
  /** One-off (album-page) vs batch (/admin checkbox) is a cosmetic tag
   *  that shows up in the curation-history feed — doesn't change the
   *  pipeline itself. Defaults to 'oneclick' when a single album is
   *  passed, 'batch' when more than one. */
  startRun: (
    albums: Array<{ mbid: string; title: string }>,
    triggerKind?: 'oneclick' | 'batch'
  ) => Promise<void>;
  /** Server-driven variant: kicks off no HTTP curation calls itself
   *  (the server already enqueued the run when the album was
   *  registered). Polls /auto-curation-status for each watched album
   *  and translates phase + counter transitions into log lines and
   *  album-state updates so the existing panel UI surfaces server-
   *  side runs the same as admin's client-driven runs. */
  watchServerRun: (albums: Array<{ mbid: string; title: string }>) => void;
  clearRun: () => void;
}

const CurationProgressContext = createContext<CurationProgressAPI | null>(null);

let nextLogId = 0;

export function CurationProgressProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [run, setRun] = useState<CurationRunState | null>(null);
  const isRunningRef = useRef(false);
  // Ref-backed queue that the running loop iterates against so late
  // appends (admin clicks "자동 큐레이션" on another album while one is
  // already in flight) get picked up without having to race React's
  // state updates. Kept in sync with run.albums but read synchronously.
  const queueRef = useRef<CurationAlbumResult[]>([]);
  // Mirror of run state for async pollers — useCallback closures
  // capture state at definition time, so a long-running poller needs
  // a ref to see appends/clears that happened after it started.
  const runRef = useRef<CurationRunState | null>(null);

  const appendLog = useCallback(
    (albumMbid: string, albumTitle: string, message: string, kind: CurationLogLine['kind'] = 'info') => {
      setRun((prev) => {
        if (!prev) return prev;
        const line: CurationLogLine = {
          id: `l-${nextLogId++}`,
          albumMbid,
          albumTitle,
          message,
          kind,
          at: Date.now(),
        };
        return { ...prev, log: [...prev.log, line] };
      });
    },
    []
  );

  const updateAlbum = useCallback(
    (index: number, patch: Partial<CurationAlbumResult>) => {
      setRun((prev) => {
        if (!prev) return prev;
        const next = prev.albums.slice();
        next[index] = { ...next[index], ...patch };
        return { ...prev, albums: next };
      });
    },
    []
  );

  const processAlbum = useCallback(
    async (
      album: CurationAlbumResult,
      index: number,
      runId: string,
      startedAt: string,
      triggerKind: 'oneclick' | 'batch'
    ) => {
      const { albumMbid, albumTitle } = album;
      // Window bounds for the server-side cost aggregation in the
      // curation-runs POST below. Server reads claude_usage_log rows
      // whose created_at falls inside [albumStartedAt, albumEndedAt]
      // and sums the dollar cost off PRICING_PER_1M — no need for
      // the old two-shot /api/admin/stats snapshot (was 2 HTTP round-
      // trips per album just to compute a delta).
      const albumStartedAt = new Date().toISOString();

      updateAlbum(index, { status: 'running' });
      appendLog(albumMbid, albumTitle, 'URL 자동 검색 시작', 'info');

      // Step 1: discover URLs — keep the full list as the candidate
      // pool, so Step 2 can backfill from beyond the initial target
      // when some attempts fail. The discover endpoint already re-
      // orders its response by the admin-managed source_whitelist
      // (whitelisted hosts first, relative order preserved within
      // each bucket), so the first AUTO_CURATION_MAX_ATTEMPTS slice
      // naturally concentrates trusted sources up front. The server
      // also returns whitelistedCount so we can call it out in the
      // log without maintaining a mirror list here.
      let candidates: string[] = [];
      let priorityCount = 0;
      try {
        const { data } = await axios.post(
          `/api/albums/${encodeURIComponent(albumMbid)}/reviews/discover`
        );
        const allUrls = Array.isArray(data?.urls) ? (data.urls as string[]) : [];
        candidates = allUrls.slice(0, AUTO_CURATION_MAX_ATTEMPTS);
        // whitelistedCount from the server counts the whole Haiku-
        // picked pool; clamp to the sliced candidate count so the
        // displayed number never exceeds the attempts we'll actually
        // make. If a whitelisted URL fell past the slice boundary
        // that's a concern for a future "expand attempts" flag, not
        // for the log line that describes this run.
        const serverWhitelisted = typeof data?.whitelistedCount === 'number' ? data.whitelistedCount : 0;
        priorityCount = Math.min(serverWhitelisted, candidates.length);
        // alreadySavedCount surfaces the dedup drop the server was
        // already computing. Without it admin couldn't tell whether a
        // missing-but-trusted URL got rejected by Haiku or simply
        // got filtered because it was already on file — the log line
        // now calls the dedup case out explicitly.
        const alreadySaved = typeof data?.alreadySavedCount === 'number' ? data.alreadySavedCount : 0;
        const logParts: string[] = [];
        if (priorityCount > 0) logParts.push(`화이트리스트 ${priorityCount}개`);
        if (alreadySaved > 0) logParts.push(`이미 저장 ${alreadySaved}개 제외`);
        const logSuffix = logParts.length > 0 ? ` (${logParts.join(', ')})` : '';
        appendLog(
          albumMbid,
          albumTitle,
          candidates.length === 0
            ? `URL 없음 — ${data?.message ?? '검색 결과 없음'}`
            : `URL ${candidates.length}개 발견${logSuffix} — 성공 ${AUTO_CURATION_TARGET_SAVED}개 목표로 큐레이션`,
          candidates.length === 0 ? 'warn' : 'info'
        );
      } catch (err: any) {
        appendLog(
          albumMbid,
          albumTitle,
          `URL 검색 실패: ${err?.response?.data?.error ?? err?.message ?? 'unknown'}`,
          'error'
        );
        updateAlbum(index, { status: 'failed' });
        return;
      }
      updateAlbum(index, { urlsFound: candidates.length });

      // Step 2: chunked add-url with backfill. Keep drawing from the
      // candidate pool until we hit the success target or exhaust
      // the list. A "success" is any saved row — duplicates don't
      // count because they didn't add new coverage; only fresh saves
      // advance toward the target. `failed` gets incremented on any
      // axios rejection so the log still reports accurately.
      let saved = 0;
      let dup = 0;
      let failed = 0;
      let attempted = 0;
      while (
        attempted < candidates.length &&
        saved < AUTO_CURATION_TARGET_SAVED
      ) {
        // Dynamic chunk sizing near the target: when we have room for
        // fewer than CHUNK_SIZE successes remaining, shrink the chunk
        // so a burst of successful saves can't overshoot (previously,
        // saved=13 + chunk of 5 all-succeed → saved=18, violating the
        // "15 cap" contract). The upper half of the run still uses
        // the full CHUNK_SIZE for parallelism; only the final chunk
        // or two near the target run narrower.
        const roomLeft = AUTO_CURATION_TARGET_SAVED - saved;
        const chunkSize = Math.max(1, Math.min(CHUNK_SIZE, roomLeft));
        const chunk = candidates.slice(attempted, attempted + chunkSize);
        attempted += chunk.length;
        // Per-host serialisation: parallel across distinct hosts, but
        // same-host URLs run sequentially so we never hit one site
        // (sputnikmusic, metalstorm, etc.) with two simultaneous
        // requests. Two effects: (1) avoids tripping rate-limit /
        // bot-wall heuristics that look for burst patterns, (2) when
        // a host serves a 16s timeout the chunk's other hosts aren't
        // forced to wait behind it — they finish independently.
        const byHost = new Map<string, string[]>();
        for (const url of chunk) {
          let host: string;
          try {
            host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
          } catch {
            host = url; // Malformed URL — give it its own bucket.
          }
          if (!byHost.has(host)) byHost.set(host, []);
          byHost.get(host)!.push(url);
        }
        await Promise.all(
          [...byHost.values()].map(async (urls) => {
            for (const url of urls) {
              try {
                const resp = await axios.post(
                  `/api/albums/${encodeURIComponent(albumMbid)}/reviews/add-url`,
                  { url }
                );
                if (resp.data?.duplicate) dup++;
                else saved++;
              } catch {
                failed++;
              }
            }
          })
        );
        updateAlbum(index, { urlsSaved: saved, duplicates: dup, failures: failed });
      }
      if (candidates.length > 0) {
        const hit = saved >= AUTO_CURATION_TARGET_SAVED;
        const tail = hit
          ? `${attempted}회 시도해서 목표 달성`
          : `후보 소진 (${attempted}회 시도)`;
        appendLog(
          albumMbid,
          albumTitle,
          `리뷰 ${saved}개 저장 (중복 ${dup}, 실패 ${failed}) — ${tail}`,
          saved > 0 ? 'success' : 'warn'
        );
      }

      // Step 3: summary (only if there's something to summarize).
      // Retried a few times with backoff so transient hiccups
      // (Network Error, Anthropic 429/503, Railway cold-start) don't
      // drop the summary step on an otherwise-successful run.
      let summaryOk = false;
      if (saved > 0 || dup > 0) {
        appendLog(albumMbid, albumTitle, '한국어 요약 생성 중', 'info');
        let lastSummaryErr: string | null = null;
        for (let attempt = 0; attempt < SUMMARY_MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            const backoff = SUMMARY_BACKOFF_MS[attempt] ?? 0;
            appendLog(
              albumMbid,
              albumTitle,
              `요약 재시도 (${attempt + 1}/${SUMMARY_MAX_ATTEMPTS})`,
              'warn'
            );
            if (backoff > 0) {
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
          try {
            await axios.post(
              `/api/albums/${encodeURIComponent(albumMbid)}/reviews/generate-summary`
            );
            summaryOk = true;
            break;
          } catch (err: any) {
            lastSummaryErr =
              err?.response?.data?.error ?? err?.message ?? 'unknown';
          }
        }
        if (summaryOk) {
          updateAlbum(index, { summaryGenerated: true });
          appendLog(albumMbid, albumTitle, '요약 생성 완료', 'success');
        } else {
          appendLog(
            albumMbid,
            albumTitle,
            `요약 실패 (${SUMMARY_MAX_ATTEMPTS}회 시도): ${lastSummaryErr}`,
            'error'
          );
        }
      }

      updateAlbum(index, { status: 'done' });

      // Keep the album page and home grid in sync once this album is done.
      // Uses partial-key invalidation (React Query v5's default prefix
      // match) so both slug-keyed and mbid-keyed queries refetch —
      // useAlbumBase / useAlbumReviews / useAlbumSimilar all key on
      // Album.tsx's albumId (slug when available, mbid otherwise), so
      // a ['album', mbid] exact match would miss the slug-keyed copy
      // and leave the album page showing stale "pending" state even
      // though the curation finished.
      qc.invalidateQueries({ queryKey: ['album'] });
      qc.invalidateQueries({ queryKey: ['album-reviews'] });
      qc.invalidateQueries({ queryKey: ['album-similar'] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });

      // Persist a curation-history row. Fire-and-forget — a failed
      // insert shouldn't break the run, and the server computes
      // cost_usd itself from claude_usage_log within the window we
      // pass here. Captures albumEndedAt BEFORE the POST so the
      // window doesn't accidentally include next-album calls if the
      // loop moves on before this POST reaches the server.
      const albumEndedAt = new Date().toISOString();
      axios
        .post('/api/admin/curation-runs', {
          runId,
          albumMbid,
          albumTitle,
          triggerKind,
          urlsFound: candidates.length,
          urlsSaved: saved,
          duplicates: dup,
          failures: failed,
          summaryGenerated: summaryOk,
          status: 'done',
          startedAt,
          albumStartedAt,
          albumEndedAt,
        })
        .catch(() => {
          // Best-effort — already logged the work in the panel.
        });
    },
    [appendLog, qc, updateAlbum]
  );

  const startRun = useCallback(
    async (
      albums: Array<{ mbid: string; title: string }>,
      triggerKindArg?: 'oneclick' | 'batch'
    ) => {
      if (albums.length === 0) return;

      const newItems: CurationAlbumResult[] = albums.map((a) => ({
        albumMbid: a.mbid,
        albumTitle: a.title,
        urlsFound: 0,
        urlsSaved: 0,
        duplicates: 0,
        failures: 0,
        summaryGenerated: false,
        status: 'pending',
      }));

      // Append path: a run is already active, so extend its queue
      // instead of rejecting the click. The loop below re-reads
      // queueRef on every iteration so appended albums slot in
      // naturally behind whatever's currently processing.
      if (isRunningRef.current) {
        // De-dupe against already-queued or currently-processing albums
        // so repeated clicks on the same album page don't stack multiple
        // copies into the queue. Status-agnostic: even finished albums
        // count (admin can still clear + restart if they want a redo).
        const existingMbids = new Set(
          queueRef.current.map((a) => a.albumMbid)
        );
        const deduped = newItems.filter((a) => !existingMbids.has(a.albumMbid));
        if (deduped.length === 0) return;

        queueRef.current.push(...deduped);
        const appendedLogs: CurationLogLine[] = deduped.map((a) => ({
          id: `l-${nextLogId++}`,
          albumMbid: a.albumMbid,
          albumTitle: a.albumTitle,
          message: '대기열에 추가됨',
          kind: 'info',
          at: Date.now(),
        }));
        setRun((prev) =>
          prev
            ? {
                ...prev,
                albums: [...prev.albums, ...deduped],
                log: [...prev.log, ...appendedLogs],
              }
            : prev
        );
        return;
      }

      // Fresh-run path: initialise queue + state and enter the loop.
      isRunningRef.current = true;
      queueRef.current = [...newItems];

      const runId = `r-${Date.now()}`;
      const startedAtIso = new Date().toISOString();
      const triggerKind =
        triggerKindArg ?? (albums.length === 1 ? 'oneclick' : 'batch');

      setRun({
        runId,
        albums: [...newItems],
        currentIndex: 0,
        log: [],
        startedAt: Date.now(),
        finished: false,
      });

      try {
        // Index-based while loop (not for-of) so we re-check the
        // queue length after each album — late appends via the
        // isRunningRef branch above extend queueRef mid-run.
        let i = 0;
        while (i < queueRef.current.length) {
          const album = queueRef.current[i];
          setRun((prev) => (prev ? { ...prev, currentIndex: i } : prev));
          await processAlbum(album, i, runId, startedAtIso, triggerKind);
          i++;
        }
      } finally {
        isRunningRef.current = false;
        queueRef.current = [];
        // Only flip finished if no server-watch albums joined mid-run
        // and are still resolving. If they are, the allDone useEffect
        // below catches the final transition once they complete. The
        // common case (no server-watches active) sees allDone=true
        // here and we flip immediately.
        setRun((prev) => {
          if (!prev) return prev;
          const allDone = prev.albums.every(
            (a) => a.status === 'done' || a.status === 'failed'
          );
          return allDone ? { ...prev, finished: true } : prev;
        });
        // Admin-facing stats refresh so the 데이터 미완 panel reflects
        // the albums that just got summaries, and the new curation-run
        // rows show in the 큐레이션 이력 panel.
        qc.invalidateQueries({ queryKey: ['admin-stats'] });
        qc.invalidateQueries({ queryKey: ['curation-runs'] });
      }
    },
    [processAlbum, qc]
  );

  // Server-watch flow: distinct from startRun (which drives the pipeline
  // from the client via three HTTP calls). For user submissions the
  // server already runs the pipeline in its own queue, so the client's
  // job is purely to surface the progress. We poll each watched mbid's
  // /auto-curation-status, derive log lines from phase + counter
  // transitions, and update the same RunState shape startRun produces
  // so the existing panel renders both flows identically.
  //
  // Concurrency: server-watch entries don't go through queueRef.current
  // (the admin-side serial loop). Each watched album spawns its own
  // poller; the server-side queue paces the actual work. Multiple
  // parallel pollers are fine — they each hit a cheap in-memory
  // endpoint, and a non-admin user can only have one auto-curation
  // active at a time anyway (USER_DAILY_ALBUM_CAP + serial server queue).
  //
  // Stale-pollers cleanup: each poller checks the run state on each
  // tick and bails if the album was cleared (clearRun) or the context
  // unmounted. A 5-minute hard cap protects against a server that
  // never clears the entry (e.g., crash mid-run).
  const POLL_INTERVAL_MS = 2500;
  const POLL_MAX_ATTEMPTS = 120; // ~5 min
  const POLL_GRACE_BEFORE_GIVEUP = 8; // ~20s of "no progress" before assuming done

  const pollOneAlbum = useCallback(
    async (mbid: string, title: string) => {
      let prevPhase: string | null = null;
      let prevFound = 0;
      let prevSaved = 0;
      let neverSeenProgress = true;
      // Read the live run via the ref each tick — useCallback's
      // closure would otherwise hold a snapshot from when the poller
      // was spawned, so a later append-branch update wouldn't shift
      // our index lookup. The ref is kept in sync by the useEffect
      // below.
      const findAlbumIndex = (): number => {
        const r = runRef.current;
        if (!r) return -1;
        return r.albums.findIndex((a) => a.albumMbid === mbid);
      };

      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let progress: {
          phase: 'queued' | 'discovering' | 'scraping' | 'summarizing';
          urlsFound: number;
          urlsSaved: number;
        } | null = null;
        try {
          const { data } = await axios.get(
            `/api/albums/${encodeURIComponent(mbid)}/auto-curation-status`
          );
          progress = data?.progress ?? null;
        } catch {
          continue;
        }

        // Look up the index fresh each tick — append-branch additions
        // shift indices, and findIndex is cheap on a run with at most
        // a handful of albums.
        const idx = findAlbumIndex();
        if (idx === -1) {
          // Album was cleared from the run — caller dismissed; stop.
          return;
        }

        if (!progress) {
          if (neverSeenProgress) {
            // Server might not have set the entry yet (race between
            // submission and our first poll). Give it a short grace
            // window before assuming the run was never enqueued.
            if (attempt < POLL_GRACE_BEFORE_GIVEUP) continue;
            updateAlbum(idx, { status: 'done' });
            appendLog(
              mbid,
              title,
              '리뷰 수집이 시작되지 않았습니다',
              'warn'
            );
            return;
          }
          // Progress went from non-null → null: curation finished.
          updateAlbum(idx, { status: 'done' });
          appendLog(mbid, title, '완료', 'success');
          qc.invalidateQueries({ queryKey: ['album'] });
          qc.invalidateQueries({ queryKey: ['album-reviews'] });
          qc.invalidateQueries({ queryKey: ['album-similar'] });
          qc.invalidateQueries({ queryKey: ['album-list'] });
          qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
          return;
        }

        neverSeenProgress = false;

        // Phase transitions → log lines that match the rough cadence
        // admin's startRun emits. Translations are intentionally close
        // to the admin pipeline copy so users + admin see the same
        // vocabulary.
        if (progress.phase !== prevPhase) {
          if (prevPhase === null && progress.phase === 'queued') {
            appendLog(mbid, title, '리뷰 수집 대기 중', 'info');
          } else if (progress.phase === 'discovering') {
            appendLog(mbid, title, 'URL 자동 검색 시작', 'info');
            updateAlbum(idx, { status: 'running' });
          } else if (progress.phase === 'scraping') {
            appendLog(
              mbid,
              title,
              `URL ${progress.urlsFound}개 발견 — 큐레이션 시작`,
              'info'
            );
            updateAlbum(idx, { status: 'running' });
          } else if (progress.phase === 'summarizing') {
            appendLog(mbid, title, '한국어 요약 생성 중', 'info');
          }
          prevPhase = progress.phase;
        }

        if (progress.urlsFound !== prevFound) {
          updateAlbum(idx, { urlsFound: progress.urlsFound });
          prevFound = progress.urlsFound;
        }
        if (progress.urlsSaved !== prevSaved) {
          const delta = progress.urlsSaved - prevSaved;
          if (delta > 0) {
            appendLog(
              mbid,
              title,
              `리뷰 ${progress.urlsSaved}개 저장됨`,
              'success'
            );
          }
          updateAlbum(idx, { urlsSaved: progress.urlsSaved });
          prevSaved = progress.urlsSaved;
        }
      }
      // Hit the attempt cap without resolution — mark failed.
      const idx = findAlbumIndex();
      if (idx !== -1) {
        updateAlbum(idx, { status: 'failed' });
        appendLog(mbid, title, '타임아웃 (5분 초과)', 'error');
      }
    },
    [appendLog, qc, updateAlbum]
  );

  const watchServerRun = useCallback(
    (albums: Array<{ mbid: string; title: string }>) => {
      if (albums.length === 0) return;

      const newItems: CurationAlbumResult[] = albums.map((a) => ({
        albumMbid: a.mbid,
        albumTitle: a.title,
        urlsFound: 0,
        urlsSaved: 0,
        duplicates: 0,
        failures: 0,
        summaryGenerated: false,
        status: 'pending',
      }));

      setRun((prev) => {
        if (prev) {
          // Dedupe against albums already tracked in this run state.
          const existing = new Set(prev.albums.map((a) => a.albumMbid));
          const dedup = newItems.filter((a) => !existing.has(a.albumMbid));
          if (dedup.length === 0) return prev;
          const newLogs: CurationLogLine[] = dedup.map((a) => ({
            id: `l-${nextLogId++}`,
            albumMbid: a.albumMbid,
            albumTitle: a.albumTitle,
            message: '리뷰 수집 시작',
            kind: 'info',
            at: Date.now(),
          }));
          return {
            ...prev,
            albums: [...prev.albums, ...dedup],
            log: [...prev.log, ...newLogs],
            // Re-open a finished panel if a new server-watch lands
            // after a previous run completed — user just registered
            // another album.
            finished: false,
          };
        }
        const startLogs: CurationLogLine[] = newItems.map((a) => ({
          id: `l-${nextLogId++}`,
          albumMbid: a.albumMbid,
          albumTitle: a.albumTitle,
          message: '리뷰 수집 시작',
          kind: 'info',
          at: Date.now(),
        }));
        return {
          runId: `r-${Date.now()}`,
          albums: newItems,
          currentIndex: 0,
          log: startLogs,
          startedAt: Date.now(),
          finished: false,
        };
      });

      // Spawn pollers AFTER setRun so the first findAlbumIndex hit
      // sees the album in run.albums. State updates flush async so a
      // tiny tick yield isn't strictly necessary, but pollOneAlbum's
      // first iteration sleeps POLL_INTERVAL_MS first anyway, which
      // is more than enough.
      for (const item of newItems) {
        pollOneAlbum(item.albumMbid, item.albumTitle).catch((err) => {
          console.error('[curation-watch] poll error for', item.albumMbid, err);
        });
      }
    },
    [pollOneAlbum]
  );

  // Keep the ref mirror in sync so async pollers see the latest run.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // Mark the run finished when every watched album reaches a terminal
  // state. The admin-side startRun's own loop manages this via its
  // try/finally; server-watch albums each resolve independently, so
  // we observe their statuses and flip finished here.
  useEffect(() => {
    if (!run || run.finished) return;
    const allDone = run.albums.every(
      (a) => a.status === 'done' || a.status === 'failed'
    );
    if (allDone && !isRunningRef.current) {
      setRun((prev) => (prev ? { ...prev, finished: true } : prev));
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['curation-runs'] });
    }
  }, [run, qc]);

  const clearRun = useCallback(() => {
    if (isRunningRef.current) return;
    setRun(null);
  }, []);

  // Derived from the run state instead of the ref so consumers re-render
  // when a run starts or finishes (the ref wouldn't trigger a React
  // update on its own).
  const isRunning = run !== null && !run.finished;

  const value = useMemo<CurationProgressAPI>(
    () => ({ run, isRunning, startRun, watchServerRun, clearRun }),
    [run, isRunning, startRun, watchServerRun, clearRun]
  );

  return (
    <CurationProgressContext.Provider value={value}>
      {children}
    </CurationProgressContext.Provider>
  );
}

export function useCurationProgress(): CurationProgressAPI {
  const ctx = useContext(CurationProgressContext);
  if (!ctx) throw new Error('useCurationProgress must be used inside CurationProgressProvider');
  return ctx;
}
