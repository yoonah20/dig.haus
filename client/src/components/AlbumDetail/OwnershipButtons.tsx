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

// Split-pill: 샀음 on the left (muted gold), 살거 on the right (muted
// purple). Shares the same shape + gradient system as VoteButtons so
// the four buttons on the album header read as one family. Format
// picker is intentionally absent — clicks operate on Vinyl and clear
// any legacy format rows when turning off.
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
    const palette = row === 'owned'
      ? {
          activeFrom: '#8a6a2a',
          activeTo: '#6c5222',
          activeText: '#fff3de',
          idleFrom: '#1f1810',
          idleTo: '#15100a',
          idleText: '#a88856',
        }
      : {
          activeFrom: '#6e5697',
          activeTo: '#543f78',
          activeText: '#f2ecfb',
          idleFrom: '#1b1628',
          idleTo: '#120e1c',
          idleText: '#8f7cb3',
        };

    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        disabled={mutate.isPending}
        onClick={() => handleClick(row)}
        style={{
          background: active
            ? `linear-gradient(to bottom, ${palette.activeFrom}, ${palette.activeTo})`
            : `linear-gradient(to bottom, ${palette.idleFrom}, ${palette.idleTo})`,
          color: active ? palette.activeText : palette.idleText,
          padding: '4px 10px',
          fontSize: '13px',
          fontWeight: 600,
          transition: 'background 160ms ease, color 160ms ease',
        }}
        className="flex-1 inline-flex items-center justify-center gap-1 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:brightness-110"
      >
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{emoji}</span>
        <span>{label}</span>
        <span className="tabular-nums">{count.toLocaleString()}</span>
      </button>
    );
  };

  return (
    <div className="inline-flex items-stretch rounded-full overflow-hidden border border-white/10">
      {half('owned')}
      <div className="w-px self-stretch bg-black/40" aria-hidden />
      {half('wanted')}
    </div>
  );
}
