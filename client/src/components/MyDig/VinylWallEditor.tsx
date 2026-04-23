import { useEffect, useRef, useState } from 'react';
import CoverArt from '../CoverArt';
import QuickRegister from './QuickRegister';
import SnapshotSaveModal from './SnapshotSaveModal';
import {
  useMyDigCandidates,
  useSaveVinylWall,
  type MyDigAlbum,
  type MyDigCandidate,
  type MyDigCandidateSource,
  type MyDigWallItem,
} from '../../hooks/useMyDig';

// Phase 3b — Vinyl Wall edit mode. 80/20 split, native HTML5
// drag-drop on desktop, tap-to-select + tap-slot on touch. Edit
// state lives entirely in-memory here; submit button pushes the
// full 15-slot array to PUT /api/mydig/vinyl-wall/items (bulk
// replace in a transaction server-side). Cancel resets to the
// server snapshot.

const WALL_ROW_SIZES = [5, 5, 5] as const;
const WALL_TOTAL = 15;

type DraftSlot = MyDigAlbum | null;

interface Props {
  username: string;
  initialWall: MyDigWallItem[];
  onClose: () => void;
}

export default function VinylWallEditor({ username, initialWall, onClose }: Props) {
  // Hydrate the 22-element draft array from the sparse server payload.
  const [draft, setDraft] = useState<DraftSlot[]>(() => {
    const arr: DraftSlot[] = new Array(WALL_TOTAL).fill(null);
    for (const it of initialWall) {
      if (it.position >= 0 && it.position < WALL_TOTAL) {
        arr[it.position] = it.album;
      }
    }
    return arr;
  });

  const [source, setSource] = useState<MyDigCandidateSource>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  // Selection state for the click/tap path (mobile primary, desktop
  // secondary-to-drag). A selected album can originate either from the
  // right-side candidate panel (`selectedSource === null`) or from an
  // occupied wall slot (`selectedSource === <position>`). The source
  // distinguishes placement semantics: panel → place-or-overwrite,
  // wall → swap. This replaces the older single-field selection that
  // only tracked the album and treated every tap as "overwrite", which
  // left wall-to-wall rearrangement unreachable for non-drag users.
  const [selectedAlbum, setSelectedAlbum] = useState<MyDigAlbum | null>(null);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  // While native drag-drop is in flight, this holds the source
  // position (if reordering from inside the wall) or `-1` for
  // drags originating in the candidate panel. Only used so
  // dragover highlights skip the same-slot-no-op case.
  const dragSource = useRef<number | null>(null);

  // Debounce search input so every keystroke doesn't hit the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const candidates = useMyDigCandidates(source, debouncedQ, true);
  const save = useSaveVinylWall(username);

  // Snapshot-from-draft flow. Opening the save modal captures the
  // current draft into a server snapshot without touching the live
  // wall. After it saves, a follow-up prompt asks whether to commit
  // the draft to the wall or roll back to what the wall was when
  // the editor opened.
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [postSnapshotPrompt, setPostSnapshotPrompt] = useState(false);
  const [revertPending, setRevertPending] = useState(false);

  const dirty = draft.some((slot, idx) => {
    const serverItem = initialWall.find((it) => it.position === idx);
    if (!slot && !serverItem) return false;
    if (!slot || !serverItem) return true;
    return slot.id !== serverItem.album.id;
  });

  // Draft → flat items payload, shared by wall-save and
  // snapshot-from-draft paths.
  const draftItems = () =>
    draft
      .map((slot, position) =>
        slot ? { position, albumId: slot.id } : null
      )
      .filter((x): x is { position: number; albumId: number } => x !== null);

  const handleSave = async () => {
    if (save.isPending) return;
    try {
      await save.mutateAsync(draftItems());
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const handleCancel = () => {
    if (save.isPending) return;
    if (dirty && !confirm('편집 내용을 버리고 닫을까요?')) return;
    onClose();
  };

  const handleClearAll = () => {
    // Fast path to a scratch wall — the owner typically hits this
    // right before building a themed snapshot that has nothing to
    // do with what's currently on the live wall. Confirm when the
    // current draft already has anything on it so the click isn't
    // destructive.
    const hasAnything = draft.some((s) => s != null);
    if (hasAnything && !confirm('벽의 15장을 모두 비울까요?')) return;
    setDraft(new Array(WALL_TOTAL).fill(null));
    clearSelection();
  };

  // Revert vs. keep, called after a snapshot save succeeds.
  const handleRevertAfterSnapshot = () => {
    // Discard the draft: re-hydrate from initialWall and close.
    // No server call — the editor opened against initialWall and
    // we haven't touched vinyl_wall_items yet, so the wall is
    // already at the "original" state the prompt promised.
    const reset: DraftSlot[] = new Array(WALL_TOTAL).fill(null);
    for (const it of initialWall) {
      if (it.position >= 0 && it.position < WALL_TOTAL) {
        reset[it.position] = it.album;
      }
    }
    setDraft(reset);
    setPostSnapshotPrompt(false);
    onClose();
  };

  const handleKeepAfterSnapshot = async () => {
    if (save.isPending || revertPending) return;
    setRevertPending(true);
    try {
      await save.mutateAsync(draftItems());
      setPostSnapshotPrompt(false);
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '벽 저장 실패');
    } finally {
      setRevertPending(false);
    }
  };

  const placeAtSlot = (targetPosition: number, album: MyDigAlbum) => {
    setDraft((prev) => {
      const next = [...prev];
      next[targetPosition] = album;
      return next;
    });
  };

  const swapSlots = (from: number, to: number) => {
    if (from === to) return;
    setDraft((prev) => {
      const next = [...prev];
      const tmp = next[from];
      next[from] = next[to];
      next[to] = tmp;
      return next;
    });
  };

  const clearSlot = (position: number) => {
    setDraft((prev) => {
      const next = [...prev];
      next[position] = null;
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedAlbum(null);
    setSelectedSource(null);
  };

  // Click/tap on a slot resolves against the current selection state.
  // Full table of the four cases the wall handles:
  //
  //   1. No selection + empty slot       → noop
  //   2. No selection + filled slot      → pick up (select from wall)
  //   3. Selection (this slot) + tap it  → deselect
  //   4. Selection + other slot
  //      - selectedSource === null       → place/overwrite (panel drop)
  //      - selectedSource is a position  → swap
  //
  // Path (2) is the one that was missing before — without it the click
  // flow could only place albums from the candidate panel and never
  // rearrange what was already on the wall.
  const handleSlotTap = (position: number) => {
    if (!selectedAlbum) {
      const pickup = draft[position];
      if (pickup) {
        setSelectedAlbum(pickup);
        setSelectedSource(position);
      }
      return;
    }
    if (selectedSource === position) {
      clearSelection();
      return;
    }
    if (selectedSource !== null) {
      swapSlots(selectedSource, position);
    } else {
      placeAtSlot(position, selectedAlbum);
    }
    clearSelection();
  };

  // Split 22 positions into 4 rows (5-5-6-6).
  let cursor = 0;
  const rows = WALL_ROW_SIZES.map((count) => {
    const positions = Array.from({ length: count }, (_, i) => cursor + i);
    cursor += count;
    return positions;
  });

  return (
    <div className="fixed inset-0 z-40 bg-[#0a0703] flex flex-col">
      {/* Header bar — title + dirty indicator on the left, build
          tools (🧹 다 지우기, 📸 스냅샷) in the middle, exit
          actions (취소, 저장) on the right. The snapshot button
          stays usable even when the draft is unsaved; the "save
          snapshot → revert or keep" prompt handles both outcomes
          on close. */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-[#12100d]">
        <div className="flex items-center gap-3">
          <span className="text-sm uppercase tracking-wider text-[#e8a020]">
            Vinyl Wall 편집
          </span>
          {dirty && (
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
              저장되지 않음
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={save.isPending || !draft.some((s) => s != null)}
            className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="벽의 15장 모두 비우기"
          >
            🧹 다 지우기
          </button>
          <button
            type="button"
            onClick={() => setSnapshotModalOpen(true)}
            disabled={save.isPending}
            className="text-xs text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-md px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="지금 상태를 스냅샷으로 저장"
          >
            📸 스냅샷
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <button
            type="button"
            onClick={handleCancel}
            disabled={save.isPending}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={save.isPending || !dirty}
            className="text-xs font-medium text-[#e8a020] border border-[#e8a020]/60 hover:bg-[#e8a020]/10 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </header>

      {/* 80 / 20 split layout — the main "mydig" side stays full
          width on mobile (picker collapses into a bottom drawer
          via flex-col reverse). Desktop gets the proper split. */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[780px] mx-auto flex flex-col gap-3 sm:gap-4">
            {rows.map((positions, rowIdx) => (
              <div
                key={rowIdx}
                // 5-column grid matches WALL_ROW_SIZES (5/5/5). An
                // earlier iteration used 6 columns from the 5-5-6-6
                // era, leaving an empty right-hand column that made
                // the records look left-aligned instead of centered.
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                }}
                className="gap-3 sm:gap-4"
              >
                {positions.map((position) => {
                  return (
                    <div key={position} className="w-full aspect-square">
                      <EditWallSlot
                        position={position}
                        album={draft[position]}
                        isSelecting={!!selectedAlbum}
                        isSelectedSource={selectedSource === position}
                        dragSource={dragSource}
                        onDropAlbum={(album) => placeAtSlot(position, album)}
                        onSwap={swapSlots}
                        onClear={clearSlot}
                        onTap={() => handleSlotTap(position)}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </main>

        <aside className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-white/5 bg-[#12100d] flex flex-col max-h-[50vh] lg:max-h-none">
          {/* Source tabs. 굿굿 first surfaces albums the user has
              already endorsed — a natural starting point for wall
              curation. 살거 was dropped: the wall is identity
              expression, not shopping list. '내 상자' renames the
              earlier '내 Crate' to match dig.haus's Korean lexicon. */}
          <div className="flex border-b border-white/5 text-xs">
            {([
              { key: 'upvote', label: '굿굿' },
              { key: 'collection', label: '샀음' },
              { key: 'crate', label: '내 상자' },
              { key: 'all', label: '전체' },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSource(t.key)}
                className={`flex-1 px-2 py-2 transition-colors cursor-pointer ${
                  source === t.key
                    ? 'text-[#e8a020] border-b-2 border-[#e8a020]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Quick-register appears only on the 전체 tab — the other
              three tabs are filtered views of the user's own
              collections, where "this album isn't in dig.haus yet"
              doesn't apply. */}
          {source === 'all' && <QuickRegister />}

          <div className="p-3 border-b border-white/5">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="아티스트 / 앨범 검색"
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none"
            />
            {selectedAlbum ? (
              <div className="mt-2 text-[11px] text-[#e8a020]">
                선택됨: {selectedAlbum.title}
                {selectedSource !== null
                  ? ' — 다른 슬롯 탭으로 교환'
                  : ' — 슬롯 탭으로 배치'}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-gray-600 leading-snug">
                앨범을 <span className="text-gray-400">드래그</span>해서 벽에 놓거나,
                슬롯/앨범을 탭해 선택 후 다른 슬롯을 탭하세요.
              </div>
            )}
          </div>

          <CandidateList
            candidates={candidates}
            selectedAlbum={selectedAlbum}
            selectedSource={selectedSource}
            onSelectAlbum={(album) => {
              // Picking from the candidate panel while a wall slot is
              // already selected replaces the selection — the user's
              // most recent gesture wins, and the previous wall source
              // just goes back to its slot untouched.
              if (
                selectedAlbum?.id === album.id &&
                selectedSource === null
              ) {
                clearSelection();
                return;
              }
              setSelectedAlbum(candidateToAlbum(album));
              setSelectedSource(null);
            }}
            dragSource={dragSource}
            debouncedQ={debouncedQ}
          />
        </aside>
      </div>

      {snapshotModalOpen && (
        <SnapshotSaveModal
          username={username}
          items={draftItems()}
          onClose={() => setSnapshotModalOpen(false)}
          onSaved={() => {
            setSnapshotModalOpen(false);
            setPostSnapshotPrompt(true);
          }}
        />
      )}

      {postSnapshotPrompt && (
        <RevertOrKeepPrompt
          pending={revertPending || save.isPending}
          onRevert={handleRevertAfterSnapshot}
          onKeep={handleKeepAfterSnapshot}
        />
      )}
    </div>
  );
}

function RevertOrKeepPrompt({
  pending,
  onRevert,
  onKeep,
}: {
  pending: boolean;
  onRevert: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5">
        <h2 className="text-lg text-white font-serif italic mb-1">
          스냅샷 저장됨
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          원래 벽으로 돌아갈까요? 예를 선택하면 편집 전 상태로 돌아가고,
          아니요를 선택하면 지금 상태가 벽에 그대로 남아요.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onKeep}
            disabled={pending}
            className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-md border border-white/10 hover:border-white/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? '저장 중…' : '아니요, 이 상태 유지'}
          </button>
          <button
            type="button"
            onClick={onRevert}
            disabled={pending}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/60 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            네, 원래대로
          </button>
        </div>
      </div>
    </div>
  );
}

function candidateToAlbum(c: MyDigCandidate): MyDigAlbum {
  return {
    id: c.id,
    mbid: c.mbid,
    slug: c.slug,
    title: c.title,
    artist: c.artist,
    releaseYear: c.releaseYear,
    coverArtUrl: c.coverArtUrl,
    coverArtFallbacks: c.coverArtFallbacks ?? [],
  };
}

function EditWallSlot({
  position,
  album,
  isSelecting,
  isSelectedSource,
  dragSource,
  onDropAlbum,
  onSwap,
  onClear,
  onTap,
}: {
  position: number;
  album: MyDigAlbum | null;
  isSelecting: boolean;
  isSelectedSource: boolean;
  dragSource: React.MutableRefObject<number | null>;
  onDropAlbum: (album: MyDigAlbum) => void;
  onSwap: (from: number, to: number) => void;
  onClear: (position: number) => void;
  onTap: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);

  // Native dragstart listener. React's synthetic onDragStart
  // doesn't fire reliably here (confirmed via tracing) — binding
  // through addEventListener bypasses the synthetic event system
  // and fires when the browser initiates the drag. Other drag
  // phases (over, leave, drop, end) stay on React handlers.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !album) return;
    const handler = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      dragSource.current = position;
      e.dataTransfer.effectAllowed = 'move';
      const payload = JSON.stringify({
        ...album,
        _sourcePosition: position,
      });
      e.dataTransfer.setData('application/x-mydig-album', payload);
      // text/plain fallback — some browsers refuse to enter the
      // drop phase unless a standard type is present.
      e.dataTransfer.setData('text/plain', payload);
    };
    el.addEventListener('dragstart', handler);
    return () => el.removeEventListener('dragstart', handler);
  }, [album, position, dragSource]);

  const handleDragOver = (e: React.DragEvent) => {
    if (dragSource.current === position) return;
    e.preventDefault();
    // Match dropEffect to the source's effectAllowed. A copy-from-
    // candidate (source = -1) must show dropEffect='copy' or the
    // browser rejects the drop outright and onDrop never fires.
    // Slot-to-slot drags are semantically moves.
    e.dataTransfer.dropEffect = dragSource.current === -1 ? 'copy' : 'move';
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data =
      e.dataTransfer.getData('application/x-mydig-album') ||
      e.dataTransfer.getData('text/plain');
    if (!data) {
      dragSource.current = null;
      return;
    }
    try {
      const payload = JSON.parse(data) as MyDigAlbum & { _sourcePosition?: number };
      if (typeof payload._sourcePosition === 'number') {
        onSwap(payload._sourcePosition, position);
      } else {
        onDropAlbum(payload);
      }
    } catch {
      /* malformed payload; ignore */
    }
    dragSource.current = null;
  };

  const handleDragEnd = () => {
    dragSource.current = null;
  };

  const baseClass =
    'relative w-full h-full rounded-md overflow-hidden transition-all group';
  // Highlight priority: dragOver (hovering a drop target) > selected
  // source (click/tap selection) > filled > empty. DragOver borrows the
  // same amber ring as selection — both signal "this slot is active"
  // and reusing the look keeps the edit canvas quiet. Selected source
  // dims the slot so the picked-up album visually "lifts off" the wall
  // while the user decides where to drop it.
  const stateClass = dragOver
    ? 'ring-2 ring-[#e8a020] ring-offset-2 ring-offset-[#0a0703]'
    : isSelectedSource
      ? 'ring-2 ring-[#e8a020] ring-offset-2 ring-offset-[#0a0703] opacity-60'
      : album
        ? 'bg-[#1a1a1a]'
        : `border border-dashed bg-white/[0.02] ${
            isSelecting ? 'border-[#e8a020]/60 hover:border-[#e8a020]' : 'border-white/10'
          }`;

  // Single element handles both drag source (when the slot holds an
  // album) and drop target. The earlier nested `<div draggable>`
  // inside the drop-target div was failing to fire its onDragStart
  // in some browsers — the browser would start a native drag on the
  // element, bypassing React's synthetic onDragStart, so setData()
  // never ran and drop received an empty payload. Collapsing to one
  // div gets React's event delegation to reliably catch dragstart.
  return (
    <div
      ref={slotRef}
      draggable={!!album}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={onTap}
      className={`${baseClass} ${stateClass} ${
        album ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {album ? (
        <>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear(position);
            }}
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-[11px] bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500 transition-opacity"
            aria-label="이 슬롯 비우기"
          >
            ×
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-700">
          {position + 1}
        </div>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  selectedAlbum,
  selectedSource,
  onSelectAlbum,
  dragSource,
  debouncedQ,
}: {
  candidates: ReturnType<typeof useMyDigCandidates>;
  selectedAlbum: MyDigAlbum | null;
  selectedSource: number | null;
  onSelectAlbum: (album: MyDigCandidate) => void;
  dragSource: React.MutableRefObject<number | null>;
  debouncedQ: string;
}) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = candidates;
  // Flatten all pages into one sequence for rendering. React Query
  // keeps pages across paginations so already-loaded rows don't
  // re-render as the user scrolls.
  const albums = data?.pages.flatMap((p) => p.albums) ?? [];

  // Sentinel at the end of the list — when it intersects the
  // scroll container, request the next page. Fetch is guarded by
  // hasNextPage + isFetchingNextPage so we never over-request.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }
      },
      { rootMargin: '120px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 text-xs text-gray-500">로딩 중…</div>
      </div>
    );
  }
  if (albums.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 text-xs text-gray-500">
          {debouncedQ ? '검색 결과 없음' : '항목 없음'}
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto divide-y divide-white/5">
      {albums.map((album) => (
        <CandidateRow
          key={album.id}
          album={album}
          // Only highlight a candidate row when the selection
          // specifically originated from the panel (source === null).
          // A wall-origin selection of the same album elsewhere
          // shouldn't light up the candidate row — they're different
          // actions even though the album id matches.
          isSelected={
            selectedAlbum?.id === album.id && selectedSource === null
          }
          onSelect={() => onSelectAlbum(album)}
          dragSource={dragSource}
        />
      ))}
      {/* Sentinel row at the very bottom. Takes minimal space but
          is tall enough for the IntersectionObserver to reliably
          fire as it scrolls into view. */}
      <div ref={sentinelRef} className="h-8 flex items-center justify-center">
        {isFetchingNextPage && (
          <span className="text-[10px] text-gray-600">더 불러오는 중…</span>
        )}
        {!hasNextPage && albums.length > 20 && (
          <span className="text-[10px] text-gray-700">더 없음</span>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  album,
  isSelected,
  onSelect,
  dragSource,
}: {
  album: MyDigCandidate;
  isSelected: boolean;
  onSelect: () => void;
  dragSource: React.MutableRefObject<number | null>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Same native dragstart workaround as EditWallSlot.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const handler = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      dragSource.current = -1;
      e.dataTransfer.effectAllowed = 'copy';
      const payload = JSON.stringify(candidateToAlbum(album));
      e.dataTransfer.setData('application/x-mydig-album', payload);
      e.dataTransfer.setData('text/plain', payload);
    };
    el.addEventListener('dragstart', handler);
    return () => el.removeEventListener('dragstart', handler);
  }, [album, dragSource]);

  const handleDragEnd = () => {
    dragSource.current = null;
  };

  return (
    <div
      ref={rowRef}
      draggable
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      // cursor-grab signals the row is draggable; it flips to
      // grabbing while the drag is in flight via active:cursor.
      className={`p-2 flex items-center gap-2 cursor-grab active:cursor-grabbing transition-colors ${
        isSelected ? 'bg-[#e8a020]/15' : 'hover:bg-white/5'
      }`}
    >
      <CoverArt
        src={album.coverArtUrl}
        fallbacks={album.coverArtFallbacks}
        alt={album.title}
        className="w-10 h-10 rounded object-cover flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white font-medium truncate">{album.title}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {album.artist}
          {album.releaseYear ? ` · ${album.releaseYear}` : ''}
        </div>
      </div>
    </div>
  );
}
