import { useEffect, useRef, useState } from 'react';
import CoverArt from '../CoverArt';
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
  // Touch-fallback state: tap a candidate (or already-placed slot) →
  // it becomes `selected`, next tap on a slot resolves. Cancel by
  // tapping the same source again or pressing Esc.
  const [selectedAlbum, setSelectedAlbum] = useState<MyDigAlbum | null>(null);
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

  const dirty = draft.some((slot, idx) => {
    const serverItem = initialWall.find((it) => it.position === idx);
    if (!slot && !serverItem) return false;
    if (!slot || !serverItem) return true;
    return slot.id !== serverItem.album.id;
  });

  const handleSave = async () => {
    if (save.isPending) return;
    const items = draft
      .map((slot, position) =>
        slot ? { position, albumId: slot.id } : null
      )
      .filter((x): x is { position: number; albumId: number } => x !== null);
    try {
      await save.mutateAsync(items);
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

  // Touch-fallback flow: selectAlbum → user taps a slot → we place/swap.
  const handleSlotTap = (position: number) => {
    if (!selectedAlbum) return;
    placeAtSlot(position, selectedAlbum);
    setSelectedAlbum(null);
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
      {/* Header bar — title, dirty indicator, 저장/취소 actions. */}
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
          <div className="max-w-[900px] mx-auto flex flex-col gap-3 sm:gap-4">
            {rows.map((positions, rowIdx) => (
              <div
                key={rowIdx}
                // Inline grid declaration — see MyDig.tsx's VinylWallGrid
                // for why we stopped relying on Tailwind's grid-cols-6
                // utility (a few renders were collapsing to a single
                // vertical column).
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
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
          {/* Source tabs */}
          <div className="flex border-b border-white/5 text-xs">
            {([
              { key: 'all', label: '전체' },
              { key: 'collection', label: '샀음' },
              { key: 'wantlist', label: '살거' },
              { key: 'crate', label: '내 Crate' },
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

          <div className="p-3 border-b border-white/5">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="아티스트 / 앨범 검색"
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none"
            />
            {selectedAlbum && (
              <div className="mt-2 text-[11px] text-[#e8a020]">
                선택됨: {selectedAlbum.title} — 빈 슬롯을 탭해 배치하거나 ESC로 취소
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {candidates.isLoading ? (
              <div className="p-4 text-xs text-gray-500">로딩 중…</div>
            ) : (candidates.data?.albums.length ?? 0) === 0 ? (
              <div className="p-4 text-xs text-gray-500">
                {debouncedQ ? '검색 결과 없음' : '항목 없음'}
              </div>
            ) : (
              candidates.data!.albums.map((album) => (
                <CandidateRow
                  key={album.id}
                  album={album}
                  isSelected={selectedAlbum?.id === album.id}
                  onSelect={() =>
                    setSelectedAlbum((curr) =>
                      curr?.id === album.id ? null : candidateToAlbum(album)
                    )
                  }
                  dragSource={dragSource}
                />
              ))
            )}
          </div>
        </aside>
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
  dragSource,
  onDropAlbum,
  onSwap,
  onClear,
  onTap,
}: {
  position: number;
  album: MyDigAlbum | null;
  isSelecting: boolean;
  dragSource: React.MutableRefObject<number | null>;
  onDropAlbum: (album: MyDigAlbum) => void;
  onSwap: (from: number, to: number) => void;
  onClear: (position: number) => void;
  onTap: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    if (!album) return;
    dragSource.current = position;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-mydig-album',
      JSON.stringify({ ...album, _sourcePosition: position })
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (dragSource.current === position) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData('application/x-mydig-album');
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

  const baseClass =
    'relative w-full h-full rounded-md overflow-hidden transition-all group';
  const stateClass = dragOver
    ? 'ring-2 ring-[#e8a020] ring-offset-2 ring-offset-[#0a0703]'
    : album
      ? 'bg-[#1a1a1a]'
      : `border border-dashed bg-white/[0.02] ${
          isSelecting ? 'border-[#e8a020]/60 hover:border-[#e8a020]' : 'border-white/10'
        }`;

  return (
    <div
      className={`${baseClass} ${stateClass}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        // Tap routes: empty slot while selecting → place.
        if (!album && isSelecting) onTap();
      }}
    >
      {album ? (
        <div
          draggable
          onDragStart={handleDragStart}
          className="w-full h-full cursor-grab active:cursor-grabbing"
        >
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
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-700">
          {position + 1}
        </div>
      )}
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
  const handleDragStart = (e: React.DragEvent) => {
    dragSource.current = -1;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(
      'application/x-mydig-album',
      JSON.stringify(candidateToAlbum(album))
    );
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      className={`p-2 flex items-center gap-2 cursor-pointer transition-colors ${
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
