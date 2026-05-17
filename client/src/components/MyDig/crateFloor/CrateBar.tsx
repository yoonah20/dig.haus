import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CrateSummary } from '../../../hooks/useCrates';
import CoverArt from '../../CoverArt';

// Horizontal row of crates anchored at the bottom of the mydig
// surface. Click a crate makes it active (its records spill onto
// the floor above). Doubles as a drop target when the owner drags
// a record from the floor (parent uses hitTestAtClient on
// pointerup). The bar also supports drag-to-reorder for owners —
// position 0 is the leftmost chip, which is what visitors see by
// default on first load.
//
// Click-vs-drag discrimination matches FloorRecord: < 5 px of
// movement = click (select active), beyond = drag (reorder).

export interface CrateBarHandle {
  hitTestAtClient: (clientX: number, clientY: number) => number | null;
}

interface Props {
  crates: CrateSummary[];
  activeCrateId: number | null;
  onSelect: (crateId: number) => void;
  highlightedDropId?: number | null;
  // Owner-only — fired with the new id order when the owner finishes
  // a drag-to-reorder gesture.
  onReorder?: (orderedIds: number[]) => void;
  // Owner-only — fired with a trimmed title when the trailing + chip
  // commits a new crate.
  onCreate?: (title: string) => void;
  // Owner-only — fired when any chip's ✏️ button is clicked. Parent
  // opens an edit modal for that crate (no need to switch active
  // first — owner can edit any of their crates in place).
  onEditCrate?: (crateId: number) => void;
  isOwner?: boolean;
}

const REORDER_CLICK_THRESHOLD_PX = 5;

interface ReorderDrag {
  id: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  moved: boolean;
}

function CrateChip({
  crate,
  isActive,
  isDropHover,
  isReordering,
  reorderTranslateX,
  onPointerDown,
  chipRef,
  onEdit,
}: {
  crate: CrateSummary;
  isActive: boolean;
  isDropHover: boolean;
  // True for the chip currently being dragged for reorder. The
  // chip floats above siblings + follows the pointer via translateX.
  isReordering: boolean;
  reorderTranslateX: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  chipRef: (el: HTMLDivElement | null) => void;
  // Owner-only — set on the active chip. Click on the ✏️ corner
  // button fires this; visitor chips leave it undefined and the
  // button doesn't render.
  onEdit?: () => void;
}) {
  const front = crate.coverThumbs?.[0];
  const [hover, setHover] = useState(false);
  return (
    <div
      ref={chipRef}
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-crate-id={crate.id}
      style={{
        padding: 4,
        background: 'transparent',
        border: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: isReordering ? 'grabbing' : 'pointer',
        touchAction: 'none',
        transform: isReordering
          ? `translateX(${reorderTranslateX}px)`
          : undefined,
        zIndex: isReordering ? 50 : undefined,
        position: 'relative',
        transition: isReordering ? 'none' : 'transform 160ms ease-out',
      }}
    >
      {/* Edit chip — owner-only, surfaces on the active chip when
          hovered. stopPropagation on both pointerdown + click so it
          never starts a drag or trips the chip-select path. */}
      {onEdit && hover && !isReordering && (
        <button
          type="button"
          aria-label="상자 편집"
          title="상자 편집"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(20, 12, 10, 0.95)',
            color: '#f4ebd9',
            border: '1px solid rgba(220, 170, 80, 0.6)',
            fontSize: 11,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            zIndex: 3,
          }}
        >
          ✏️
        </button>
      )}
      {/* Crate body — a small wooden bin with the front record peeking. */}
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
          boxShadow: isReordering
            ? '0 10px 22px rgba(0,0,0,0.55)'
            : isActive
              ? '0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)'
              : '0 2px 6px rgba(0,0,0,0.4)',
          padding: 6,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          transition: 'border-color 160ms ease-out',
          transform: isDropHover
            ? 'translateY(-4px) scale(1.04)'
            : isActive
              ? 'translateY(-2px)'
              : undefined,
        }}
      >
        {front?.url ? (
          <div
            style={{
              width: 56,
              height: 56,
              boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
              borderRadius: 1,
              overflow: 'hidden',
              pointerEvents: 'none',
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
              pointerEvents: 'none',
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
          pointerEvents: 'none',
        }}
      >
        {crate.title}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'rgba(200,184,154,0.55)',
          pointerEvents: 'none',
        }}
      >
        {crate.itemCount}
        {!crate.isPublic && ' · 🔒'}
      </div>
    </div>
  );
}

const CrateBar = forwardRef<CrateBarHandle, Props>(function CrateBar(
  {
    crates,
    activeCrateId,
    onSelect,
    highlightedDropId,
    onReorder,
    onCreate,
    onEditCrate,
    isOwner = false,
  },
  ref
) {
  const chipsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  // Inline new-crate name input. null = collapsed (just shows the +
  // chip); string = composing (text input is open, Enter creates).
  const [newCrateTitle, setNewCrateTitle] = useState<string | null>(null);

  // Local override of crate order while the owner is mid-drag. Null
  // means "use props order"; an array means "render in this order
  // until the drag commits or cancels." Committed to the server via
  // onReorder; the server response flow refreshes props and the
  // override falls away.
  const [draftOrder, setDraftOrder] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const dragRef = useRef<ReorderDrag | null>(null);
  dragRef.current = drag;

  // Resolve the display order: draft (during drag) → props.
  const displayCrates = useMemo<CrateSummary[]>(() => {
    if (!draftOrder) return crates;
    const byId = new Map(crates.map((c) => [c.id, c]));
    return draftOrder
      .map((id) => byId.get(id))
      .filter((c): c is CrateSummary => c != null);
  }, [crates, draftOrder]);

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

  // Drag lifecycle — window-level move/up so the pointer can stray
  // outside the chip without breaking the gesture. Mirrors the
  // FloorRecord drag pattern.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.startClientX;
      const dy = e.clientY - cur.startClientY;
      const moved = cur.moved || Math.hypot(dx, dy) >= REORDER_CLICK_THRESHOLD_PX;
      setDrag({ ...cur, currentClientX: e.clientX, moved });
      if (!moved) return;
      // Rewritten 2026-05-18: the prior "nearest-chip-centre" logic
      // got confused once the dragged chip moved, since chipsRef
      // also reported its own (floated) position. Now: collect the
      // OTHER chips' rects only, sort by visual left edge, then
      // pick the insertion index from cursor x vs each chip's
      // centre. The dragged chip goes at the first index whose
      // chip centre is past the cursor.
      const others: Array<{ id: number; left: number; centreX: number }> = [];
      for (const [id, el] of chipsRef.current) {
        if (id === cur.id) continue;
        const r = el.getBoundingClientRect();
        others.push({ id, left: r.left, centreX: r.left + r.width / 2 });
      }
      others.sort((a, b) => a.left - b.left);
      let insertIdx = others.length;
      for (let i = 0; i < others.length; i++) {
        if (e.clientX < others[i].centreX) {
          insertIdx = i;
          break;
        }
      }
      const next = others.map((o) => o.id);
      next.splice(insertIdx, 0, cur.id);
      // Only push state when the draft order actually changes —
      // avoids pointermove storms re-rendering every frame at rest.
      const same =
        draftOrder != null &&
        draftOrder.length === next.length &&
        draftOrder.every((id, i) => id === next[i]);
      if (!same) setDraftOrder(next);
    };
    const onUp = () => {
      const cur = dragRef.current;
      if (!cur) return;
      if (!cur.moved) {
        // Pure click — fall through to select handler.
        onSelect(cur.id);
      } else if (draftOrder && onReorder) {
        onReorder(draftOrder);
      }
      setDrag(null);
      // Keep draftOrder applied during the brief window before the
      // server response comes back — otherwise the bar snaps back to
      // the old order for a frame. Clear it on the next render after
      // crates prop changes (see effect below).
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, crates, draftOrder, onReorder, onSelect]);

  // When the parent's crate list changes (server re-fetch lands),
  // drop any stale draftOrder so the new ground truth wins.
  useEffect(() => {
    setDraftOrder(null);
  }, [crates]);

  const handleChipPointerDown = (
    crateId: number,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isOwner) {
      // Visitor: just select on pointerup of a tap. Use simple click
      // semantics — no drag bookkeeping needed.
      // Defer to a click via onPointerUp handler below would also
      // work, but it's simpler to fire selection on pointerdown for
      // visitors since they have no other gesture path.
      onSelect(crateId);
      return;
    }
    setDrag({
      id: crateId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      currentClientX: e.clientX,
      moved: false,
    });
    e.preventDefault();
  };

  // Translate offset for the chip currently being reordered — keeps
  // its centre under the pointer. Computed once per render against
  // the chip's slot rect.
  const reorderTranslateX = (() => {
    if (!drag || !drag.moved) return 0;
    const el = chipsRef.current.get(drag.id);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return drag.currentClientX - (r.left + r.width / 2);
  })();

  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '12px 16px 16px',
        overflowX: 'auto',
        // Same warm tint as the meta ribbon above the carpet so the
        // two crate-info bands read as a matched pair bracketing the
        // floor. Border on top mirrors the meta strip's bottom amber
        // border for the same visual rhyme.
        borderTop: '1px solid rgba(220, 170, 80, 0.12)',
        background: 'rgba(50, 32, 18, 0.55)',
      }}
    >
      {displayCrates.map((c) => {
        const isActive = c.id === activeCrateId;
        return (
          <CrateChip
            key={c.id}
            crate={c}
            isActive={isActive}
            isDropHover={c.id === highlightedDropId}
            isReordering={drag?.moved === true && drag.id === c.id}
            reorderTranslateX={
              drag?.moved === true && drag.id === c.id ? reorderTranslateX : 0
            }
            onPointerDown={(e) => handleChipPointerDown(c.id, e)}
            chipRef={(el) => {
              if (el) chipsRef.current.set(c.id, el);
              else chipsRef.current.delete(c.id);
            }}
            onEdit={
              // Edit chip surfaces on every owner-side chip, not
              // just the active one — visitor never sees it.
              isOwner && onEditCrate
                ? () => onEditCrate(c.id)
                : undefined
            }
          />
        );
      })}
      {/* Trailing + chip — owner only. Click → inline name input,
          Enter → create empty crate. Same chip footprint as the
          crate ones so it doesn't break the bar's rhythm. */}
      {isOwner && onCreate && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 4,
          }}
        >
          {newCrateTitle == null ? (
            <button
              type="button"
              onClick={() => setNewCrateTitle('')}
              title="새 상자 만들기"
              style={{
                width: 88,
                height: 70,
                background:
                  'linear-gradient(180deg, rgba(60,42,24,0.4) 0%, rgba(40,28,18,0.4) 100%)',
                border: '2px dashed rgba(200,184,154,0.35)',
                borderRadius: 4,
                color: 'rgba(220,200,160,0.7)',
                fontSize: 26,
                fontWeight: 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              +
            </button>
          ) : (
            <div
              style={{
                width: 88,
                height: 70,
                background:
                  'linear-gradient(180deg, #523620 0%, #3a2310 100%)',
                border: '2px solid #d9a559',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
              }}
            >
              <input
                type="text"
                autoFocus
                value={newCrateTitle}
                onChange={(e) => setNewCrateTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const t = (newCrateTitle ?? '').trim();
                    if (t) {
                      onCreate(t);
                      setNewCrateTitle(null);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setNewCrateTitle(null);
                  }
                }}
                onBlur={() => {
                  const t = (newCrateTitle ?? '').trim();
                  if (t) onCreate(t);
                  setNewCrateTitle(null);
                }}
                placeholder="이름"
                maxLength={60}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#f0c060',
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
            </div>
          )}
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: '#c8b89a',
              opacity: 0.6,
            }}
          >
            새 상자
          </div>
        </div>
      )}
    </div>
  );
});

export default CrateBar;
