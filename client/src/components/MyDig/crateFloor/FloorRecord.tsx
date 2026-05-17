import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
//
// 2026-05-17 iter: drop-shadow stripped (operator preference) and a
// shrink-wrap raster overlay added on top of each cover, matching
// the home-hero "sealed sleeve" treatment.

const PLASTIC_TEXTURE_PATHS = [
  '/textures/swrap01.webp',
  '/textures/swrap02.webp',
  '/textures/swrap03.webp',
  '/textures/swrap04.webp',
  '/textures/swrap09.webp',
  '/textures/swrap15.webp',
  '/textures/swrap16.webp',
  '/textures/swrap17.webp',
];

// Deterministic plastic-texture pick per album so the wrap stays
// stable across re-fetches (no flicker). Album id mod the pool.
function pickPlasticTextureForAlbum(albumId: number): string {
  return (
    PLASTIC_TEXTURE_PATHS[Math.abs(albumId) % PLASTIC_TEXTURE_PATHS.length] ??
    PLASTIC_TEXTURE_PATHS[0]!
  );
}

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
  // Mouse position in viewport coords — drives the hover label
  // anchor so the artist/title/review tag follows the cursor instead
  // of sitting fixed above the record. Updated on each mousemove
  // while the pointer is over the record.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    setPointer({ x: e.clientX, y: e.clientY });
  };

  const lift = isDragging ? 0 : hover ? -6 : 0;
  const scale = isDragging ? 1.05 : hover ? 1.04 : 1;
  const z = isDragging ? 1000 : hover ? 500 : zOrder;

  const plasticSrc = useMemo(
    () => pickPlasticTextureForAlbum(item.id),
    [item.id]
  );

  // Plastic overlay sized 1:1 with the cover (no protrusion).
  // Operator iter 2026-05-17: the home-hero 15% extra read as
  // misaligned on the floor where covers sit isolated rather than
  // nested into a sleeve frame.

  const inner = (
    <div
      style={{
        position: 'relative',
        width: sizePx,
        height: sizePx,
        // No box-shadow — operator preference 2026-05-17. The
        // plastic wrap below provides edge definition without the
        // muddy stack a shadow would add on top.
      }}
    >
      <div
        style={{
          width: sizePx,
          height: sizePx,
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
      {/* Shrink-wrap raster — sized 1:1 with the cover so the film
          stays flush with the sleeve edges. Pointer-events: none so
          it never intercepts a drag. */}
      <img
        src={plasticSrc}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: sizePx,
          height: sizePx,
          maxWidth: 'none',
          objectFit: 'cover',
          pointerEvents: 'none',
        }}
      />
    </div>
  );

  return (
    <div
      onPointerDown={isOwner ? onPointerDown : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPointer(null);
      }}
      onMouseMove={handleMouseMove}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(-50%, ${lift - 50}%) scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 180ms ease-out',
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
          className="block"
          draggable={false}
        >
          {inner}
        </Link>
      )}
      {/* Hover label — anchored to the cursor (operator iter
          2026-05-17), portaled to body so the floor's overflow:
          hidden / record stacking can't clip it. Artist (dim) over
          title (bold), and the owner's 50자 평 below if any.
          Pointer-events: none so it never intercepts the drag. */}
      {hover &&
        !isDragging &&
        pointer &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              // 14 px clearance to the upper-left of the cursor so
              // the label sits where the eye expects a tooltip
              // without covering whatever the user is mousing over.
              left: pointer.x + 14,
              top: pointer.y - 14,
              transform: 'translateY(-100%)',
              background: 'rgba(20, 12, 10, 0.94)',
              color: '#f4ebd9',
              padding: '5px 9px',
              borderRadius: 4,
              fontSize: 11,
              lineHeight: 1.4,
              maxWidth: 280,
              pointerEvents: 'none',
              boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
              border: '1px solid rgba(220, 170, 80, 0.25)',
              zIndex: 10000,
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
            {item.ownerReview && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 4,
                  borderTop: '1px solid rgba(220,170,80,0.18)',
                  fontSize: 11,
                  color: '#e8d8b5',
                  fontStyle: 'italic',
                  // The 50자 평 caps at 50 chars Korean by design,
                  // but allow it to wrap inside the 280px max
                  // rather than ellipsis — it's the most expressive
                  // bit, worth showing in full.
                  whiteSpace: 'normal',
                  wordBreak: 'keep-all',
                  lineHeight: 1.4,
                }}
              >
                {item.ownerReview.emoji && (
                  <span style={{ marginRight: 4 }}>
                    {item.ownerReview.emoji}
                  </span>
                )}
                {item.ownerReview.body}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
