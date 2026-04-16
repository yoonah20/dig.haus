import { useEffect, useRef, useState } from 'react';
import { useUserPublic } from '../hooks/useMe';

function formatJoined(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

// Wraps an avatar/name element. On desktop hover (with a short delay) or
// mobile tap, shows a popover with the user's display name, Instagram
// handle, join date, and vote/review counts. Popover content is fetched
// lazily from /api/users/:id/public on first open and cached by React
// Query so repeat opens don't hit the network.
export default function UserHoverCard({
  userId,
  children,
}: {
  userId: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useUserPublic(userId, open);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Dismiss when clicking outside the trigger/popover on touch devices —
  // the popover otherwise lingers after the user has moved on.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  const scheduleShow = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (open) return;
    showTimerRef.current = setTimeout(() => setOpen(true), 200);
  };
  const scheduleHide = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    hideTimerRef.current = setTimeout(() => setOpen(false), 120);
  };

  const toggleOnTap = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setOpen((v) => !v);
  };

  return (
    <span
      ref={rootRef}
      className="relative inline-flex items-center"
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
      onFocus={scheduleShow}
      onBlur={scheduleHide}
    >
      <span
        className="inline-flex items-center"
        onClick={(e) => {
          // Touch devices: tapping the avatar opens the card instead of
          // firing whatever click the parent intended.
          if (window.matchMedia('(hover: none)').matches) {
            e.stopPropagation();
            e.preventDefault();
            toggleOnTap();
          }
        }}
      >
        {children}
      </span>

      {open && (
        <div
          role="tooltip"
          className="absolute z-30 top-full left-0 mt-2 w-64 bg-[#0f0a05] border border-[#e8a020]/25 rounded-xl shadow-xl p-3 text-xs text-gray-200 animate-[fadeInUp_150ms_ease-out] pointer-events-auto"
          onMouseEnter={scheduleShow}
          onMouseLeave={scheduleHide}
        >
          {!data ? (
            <div className="text-gray-500 py-2 text-center">불러오는 중…</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                {data.user.avatarUrl ? (
                  <img
                    src={data.user.avatarUrl}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover border border-white/10"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-[#2a1f10]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">
                    {data.user.name || '이름 없음'}
                  </div>
                  {data.user.createdAt && (
                    <div className="text-[10px] text-gray-500">
                      가입 {formatJoined(data.user.createdAt)}
                    </div>
                  )}
                </div>
              </div>

              {data.user.instagramHandle && (
                <a
                  href={`https://instagram.com/${data.user.instagramHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[#e8a020] hover:text-[#f0b040] truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  @{data.user.instagramHandle}
                </a>
              )}

              <div className="flex items-center gap-3 pt-2 border-t border-white/5 tabular-nums">
                <span>
                  50자 평 <span className="text-gray-100 font-semibold">{data.stats.reviewCount}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 tabular-nums">
                <span>
                  👍{' '}
                  <span className="text-[#e8a020] font-semibold">{data.stats.upvoteCount}</span>
                  {data.stats.upvotePct != null && (
                    <span className="text-gray-500"> ({data.stats.upvotePct}%)</span>
                  )}
                </span>
                <span>
                  👎{' '}
                  <span className="text-gray-200 font-semibold">{data.stats.downvoteCount}</span>
                  {data.stats.downvotePct != null && (
                    <span className="text-gray-500"> ({data.stats.downvotePct}%)</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
