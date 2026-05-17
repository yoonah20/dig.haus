import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useAddToCrate,
  useCrateDetail,
  useUpdateCrateItemLayout,
  useUserCrates,
  type CrateItem,
} from '../../../hooks/useCrates';
import FloorRecord from './FloorRecord';
import CrateBar, { type CrateBarHandle } from './CrateBar';
import { defaultFlowPosition } from './layout';

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
}

const ACTIVE_KEY = 'mydig:crateFloor:activeCrateId';

export default function CrateFloor({ username, isOwner }: Props) {
  const cratesQuery = useUserCrates(username);

  const crates = cratesQuery.data?.crates ?? [];

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

  // Pick a sensible active crate when the list loads or when the
  // saved one is no longer accessible (e.g. visitor where the crate
  // is private). Always prefer 굿굿 (the canonical 좋아함 surface)
  // when nothing else applies.
  useEffect(() => {
    if (crates.length === 0) return;
    const exists = activeCrateId != null && crates.some((c) => c.id === activeCrateId);
    if (exists) return;
    const goodgood = crates.find((c) => c.title === '굿굿');
    setActiveCrateId(goodgood?.id ?? crates[0].id);
  }, [crates, activeCrateId]);

  useEffect(() => {
    if (activeCrateId != null && typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_KEY, String(activeCrateId));
    }
  }, [activeCrateId]);

  const detail = useCrateDetail(activeCrateId);
  const items = detail.data?.items ?? [];

  const updateLayout = useUpdateCrateItemLayout();
  const addToCrate = useAddToCrate();

  // Owner-local optimistic layout cache. Persists positions across
  // refetch and lets drag stay responsive while the PATCH is in
  // flight. Keyed by albumId because that's stable across crates
  // (an album in 굿굿 and 별루 still shares the visual identity).
  // Reset when active crate changes so old positions don't leak.
  const [localLayouts, setLocalLayouts] = useState<LocalLayoutMap>(new Map());
  useEffect(() => {
    setLocalLayouts(new Map());
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
      setDrag({
        ...cur,
        currentX: Math.max(0, Math.min(1, nx)),
        currentY: Math.max(0, Math.min(1, ny)),
        hoverCrateId: hover,
      });
    };
    const onUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const droppedOn = crateBarRef.current?.hitTestAtClient(e.clientX, e.clientY) ?? null;
      if (droppedOn != null && droppedOn !== activeCrateId) {
        // Drop into another crate — adds membership but doesn't
        // remove from the source. The record visually returns to
        // its prior position (no layout change) since it's still in
        // the active crate too. Local layout already has it where
        // the owner placed it last; nothing to do beyond the POST.
        addToCrate.mutate({ crateId: droppedOn, albumId: cur.albumId });
      } else {
        // Commit the new free position to the active crate. Local
        // layout overrides server until the refetch lands.
        setLocalLayouts((prev) => {
          const next = new Map(prev);
          next.set(cur.albumId, {
            x: cur.currentX,
            y: cur.currentY,
            rotation: cur.rotation,
          });
          return next;
        });
        if (activeCrateId != null) {
          updateLayout.mutate({
            crateId: activeCrateId,
            albumId: cur.albumId,
            positionX: cur.currentX,
            positionY: cur.currentY,
            rotation: cur.rotation,
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
  }, [drag, activeCrateId, addToCrate, updateLayout]);

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

  // Record size — slightly smaller on narrow viewports so 30 records
  // breathe. Tied to the floor's measured width; default to 120px
  // before the first layout pass.
  const [recordSize, setRecordSize] = useState(120);
  useLayoutEffect(() => {
    const el = floorRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      // Scale: 96 → 140 across 320 → 1100 px viewport.
      const target = Math.max(80, Math.min(140, Math.round(w * 0.12)));
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
    });
    e.preventDefault();
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: '#1a1614',
        borderRadius: 12,
        overflow: 'hidden',
        // Subtle wood-tone floor cue — no full backdrop asset, just
        // a colour wash that says "this is a surface" without a
        // dedicated illustration.
        backgroundImage:
          'radial-gradient(ellipse at 50% 35%, rgba(80,55,30,0.35) 0%, rgba(0,0,0,0) 70%)',
      }}
    >
      {/* Floor area — fixed aspect, no scroll. Records absolutely
          positioned in normalised [0, 1] space. */}
      <div
        ref={floorRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 11',
          minHeight: 360,
        }}
      >
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
            상자 꺼내는 중…
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
            이 상자는 아직 비어있어요.
          </div>
        )}
        {renderItems.map((r) => {
          const isThisDragging = drag?.albumId === r.item.id;
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
              onPointerDown={
                isOwner ? (e) => handleRecordPointerDown(r.item, e) : undefined
              }
            />
          );
        })}
      </div>
      {/* Crate bar pinned at bottom. */}
      <CrateBar
        ref={crateBarRef}
        crates={crates}
        activeCrateId={activeCrateId}
        onSelect={setActiveCrateId}
        highlightedDropId={drag?.hoverCrateId ?? null}
      />
    </div>
  );
}
