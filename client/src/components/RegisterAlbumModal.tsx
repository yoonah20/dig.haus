import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/axios';
import { useExternalSearch, useRequestSearch } from '../hooks/useSearch';
import { useSubmitAlbumRequest } from '../hooks/useAlbumRequests';
import type { AlbumSearchResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  // 'register' (admin) directly caches the album + kicks off the Claude
  // pipeline. 'request' (logged-in non-admin) writes a row to
  // album_requests with no external-API cascade — admin decides later.
  mode: 'register' | 'request';
}

const NOTES_MAX = 280;

export default function RegisterAlbumModal({ open, onClose, mode }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // While this is non-null, a single row is mid-submit. In register
  // mode it's the mbid we're fetching; in request mode it's the mbid
  // of the row whose "요청 보내기" button was clicked.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Request mode shows a notes input expanded below a selected row.
  // `selected` tracks which row has the expander open.
  const [selected, setSelected] = useState<AlbumSearchResult | null>(null);
  const [notes, setNotes] = useState('');
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);
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
    setSelected(null);
    setNotes('');
    setJustSubmitted(null);
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
      await submit.mutateAsync({
        mbid: album.mbid,
        title: album.title,
        artist: album.artist,
        year: album.year,
        coverArtUrl: album.coverArtUrl,
        notes: notes.trim() || null,
      });
      setJustSubmitted(album.mbid);
      setSelected(null);
      setNotes('');
    } catch (e: any) {
      const apiMessage = e?.response?.data?.error;
      setError(apiMessage || '요청을 보내지 못했어요. 잠시 뒤에 다시 시도해주세요.');
    } finally {
      setPending(null);
    }
  }

  function onRowClick(album: AlbumSearchResult) {
    if (pending) return;
    if (isRequest) {
      // Toggle the expander; clicking the same row again closes it.
      if (selected?.mbid === album.mbid) {
        setSelected(null);
        setNotes('');
      } else {
        setSelected(album);
        setNotes('');
        setError(null);
      }
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
            <p className="text-base text-gray-300 mb-5 leading-relaxed">
              dig.haus 에 없는 앨범 등록 요청을 보낼 수 있어요. admin 이
              검토한 뒤에 반영돼요.
            </p>
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

          {pending && !isRequest && (
            <div className="mt-6 flex items-center gap-3 text-sm text-gray-300">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-[#e8a020] rounded-full animate-spin" />
              <span>앨범 등록 및 리뷰 수집 중...</span>
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
                const isSelected = selected?.mbid === album.mbid;
                const wasSubmitted = justSubmitted === album.mbid;
                return (
                  <div key={album.mbid}>
                    <button
                      onClick={() => onRowClick(album)}
                      disabled={!!pending && pending !== album.mbid}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors text-left disabled:opacity-40 ${
                        isSelected || wasSubmitted ? 'bg-white/5' : ''
                      }`}
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
                      {wasSubmitted && (
                        <span className="text-sm text-[#e8a020] shrink-0">요청 보냄 ✓</span>
                      )}
                    </button>

                    {/* Request-mode expander — shows a short notes
                        textarea under the selected row and a submit
                        button. Keeps the flow inline instead of
                        opening a second modal. */}
                    {isRequest && isSelected && !wasSubmitted && (
                      <div className="px-3 pb-4 pt-1">
                        <textarea
                          value={notes}
                          onChange={(e) => {
                            if (e.target.value.length > NOTES_MAX) return;
                            setNotes(e.target.value);
                          }}
                          placeholder="admin 에게 남길 한마디 (선택) — 왜 이 앨범을 원하는지 등"
                          rows={2}
                          disabled={!!pending}
                          className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-500 tabular-nums mr-auto">
                            {notes.length}/{NOTES_MAX}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(null);
                              setNotes('');
                            }}
                            disabled={!!pending}
                            className="text-sm text-gray-400 hover:text-white px-2.5 py-1 disabled:opacity-40 cursor-pointer"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRequestSubmit(album)}
                            disabled={!!pending}
                            className="bg-[#e8a020] text-black hover:bg-[#f0b040] rounded-md px-3.5 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            {pending === album.mbid ? '보내는 중…' : '요청 보내기'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
