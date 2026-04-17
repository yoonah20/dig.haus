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

// Flat 샀음/살거 split-pill. Matches VoteButtons' shape: one rounded
// object with two halves. Amber = 샀음 (owned, brand accent), emerald
// = 살거 (wanted). Format selection is intentionally absent; every
// click operates against Vinyl, and clearing an active side removes
// every legacy format the user has for that row.
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
      for (const fmt of currentFormats) {
        await mutate.mutateAsync({ state: null, format: fmt });
      }
      return;
    }
    mutate.mutate({ state: row, format: DEFAULT_FORMAT });
  };

  const half = (row: 'owned' | 'wanted') => {
    const active = row === 'owned' ? ownedActive : wantedActive;
    const label = row === 'owned' ? '샀음' : '살거';
    const emoji = row === 'owned' ? '💿' : '🎯';
    const count = row === 'owned' ? ownedCount : wantedCount;
    const activeBg = row === 'owned' ? '#e8a020' : '#10b981';
    const activeFg = row === 'owned' ? '#0f0f0f' : '#052e2b';
    const idleFg = row === 'owned' ? '#e8a020' : '#34d399';

    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        disabled={mutate.isPending}
        onClick={() => handleClick(row)}
        style={{
          background: active ? activeBg : 'transparent',
          color: active ? activeFg : idleFg,
          opacity: active ? 1 : 0.7,
          padding: '6px 14px',
          fontSize: '13px',
          fontWeight: 600,
          transition: 'all 150ms ease',
        }}
        className="flex-1 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:!opacity-100"
      >
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{emoji}</span>
        <span>{label}</span>
        <span className="tabular-nums">{count.toLocaleString()}</span>
      </button>
    );
  };

  return (
    <div
      className="inline-flex items-stretch rounded-full overflow-hidden border"
      style={{
        borderColor: 'rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      {half('owned')}
      <div className="w-px self-stretch bg-white/10" aria-hidden />
      {half('wanted')}
    </div>
  );
}
