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

// Split-pill: 샀음 on the left (warm gold), 살거 on the right (muted
// gold). Both halves now sit in the amber family that the rest of
// the album page already speaks — the previous brown / purple split
// read as a legacy widget against the amber accent the page
// otherwise carries. Distinction between owned / wanted is preserved
// through saturation (owned brighter, wanted softer) plus the emoji
// + label, not hue. VoteButtons (blue / red) intentionally stays in
// its own semantic palette since up/down voting reads as pos/neg
// rather than collection state. Format picker is absent — clicks
// operate on Vinyl and clear any legacy format rows when turning
// off.
const DEFAULT_FORMAT: OwnershipFormat = 'Vinyl';

const PALETTE_OWNED = {
  activeFrom: '#a17a2a',
  activeTo: '#7a5a1c',
  activeText: '#fff3de',
  idleFrom: '#1f1810',
  idleTo: '#15100a',
  idleText: '#a88856',
} as const;

const PALETTE_WANTED = {
  // Same amber family, softer saturation so 살거 reads as the
  // aspirational state next to 샀음's confirmed state without
  // jumping to a different hue.
  activeFrom: '#6a5a3a',
  activeTo: '#4e4128',
  activeText: '#f0e6d0',
  idleFrom: '#1c1812',
  idleTo: '#13100a',
  idleText: '#8c7d5a',
} as const;

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
    const palette = row === 'owned' ? PALETTE_OWNED : PALETTE_WANTED;

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
