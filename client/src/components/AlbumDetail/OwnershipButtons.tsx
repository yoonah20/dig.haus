import { useAuth } from '../../contexts/AuthContext';
import { useSetOwnership } from '../../hooks/useOwnership';
import {
  OWNERSHIP_FORMATS,
  type OwnershipFormat,
  type OwnershipState,
} from '../../types';

interface Props {
  albumId: string;
  ownedFormats: OwnershipFormat[];
  wantedFormats: OwnershipFormat[];
  ownedCount: number;
  wantedCount: number;
}

const FORMAT_EMOJI: Record<OwnershipFormat, string> = {
  Vinyl: '🖤',
  CD: '💿',
  Cassette: '📼',
};

// Per-format 2×3 toggle grid. Each cell is independent: a collector
// can mark vinyl as 샀음 and CD as 살거 on the same album. Clicking
// an already-active cell clears it; clicking the opposite-row cell
// of the same format moves the state (server enforces). Logged-out
// visitors see the grid disabled — the social counts still show so
// the page reads as a collector hub regardless of auth state.
export default function OwnershipButtons({
  albumId,
  ownedFormats,
  wantedFormats,
  ownedCount,
  wantedCount,
}: Props) {
  const { user, login } = useAuth();
  const mutate = useSetOwnership(albumId);

  const ownedSet = new Set(ownedFormats);
  const wantedSet = new Set(wantedFormats);

  const handleClick = (row: 'owned' | 'wanted', format: OwnershipFormat) => {
    if (!user) {
      login();
      return;
    }
    if (mutate.isPending) return;
    const currentlyActive =
      row === 'owned' ? ownedSet.has(format) : wantedSet.has(format);
    // Clicking an active cell clears it; clicking an inactive one
    // sets that row's state (and server auto-clears the opposite
    // row for this format).
    const target: OwnershipState = currentlyActive ? null : row;
    mutate.mutate({ state: target, format });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <OwnershipRow
        row="owned"
        label="샀음"
        leadEmoji="💿"
        count={ownedCount}
        activeSet={ownedSet}
        onClick={handleClick}
        pending={mutate.isPending}
      />
      <OwnershipRow
        row="wanted"
        label="살거"
        leadEmoji="🎯"
        count={wantedCount}
        activeSet={wantedSet}
        onClick={handleClick}
        pending={mutate.isPending}
      />
    </div>
  );
}

function OwnershipRow({
  row,
  label,
  leadEmoji,
  count,
  activeSet,
  onClick,
  pending,
}: {
  row: 'owned' | 'wanted';
  label: string;
  leadEmoji: string;
  count: number;
  activeSet: Set<OwnershipFormat>;
  onClick: (row: 'owned' | 'wanted', format: OwnershipFormat) => void;
  pending: boolean;
}) {
  // 샀음 row uses amber (the brand colour), 살거 row uses sky so the
  // two rows read as distinct choices even at a glance.
  const activeClass =
    row === 'owned'
      ? 'bg-[#e8a020]/20 border-[#e8a020]/60 text-[#e8a020]'
      : 'bg-sky-500/15 border-sky-500/50 text-sky-300';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="inline-flex items-center gap-1 text-xs text-gray-400 min-w-[52px]"
        aria-hidden
      >
        <span>{leadEmoji}</span>
        <span>{label}</span>
        {count > 0 && (
          <span className="tabular-nums text-gray-500">{count}</span>
        )}
      </span>
      <div className="flex items-center gap-1">
        {OWNERSHIP_FORMATS.map((fmt) => {
          const active = activeSet.has(fmt);
          return (
            <button
              key={fmt}
              type="button"
              aria-pressed={active}
              aria-label={`${label} ${fmt}`}
              disabled={pending}
              onClick={() => onClick(row, fmt)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 h-7 text-xs font-medium border transition-colors cursor-pointer disabled:opacity-60 ${
                active
                  ? activeClass
                  : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20'
              }`}
            >
              <span aria-hidden>{FORMAT_EMOJI[fmt]}</span>
              <span>{fmt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
