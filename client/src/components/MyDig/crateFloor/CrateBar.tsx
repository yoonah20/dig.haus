import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { CrateSummary } from '../../../hooks/useCrates';
import CoverArt from '../../CoverArt';

// Horizontal row of crates anchored at the bottom of the mydig
// surface. Clicking a crate makes it the active one (its records
// spill onto the floor above). Acts as a drop target when the owner
// drags a record from the floor.
//
// Imperative API: parent calls hitTestAtClient(x, y) on pointerup
// to figure out which crate (if any) a record landed on.

export interface CrateBarHandle {
  hitTestAtClient: (clientX: number, clientY: number) => number | null;
}

interface Props {
  crates: CrateSummary[];
  activeCrateId: number | null;
  onSelect: (crateId: number) => void;
  highlightedDropId?: number | null;
}

function CrateChip({
  crate,
  isActive,
  isDropHover,
  onClick,
  chipRef,
}: {
  crate: CrateSummary;
  isActive: boolean;
  isDropHover: boolean;
  onClick: () => void;
  chipRef: (el: HTMLButtonElement | null) => void;
}) {
  // Cover thumbs: up to 4 most-recent covers, used to peek the front
  // contents like a real record crate where the leftmost cover faces
  // outward. We just show the first one as the prominent face.
  const front = crate.coverThumbs?.[0];

  return (
    <button
      ref={chipRef}
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-center"
      style={{
        padding: 4,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      data-crate-id={crate.id}
    >
      {/* Crate body — a small wooden bin with the front record
          peeking out. Slightly tilted up at the top to fake a
          shallow 3/4 perspective consistent with the flat-lay floor. */}
      <div
        style={{
          width: 88,
          height: 70,
          background: isActive
            ? 'linear-gradient(180deg, #6a4423 0%, #4a2d15 100%)'
            : 'linear-gradient(180deg, #523620 0%, #3a2310 100%)',
          border: isDropHover
            ? '2px solid #f0c060'
            : isActive
              ? '2px solid #d9a559'
              : '2px solid transparent',
          borderRadius: 4,
          boxShadow: isActive
            ? '0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)'
            : '0 2px 6px rgba(0,0,0,0.4)',
          padding: 6,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          transition: 'transform 160ms ease-out, border-color 160ms ease-out',
          transform: isDropHover
            ? 'translateY(-4px) scale(1.04)'
            : isActive
              ? 'translateY(-2px)'
              : 'translateY(0)',
        }}
      >
        {/* Front cover peek — the most-recent record in the crate.
            CoverArt handles the API-base prefix for /api/custom-covers
            paths and falls through the fallbacks chain on load failure,
            both of which a raw <img> would skip (the prior version
            broke for crates whose top item was a custom cover on the
            split-origin Vercel→Railway deploy). */}
        {front?.url ? (
          <div
            style={{
              width: 56,
              height: 56,
              boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <CoverArt
              src={front.url}
              fallbacks={front.fallbacks}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              background: 'rgba(0,0,0,0.3)',
              border: '1px dashed rgba(255,255,255,0.18)',
              borderRadius: 1,
            }}
          />
        )}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          fontWeight: isActive ? 700 : 500,
          color: isActive ? '#f0c060' : '#c8b89a',
          maxWidth: 96,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {crate.title}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'rgba(200,184,154,0.55)',
        }}
      >
        {crate.itemCount}
        {!crate.isPublic && ' · 🔒'}
      </div>
    </button>
  );
}

const CrateBar = forwardRef<CrateBarHandle, Props>(function CrateBar(
  { crates, activeCrateId, onSelect, highlightedDropId },
  ref
) {
  const chipsRef = useRef<Map<number, HTMLButtonElement>>(new Map());

  useImperativeHandle(ref, () => ({
    hitTestAtClient(clientX, clientY) {
      for (const [id, el] of chipsRef.current) {
        const r = el.getBoundingClientRect();
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          return id;
        }
      }
      return null;
    },
  }));

  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '12px 16px 16px',
        overflowX: 'auto',
        // Subtle floor-meeting line so the bar feels seated.
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.25) 100%)',
      }}
    >
      {crates.map((c) => (
        <CrateChip
          key={c.id}
          crate={c}
          isActive={c.id === activeCrateId}
          isDropHover={c.id === highlightedDropId}
          onClick={() => onSelect(c.id)}
          chipRef={(el) => {
            if (el) chipsRef.current.set(c.id, el);
            else chipsRef.current.delete(c.id);
          }}
        />
      ))}
    </div>
  );
});

export default CrateBar;
