import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFollowing } from '../hooks/useFollow';
import FollowButton from './FollowButton';
import { resolveApiUrl } from '../utils/apiUrl';

// Lightweight dropdown that anchors below an arbitrary trigger
// element. Use case: the "내 팔로잉 N" chip on the mydig header
// opens this panel instead of a centred modal — the list is small
// enough that a dropdown reads as the right scale.
//
// Positioning: caller passes an `anchorRect` (the trigger's
// getBoundingClientRect at open time); we use fixed positioning to
// sit just under the right edge of that rect. Window scroll +
// resize update via a small effect so the dropdown follows along.

interface Props {
  userId: number;
  anchorRect: DOMRect | null;
  onClose: () => void;
}

const DROPDOWN_WIDTH = 280;

export default function FollowingDropdown({ userId, anchorRect, onClose }: Props) {
  const query = useFollowing(userId);
  // Track viewport size so we can re-clamp the dropdown's left edge
  // when the window resizes mid-open.
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, []);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Outside-click closes. Pointerdown beats click for touch (matches
  // the rest of the app's dropdown pattern).
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-following-dropdown]')) return;
      // Don't close on the trigger itself — caller handles toggle.
      if (target.closest('[data-following-trigger]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onClose]);

  if (!anchorRect) return null;

  // Right-align the dropdown to the trigger but clamp the left edge
  // so the panel never spills off the viewport on narrow screens.
  const viewportW =
    typeof window !== 'undefined' ? window.innerWidth : 1280;
  const rightEdge = anchorRect.right;
  const desiredLeft = rightEdge - DROPDOWN_WIDTH;
  const clampedLeft = Math.max(8, Math.min(viewportW - DROPDOWN_WIDTH - 8, desiredLeft));

  return (
    <div
      data-following-dropdown
      role="dialog"
      aria-label="내 팔로잉"
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 6,
        left: clampedLeft,
        width: DROPDOWN_WIDTH,
        maxHeight: 360,
        background: '#1a1614',
        border: '1px solid rgba(220, 170, 80, 0.25)',
        borderRadius: 8,
        boxShadow: '0 14px 36px rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#d9c89a',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(220, 170, 80, 0.12)',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        내 팔로잉
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {query.isLoading && (
          <div className="py-4 text-center text-xs text-gray-500">
            불러오는 중…
          </div>
        )}
        {query.isError && (
          <div className="py-4 text-center text-xs text-red-400">
            불러오지 못했어요.
          </div>
        )}
        {query.data && query.data.users.length === 0 && (
          <div className="py-4 text-center text-xs text-gray-500">
            아직 팔로우한 디거가 없어요.
          </div>
        )}
        <div className="flex flex-col divide-y divide-white/5">
          {query.data?.users.map((u) => {
            const avatar = resolveApiUrl(u.avatarUrl);
            const href = u.username ? `/my/${u.username}` : null;
            const initial = (u.displayName || u.username || '?')
              .trim()
              .charAt(0)
              .toUpperCase();
            const inner = (
              <>
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-avatar-bg border border-white/10 shrink-0 flex items-center justify-center text-accent text-xs font-semibold">
                    {initial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-white truncate">
                    {u.displayName || u.username}
                  </div>
                  {u.username && (
                    <div className="text-[11px] text-gray-500 truncate">
                      @{u.username}
                    </div>
                  )}
                </div>
              </>
            );
            return (
              <div
                key={u.id}
                className="flex items-center gap-2.5 px-3 py-2"
              >
                {href ? (
                  <Link
                    to={href}
                    onClick={onClose}
                    className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    {inner}
                  </div>
                )}
                <FollowButton
                  targetUserId={u.id}
                  following={u.followingByViewer}
                  size="sm"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
