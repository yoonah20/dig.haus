import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { Popover } from './ui';
import { useUserPublic, type UserPublic } from '../hooks/useMe';
import FollowButton from './FollowButton';
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
  className = '',
}: {
  userId: number;
  children: React.ReactNode;
  /** Extra classes merged onto the root inline-flex wrapper — callers that
   *  need the trigger to participate in a parent flex layout (e.g. avatar
   *  + name + comment-count grouped into one hover target) can pass
   *  `flex-1 min-w-0 gap-2.5` here without touching the component's
   *  default inline-flex styling. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useUserPublic(userId, open);

  // Popover is rendered through a portal into document.body so
  // overflow-hidden / clip-path contexts along the DOM path (e.g.
  // the home CommentTicker's marquee) don't clip it. Position is
  // computed from the trigger's viewport rect with a flip to above
  // when there isn't room below. Measured against the popover's
  // actual rendered height after mount so a tall payload doesn't
  // fall off the edge either.
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: 'below' | 'above';
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const measure = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const GAP = 8;
      // Popover always anchors below the trigger — earlier the
      // measure flipped above when there wasn't room, but on the
      // home activity grid the strip sits at the bottom of every
      // card, so a flip would land the popover ON TOP of the card
      // it's supposed to describe. Better to clip at the viewport
      // bottom (the inner content remains scrollable) than to
      // cover the row.
      const top = trigger.bottom + GAP;
      // Clamp left so a popover near the right edge doesn't
      // overflow; 288px matches w-72 below.
      const rightEdge = window.innerWidth - 288 - 8;
      const left = Math.max(8, Math.min(trigger.left, rightEdge));
      setPos({ top, left, placement: 'below' });
    };
    measure();
    // Re-measure on scroll/resize while open so the popover tracks
    // the trigger if the user scrolls the underlying page with the
    // card visible (e.g. because they're hovering).
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    // Measure again after a beat so we get the real popover height
    // once content has loaded.
    const t = setTimeout(measure, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, data]);

  // Avatar/trigger click — navigate to the user's mydig page. Uses
  // whatever's already cached from the hover-triggered useUserPublic
  // first; if the user clicked without hovering (and the query hasn't
  // run yet), kick off a one-shot fetchQuery and navigate on resolve.
  // preventDefault + stopPropagation is always applied so this click
  // beats any ancestor <Link> (e.g. the TickerItem wraps the avatar
  // in a card-wide Link to the album — we want the avatar-specific
  // gesture to win).
  const handleTriggerClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cached =
      data ?? qc.getQueryData<UserPublic>(['user-public', userId]);
    if (cached?.mydig?.username) {
      navigate(`/my/${cached.mydig.username}`);
      return;
    }
    // Not cached / mydig not yet known — fetch, then navigate if the
    // resolved payload actually carries a mydig username. If the
    // user hasn't claimed one we silently do nothing (fall-through
    // hover popover still shows vote counts + instagram so the
    // click isn't totally wasted — they can read the card instead).
    try {
      const fresh = await qc.fetchQuery<UserPublic>({
        queryKey: ['user-public', userId],
        queryFn: async () => {
          const { data: res } = await axios.get(
            `/api/users/${userId}/public`
          );
          return res;
        },
        staleTime: 1000 * 60 * 5,
      });
      if (fresh?.mydig?.username) {
        navigate(`/my/${fresh.mydig.username}`);
      }
    } catch (err) {
      console.error('[avatar-click] failed', err);
    }
  };

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Dismiss when clicking outside the trigger/popover on touch devices —
  // the popover otherwise lingers after the user has moved on. Must
  // check BOTH rootRef (the trigger span) AND popoverRef (the
  // portal'd card) because the card lives on document.body, so a
  // click on e.g. the mydig Link inside it would otherwise match
  // "outside" and setOpen(false) on pointerdown — that unmounts
  // the Link before its click handler fires, killing navigation.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const insideTrigger = rootRef.current?.contains(target) ?? false;
      const insidePopover = popoverRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insidePopover) {
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

  const popover =
    open && pos
      ? createPortal(
          <Popover
            ref={popoverRef}
            role="tooltip"
            tone="accent-faint"
            radius="xl"
            pad="md"
            shadow="xl"
            animate
            // Wider (w-72) than the old w-64 because the layout is
            // [big avatar | info column] side-by-side. Fixed-positioned
            // via the measured rect so this lives outside any ancestor
            // overflow-hidden (e.g. the marquee) and never clips.
            className="fixed z-[60] w-72 text-xs text-gray-200 pointer-events-auto"
            style={{ top: pos.top, left: pos.left }}
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
                <div className="w-[72px] h-[72px] rounded-full bg-avatar-bg border border-white/10 shrink-0 flex items-center justify-center text-accent font-semibold text-2xl">
                  {(data.user.name || '?').trim().charAt(0).toUpperCase()}
                </div>
              )}

              {/* Right column — name + join date + instagram + stats.
                  space-y on the column keeps the rhythm even when the
                  user has no instagram handle. */}
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="min-w-0 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Slightly larger than the comment-card speaker
                        (text-sm = 14px) so the popover reads as the
                        authoritative profile label rather than a
                        duplicate of the trigger. */}
                    <div className="text-[15px] font-medium text-white truncate">
                      {data.user.name || '이름 없음'}
                    </div>
                    {data.user.createdAt && (
                      <div className="text-[10px] text-gray-500">
                        가입 {formatJoined(data.user.createdAt)}
                      </div>
                    )}
                  </div>
                  <FollowButton
                    targetUserId={data.user.id}
                    following={!!data.followingByViewer}
                    size="sm"
                  />
                </div>

                {/* mydig row — direct link to the user's /my/:username
                    page. Sits above instagram because it's the native
                    in-app destination; @instagram is the external
                    fallback. The "theme title" branch went away with
                    the 2026-05 mydig redesign (the vinyl wall + its
                    theme title concept is gone) — the row now just
                    says "마이딕 보기" so visitors have a clean entry
                    point regardless of what's on the page. Skipped
                    entirely when the user hasn't claimed a username. */}
                {data.mydig && (
                  <Link
                    to={`/my/${data.mydig.username}`}
                    className="flex items-center gap-1.5 truncate text-accent hover:text-accent-hover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Same Heroicons building-storefront as the nav
                        mydig button, shrunk to 14px to sit alongside
                        the instagram glyph at matching optical weight. */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                      aria-hidden
                    >
                      <path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                    </svg>
                    <span className="truncate">마이딕 보기</span>
                  </Link>
                )}

                {data.user.instagramHandle && (
                  <a
                    href={`https://instagram.com/${data.user.instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-accent hover:text-accent-hover truncate"
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

                {/* Collection + comment counts. 굿굿/별루 counts were
                    pulled out because they already appear on every
                    comment card the user lands on before the popover
                    ever opens — duplicating them here pushed the row
                    onto two lines. 💿 / 🎯 stay conditional (hidden
                    when zero — nobody reads "0장 샀음" as a stat),
                    💬 always shows since reviews are how most users
                    actually participate even with no collection. */}
                <div className="pt-1.5 border-t border-white/5 tabular-nums">
                  <div className="flex items-center gap-3">
                    {/* Followers lead — the social metric is the
                        most-immediately-actionable read for a
                        hover-card, so it sits first. Always
                        renders (even 0) so the row anchors on the
                        same metric regardless of activity level. */}
                    <span>
                      <span aria-hidden>👥</span>{' '}
                      <span className="text-gray-100 font-semibold">
                        {data.stats.followerCount ?? 0}
                      </span>
                    </span>
                    {(data.stats.crateAlbumCount ?? 0) > 0 && (
                      <span>
                        <span aria-hidden>📦</span>{' '}
                        <span className="text-gray-100 font-semibold">
                          {data.stats.crateAlbumCount}
                        </span>
                      </span>
                    )}
                    <span>
                      <span aria-hidden>💬</span>{' '}
                      <span className="text-gray-100 font-semibold">
                        {data.stats.reviewCount}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </Popover>,
          document.body
        )
      : null;

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
      onFocus={scheduleShow}
      onBlur={scheduleHide}
    >
      <span
        // Same className as the outer wrapper so caller-supplied utility
        // classes (gap-X, flex-1, min-w-0) actually reach the element
        // that directly wraps the trigger children — the outer only has
        // one flex child, so gap-* there would be a no-op otherwise.
        className={`inline-flex items-center cursor-pointer ${className}`}
        onClick={(e) => {
          // Touch devices: the hover popover doesn't exist on no-hover
          // inputs, so a tap should open the card instead of
          // short-circuiting straight to navigation. Desktop (hover
          // media) skips the popover and navigates directly to the
          // user's mydig page — the card is already discoverable via
          // hover, so an additional click gesture that just opens it
          // would feel redundant.
          if (window.matchMedia('(hover: none)').matches) {
            e.stopPropagation();
            e.preventDefault();
            toggleOnTap();
            return;
          }
          handleTriggerClick(e);
        }}
      >
        {children}
      </span>
      {popover}
    </span>
  );
}
