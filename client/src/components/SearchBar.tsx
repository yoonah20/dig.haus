import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../hooks/useSearch';
import { useAuth } from '../contexts/AuthContext';
import type { AlbumSearchResult } from '../types';

interface SearchBarProps {
  initialQuery?: string;
  autoFocus?: boolean;
  onSelect?: () => void;
}

export default function SearchBar({
  initialQuery = '',
  autoFocus = false,
  onSelect,
}: SearchBarProps) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data, isLoading } = useSearch(query);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  function handleSelect(path: string) {
    setInput('');
    setQuery('');
    onSelect?.();
    navigate(path);
  }

  const albums = data?.albums.slice(0, 8) ?? [];
  const showDropdown = query.length >= 1;

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="아티스트 또는 앨범 검색..."
          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl pl-12 pr-5 py-3 text-base text-white placeholder-gray-500 focus:border-[#e8a020] focus:outline-none transition"
        />

        {isLoading && query.length >= 1 && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showDropdown && !isLoading && albums.length === 0 && (
        <div className="absolute z-50 mt-2 w-full bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl px-5 py-4 text-sm text-gray-400">
          {isAdmin
            ? '아직 등록되지 않았습니다. + 버튼으로 추가하세요'
            : '아직 등록되지 않은 앨범입니다'}
        </div>
      )}

      {showDropdown && albums.length > 0 && (
        <div className="absolute z-50 mt-2 w-full bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          {albums.map((album: AlbumSearchResult) => (
            <button
              key={album.mbid}
              onClick={() => handleSelect(`/album/${album.mbid}`)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <div className="w-8 h-8 flex-shrink-0 bg-[#252525] rounded overflow-hidden">
                {album.coverArtUrl ? (
                  <img
                    src={album.coverArtUrl}
                    alt={album.title}
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
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
