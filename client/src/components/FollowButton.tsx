import { useAuth } from '../contexts/AuthContext';
import { useFollowMutation } from '../hooks/useFollow';

// Small amber chip that toggles follow state. Renders nothing when:
// - no viewer is logged in (would be a login-nag, surfaced
//   elsewhere on click paths that actually need a session)
// - the viewer is the target user themselves (no self-follow)
//
// `following` is the current state. Parent passes the value from
// whatever source it has cached (usually UserPublic.followingByViewer
// or a follow-list row) so the button reflects the true state
// without kicking off its own query.
//
// Size variants exist so the button fits both the compact popover
// row and the mydig header. The compact form drops the text chip
// to an icon-only dot for the very tight hover popover.

type Size = 'sm' | 'md';

export default function FollowButton({
  targetUserId,
  following,
  size = 'md',
}: {
  targetUserId: number;
  following: boolean;
  size?: Size;
}) {
  const { user } = useAuth();
  const mutation = useFollowMutation();

  if (!user) return null;
  if (user.id === targetUserId) return null;

  const disabled = mutation.isPending;
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    mutation.mutate({ userId: targetUserId, follow: !following });
  };

  // Amber-fill-when-following, outline-when-not — standard social
  // affordance. Hover state flips to "언팔로우" so the user knows
  // the click direction without actually having to click.
  const base =
    size === 'sm'
      ? 'px-2 py-[1px] text-[10px] rounded-full'
      : 'px-3 py-1 text-[11px] rounded-full';
  const classes = following
    ? `${base} bg-[#e8a020]/15 text-[#e8a020] border border-[#e8a020]/40 hover:bg-[#e8a020]/5 hover:text-[#c98820] cursor-pointer transition-colors group/follow`
    : `${base} bg-transparent text-gray-200 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] cursor-pointer transition-colors`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`${classes} disabled:opacity-50 disabled:cursor-not-allowed`}
      title={following ? '언팔로우' : '팔로우'}
    >
      {following ? (
        <>
          <span className="group-hover/follow:hidden">팔로잉</span>
          <span className="hidden group-hover/follow:inline">언팔로우</span>
        </>
      ) : (
        <span>+ 팔로우</span>
      )}
    </button>
  );
}
