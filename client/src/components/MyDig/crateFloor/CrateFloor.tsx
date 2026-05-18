import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAddToCrate,
  useCrateDetail,
  useCreateCrate,
  useRemoveFromCrate,
  useReorderCrates,
  useUpdateCrateItemLayout,
  useUserCrates,
  type CrateItem,
  type CrateSummary,
} from '../../../hooks/useCrates';
import FloorRecord from './FloorRecord';
import CrateBar, { type CrateBarHandle } from './CrateBar';
import { defaultFlowPosition } from './layout';
import ToasterButton from '../ToasterButton';
import LiveToasterPreview from './LiveToasterPreview';
import AddAlbumSearch from './AddAlbumSearch';
import Guestbook from './Guestbook';
import CrateEditModal from './CrateEditModal';
import ShareButton from '../ShareButton';
import { resolveApiUrl } from '../../../utils/apiUrl';

// The main mydig surface (replacement for the old vinyl-wall +
// storefront composition, 2026-05-17). Crates line the bottom of
// the scene; one is active at a time and its records spill onto
// the floor above as a flat scatter (cover-up).
//
// Owner interactions:
//   - Click another crate → it becomes active, its records spill.
//   - Drag a record on the floor → drops a new free position (PATCH).
//   - Drag a record onto a crate in the bar → adds membership (POST).
//   - The active crate is always 굿굿 on first load; later loads
//     remember the last opened crate via localStorage.
//
// Visitor interactions:
//   - Same crate switching is allowed.
//   - Records are plain links to the album page; no drag.

interface Props {
  username: string;
  isOwner: boolean;
}

interface LocalLayout {
  x: number;
  y: number;
  rotation: number;
}

type LocalLayoutMap = Map<number, LocalLayout>;

interface DragState {
  albumId: number;
  // Pixel offset of the pointer from the record centre at drag start.
  pointerOffsetX: number;
  pointerOffsetY: number;
  // Current pointer in floor-normalised coords.
  currentX: number;
  currentY: number;
  // Resolved rotation (carried through the drag unchanged).
  rotation: number;
  // Floor pixel rect captured at pointerdown so pointermove math
  // stays consistent even if the parent reflows.
  floorRect: DOMRect;
  // Which crate chip the pointer is currently over (highlight target).
  hoverCrateId: number | null;
  // Pointer position at pointerdown — used to distinguish tap-to-
  // navigate from drag-to-reposition in pointerup.
  startClientX: number;
  startClientY: number;
  // Pixel distance moved so far. > CLICK_THRESHOLD_PX means the
  // gesture committed to drag; ≤ keeps it eligible for navigation.
  moveDistance: number;
  // Convenience link target — captured at pointerdown so the
  // navigation handler doesn't have to re-lookup the item.
  href: string;
}

// Maximum pointer drift (in CSS px) for a pointerdown→pointerup to
// still count as a tap rather than a drag. 5 px is roughly the OS
// default touch slop and matches the human "I didn't mean to move".
const CLICK_THRESHOLD_PX = 5;

const ACTIVE_KEY = 'mydig:crateFloor:activeCrateId';

// Tailwind's `md` breakpoint is 768px; the grid above swaps to a
// two-column layout at the same width, so anything keyed on mobile-
// vs-desktop here matches the visual breakpoint.
function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export default function CrateFloor({ username, isOwner }: Props) {
  const cratesQuery = useUserCrates(username);
  const navigate = useNavigate();
  const isMobile = useIsMobileViewport();

  // Mobile collapses the toaster tools (search + preview + export
  // buttons) by default so the guestbook isn't pushed below the fold.
  // Desktop ignores this state — the tools always render in the side
  // column there.
  const [toasterToolsOpen, setToasterToolsOpen] = useState(false);

  // Server returns crates ordered by position ASC. The owner controls
  // ordering by drag-reordering chips in the bar; that PUT bumps
  // position values so the next fetch lands in the new order. No
  // client-side sort needed.
  const crates = useMemo<CrateSummary[]>(
    () => cratesQuery.data?.crates ?? [],
    [cratesQuery.data]
  );

  // Default open = 굿굿 unless the owner has previously picked
  // another (localStorage remembers across sessions).
  const initialActive = (() => {
    if (typeof window === 'undefined') return null;
    const saved = window.localStorage.getItem(ACTIVE_KEY);
    return saved ? parseInt(saved, 10) : null;
  })();

  const [activeCrateId, setActiveCrateId] = useState<number | null>(
    initialActive
  );
  // Open-modal target — set when the active crate's ✏️ chip fires,
  // cleared when the modal closes or the active crate changes.
  const [editingCrateId, setEditingCrateId] = useState<number | null>(null);

  // Pick a sensible active crate when the list loads or when the
  // saved one is no longer accessible (visitor + private crate).
  // Falls back to the frontmost (position 0) crate — owner controls
  // which one that is by drag-reordering chips in the bar, so
  // "what visitors see first" stays an owner-curated choice.
  useEffect(() => {
    if (crates.length === 0) return;
    const exists = activeCrateId != null && crates.some((c) => c.id === activeCrateId);
    if (exists) return;
    setActiveCrateId(crates[0].id);
  }, [crates, activeCrateId]);

  useEffect(() => {
    if (activeCrateId != null && typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_KEY, String(activeCrateId));
    }
  }, [activeCrateId]);

  // Close the edit modal when the active crate changes — the
  // operator's intent is "edit THIS active one", not "follow me
  // around as I switch crates."
  useEffect(() => {
    setEditingCrateId(null);
  }, [activeCrateId]);

  const detail = useCrateDetail(activeCrateId);
  const items = detail.data?.items ?? [];
  const activeCrate = useMemo(
    () => crates.find((c) => c.id === activeCrateId) ?? null,
    [crates, activeCrateId]
  );
  // Overflow count — items is capped at the server's FLOOR_CAP, but
  // crate.itemCount is the full membership. The badge surfaces "this
  // crate has more than fits on the floor" without surfacing which
  // ones are hidden; owner re-curates by adding / removing via
  // 담기.
  const overflowCount =
    activeCrate != null
      ? Math.max(0, activeCrate.itemCount - items.length)
      : 0;

  const updateLayout = useUpdateCrateItemLayout();
  const addToCrate = useAddToCrate();
  const removeFromCrate = useRemoveFromCrate();
  const reorderCrates = useReorderCrates();
  const createCrate = useCreateCrate();

  // Owner-local optimistic layout cache. Persists positions across
  // refetch and lets drag stay responsive while the PATCH is in
  // flight. Keyed by albumId because that's stable across crates
  // (an album in 굿굿 and 별루 still shares the visual identity).
  // Reset when active crate changes so old positions don't leak.
  const [localLayouts, setLocalLayouts] = useState<LocalLayoutMap>(new Map());
  // Per-album z-order: incrementing counter so the most-recently-
  // dragged record stays on top after the drag ends (not just while
  // mid-drag). Owner-side feature; visitors all render at z=1.
  // Resets with the crate change so the natural added_at order
  // re-asserts when switching.
  const [zOrder, setZOrder] = useState<Map<number, number>>(new Map());
  const zCounterRef = useRef(0);
  useEffect(() => {
    setLocalLayouts(new Map());
    setZOrder(new Map());
    zCounterRef.current = 0;
  }, [activeCrateId]);

  // Drag state + handlers — owner-only path. Captured once at
  // pointerdown; window listeners handle move + up so the pointer
  // can leave the record element without breaking the drag.
  const [drag, setDrag] = useState<DragState | null>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const crateBarRef = useRef<CrateBarHandle | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      // Normalise pointer relative to the floor rect captured at
      // pointerdown. The record is anchored by its centre, so we
      // subtract the offset captured then too — keeping the drag
      // grab-point under the pointer.
      const px = e.clientX - cur.pointerOffsetX;
      const py = e.clientY - cur.pointerOffsetY;
      const nx = (px - cur.floorRect.left) / cur.floorRect.width;
      const ny = (py - cur.floorRect.top) / cur.floorRect.height;
      const hover = crateBarRef.current?.hitTestAtClient(e.clientX, e.clientY) ?? null;
      const dx = e.clientX - cur.startClientX;
      const dy = e.clientY - cur.startClientY;
      const moveDistance = Math.max(
        cur.moveDistance,
        Math.hypot(dx, dy)
      );
      // Clamp to keep the dragged record's edges inside the carpet.
      // Record is anchored by its centre, so half the record size in
      // normalised floor coords is the safe inset.
      const halfNx = (recordSize / 2) / cur.floorRect.width;
      const halfNy = (recordSize / 2) / cur.floorRect.height;
      setDrag({
        ...cur,
        currentX: Math.max(halfNx, Math.min(1 - halfNx, nx)),
        currentY: Math.max(halfNy, Math.min(1 - halfNy, ny)),
        hoverCrateId: hover,
        moveDistance,
      });
    };
    const onUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const droppedOn = crateBarRef.current?.hitTestAtClient(e.clientX, e.clientY) ?? null;
      // Tap (no meaningful movement) → navigate to album page. Owner
      // can still drag-to-move with intent; quick clicks read as
      // "open this album". The CLICK_THRESHOLD_PX value is the human
      // touch-slop, not a UI knob.
      if (
        droppedOn == null &&
        cur.moveDistance < CLICK_THRESHOLD_PX &&
        cur.href
      ) {
        navigate(cur.href);
        setDrag(null);
        return;
      }
      if (droppedOn != null && droppedOn !== activeCrateId) {
        // Drop into another crate — adds membership but doesn't
        // remove from the source. The record visually returns to
        // its prior position (no layout change) since it's still in
        // the active crate too. Local layout already has it where
        // the owner placed it last; nothing to do beyond the POST.
        addToCrate.mutate({ crateId: droppedOn, albumId: cur.albumId });
      } else {
        // Commit the new free position to the active crate. Local
        // layout overrides server until the refetch lands. Bump the
        // record's z so it stays on top of the records it now
        // overlaps — the owner just placed it there, it should win.
        // Each drop re-rolls the rotation in [-2, +2]° so the act
        // of placing the record visibly handles it — mimicking
        // physically picking up an LP and tossing it back down.
        const droppedRotation = (Math.random() - 0.5) * 4;
        setLocalLayouts((prev) => {
          const next = new Map(prev);
          next.set(cur.albumId, {
            x: cur.currentX,
            y: cur.currentY,
            rotation: droppedRotation,
          });
          return next;
        });
        zCounterRef.current += 1;
        const z = zCounterRef.current;
        setZOrder((prev) => {
          const next = new Map(prev);
          next.set(cur.albumId, z);
          return next;
        });
        if (activeCrateId != null) {
          updateLayout.mutate({
            crateId: activeCrateId,
            albumId: cur.albumId,
            positionX: cur.currentX,
            positionY: cur.currentY,
            rotation: droppedRotation,
          });
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, activeCrateId, addToCrate, updateLayout, navigate]);

  // Compute the rendered floor positions for the active crate's
  // items. Priority: local optimistic > server-stored > default flow.
  const renderItems = useMemo(() => {
    return items.map((item, index) => {
      const local = localLayouts.get(item.id);
      if (local) {
        return {
          item,
          x: local.x,
          y: local.y,
          rotation: local.rotation,
          isPersisted: true,
        };
      }
      if (
        item.positionX != null &&
        item.positionY != null
      ) {
        return {
          item,
          x: item.positionX,
          y: item.positionY,
          rotation: item.rotation ?? 0,
          isPersisted: true,
        };
      }
      const flow = defaultFlowPosition(index, item.id);
      return {
        item,
        x: flow.positionX,
        y: flow.positionY,
        rotation: flow.rotation,
        isPersisted: false,
      };
    });
  }, [items, localLayouts]);

  // First-time owner-side persistence of default-flow positions —
  // so the next visitor sees a stable, owner-curated-or-defaulted
  // layout instead of the flow algorithm running again on their
  // viewport. Fires once per item after the floor is rendered.
  useEffect(() => {
    if (!isOwner || activeCrateId == null) return;
    const unplaced = renderItems.filter((r) => !r.isPersisted);
    if (unplaced.length === 0) return;
    // Batch all unplaced positions sequentially so we don't flood
    // the server with 30 concurrent PATCHes on first spill.
    let cancelled = false;
    (async () => {
      for (const r of unplaced) {
        if (cancelled) return;
        try {
          await updateLayout.mutateAsync({
            crateId: activeCrateId,
            albumId: r.item.id,
            positionX: r.x,
            positionY: r.y,
            rotation: r.rotation,
          });
        } catch {
          // best-effort; next render will retry the unplaced ones.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit renderItems from deps — we react to crate
    // change only. Within a crate the items array is stable enough
    // that this would otherwise re-fire on every state tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCrateId, isOwner]);

  // Record size — bigger than the preview's covers so the floor
  // reads as the working surface and the preview as the export
  // thumbnail. Bumped 2026-05-17 per operator feedback ("커버 크기가
  // 토스터 쪽 보단 커야함"). Tied to floor measured width.
  const [recordSize, setRecordSize] = useState(150);
  useLayoutEffect(() => {
    const el = floorRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      // Record size is a fixed fraction of carpet width so the
      // record-to-carpet ratio reads the same on every viewport.
      // Operator decision 2026-05-18: "사이즈는 다르더라도 모든
      // 뷰포트에서 같은 그림이 보이게."
      const target = Math.max(48, Math.round(w * 0.16));
      setRecordSize(target);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleRecordPointerDown = (
    item: CrateItem,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isOwner) return;
    const floor = floorRef.current;
    if (!floor) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    // Pointer offset relative to record centre — keep the grab
    // point under the pointer for the whole drag.
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const r = renderItems.find((ri) => ri.item.id === item.id);
    setDrag({
      albumId: item.id,
      pointerOffsetX: e.clientX - centreX,
      pointerOffsetY: e.clientY - centreY,
      currentX: r?.x ?? 0.5,
      currentY: r?.y ?? 0.5,
      rotation: r?.rotation ?? 0,
      floorRect: floor.getBoundingClientRect(),
      hoverCrateId: null,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moveDistance: 0,
      href: `/album/${item.slug ?? item.mbid}`,
    });
    e.preventDefault();
  };

  // Right column reserved when there's an active crate — holds the
  // toaster tools + guestbook. The earlier collapse toggle was
  // pulled 2026-05-18 since the carpet couldn't widen anyway (the
  // guestbook needed a column to live in regardless).
  const gridCols =
    activeCrateId != null && activeCrate
      ? 'grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px]'
      : 'grid-cols-1';

  return (
    <div className="flex flex-col gap-4">
    <div className={`grid ${gridCols} gap-4 relative`}>
      {/* Left column — floor (carpet) + crate bar at bottom. */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-panel-strong)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
      {/* Meta strip ABOVE the carpet — active crate's title +
          description on a single row, separated by a thin dot.
          Slightly warmer background tint than the carpet wrapper
          so it reads as its own ribbon, not just dead space. */}
      {activeCrate && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            padding: '6px 14px',
            background: 'var(--color-panel-strong)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: '#f0c060',
              letterSpacing: 0.2,
              flexShrink: 0,
            }}
          >
            {activeCrate.title}
          </span>
          {activeCrate.description && (
            <>
              <span
                aria-hidden
                style={{
                  color: 'rgba(220, 200, 160, 0.4)',
                  flexShrink: 0,
                }}
              >
                ·
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontStyle: 'italic',
                  color: 'rgba(220, 200, 160, 0.85)',
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
                title={activeCrate.description}
              >
                {activeCrate.description}
              </span>
            </>
          )}
        </div>
      )}
      {/* Top-right overflow badge — shows when the crate has more
          items than fit on the floor. */}
      {overflowCount > 0 && (
        <div className="absolute top-2 right-3 z-[60]">
          <span
            className="text-[11px] text-[#f4ebd9] bg-[rgba(40,20,20,0.85)] border border-[rgba(220,170,80,0.25)] rounded-full px-2.5 py-1"
            title={`총 ${activeCrate?.itemCount ?? 0}장 중 ${items.length}장 표시`}
          >
            +{overflowCount}장
          </span>
        </div>
      )}
      {/* Floor area — carpet asset on top, gradient fallback
          underneath. When /textures/carpet.webp is dropped in, the
          image wins (cover-fit); until then the layered gradients
          below still render so the surface is never blank. Both
          layers share the same aspect ratio + render area so the
          owner-placed record coordinates land in the same spots
          either way. */}
      <div
        ref={floorRef}
        style={{
          position: 'relative',
          width: '100%',
          // Aspect ratio is the contract that keeps the same record
          // positions reading identically across viewports. Don't add
          // a minHeight here — it would override the aspect ratio at
          // narrow widths and break the "same picture, different
          // size" promise.
          aspectRatio: '16 / 11',
          backgroundImage: [
            // Carpet asset (cover-fit). Falls through to the
            // gradient layers below when the file is missing — no
            // alt text needed since this is decoration.
            "url('/textures/carpet.webp')",
            // Repeating geometric border — narrow band of light-on-
            // dark dashes along the edges, suggestive of a kilim
            // pattern without trying to be literal. (Earlier passes
            // also painted a centre medallion + outer vignette via
            // radial-gradients but those read as a spotlight on the
            // carpet — pulled 2026-05-18.)
            'repeating-linear-gradient(45deg, rgba(220,170,80,0.08) 0 6px, transparent 6px 12px)',
            // Carpet ground
            'linear-gradient(135deg, #6a1d1d 0%, #4a1212 100%)',
          ].join(', '),
          backgroundSize: 'cover, auto, auto',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Digman 마스코트 — bottom-right of the carpet, hardhat
            character "digging" through the records. Sized to
            ~10% of the carpet width so it's a presence without
            crowding the floor; pointer-events none so it never
            intercepts a drag. */}
        <img
          src="/textures/digman_digging.webp"
          alt=""
          aria-hidden
          draggable={false}
          style={{
            position: 'absolute',
            right: '2%',
            bottom: '2%',
            width: '10%',
            minWidth: 56,
            maxWidth: 110,
            height: 'auto',
            pointerEvents: 'none',
            zIndex: 30,
            opacity: 0.92,
          }}
        />
        {detail.isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 13,
            }}
          >
            박스 꺼내는 중…
          </div>
        )}
        {!detail.isLoading && items.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.35)',
              fontSize: 13,
              padding: 16,
              textAlign: 'center',
            }}
          >
            이 박스는 아직 비어있어요.
          </div>
        )}
        {renderItems.map((r) => {
          const isThisDragging = drag?.albumId === r.item.id;
          const z = zOrder.get(r.item.id) ?? 0;
          return (
            <FloorRecord
              key={r.item.id}
              item={r.item}
              x={isThisDragging ? drag!.currentX : r.x}
              y={isThisDragging ? drag!.currentY : r.y}
              rotation={r.rotation}
              sizePx={recordSize}
              isOwner={isOwner}
              isDragging={isThisDragging}
              zOrder={z}
              onPointerDown={
                isOwner ? (e) => handleRecordPointerDown(r.item, e) : undefined
              }
              onRemove={
                isOwner && activeCrateId != null
                  ? () =>
                      removeFromCrate.mutate({
                        crateId: activeCrateId,
                        albumId: r.item.id,
                      })
                  : undefined
              }
            />
          );
        })}
      </div>
      {/* Crate bar pinned at bottom of the left column. Owner can
          drag chips to reorder (position 0 is the leftmost / default
          open for visitors), ✏️ on the active chip opens the edit
          modal; visitors get plain click-to-select. */}
      <CrateBar
        ref={crateBarRef}
        crates={crates}
        activeCrateId={activeCrateId}
        onSelect={setActiveCrateId}
        highlightedDropId={drag?.hoverCrateId ?? null}
        isOwner={isOwner}
        onReorder={(orderedIds) => reorderCrates.mutate(orderedIds)}
        onCreate={(title) => {
          // Create + auto-select. The mutation refetches the crate
          // list; once the new id lands in props, switching active
          // makes the new crate the spilled one immediately.
          void createCrate
            .mutateAsync({ title })
            .then((c) => setActiveCrateId(c.id))
            .catch((err) => {
              alert(err?.response?.data?.error || '박스 만들기 실패');
            });
        }}
        onEditCrate={(crateId) => setEditingCrateId(crateId)}
      />
      </div>

      {/* Right column — toaster tools (search / preview / download)
          + the guestbook. The toaster tools collapse with the
          previewCollapsed flag; the guestbook stays so visitors
          always have somewhere to leave a note even when the owner
          has the export tools hidden. Operator iter 2026-05-18:
          guestbook moved out of its full-width below-the-grid slot
          and into this column. Mobile-specific iter 2026-05-18:
          the right column stacks below the carpet on mobile, where
          the toaster tools push the guestbook well below the fold.
          On mobile we default them closed behind a toggle; desktop
          renders them inline as before. */}
      {activeCrateId != null && activeCrate && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {isMobile && (
            <button
              type="button"
              onClick={() => setToasterToolsOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--color-panel-strong)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                borderRadius: 8,
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
              }}
              aria-expanded={toasterToolsOpen}
            >
              <span>토스터 만들기</span>
              <span aria-hidden="true">{toasterToolsOpen ? '▴' : '▾'}</span>
            </button>
          )}
          {(!isMobile || toasterToolsOpen) && (
            <>
              {isOwner && (
                <AddAlbumSearch
                  activeCrateId={activeCrateId}
                  activeCrateTitle={activeCrate.title}
                />
              )}
              <LiveToasterPreview items={items} />
              {/* Toaster export actions — explicit "make a toaster
                  from THIS arrangement" + a page-share link. The page
                  share lives here now (removed from the MyDig header)
                  so both export-style actions cluster in one place. */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <ToasterButton
                  path={`/api/mydig/crates/${activeCrateId}/toaster.png`}
                  filenameHint={`${username}-${activeCrate.title}-toaster.png`}
                  variant={isOwner ? 'prominent' : 'default'}
                  label="이 배열로 토스터 만들기"
                />
                {/* Toaster IMAGE share. Mobile (coarse pointer + Web
                    Share API w/ files): opens the OS share sheet with
                    the PNG file → Instagram / KakaoTalk / Photos. Desktop
                    or no-share-support: copies the resolved PNG URL to
                    clipboard. resolveApiUrl prefixes API_BASE so split-
                    origin deploys produce a full URL the recipient can
                    hit. */}
                <ShareButton
                  url={
                    resolveApiUrl(
                      `/api/mydig/crates/${activeCrateId}/toaster.png`
                    ) ?? `/api/mydig/crates/${activeCrateId}/toaster.png`
                  }
                  imageUrl={
                    resolveApiUrl(
                      `/api/mydig/crates/${activeCrateId}/toaster.png`
                    ) ?? `/api/mydig/crates/${activeCrateId}/toaster.png`
                  }
                  imageFilename={`${username}-${activeCrate.title}-toaster.png`}
                  label="공유"
                />
              </div>
            </>
          )}
          <Guestbook
            crateId={activeCrateId}
            crateTitle={activeCrate.title}
            isOwner={isOwner}
          />
        </div>
      )}
    </div>
    {/* Edit modal — opens when ✏️ on the active chip fires.
        Looked up against the current crates list rather than
        re-fetching, so the modal's title / description inputs
        seed from whatever the bar already showed. */}
    {editingCrateId != null &&
      (() => {
        const editing = crates.find((c) => c.id === editingCrateId);
        if (!editing) return null;
        return (
          <CrateEditModal
            crate={editing}
            onClose={() => setEditingCrateId(null)}
          />
        );
      })()}
    </div>
  );
}
