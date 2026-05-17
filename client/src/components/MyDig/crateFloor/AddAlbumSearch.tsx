import { useEffect, useRef, useState } from 'react';
import { useSearch } from '../../../hooks/useSearch';
import { useAddToCrate } from '../../../hooks/useCrates';
import CoverArt from '../../CoverArt';

// Inline album search on mydig — owner-only path to add an album
// directly to the currently-open crate without bouncing through the
// album page. Debounced DB-only search (same /api/albums/search
// endpoint the homepage SearchBar uses), 8 results max, click a
// hit to insert. The active crate is the parent's responsibility
// to track and pass through.
//
// Lives in the right column above the live toaster preview so it
// reads as "this is the make-something happen surface" while the
// preview reads as "this is what it'll look like."

interface Props {
  activeCrateId: number;
  activeCrateTitle: string;
}

export default function AddAlbumSearch({ activeCrateId, activeCrateTitle }: Props) {
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  // 200ms debounce — same shape as the home SearchBar so the rate
  // limiter behaves identically.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(raw.trim()), 200);
    return () => window.clearTimeout(id);
  }, [raw]);

  const search = useSearch(debounced);
  const add = useAddToCrate();

  // Close dropdown on outside click. Pointerdown beats click for
  // touch — same pattern as CrateButton.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(
    () => () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };

  const handlePick = async (album: { id?: number; title: string }) => {
    if (album.id == null) {
      // Defensive — DB search results always carry id, but the
      // shared AlbumSearchResult shape has it optional.
      showToast('이 앨범은 추가할 수 없어요.');
      return;
    }
    try {
      await add.mutateAsync({ crateId: activeCrateId, albumId: album.id });
      showToast(`"${album.title}" 담았어요`);
      setRaw('');
      setOpen(false);
    } catch (err: any) {
      showToast(err?.response?.data?.error || '담기 실패');
    }
  };

  const hits = (search.data?.albums ?? []).slice(0, 8);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={`${activeCrateTitle}에 앨범 담기`}
        className="w-full bg-background/60 border border-white/10 focus:border-accent/60 rounded-md px-3 py-2 text-[13px] text-gray-200 placeholder:text-gray-500 outline-none transition-colors"
      />
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute left-0 right-0 top-full mt-1 px-3 py-1.5 rounded-md text-[12px] text-panel-strong bg-accent shadow-lg pointer-events-none"
        >
          {toast}
        </div>
      )}
      {open && debounced.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-[300px] overflow-y-auto rounded-md border border-white/10 bg-panel-strong shadow-xl"
        >
          {search.isLoading && (
            <div className="px-3 py-2 text-[12px] text-gray-500">검색 중…</div>
          )}
          {!search.isLoading && hits.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-gray-500">
              검색 결과가 없어요.
            </div>
          )}
          {hits.map((a) => (
            <button
              key={a.mbid}
              type="button"
              onClick={() => void handlePick(a)}
              disabled={add.isPending}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  background: '#0a0703',
                  overflow: 'hidden',
                  borderRadius: 2,
                }}
              >
                <CoverArt
                  src={a.coverArtUrl}
                  fallbacks={a.coverArtFallbacks ?? []}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-gray-200">{a.title}</div>
                <div className="truncate text-[11px] text-gray-500">
                  {a.artist}
                  {a.year ? ` · ${a.year}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
