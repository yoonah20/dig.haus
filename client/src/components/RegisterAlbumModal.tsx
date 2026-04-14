import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/axios';
import { useExternalSearch } from '../hooks/useSearch';
import type { AlbumSearchResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RegisterAlbumModal({ open, onClose }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [registering, setRegistering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data, isLoading } = useExternalSearch(query, open);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setQuery('');
    setRegistering(null);
    setError(null);
    // Focus input on open
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
      if (e.key === 'Escape' && !registering) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, registering, onClose]);

  if (!open) return null;

  const albums = data?.albums ?? [];

  async function handleSelect(album: AlbumSearchResult) {
    if (registering) return;
    setError(null);
    setRegistering(album.mbid);
    try {
      // Hitting the album endpoint caches the album in the DB and fetches
      // base metadata. Review collection kicks off on the album page.
      await axios.get(`/api/albums/${encodeURIComponent(album.mbid)}`);
      onClose();
      navigate(`/album/${album.mbid}`);
    } catch (e: any) {
      console.error('Register album error:', e);
      setError('앨범 등록에 실패했습니다. 다시 시도해주세요.');
      setRegistering(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-24 px-4"
      onClick={() => !registering && onClose()}
    >
      <div
        className="w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold text-[#e8a020]">앨범 등록</h2>
          <button
            onClick={() => !registering && onClose()}
            disabled={!!registering}
            className="text-gray-400 hover:text-white text-2xl leading-none disabled:opacity-40"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!!registering}
              placeholder="MusicBrainz / Discogs에서 앨범 검색..."
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

          {registering && (
            <div className="mt-6 flex items-center gap-3 text-sm text-gray-300">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-[#e8a020] rounded-full animate-spin" />
              <span>앨범 등록 및 리뷰 수집 중...</span>
            </div>
          )}

          {!registering && query.length >= 2 && !isLoading && albums.length === 0 && (
            <div className="mt-6 text-sm text-gray-500 text-center">
              검색 결과가 없습니다.
            </div>
          )}

          {!registering && albums.length > 0 && (
            <div className="mt-4 max-h-[60vh] overflow-y-auto -mx-1">
              {albums.map((album) => (
                <button
                  key={album.mbid}
                  onClick={() => handleSelect(album)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors text-left"
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
                    <p className="text-sm font-semibold text-gray-100 truncate">
                      {album.title}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {album.artist}
                      {album.year && (
                        <span className="text-gray-500"> ({album.year})</span>
                      )}
                      {album.label && (
                        <span className="text-gray-500"> · {album.label}</span>
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
