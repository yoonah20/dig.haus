import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { useRequestSearch } from '../hooks/useSearch';
import { useSubmitAlbumRequest } from '../hooks/useAlbumRequests';
import type { AlbumSearchResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Unified album-registration modal. Admin and non-admin now take the
// same path: external search (MusicBrainz + Discogs) → select a
// candidate → POST /api/album-requests → redirect into the new album
// page (pending state). Admin does not get automatic review
// collection anymore; that's a separate explicit action on the album
// page (🔍 리뷰 모아오기).
export default function RegisterAlbumModal({ open, onClose }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  // Non-null while one specific row is mid-submit; drives the
  // per-row disable + spinner.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const submit = useSubmitAlbumRequest();

  const search = useRequestSearch(query, open);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setQuery('');
    setUrlInput('');
    setExtractError(null);
    setExtracting(false);
    setPending(null);
    setError(null);
    // Drop every cached request-search result so a prior session's
    // "already registered" hits don't flash back through
    // placeholderData when the modal reopens. staleTime: 5min + the
    // placeholderData: (prev) => prev on useRequestSearch otherwise
    // preserved those rows even after the user had moved on.
    qc.removeQueries({ queryKey: ['album-request-search'] });
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, qc]);

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

  const albums = search.data?.albums ?? [];

  async function handleExtractUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setExtractError('http:// 또는 https:// 로 시작하는 URL을 입력해주세요.');
      return;
    }
    setExtractError(null);
    setExtracting(true);
    try {
      const { data } = await axios.post<{ artist: string; title: string }>(
        '/api/album-requests/extract-from-url',
        { url: trimmed }
      );
      // Feed the result back into the main search input — that path
      // is what actually reconciles with MusicBrainz / Discogs and
      // lets the user pick the right release. Skipping MB here
      // would bypass the matching that catches wrong-edition /
      // wrong-year cases.
      const combined = `${data.artist} ${data.title}`.trim();
      setInput(combined);
      setQuery(combined);
      setUrlInput('');
      inputRef.current?.focus();
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        'URL에서 정보를 가져오지 못했어요. 아래 검색어를 직접 입력해 주세요.';
      setExtractError(msg);
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(album: AlbumSearchResult) {
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
          <h2 className="text-lg font-semibold text-[#e8a020]">새 앨범 등록</h2>
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
          <div className="mb-5 space-y-1.5">
            <p className="text-base text-gray-300 leading-relaxed">
              dig.haus에 음반을 직접 등록하세요. 단, 디지털 싱글은 등록할 수 없습니다. (EP/앨범 단위만 가능)
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              커뮤니티 가이드에 맞지 않는 앨범은 관리자가 수정·삭제할 수 있어요.
            </p>
          </div>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!!pending}
              placeholder="검색어 넣기 (아티스트, 앨범) …"
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-[#e8a020] focus:outline-none transition disabled:opacity-60"
            />
            {/* isFetching, not isLoading — React Query v5 flips
                isLoading to false as soon as placeholderData (the
                previous result) is available, so subsequent searches
                would show no spinner at all. isFetching stays true
                for the entire in-flight period regardless of whether
                stale data is being shown. */}
            {search.isFetching && query.length >= 2 && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* URL-based prefill. Keeps the text search as the primary
              path (it's the one that reconciles with MusicBrainz /
              Discogs and lets the user pick the right release); this
              just drops artist + title into that box so you don't
              have to retype a name you already have in a Discogs /
              Bandcamp / Spotify / Apple Music tab. Server does the
              parsing — see services/albumUrlExtract.ts. */}
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
              또는 상점·스트리밍 URL로 찾기
            </div>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (extractError) setExtractError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !extracting && urlInput.trim()) {
                    e.preventDefault();
                    void handleExtractUrl();
                  }
                }}
                disabled={extracting || !!pending}
                placeholder="https://www.discogs.com/release/… · bandcamp · spotify · apple music"
                className="flex-1 min-w-0 bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleExtractUrl}
                disabled={extracting || !urlInput.trim() || !!pending}
                className="shrink-0 px-3 py-2 text-sm font-medium bg-[#e8a020] text-black rounded-lg hover:bg-[#f0b040] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {extracting ? '분석 중…' : '가져오기'}
              </button>
            </div>
            {extractError && (
              <div className="mt-2 text-xs text-red-400">{extractError}</div>
            )}
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-400">{error}</div>
          )}

          {pending && (
            <div className="mt-6 flex items-center gap-3 text-sm text-gray-300">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-[#e8a020] rounded-full animate-spin" />
              <span>앨범 등록 중...</span>
            </div>
          )}

          {!pending && query.length >= 2 && !search.isFetching && albums.length === 0 && (
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
                    onClick={() => handleSubmit(album)}
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
