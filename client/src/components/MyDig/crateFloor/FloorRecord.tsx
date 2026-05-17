import { useState } from 'react';
import { Link } from 'react-router-dom';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// A single LP cover lying flat on the mydig floor. Visitors see it
// as a static cover-up record; owners can pick it up and drag.
//
// Position is absolute, anchored by the centre (transform translate
// -50% -50%) so the rotation pivots around the centre and the
// coordinate maps cleanly to "where the cover sits on the floor."

interface Props {
  item: CrateItem;
  // Normalised floor coords [0, 1]; size in px (square).
  x: number;
  y: number;
  rotation: number;
  sizePx: number;
  isOwner: boolean;
  isDragging: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export default function FloorRecord({
  item,
  x,
  y,
  rotation,
  sizePx,
  isOwner,
  isDragging,
  onPointerDown,
}: Props) {
  const [hover, setHover] = useState(false);

  // On hover, lift the record up slightly + straighten the rotation
  // so the cover is easier to read. Disabled while actively dragging
  // (the transform is being driven by pointer movement).
  const rot = isDragging ? rotation : hover ? rotation * 0.2 : rotation;
  const lift = isDragging ? 0 : hover ? -6 : 0;
  const scale = isDragging ? 1.05 : hover ? 1.04 : 1;

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
        transform: `translate(-50%, ${lift - 50}%) rotate(${rot}deg) scale(${scale})`,
        transition: isDragging
          ? 'none'
          : 'transform 180ms ease-out, box-shadow 180ms ease-out',
        cursor: isOwner ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        zIndex: isDragging ? 100 : hover ? 10 : 1,
        touchAction: 'none',
      }}
      // While dragging the owner is in transform-control mode and
      // shouldn't accidentally navigate. Visitors get a plain link to
      // the album page.
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
    </div>
  );
}
