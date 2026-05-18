import { useMemo } from 'react';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// Live preview — minimum-viable representation of what the toaster
// PNG will render. Text was stripped 2026-05-17 (operator iter): the
// crate title, per-row captions, dig.haus footer, and handle stamp
// all left the preview because matching the server PNG's typography
// exactly client-side proved fiddly and pulled focus from the only
// thing the preview really needs to communicate — which 15 covers
// the export will pick and in what order. The downloaded PNG still
// carries the full text treatment (header / captions / stamp).
//
// Sort mirrors server crateToToasterSlots: y bucketed into 0.25-
// wide bands (one band per visible row of the default-flow grid),
// within a band x decides, unplaced records last by addedAt DESC.

interface Props {
  items: CrateItem[];
}

// Must stay in sync with server/src/routes/mydig.ts → toaster sort
// (CAST(position_y / 0.25 AS INTEGER)) and with the default-flow
// row positions in ./layout.ts. Touching one without the other will
// desync the preview from the download, and tuning this without
// re-checking the row positions can re-introduce the "tiny drag
// flips a band" bug (see server-side history comment).
const Y_BAND = 0.25;

function sortForToaster(items: CrateItem[]): CrateItem[] {
  return [...items].sort((a, b) => {
    const aPlaced = a.positionY != null;
    const bPlaced = b.positionY != null;
    if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
    if (aPlaced && bPlaced) {
      const aBand = Math.floor(a.positionY! / Y_BAND);
      const bBand = Math.floor(b.positionY! / Y_BAND);
      if (aBand !== bBand) return aBand - bBand;
      const ax = a.positionX ?? 0;
      const bx = b.positionX ?? 0;
      if (ax !== bx) return ax - bx;
    }
    return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
  });
}

const COLS = 3;
const ROWS = 5;
const TOASTER_SLOTS = COLS * ROWS;

export default function LiveToasterPreview({ items }: Props) {
  const sorted = useMemo(
    () => sortForToaster(items).slice(0, TOASTER_SLOTS),
    [items]
  );
  const slots: (CrateItem | null)[] = Array.from(
    { length: TOASTER_SLOTS },
    (_, i) => sorted[i] ?? null
  );

  return (
    <div
      style={{
        background: 'var(--color-panel-strong)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        borderRadius: 6,
        padding: 10,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.45)',
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridAutoRows: '1fr',
        gap: 4,
        // 3 cols × 5 rows of square covers → aspect 3:5 for the cover
        // area. The padding adds a little around the outside, so the
        // outer aspect is slightly more square than 3:5 but stays
        // portrait — matches the PNG's portrait orientation without
        // pretending to replicate its exact 4:5 layout (which only
        // holds when the text columns are included).
        aspectRatio: '3 / 5',
      }}
    >
      {slots.map((s, i) => (
        <div
          key={s ? s.id : `empty-${i}`}
          style={{
            background: '#0a0703',
            overflow: 'hidden',
            position: 'relative',
            minHeight: 0,
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
  );
}
