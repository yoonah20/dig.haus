import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import CoverArt from '../CoverArt';
import { useRequestSearch } from '../../hooks/useSearch';
import { useSubmitAlbumRequest } from '../../hooks/useAlbumRequests';

// Inline album registration for the Vinyl-Wall editor's "전체" tab.
// A tiny input + drawer reproduces the SearchBar's MusicBrainz /
// Discogs lookup and its [+] register action in the picker column,
// so the owner can add a missing album without leaving edit mode.
//
// Sort in the mydig candidates list is `albums.id DESC` (newest
// registration first), so invalidating the `mydig-candidates`
// query after a successful register pops the new row to the top —
// the owner can grab it and drop it on a wall slot in one gesture.
//
// Skipped admin's [⚡] auto-curation: edit-mode is a "keep me in
// flow" surface, and curation is a long-running background job
// that belongs on the dedicated admin panel, not inside a picker
// drawer.
export default function QuickRegister() {
  const [input, setInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingMbid, setPendingMbid] = useState<string | null>(null);

  // Debounce so each keystroke doesn't fire an external search.
  // 250ms matches the picker's own debounce so the two inputs feel
  // like a pair.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const externalSearch = useRequestSearch(debouncedQ, debouncedQ.length >= 2);
  const submit = useSubmitAlbumRequest();
  const qc = useQueryClient();

  const candidates = externalSearch.data?.albums ?? [];
  const showDrawer = debouncedQ.length >= 2;
  const isSearching = externalSearch.isFetching && showDrawer;

  async function handleRegister(album: {
    mbid: string;
    title: string;
    artist: string;
    year?: number | null;
    coverArtUrl?: string | null;
  }) {
    if (submit.isPending) return;
    setErrorMsg(null);
    setPendingMbid(album.mbid);
    try {
      await submit.mutateAsync({
        mbid: album.mbid,
        title: album.title,
        artist: album.artist,
        year: album.year,
        coverArtUrl: album.coverArtUrl,
      });
      // Newly-registered album lands at the top of albums.id DESC,
      // so refetching the 전체-tab candidates surfaces it as the
      // first row the owner can drag or tap into place.
      qc.invalidateQueries({ queryKey: ['mydig-candidates', 'all'] });
      setInput('');
      setDebouncedQ('');
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error;
      setErrorMsg(
        apiMessage || '등록에 실패했어요. 잠시 뒤 다시 시도해주세요.'
      );
    } finally {
      setPendingMbid(null);
    }
  }

  return (
    <div className="p-3 border-b border-white/5 bg-[#14110d]">
      <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        DB에 없는 앨범 등록
      </label>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="아티스트 / 앨범 검색 후 등록"
        className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none placeholder-gray-600"
      />

      {errorMsg && (
        <div className="mt-2 text-[11px] text-red-400 leading-snug">
          {errorMsg}
        </div>
      )}

      {showDrawer && (
        <div className="mt-2 rounded-md border border-white/5 bg-[#0f0d09] max-h-60 overflow-y-auto divide-y divide-white/5">
          {isSearching && candidates.length === 0 ? (
            <div className="p-3 text-[11px] text-gray-500">검색 중…</div>
          ) : candidates.length === 0 ? (
            <div className="p-3 text-[11px] text-gray-600">
              {debouncedQ.length >= 2 ? '결과 없음' : ''}
            </div>
          ) : (
            candidates.map((album) => {
              const isPending = pendingMbid === album.mbid;
              return (
                <div
                  key={album.mbid}
                  className="p-2 flex items-center gap-2 transition-colors hover:bg-white/5"
                >
                  <CoverArt
                    src={album.coverArtUrl}
                    fallbacks={album.coverArtFallbacks}
                    alt={album.title}
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-white font-medium truncate">
                      {album.title}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {album.artist}
                      {album.year ? ` · ${album.year}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRegister(album)}
                    disabled={isPending || submit.isPending}
                    aria-label={`${album.title} 등록`}
                    title="등록"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isPending ? (
                      <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      '+'
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
