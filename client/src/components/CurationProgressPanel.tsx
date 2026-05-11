import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurationProgress } from '../contexts/CurationProgressContext';
import { useAuth } from '../contexts/AuthContext';

// Floating progress panel for the admin curation pipeline. Renders at
// the app root so it survives route changes — admin can start a batch
// from /admin, navigate to an album page to watch one review come in
// live, then go somewhere else, and the panel stays pinned bottom-right
// the whole time. Auto-hides when there's no active run or when the
// logged-in user isn't admin.
//
// Minimize collapses to a compact pill showing "N/total · 리뷰 M개"
// which is the rough answer to "is it still running?" without eating
// half the screen. Close button only works when the run is finished
// — we don't let admin dismiss the panel mid-run (would strand the
// state without a way to reopen it).
export default function CurationProgressPanel() {
  const { user } = useAuth();
  const { run, clearRun } = useCurationProgress();
  const [minimized, setMinimized] = useState(false);

  if (!user?.isAdmin) return null;
  if (!run) return null;

  const current = run.albums[run.currentIndex];
  const doneCount = run.albums.filter((a) => a.status === 'done' || a.status === 'failed').length;
  const totalReviews = run.albums.reduce((s, a) => s + a.urlsSaved, 0);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 bg-background/95 backdrop-blur-sm border border-accent/40 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] text-xs overflow-hidden"
      style={{
        width: minimized ? 260 : 420,
        // Cap at viewport minus the bottom-4 right-4 padding so the
        // panel never overflows the left edge on narrow phones
        // (420px default vs ~360px iPhone mini width).
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      {/* Header bar with status + minimize/close */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-panel-strong">
        <div className="flex items-center gap-2 min-w-0">
          {!run.finished && (
            <span className="w-3 h-3 border-2 border-gray-500 border-t-accent rounded-full animate-spin shrink-0" />
          )}
          <span className="text-accent font-medium truncate">
            {run.finished ? '큐레이션 완료' : '큐레이션 진행 중'}
          </span>
          <span className="text-gray-500 tabular-nums shrink-0">
            {doneCount}/{run.albums.length} · 리뷰 {totalReviews}개
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="text-gray-500 hover:text-white px-1.5 py-0.5 transition-colors cursor-pointer"
            title={minimized ? '확장' : '축소'}
          >
            {minimized ? '▲' : '▼'}
          </button>
          {run.finished && (
            <button
              onClick={clearRun}
              className="text-gray-500 hover:text-white px-1.5 py-0.5 transition-colors cursor-pointer"
              title="닫기"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!minimized && (
        <>
          {/* Current album bar (only while running) */}
          {!run.finished && current && (
            <div className="px-3 py-2 border-b border-white/5 bg-panel-strong">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">
                현재 처리 중
              </div>
              <div className="text-gray-200 font-medium truncate">
                {current.albumTitle}
              </div>
            </div>
          )}

          {/* Per-album result grid */}
          <div className="max-h-48 overflow-y-auto divide-y divide-white/5">
            {run.albums.map((a, i) => {
              const stateIcon =
                a.status === 'done'
                  ? '✓'
                  : a.status === 'failed'
                    ? '✗'
                    : a.status === 'running'
                      ? '…'
                      : '·';
              const stateColor =
                a.status === 'done'
                  ? 'text-green-400'
                  : a.status === 'failed'
                    ? 'text-red-400'
                    : a.status === 'running'
                      ? 'text-accent'
                      : 'text-gray-600';
              return (
                <Link
                  key={`${a.albumMbid}-${i}`}
                  to={`/album/${a.albumMbid}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors"
                >
                  <span className={`w-3 text-center shrink-0 ${stateColor}`}>
                    {stateIcon}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-gray-300">
                    {a.albumTitle}
                  </span>
                  <span className="text-gray-500 tabular-nums shrink-0">
                    {a.status === 'pending'
                      ? '대기'
                      : `${a.urlsSaved}/${a.urlsFound}${a.summaryGenerated ? ' ✎' : ''}`}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Rolling log — last 15 lines, newest at bottom so eye
              tracks the live tail. Trimmed because long runs spit
              out hundreds of lines and the panel shouldn't balloon. */}
          {run.log.length > 0 && (
            <div className="max-h-40 overflow-y-auto px-3 py-2 bg-panel-strong border-t border-white/5 font-mono text-[10px] leading-5">
              {run.log.slice(-15).map((l) => (
                <div
                  key={l.id}
                  className={
                    l.kind === 'error'
                      ? 'text-red-400'
                      : l.kind === 'warn'
                        ? 'text-yellow-500'
                        : l.kind === 'success'
                          ? 'text-green-400'
                          : 'text-gray-400'
                  }
                >
                  <span className="text-gray-600">
                    [{l.albumTitle.slice(0, 18)}]
                  </span>{' '}
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
