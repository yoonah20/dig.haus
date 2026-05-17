import { useState } from 'react';
import { Link } from 'react-router-dom';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// A single LP cover lying flat on the mydig floor. Visitors see it
// as a static cover-up record; owners can pick it up and drag.
//
// Position is absolute, anchored by the centre (transform translate
// -50% -50%) so the coordinate maps cleanly to "where the cover sits
// on the floor." Records lie flat — rotation was an early experiment
// that read as broken; the rotation prop is accepted for layout-data
// compatibility but no longer applied to the render transform.

interface Props {
  item: CrateItem;
  // Normalised floor coords [0, 1]; size in px (square).
  x: number;
  y: number;
  rotation: number;
  sizePx: number;
  isOwner: boolean;
  isDragging: boolean;
  // Owner-side drag history — most-recently-placed records get a
  // higher z-index so they stay on top after the drag ends. 0 means
  // "natural order" (DOM order wins).
  zOrder: number;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export default function FloorRecord({
  item,
  x,
  y,
  sizePx,
  isOwner,
  isDragging,
  zOrder,
  onPointerDown,
}: Props) {
  const [hover, setHover] = useState(false);

  const lift = isDragging ? 0 : hover ? -6 : 0;
  const scale = isDragging ? 1.05 : hover ? 1.04 : 1;

  // Resolved z-index — dragging trumps everything; hovered records
  // pop temporarily; otherwise use the owner's drag-order stack so
  // the last-touched record stays on top of what it now overlaps.
  const z = isDragging ? 1000 : hover ? 500 : zOrder;

  const inner = (
    <div
      style={{
        width: sizePx,
        height: sizePx,
        boxShadow: isDragging
          ? '0 18px 32px rgba(0,0,0,0.55)'
          : '0 6px 12px rgba(0,0,0,0.35)',
        borderRadius: 2,
        overflow: 'hidden',
        background: '#111',
      }}
    >
      <CoverArt
        src={item.coverArtUrl}
        fallbacks={item.coverArtFallbacks}
        alt={`${item.title} – ${item.artist}`}
        className="w-full h-full object-cover select-none pointer-events-none"
      />
    </div>
  );

  return (
    <div
      onPointerDown={isOwner ? onPointerDown : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(-50%, ${lift - 50}%) scale(${scale})`,
        transition: isDragging
          ? 'none'
          : 'transform 180ms ease-out, box-shadow 180ms ease-out',
        cursor: isOwner ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        zIndex: z,
        touchAction: 'none',
      }}
    >
      {isOwner ? (
        inner
      ) : (
        <Link
          to={`/album/${item.slug ?? item.mbid}`}
          className="block w-full h-full"
          draggable={false}
        >
          {inner}
        </Link>
      )}
      {/* Hover label — artist (small, muted) above title (bolder),
          on a dark plaque so it reads against any cover. Sits just
          above the record. Pointer-events-none so it never grabs
          the cursor mid-drag. */}
      {hover && !isDragging && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(100% + 6px)',
            transform: 'translateX(-50%)',
            background: 'rgba(20, 12, 10, 0.92)',
            color: '#f4ebd9',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            lineHeight: 1.35,
            maxWidth: 240,
            pointerEvents: 'none',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            border: '1px solid rgba(220, 170, 80, 0.25)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              opacity: 0.72,
              fontSize: 10,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.artist}
          </div>
          <div
            style={{
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.title}
          </div>
        </div>
      )}
    </div>
  );
}
