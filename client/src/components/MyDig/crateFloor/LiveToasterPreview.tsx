import { useMemo } from 'react';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// Live preview of what the toaster PNG will render — 3×5 cover grid
// with crate title at the top + dig.haus footer stamp, mirroring the
// server-side PNG layout closely enough that "what I see here is what
// I'll download." Sort is intentionally identical to the server's
// crateToToasterSlots (visual reading order: top → bottom, left →
// right; unplaced records last by created_at DESC). When the owner
// drags a record on the floor, both the floor render and this
// preview re-sort together.
//
// Pure visual surface. The actual download action sits beside the
// preview (DownloadToasterButton) so this stays uncluttered.

interface Props {
  crateTitle: string;
  items: CrateItem[];
}

// Sort that matches server/src/routes/mydig.ts → crateToToasterSlots.
// Kept identical so preview and download show the same record order.
function sortForToaster(items: CrateItem[]): CrateItem[] {
  return [...items].sort((a, b) => {
    const aPlaced = a.positionY != null;
    const bPlaced = b.positionY != null;
    if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
    if (aPlaced && bPlaced) {
      if (a.positionY! !== b.positionY!) return a.positionY! - b.positionY!;
      if (a.positionX! !== b.positionX!) return a.positionX! - b.positionX!;
    }
    // Both unplaced or tied — newer (later added) wins.
    return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
  });
}

const TOASTER_SLOTS = 15; // 3 columns × 5 rows

export default function LiveToasterPreview({ crateTitle, items }: Props) {
  const sorted = useMemo(() => sortForToaster(items).slice(0, TOASTER_SLOTS), [items]);
  // Pad to exactly 15 so the grid renders even when the crate is
  // sparsely populated. Empty cells render as flat dark squares — same
  // empty-is-OK rule the server PNG already follows.
  const slots: (CrateItem | null)[] = Array.from(
    { length: TOASTER_SLOTS },
    (_, i) => sorted[i] ?? null
  );

  return (
    <div
      style={{
        // Mimics the rendered PNG's 4:5 portrait aspect (the actual
        // PNG is 1080×1350, ratio 0.8). The preview floats free in
        // its column — width is the parent's, height derived.
        aspectRatio: '4 / 5',
        background: 'linear-gradient(180deg, #1c1612 0%, #0e0a08 100%)',
        border: '1px solid rgba(220, 170, 80, 0.18)',
        borderRadius: 6,
        padding: '14px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.45)',
      }}
    >
      {/* Crate title — small, monospace, top-left aligned. Matches
          the server PNG's themeTitle treatment closely enough that
          glancing between the two reads as "same thing." */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: 0.6,
          color: '#d9c89a',
          fontFamily:
            "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
          textTransform: 'uppercase',
          opacity: 0.9,
        }}
      >
        {crateTitle}
      </div>
      {/* 3×5 cover grid. flex:1 so the grid expands to fill whatever
          height the aspect ratio gives us, then internal grid sizing
          divides equally. */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridAutoRows: '1fr',
          gap: 4,
          minHeight: 0,
        }}
      >
        {slots.map((s, i) => (
          <div
            key={s ? s.id : `empty-${i}`}
            style={{
              background: '#0a0703',
              overflow: 'hidden',
              borderRadius: 1,
              position: 'relative',
            }}
          >
            {s && (
              <CoverArt
                src={s.coverArtUrl}
                fallbacks={s.coverArtFallbacks}
                alt={`${s.title} – ${s.artist}`}
                className="w-full h-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {/* Brand stamp — same wordmark register as the live nav, in
          muted gold so it doesn't fight the covers. */}
      <div
        style={{
          fontSize: 10,
          letterSpacing: 1.2,
          color: 'rgba(220, 170, 80, 0.6)',
          fontFamily:
            "Syne, ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
          fontWeight: 700,
          textAlign: 'center',
          textTransform: 'lowercase',
        }}
      >
        dig.haus
      </div>
    </div>
  );
}
