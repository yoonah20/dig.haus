import {
  createContext,
  useCallback,
  useContext,
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

const CHUNK_SIZE = 5;

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

// Soft priority list — outlets that reliably publish numeric scores,
// clean editorial voice, and whose pages the scraper handles well.
// When discover returns a mixed list, these get re-ordered to the
// front of the candidate queue so they land in the first-15 success
// slots whenever they're part of the result. No forced inclusion —
// if Haiku didn't pick them (album genuinely outside their scope),
// we don't add them. Within the priority bucket the original Haiku
// ranking is preserved; same for the non-priority bucket.
const PRIORITY_REVIEW_DOMAINS = [
  'sputnikmusic.com',
  'pitchfork.com',
  'kerrang.com',
  'loudersound.com',
  'metalhammer.com',
  'angrymetalguy.com',
  'nocleansinging.com',
  'metalsucks.net',
  'blabbermouth.net',
  'everythingisnoise.net',
  'metalinjection.net',
  'stereogum.com',
  'consequence.net',
  'exclaim.ca',
  'rollingstone.com',
  'thequietus.com',
  'metalreviews.com',
  'distortedsoundmag.com',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isPriorityDomain(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return PRIORITY_REVIEW_DOMAINS.some(
    (d) => host === d || host.endsWith('.' + d)
  );
}

// Stable-partition: priority URLs first (in their original relative
// order), then everyone else (in their original relative order).
function orderByPriority(urls: string[]): string[] {
  const priority: string[] = [];
  const rest: string[] = [];
  for (const u of urls) {
    if (isPriorityDomain(u)) priority.push(u);
    else rest.push(u);
  }
  return [...priority, ...rest];
}

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

  // Snapshot the admin's Claude-usage tally before and after each album
  // so we can compute an approximate per-album cost for the curation log.
  // GET /api/admin/stats is already polled by the Admin page via React
  // Query so this should hit cache most of the time; worst case it's
  // one extra light request per album.
  const fetchTotalUsd = useCallback(async (): Promise<number> => {
    try {
      const { data } = await axios.get('/api/admin/stats');
      return typeof data?.claudeUsage?.month?.usd === 'number'
        ? data.claudeUsage.month.usd
        : 0;
    } catch {
      return 0;
    }
  }, []);

  const processAlbum = useCallback(
    async (
      album: CurationAlbumResult,
      index: number,
      runId: string,
      startedAt: string,
      triggerKind: 'oneclick' | 'batch'
    ) => {
      const { albumMbid, albumTitle } = album;
      const costBefore = await fetchTotalUsd();

      updateAlbum(index, { status: 'running' });
      appendLog(albumMbid, albumTitle, 'URL 자동 검색 시작', 'info');

      // Step 1: discover URLs — keep the full list as the candidate
      // pool, so Step 2 can backfill from beyond the initial target
      // when some attempts fail. Priority-domain URLs are re-ordered
      // to the front of the queue so they land in the first success
      // slots whenever Haiku picked them.
      let candidates: string[] = [];
      let priorityCount = 0;
      try {
        const { data } = await axios.post(
          `/api/albums/${encodeURIComponent(albumMbid)}/reviews/discover`
        );
        const allUrls = Array.isArray(data?.urls) ? (data.urls as string[]) : [];
        const ordered = orderByPriority(allUrls);
        candidates = ordered.slice(0, AUTO_CURATION_MAX_ATTEMPTS);
        priorityCount = candidates.filter(isPriorityDomain).length;
        appendLog(
          albumMbid,
          albumTitle,
          candidates.length === 0
            ? `URL 없음 — ${data?.message ?? '검색 결과 없음'}`
            : priorityCount > 0
              ? `URL ${candidates.length}개 발견 (우선 도메인 ${priorityCount}개) — 성공 ${AUTO_CURATION_TARGET_SAVED}개 목표로 큐레이션`
              : `URL ${candidates.length}개 발견 — 성공 ${AUTO_CURATION_TARGET_SAVED}개 목표로 큐레이션`,
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
        await Promise.all(
          chunk.map(async (url) => {
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
      qc.invalidateQueries({ queryKey: ['album', albumMbid] });
      qc.invalidateQueries({ queryKey: ['album-reviews', albumMbid] });
      qc.invalidateQueries({ queryKey: ['album-list'] });
      qc.invalidateQueries({ queryKey: ['album-list-infinite'] });

      // Persist a curation-history row. Cost is the Claude-usage
      // delta over the album's processing window. Fire-and-forget
      // since a failed insert shouldn't break the run — the ledger
      // is observability, not critical state.
      const costAfter = await fetchTotalUsd();
      const costDelta = Math.max(0, costAfter - costBefore);
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
          costUsd: costDelta,
          status: 'done',
          startedAt,
        })
        .catch(() => {
          // Best-effort — already logged the work in the panel.
        });
    },
    [appendLog, qc, updateAlbum, fetchTotalUsd]
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
        setRun((prev) => (prev ? { ...prev, finished: true } : prev));
        isRunningRef.current = false;
        queueRef.current = [];
        // Admin-facing stats refresh so the 데이터 미완 panel reflects
        // the albums that just got summaries, and the new curation-run
        // rows show in the 큐레이션 이력 panel.
        qc.invalidateQueries({ queryKey: ['admin-stats'] });
        qc.invalidateQueries({ queryKey: ['curation-runs'] });
      }
    },
    [processAlbum, qc]
  );

  const clearRun = useCallback(() => {
    if (isRunningRef.current) return;
    setRun(null);
  }, []);

  // Derived from the run state instead of the ref so consumers re-render
  // when a run starts or finishes (the ref wouldn't trigger a React
  // update on its own).
  const isRunning = run !== null && !run.finished;

  const value = useMemo<CurationProgressAPI>(
    () => ({ run, isRunning, startRun, clearRun }),
    [run, isRunning, startRun, clearRun]
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
