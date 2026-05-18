import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import CoverArt from '../../CoverArt';
import type { CrateItem } from '../../../hooks/useCrates';

// A single LP cover lying flat on the mydig floor. Visitors see it
// as a static cover-up record; owners can pick it up and drag.
//
// Position is absolute, anchored by the centre (transform translate
// -50% -50%) so the coordinate maps cleanly to "where the cover sits
// on the floor."
//
// 2026-05-18 thickness iter: covers gained a bevelled paper-edge
// (inset box-shadow stack — top highlight, bottom + side dark
// lines) plus a deterministic ±3° rotation per album so the carpet
// reads as "physical sleeves placed by hand" instead of pasted
// thumbnails. Rotation pivots around the centre (because the outer
// transform already anchors translate(-50%, -50%)), so the layout
// coordinate the owner placed still lands at the cover's centre.

// Deterministic [-1, 1] pseudo-random from an integer seed —
// reused from the layout flow's jitter so rotation feels of-a-piece
// with the default-flow placement noise.
function jitter(seed: number, salt: number): number {
  const x = Math.sin(seed * 9301 + salt * 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
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
  // Owner-only — remove this record from the active crate. Click on
  // the × chip surfaces on hover when supplied; visitors get null.
  onRemove?: () => void;
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
  onRemove,
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
  // Deterministic ±3° rotation per album. Just enough to look
  // hand-placed without breaking the sort-by-position contract
  // (rotation doesn't affect the position_y banding). Pulled to
  // 0° while dragging so the grab feels precise, and partially
  // unwound on hover so the cover straightens for reading.
  const baseRotation = jitter(item.id, 7) * 3;
  const rot = isDragging ? 0 : hover ? baseRotation * 0.25 : baseRotation;

  const inner = (
    <div
      style={{
        position: 'relative',
        width: sizePx,
        height: sizePx,
      }}
    >
      <div
        style={{
          width: sizePx,
          height: sizePx,
          overflow: 'hidden',
          background: '#111',
          // Paper-sleeve bevel — four inset 1px lines per side at
          // different tones (top brightest, bottom darkest, sides
          // mid-dark) so the cover reads as a printed sleeve with
          // edge thickness instead of a flat thumbnail. All inset
          // so the bevel never extends past the cover footprint
          // and crowds neighbours.
          boxShadow: [
            'inset 0 1px 0 rgba(255, 245, 225, 0.16)',
            'inset 0 -1px 0 rgba(0, 0, 0, 0.45)',
            'inset 1px 0 0 rgba(0, 0, 0, 0.22)',
            'inset -1px 0 0 rgba(0, 0, 0, 0.28)',
          ].join(', '),
        }}
      >
        <CoverArt
          src={item.coverArtUrl}
          fallbacks={item.coverArtFallbacks}
          alt={`${item.title} – ${item.artist}`}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
      </div>
      {/* Remove chip — owner-only, surfaces on hover. Sits at the
          top-right of the cover so the cursor's natural rest point
          (after moving onto the record) is already close to it.
          stopPropagation on both pointerdown + click so the chip
          never starts a drag or fires the tap-to-navigate path. */}
      {isOwner && onRemove && hover && !isDragging && (
        <button
          type="button"
          aria-label="이 상자에서 빼기"
          title="이 상자에서 빼기"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(20, 12, 10, 0.92)',
            color: '#f4ebd9',
            border: '1px solid rgba(220, 170, 80, 0.45)',
            fontSize: 13,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            zIndex: 2,
          }}
        >
          ×
        </button>
      )}
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
        transform: `translate(-50%, ${lift - 50}%) rotate(${rot}deg) scale(${scale})`,
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
