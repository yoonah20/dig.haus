import { useAuth } from '../../contexts/AuthContext';
import { useSetOwnership } from '../../hooks/useOwnership';
import type { OwnershipFormat } from '../../types';

interface Props {
  albumId: string;
  ownedFormats: OwnershipFormat[];
  wantedFormats: OwnershipFormat[];
  ownedCount: number;
  wantedCount: number;
}

// Flat 샀음/살거 toggle — format selection intentionally absent.
// The data layer still records per-format rows, but every new click
// operates on the default format (Vinyl). When turning a state off
// for a user who has legacy multi-format rows, we fire a clear for
// each format so the visible state matches reality.
const DEFAULT_FORMAT: OwnershipFormat = 'Vinyl';

export default function OwnershipButtons({
  albumId,
  ownedFormats,
  wantedFormats,
  ownedCount,
  wantedCount,
}: Props) {
  const { user, login } = useAuth();
  const mutate = useSetOwnership(albumId);

  const ownedActive = ownedFormats.length > 0;
  const wantedActive = wantedFormats.length > 0;

  const handleClick = async (row: 'owned' | 'wanted') => {
    if (!user) {
      login();
      return;
    }
    if (mutate.isPending) return;

    const currentFormats = row === 'owned' ? ownedFormats : wantedFormats;
    const active = currentFormats.length > 0;

    if (active) {
      // Clear every format this user has for that row.
      for (const fmt of currentFormats) {
        await mutate.mutateAsync({ state: null, format: fmt });
      }
      return;
    }
    mutate.mutate({ state: row, format: DEFAULT_FORMAT });
  };

  return (
    <>
      <OwnershipButton
        row="owned"
        label="샀음"
        emoji="💿"
        count={ownedCount}
        active={ownedActive}
        onClick={handleClick}
        pending={mutate.isPending}
      />
      <OwnershipButton
        row="wanted"
        label="살거"
        emoji="🎯"
        count={wantedCount}
        active={wantedActive}
        onClick={handleClick}
        pending={mutate.isPending}
      />
    </>
  );
}

function OwnershipButton({
  row,
  label,
  emoji,
  count,
  active,
  onClick,
  pending,
}: {
  row: 'owned' | 'wanted';
  label: string;
  emoji: string;
  count: number;
  active: boolean;
  onClick: (row: 'owned' | 'wanted') => void;
  pending: boolean;
}) {
  // Match the VoteButtons pill styling so 굿굿/별루/샀음/살거 read as
  // one cohesive row. 샀음 uses the amber brand accent when active;
  // 살거 uses a neutral dark fill.
  let buttonStyle: React.CSSProperties;
  if (active && row === 'owned') {
    buttonStyle = {
      background: '#e8a020',
      color: '#0f0f0f',
      border: '1px solid transparent',
    };
  } else if (active && row === 'wanted') {
    buttonStyle = {
      background: '#3a3a3a',
      color: '#ffffff',
      border: '1px solid transparent',
    };
  } else if (row === 'owned') {
    buttonStyle = {
      background: 'transparent',
      color: '#e8a020',
      border: '1px solid #e8a020',
      opacity: 0.5,
    };
  } else {
    buttonStyle = {
      background: 'transparent',
      color: '#9a9a9a',
      border: '1px solid #4a4a4a',
      opacity: 0.5,
    };
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={pending}
      onClick={() => onClick(row)}
      style={{
        ...buttonStyle,
        padding: '6px 14px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: 600,
        transition: 'all 150ms ease',
      }}
      className="inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:!opacity-80"
    >
      <span style={{ fontSize: '13px', lineHeight: 1 }}>{emoji}</span>
      <span>{label}</span>
      <span className="tabular-nums">{count.toLocaleString()}</span>
    </button>
  );
}

