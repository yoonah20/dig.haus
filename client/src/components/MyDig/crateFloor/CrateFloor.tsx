import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAddToCrate,
  useCrateDetail,
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
const PREVIEW_COLLAPSED_KEY = 'mydig:crateFloor:previewCollapsed';

export default function CrateFloor({ username, isOwner }: Props) {
  const cratesQuery = useUserCrates(username);
  const navigate = useNavigate();

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

  // Toaster preview collapse — owner-driven affordance for the case
  // where you don't care about the export and want the carpet to use
  // the full row. Persisted across visits.
  const [previewCollapsed, setPreviewCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(PREVIEW_COLLAPSED_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      PREVIEW_COLLAPSED_KEY,
      previewCollapsed ? '1' : '0'
    );
  }, [previewCollapsed]);

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
        setLocalLayouts((prev) => {
          const next = new Map(prev);
          next.set(cur.albumId, {
            x: cur.currentX,
            y: cur.currentY,
            rotation: cur.rotation,
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
      // Scale: 110 → 180 across 320 → 1100 px viewport. Min stays
      // generous on mobile; max bumped so a wide desktop floor
      // really feels like LP-sized records.
      const target = Math.max(110, Math.min(180, Math.round(w * 0.16)));
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

  // Right column always reserved when there's an active crate so the
  // guestbook (which lives in that column now) keeps its place
  // regardless of the toaster's collapse state. "토스터 접기" hides
  // the toaster tools (search / preview / download) inside the
  // column but doesn't widen the floor — the guestbook still needs
  // somewhere to live.
  const gridCols =
    activeCrateId != null && activeCrate
      ? 'grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px]'
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
          background: '#1a1614',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
      {/* Top-right chip row — overflow badge (when crate has more
          items than fit on the floor) + the toaster-expand button
          (only when the preview is collapsed). Both float free of
          the carpet so they don't fight the records for space. */}
      <div className="absolute top-2 right-3 z-[60] flex items-center gap-2">
        {overflowCount > 0 && (
          <span
            className="text-[11px] text-[#f4ebd9] bg-[rgba(40,20,20,0.85)] border border-[rgba(220,170,80,0.25)] rounded-full px-2.5 py-1"
            title={`총 ${activeCrate?.itemCount ?? 0}장 중 ${items.length}장 표시`}
          >
            +{overflowCount}장
          </span>
        )}
        {previewCollapsed && (
          <button
            type="button"
            onClick={() => setPreviewCollapsed(false)}
            className="text-[11px] text-[#f4ebd9] hover:text-white bg-[rgba(40,20,20,0.85)] border border-[rgba(220,170,80,0.4)] hover:border-[rgba(220,170,80,0.8)] rounded-full px-2.5 py-1 cursor-pointer transition-colors"
            title="토스터 펴기"
          >
            🖼 토스터
          </button>
        )}
      </div>
      {/* Floor area — Persian carpet feel via layered gradients
          (no asset). Wine ground, soft central medallion, darker
          outer border zone, plus a thin gold inner frame inside
          the carpet edge. Records float on top in normalised
          [0, 1] space. */}
      <div
        ref={floorRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 11',
          minHeight: 520,
          backgroundImage: [
            // Central medallion — warm gold glow
            'radial-gradient(ellipse 38% 30% at 50% 50%, rgba(190, 140, 60, 0.18), transparent 65%)',
            // Medallion inner pool — slight darker contrast so the
            // gold reads as a halo around something
            'radial-gradient(ellipse 18% 14% at 50% 50%, rgba(30, 10, 10, 0.35), transparent 75%)',
            // Outer fade to deep border zone
            'radial-gradient(ellipse 95% 95% at 50% 50%, transparent 60%, rgba(0,0,0,0.45))',
            // Repeating geometric border — narrow band of light-on-
            // dark dashes along the edges, suggestive of a kilim
            // pattern without trying to be literal
            'repeating-linear-gradient(45deg, rgba(220,170,80,0.08) 0 6px, transparent 6px 12px)',
            // Carpet ground
            'linear-gradient(135deg, #6a1d1d 0%, #4a1212 100%)',
          ].join(', '),
          boxShadow:
            'inset 0 0 0 1px rgba(220,170,80,0.25), inset 0 0 0 12px rgba(0,0,0,0.18), inset 0 0 0 14px rgba(220,170,80,0.15)',
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
          open for visitors); visitors get plain click-to-select. */}
      <CrateBar
        ref={crateBarRef}
        crates={crates}
        activeCrateId={activeCrateId}
        onSelect={setActiveCrateId}
        highlightedDropId={drag?.hoverCrateId ?? null}
        isOwner={isOwner}
        onReorder={(orderedIds) => reorderCrates.mutate(orderedIds)}
      />
      </div>

      {/* Right column — toaster tools (search / preview / download)
          + the guestbook. The toaster tools collapse with the
          previewCollapsed flag; the guestbook stays so visitors
          always have somewhere to leave a note even when the owner
          has the export tools hidden. Operator iter 2026-05-18:
          guestbook moved out of its full-width below-the-grid slot
          and into this column. */}
      {activeCrateId != null && activeCrate && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {!previewCollapsed && (
            <>
              {/* Collapse handle — quiet button at the top of the
                  column so the gesture mirrors the floor-side
                  expand chip. */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setPreviewCollapsed(true)}
                  className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer"
                  title="토스터 접기"
                >
                  ✕ 토스터 접기
                </button>
              </div>
              {isOwner && (
                <AddAlbumSearch
                  activeCrateId={activeCrateId}
                  activeCrateTitle={activeCrate.title}
                />
              )}
              <LiveToasterPreview items={items} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <ToasterButton
                  path={`/api/mydig/crates/${activeCrateId}/toaster.png`}
                  filenameHint={`${username}-${activeCrate.title}-toaster.png`}
                  variant={isOwner ? 'prominent' : 'default'}
                  label="다운로드"
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
    </div>
  );
}
