import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/axios';
import { useExternalSearch, useRequestSearch } from '../hooks/useSearch';
import { useSubmitAlbumRequest } from '../hooks/useAlbumRequests';
import type { AlbumSearchResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  // 'register' (admin) and 'request' (logged-in non-admin) both now
  // cache the album immediately on submit — the difference is that
  // 'request' skips the Claude review warm-up until admin approves.
  mode: 'register' | 'request';
}

export default function RegisterAlbumModal({ open, onClose, mode }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // Non-null while one specific row is mid-submit; drives the
  // per-row disable + spinner.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const submit = useSubmitAlbumRequest();

  // Admin → /api/search (admin-gated external). Logged-in user →
  // /api/album-requests/search (auth-gated external + rate-limited).
  // Only one fires at a time thanks to the `enabled` flag on the
  // other hook dropping to false.
  const isRequest = mode === 'request';
  const adminSearch = useExternalSearch(query, open && !isRequest);
  const userSearch = useRequestSearch(query, open && isRequest);
  const data = isRequest ? userSearch.data : adminSearch.data;
  const isLoading = isRequest ? userSearch.isLoading : adminSearch.isLoading;

  useEffect(() => {
    if (!open) return;
    setInput('');
    setQuery('');
    setPending(null);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  const albums = data?.albums ?? [];
  const title = isRequest ? '앨범 등록 요청' : '앨범 등록';
  const placeholder = isRequest
    ? '추가됐으면 하는 앨범 검색...'
    : 'MusicBrainz / Discogs에서 앨범 검색...';

  async function handleRegister(album: AlbumSearchResult) {
    if (pending) return;
    setError(null);
    setPending(album.mbid);
    try {
      await axios.get(`/api/albums/${encodeURIComponent(album.mbid)}`);
      onClose();
      navigate(`/album/${album.mbid}`);
    } catch (e: any) {
      console.error('Register album error:', e);
      setError('앨범 등록에 실패했습니다. 다시 시도해주세요.');
      setPending(null);
    }
  }

  async function handleRequestSubmit(album: AlbumSearchResult) {
    if (pending) return;
    setError(null);
    setPending(album.mbid);
    try {
      const result = await submit.mutateAsync({
        mbid: album.mbid,
        title: album.title,
        artist: album.artist,
        year: album.year,
        coverArtUrl: album.coverArtUrl,
      });
      // Server creates the album row on submit — navigate straight
      // into it so the user sees the result of their action. The slug
      // comes back in the response; fall back to mbid if missing (old
      // servers or cache misses).
      const target = (result?.slug as string | undefined) || album.mbid;
      onClose();
      navigate(`/album/${target}`);
    } catch (e: any) {
      const apiMessage = e?.response?.data?.error;
      setError(apiMessage || '요청을 보내지 못했어요. 잠시 뒤에 다시 시도해주세요.');
      setPending(null);
    }
  }

  function onRowClick(album: AlbumSearchResult) {
    if (pending) return;
    // Both modes now register immediately on row click. The notes
    // expander is gone — the new flow creates the album row directly
    // and redirects the user into it, so notes-to-admin isn't where
    // the conversation happens anymore (50자 평 is).
    if (isRequest) {
      handleRequestSubmit(album);
    } else {
      handleRegister(album);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-24 px-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold text-[#e8a020]">{title}</h2>
          <button
            onClick={() => !pending && onClose()}
            disabled={!!pending}
            className="text-gray-400 hover:text-white text-2xl leading-none disabled:opacity-40"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {isRequest && (
            <div className="mb-5 space-y-1.5">
              <p className="text-base text-gray-300 leading-relaxed">
                dig.haus 에 없는 앨범을 등록할 수 있어요. 등록 직후 바로
                앨범 페이지로 이동합니다.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                리뷰 수집은 관리자 확인 후 진행됩니다. 커뮤니티 가이드에
                맞지 않는 앨범은 관리자가 수정·삭제할 수 있어요.
              </p>
            </div>
          )}
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!!pending}
              placeholder={placeholder}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-[#e8a020] focus:outline-none transition disabled:opacity-60"
            />
            {isLoading && query.length >= 2 && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-400">{error}</div>
          )}

          {pending && (
            <div className="mt-6 flex items-center gap-3 text-sm text-gray-300">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-[#e8a020] rounded-full animate-spin" />
              <span>
                {isRequest
                  ? '앨범 등록 중...'
                  : '앨범 등록 및 리뷰 수집 중...'}
              </span>
            </div>
          )}

          {!pending && query.length >= 2 && !isLoading && albums.length === 0 && (
            <div className="mt-6 text-sm text-gray-500 text-center">
              검색 결과가 없습니다.
            </div>
          )}

          {albums.length > 0 && (
            <div className="mt-4 max-h-[60vh] overflow-y-auto -mx-1">
              {albums.map((album) => {
                const isSubmitting = pending === album.mbid;
                return (
                  <button
                    key={album.mbid}
                    onClick={() => onRowClick(album)}
                    disabled={!!pending && !isSubmitting}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors text-left disabled:opacity-40"
                  >
                    <div className="w-10 h-10 flex-shrink-0 bg-[#252525] rounded-md overflow-hidden">
                      {album.coverArtUrl ? (
                        <img
                          src={album.coverArtUrl}
                          alt={album.title}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-gray-100 truncate">
                        {album.title}
                      </p>
                      <p className="text-sm text-gray-400 truncate">
                        {album.artist}
                        {album.year && (
                          <span className="text-gray-500"> ({album.year})</span>
                        )}
                        {album.label && (
                          <span className="text-gray-500"> · {album.label}</span>
                        )}
                      </p>
                    </div>
                    {isSubmitting && (
                      <div className="shrink-0 w-4 h-4 border-2 border-gray-600 border-t-[#e8a020] rounded-full animate-spin" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
