import { useAuth } from '../../contexts/AuthContext';
import { useSetOwnership } from '../../hooks/useOwnership';
import type { OwnershipState } from '../../types';

interface Props {
  albumId: string;
  state: OwnershipState;
  ownedCount: number;
  wantedCount: number;
}

// 샀음 / 살거 two-button toggle, mutually exclusive. Clicking the
// active state clears it; clicking the inactive one flips + clears
// the other (server enforces the invariant regardless). Anonymous
// visitors see the buttons as disabled with a hover hint — no harm
// in exposing the social counts to them.
export default function OwnershipButtons({
  albumId,
  state,
  ownedCount,
  wantedCount,
}: Props) {
  const { user, login } = useAuth();
  const mutate = useSetOwnership(albumId);

  const handleClick = (next: OwnershipState) => {
    if (!user) {
      login();
      return;
    }
    if (mutate.isPending) return;
    // Toggle off if the user clicked the currently active state.
    const target = state === next ? null : next;
    mutate.mutate(target);
  };

  const ownedActive = state === 'owned';
  const wantedActive = state === 'wanted';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ToggleButton
        active={ownedActive}
        onClick={() => handleClick('owned')}
        emoji="💿"
        label="샀음"
        count={ownedCount}
        title={user ? '샀음' : '로그인 후 표시할 수 있어요'}
        accent="owned"
        busy={mutate.isPending && !ownedActive}
      />
      <ToggleButton
        active={wantedActive}
        onClick={() => handleClick('wanted')}
        emoji="🎯"
        label="살거"
        count={wantedCount}
        title={user ? '살거' : '로그인 후 표시할 수 있어요'}
        accent="wanted"
        busy={mutate.isPending && !wantedActive}
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  emoji,
  label,
  count,
  title,
  accent,
  busy,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  count: number;
  title: string;
  accent: 'owned' | 'wanted';
  busy: boolean;
}) {
  // Two distinct accent palettes so the pair reads as a symmetric
  // toggle (not two flavours of "amber") — 샀음 on the amber brand
  // colour, 살거 on a cooler sky/indigo so the two states are
  // instantly distinguishable even without the emoji.
  const activeClass =
    accent === 'owned'
      ? 'bg-[#e8a020]/20 border-[#e8a020]/60 text-[#e8a020]'
      : 'bg-sky-500/15 border-sky-500/50 text-sky-300';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-sm font-medium border transition-colors cursor-pointer disabled:opacity-60 ${
        active
          ? activeClass
          : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20'
      }`}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
      {count > 0 && (
        <span className="text-xs tabular-nums opacity-70 ml-0.5">{count}</span>
      )}
    </button>
  );
}
