import { useEffect, useRef, useState } from 'react';
import { useUserPublic } from '../hooks/useMe';
import { resolveApiUrl } from '../utils/apiUrl';

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
          // Wider (w-72) than the old w-64 because the layout is now
          // [big avatar | info column] side-by-side rather than a
          // stacked header + body. Still comfortably fits under a
          // comment card in the 3-card 50자 평 row.
          className="absolute z-30 top-full left-0 mt-2 w-72 bg-[#0f0a05] border border-[#e8a020]/25 rounded-xl shadow-xl p-3 text-xs text-gray-200 animate-[fadeInUp_150ms_ease-out] pointer-events-auto"
          onMouseEnter={scheduleShow}
          onMouseLeave={scheduleHide}
        >
          {!data ? (
            <div className="text-gray-500 py-2 text-center">불러오는 중…</div>
          ) : (
            <div className="flex items-start gap-3 min-w-0">
              {/* Big avatar on the left — makes the card feel like a
                  real profile snippet instead of a tiny header. 72px
                  matches the bubble's usual scale on album detail. */}
              {data.user.avatarUrl ? (
                <img
                  src={resolveApiUrl(data.user.avatarUrl) ?? undefined}
                  alt=""
                  className="w-[72px] h-[72px] rounded-full object-cover border border-white/10 shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-[72px] h-[72px] rounded-full bg-[#2a1f10] border border-white/10 shrink-0 flex items-center justify-center text-[#e8a020] font-semibold text-2xl">
                  {(data.user.name || '?').trim().charAt(0).toUpperCase()}
                </div>
              )}

              {/* Right column — name + join date + instagram + stats.
                  space-y on the column keeps the rhythm even when the
                  user has no instagram handle. */}
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {data.user.name || '이름 없음'}
                  </div>
                  {data.user.createdAt && (
                    <div className="text-[10px] text-gray-500">
                      가입 {formatJoined(data.user.createdAt)}
                    </div>
                  )}
                </div>

                {data.user.instagramHandle && (
                  <a
                    href={`https://instagram.com/${data.user.instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[#e8a020] hover:text-[#f0b040] truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                      aria-hidden
                    >
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                    </svg>
                    <span className="truncate">@{data.user.instagramHandle}</span>
                  </a>
                )}

                <div className="pt-1.5 border-t border-white/5 tabular-nums space-y-0.5">
                  <div>
                    50자 평{' '}
                    <span className="text-gray-100 font-semibold">
                      {data.stats.reviewCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>
                      👍{' '}
                      <span className="text-[#e8a020] font-semibold">
                        {data.stats.upvoteCount}
                      </span>
                      {data.stats.upvotePct != null && (
                        <span className="text-gray-500"> ({data.stats.upvotePct}%)</span>
                      )}
                    </span>
                    <span>
                      👎{' '}
                      <span className="text-gray-200 font-semibold">
                        {data.stats.downvoteCount}
                      </span>
                      {data.stats.downvotePct != null && (
                        <span className="text-gray-500"> ({data.stats.downvotePct}%)</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
