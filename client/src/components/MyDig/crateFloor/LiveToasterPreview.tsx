import { useMemo } from 'react';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// Live preview of what the toaster PNG will render — 5 rows × (3
// covers + 3-caption column), mirroring the server-side PNG layout
// (server/src/services/toasterRenderer.ts) closely enough that
// "what I see here is what I'll download." Sort is intentionally
// identical to the server's crateToToasterSlots (visual reading
// order: row band first, then left-to-right; unplaced records last
// by created_at DESC). When the owner drags a record on the floor,
// both the floor render and this preview re-sort together.
//
// Pure visual surface. The actual download action sits beside the
// preview so this stays uncluttered.

interface Props {
  crateTitle: string;
  username: string;
  items: CrateItem[];
}

// Y-band granularity — must match the server's CAST(position_y/0.16
// AS INTEGER) in crateToToasterSlots. 0.16 = the default-flow grid's
// row spacing in client/layout.ts.
const Y_BAND = 0.16;

// Sort that matches server/src/routes/mydig.ts → crateToToasterSlots.
// Kept identical so preview and download show the same record order.
function sortForToaster(items: CrateItem[]): CrateItem[] {
  return [...items].sort((a, b) => {
    const aPlaced = a.positionY != null;
    const bPlaced = b.positionY != null;
    if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
    if (aPlaced && bPlaced) {
      const aBand = Math.floor(a.positionY! / Y_BAND);
      const bBand = Math.floor(b.positionY! / Y_BAND);
      if (aBand !== bBand) return aBand - bBand;
      if (a.positionX! !== b.positionX!) return a.positionX! - b.positionX!;
    }
    // Both unplaced or tied — newer (later added) wins.
    return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
  });
}

const COLS = 3;
const ROWS = 5;
const TOASTER_SLOTS = COLS * ROWS;

export default function LiveToasterPreview({
  crateTitle,
  username,
  items,
}: Props) {
  const sorted = useMemo(
    () => sortForToaster(items).slice(0, TOASTER_SLOTS),
    [items]
  );
  // Pad to exactly 15 so the layout renders even when the crate is
  // sparsely populated. Empty cells render as flat dark squares.
  const slots: (CrateItem | null)[] = Array.from(
    { length: TOASTER_SLOTS },
    (_, i) => sorted[i] ?? null
  );
  // Group into 5 rows of 3 to mirror the server PNG's row layout
  // (3 covers strip + 3-caption stack per row).
  const rows: (CrateItem | null)[][] = Array.from({ length: ROWS }, (_, r) =>
    slots.slice(r * COLS, (r + 1) * COLS)
  );

  return (
    <div
      style={{
        background: '#1a130a',
        border: '1px solid rgba(220, 170, 80, 0.18)',
        borderRadius: 6,
        padding: '12px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.45)',
        fontFamily:
          "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
      }}
    >
      {/* Crate title — top, centred, monospace. Matches the PNG header. */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: 0.6,
          color: '#f0f0f0',
          textAlign: 'center',
          padding: '2px 0 4px',
          borderBottom: '1px solid rgba(220, 170, 80, 0.12)',
        }}
      >
        {crateTitle}
      </div>
      {/* 5 rows. Each row: cover strip on the left, caption column
          on the right. Mirrors server toasterRenderer.ts row layout. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            {/* Cover strip — 3 covers, fixed small size */}
            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              {row.map((s, i) => (
                <div
                  key={s ? s.id : `empty-${rowIdx}-${i}`}
                  style={{
                    width: 42,
                    height: 42,
                    background: '#0a0703',
                    overflow: 'hidden',
                    flexShrink: 0,
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
            {/* Caption column — 3 captions stacked. Each = artist
                (dim) + title (bright), 2 lines. */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
                fontSize: 8,
                lineHeight: 1.25,
                color: '#d8d8d8',
              }}
            >
              {row.map((s, i) => (
                <div
                  key={s ? `cap-${s.id}` : `cap-empty-${rowIdx}-${i}`}
                  style={{
                    minHeight: 11,
                    overflow: 'hidden',
                  }}
                >
                  {s ? (
                    <>
                      <div
                        style={{
                          opacity: 0.6,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {s.artist}
                      </div>
                      <div
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {s.title}
                      </div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Footer — Syne wordmark + handle URL, matches the server PNG
          footer pairing. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(220, 170, 80, 0.12)',
        }}
      >
        <span
          style={{
            color: '#e8a020',
            fontFamily:
              "Syne, ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '-0.03em',
            border: '1.5px solid #e8a020',
            padding: '1px 5px',
            transform: 'rotate(-3deg)',
            lineHeight: 1,
          }}
        >
          dig.haus
        </span>
        <span
          style={{
            fontSize: 9,
            color: '#bdbdbd',
            letterSpacing: '0.04em',
          }}
        >
          dig.haus/my/{username}
        </span>
      </div>
    </div>
  );
}
