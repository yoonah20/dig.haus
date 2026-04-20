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

// Cap on URLs the auto-curation pipeline actually scrapes per album.
// discover may return up to 25 candidates, but stuffing all of them into
// an album is overkill — Deftones / Whitechapel class albums get
// coverage on 25+ outlets and the UI reads as a wall of near-duplicate
// takes. The manual "🔎 URL 자동 검색" flow on the album page still
// returns the full discover list so admin can hand-pick beyond this cap
// when a specific album deserves more coverage. Haiku's ranking puts
// top editorial (usually with numeric scores) first, so slicing the top
// 15 naturally biases toward scored reviews without an explicit
// score-preference pass.
const AUTO_CURATION_URL_CAP = 15;

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

      // Step 1: discover URLs
      let urls: string[] = [];
      try {
        const { data } = await axios.post(
          `/api/albums/${encodeURIComponent(albumMbid)}/reviews/discover`
        );
        const allUrls = Array.isArray(data?.urls) ? (data.urls as string[]) : [];
        urls = allUrls.slice(0, AUTO_CURATION_URL_CAP);
        const trimmed = allUrls.length - urls.length;
        appendLog(
          albumMbid,
          albumTitle,
          allUrls.length === 0
            ? `URL 없음 — ${data?.message ?? '검색 결과 없음'}`
            : trimmed > 0
              ? `URL ${allUrls.length}개 발견 — 상위 ${urls.length}개만 큐레이션 (나머지 ${trimmed}개는 수동 경로에서 확인 가능)`
              : `URL ${urls.length}개 발견`,
          allUrls.length === 0 ? 'warn' : 'info'
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
      updateAlbum(index, { urlsFound: urls.length });

      // Step 2: batch add-url with concurrency=5
      let saved = 0;
      let dup = 0;
      let failed = 0;
      if (urls.length > 0) {
        for (let start = 0; start < urls.length; start += CHUNK_SIZE) {
          const chunk = urls.slice(start, start + CHUNK_SIZE);
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
        appendLog(
          albumMbid,
          albumTitle,
          `리뷰 ${saved}개 저장 (중복 ${dup}, 실패 ${failed})`,
          saved > 0 ? 'success' : 'warn'
        );
      }

      // Step 3: summary (only if there's something to summarize)
      let summaryOk = false;
      if (saved > 0 || dup > 0) {
        appendLog(albumMbid, albumTitle, '한국어 요약 생성 중', 'info');
        try {
          await axios.post(
            `/api/albums/${encodeURIComponent(albumMbid)}/reviews/generate-summary`
          );
          updateAlbum(index, { summaryGenerated: true });
          appendLog(albumMbid, albumTitle, '요약 생성 완료', 'success');
          summaryOk = true;
        } catch (err: any) {
          appendLog(
            albumMbid,
            albumTitle,
            `요약 실패: ${err?.response?.data?.error ?? err?.message ?? 'unknown'}`,
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
          urlsFound: urls.length,
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
      if (isRunningRef.current) return;
      if (albums.length === 0) return;
      isRunningRef.current = true;

      const runId = `r-${Date.now()}`;
      const startedAtIso = new Date().toISOString();
      const triggerKind =
        triggerKindArg ?? (albums.length === 1 ? 'oneclick' : 'batch');

      const initial: CurationRunState = {
        runId,
        albums: albums.map((a) => ({
          albumMbid: a.mbid,
          albumTitle: a.title,
          urlsFound: 0,
          urlsSaved: 0,
          duplicates: 0,
          failures: 0,
          summaryGenerated: false,
          status: 'pending',
        })),
        currentIndex: 0,
        log: [],
        startedAt: Date.now(),
        finished: false,
      };
      setRun(initial);

      try {
        for (let i = 0; i < initial.albums.length; i++) {
          setRun((prev) => (prev ? { ...prev, currentIndex: i } : prev));
          await processAlbum(initial.albums[i], i, runId, startedAtIso, triggerKind);
        }
      } finally {
        setRun((prev) => (prev ? { ...prev, finished: true } : prev));
        isRunningRef.current = false;
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
