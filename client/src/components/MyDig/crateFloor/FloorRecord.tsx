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
// 2026-05-18 thickness iter: covers get an inset paper-edge bevel
// PLUS a stack of 0-blur sharp shadows below them that read as the
// LP's physical thickness (edge of the sleeve seen from above at a
// slight angle). Rotation comes from the layout prop — deterministic
// for never-touched records, re-rolled on every drag-and-drop so
// placing a record physically handles it. Range capped at ±2°.

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
  rotation,
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
  // Rotation prop comes from layout — deterministic ±2° per album
  // for never-touched records, or the random ±2° committed at the
  // last drop. Pulled to 0° while dragging so the grab feels
  // precise, and partially unwound on hover (×0.3) so the cover
  // straightens for reading without snapping back fully.
  const rot = isDragging ? 0 : hover ? rotation * 0.3 : rotation;

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
          // Cover thickness = TWO shadow stacks working together:
          //
          // (a) Inset bevel — four 1-2px lines that read as the
          //     printed paper edge of the sleeve. Top is brightest
          //     (light hitting the upper edge), bottom is darkest
          //     (recessed shadow underneath), sides are mid-dark.
          //     Stronger than the first attempt — operator said it
          //     wasn't reading as thickness so we bumped opacity +
          //     made bottom + right 2px instead of 1px so the
          //     darkest edges actually visibly catch the eye.
          //
          // (b) Outer 0-blur stacked drop shadow — three sharp
          //     1px-tall layers in descending opacity directly
          //     beneath the cover. Reads as the SIDE of the LP
          //     sleeve peeking out from underneath the front face,
          //     i.e. the physical thickness of the cardboard. Not
          //     a blurry floating shadow (operator vetoed that) —
          //     these are sharp lines that look like real material.
          boxShadow: [
            // Inset bevel
            'inset 0 1px 0 rgba(255, 245, 225, 0.22)',
            'inset 0 -2px 0 rgba(0, 0, 0, 0.55)',
            'inset 1px 0 0 rgba(0, 0, 0, 0.28)',
            'inset -2px 0 0 rgba(0, 0, 0, 0.32)',
            // Outer thickness stack (sharp, no blur)
            '0 1px 0 rgba(0, 0, 0, 0.55)',
            '0 2px 0 rgba(0, 0, 0, 0.42)',
            '0 3px 0 rgba(0, 0, 0, 0.28)',
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
