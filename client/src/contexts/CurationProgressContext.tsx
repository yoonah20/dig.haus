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
  startRun: (
    albums: Array<{ mbid: string; title: string }>
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

  const processAlbum = useCallback(
    async (album: CurationAlbumResult, index: number) => {
      const { albumMbid, albumTitle } = album;

      updateAlbum(index, { status: 'running' });
      appendLog(albumMbid, albumTitle, 'URL 자동 검색 시작', 'info');

      // Step 1: discover URLs
      let urls: string[] = [];
      try {
        const { data } = await axios.post(
          `/api/albums/${encodeURIComponent(albumMbid)}/reviews/discover`
        );
        urls = Array.isArray(data?.urls) ? data.urls : [];
        appendLog(
          albumMbid,
          albumTitle,
          urls.length === 0
            ? `URL 없음 — ${data?.message ?? '검색 결과 없음'}`
            : `URL ${urls.length}개 발견`,
          urls.length === 0 ? 'warn' : 'info'
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
      if (saved > 0 || dup > 0) {
        appendLog(albumMbid, albumTitle, '한국어 요약 생성 중', 'info');
        try {
          await axios.post(
            `/api/albums/${encodeURIComponent(albumMbid)}/reviews/generate-summary`
          );
          updateAlbum(index, { summaryGenerated: true });
          appendLog(albumMbid, albumTitle, '요약 생성 완료', 'success');
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
    },
    [appendLog, qc, updateAlbum]
  );

  const startRun = useCallback(
    async (albums: Array<{ mbid: string; title: string }>) => {
      if (isRunningRef.current) return;
      if (albums.length === 0) return;
      isRunningRef.current = true;

      const initial: CurationRunState = {
        runId: `r-${Date.now()}`,
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
          await processAlbum(initial.albums[i], i);
        }
      } finally {
        setRun((prev) => (prev ? { ...prev, finished: true } : prev));
        isRunningRef.current = false;
        // Admin-facing stats refresh so the 데이터 미완 panel reflects
        // the albums that just got summaries.
        qc.invalidateQueries({ queryKey: ['admin-stats'] });
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
