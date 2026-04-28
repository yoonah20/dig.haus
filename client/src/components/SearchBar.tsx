import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch, useRequestSearch } from '../hooks/useSearch';
import {
  useSubmitAlbumRequest,
  useExtractAlbumFromUrl,
  type ExtractFromUrlResult,
} from '../hooks/useAlbumRequests';
import { useAuth } from '../contexts/AuthContext';
import { useCurationProgress } from '../contexts/CurationProgressContext';
import type { AlbumSearchResult } from '../types';

// URL paste branch — when the input string looks like an http(s) URL we
// route through the Discogs / OG-scrape extractor instead of running a
// normal text search. Discogs URLs come back with a fully-formed mbid
// the registration endpoint already understands; everything else lands
// as artist+title and the user is told to fall back to text search.
const URL_RE = /^https?:\/\/\S+$/i;

// Unified search overlay — one surface for both "find an album that's
// already in dig.haus" and "this album isn't here yet, register it".
// The separate nav + button + RegisterAlbumModal pair is gone; both
// flows live here.
//
// Layout: DB section (albums that are already in dig.haus) → external
// section (MusicBrainz + Discogs candidates that aren't yet). External
// candidates carry a [+] register button; admins also get a [⚡]
// button that registers AND fires auto-curation in one gesture.
// Non-admins get a confirm popup ("이 앨범이 맞나요?") before the POST
// so fat-fingered registrations don't pollute the catalog.

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
  const [pendingMbid, setPendingMbid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [urlExtract, setUrlExtract] = useState<ExtractFromUrlResult | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const loggedIn = !!user;
  const curation = useCurationProgress();
  const submit = useSubmitAlbumRequest();
  const extractFromUrl = useExtractAlbumFromUrl();

  const trimmedInput = input.trim();
  const isUrlMode = URL_RE.test(trimmedInput);

  const dbSearch = useSearch(isUrlMode ? '' : query);
  // External search only fires for logged-in users (endpoint requires
  // auth) and at 2+ chars to keep MB/Discogs calls bounded. Skipped
  // entirely while the input looks like a URL — that branch hits the
  // dedicated extract endpoint instead.
  const externalSearch = useRequestSearch(query, loggedIn && !isUrlMode);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  // Clear pending/error state when the query changes so stale
  // messages don't linger across searches.
  useEffect(() => {
    setPendingMbid(null);
    setErrorMsg(null);
  }, [query]);

  // URL paste branch — debounced so editing a URL char-by-char doesn't
  // burn extract calls (each one fires Discogs API server-side). 500ms
  // is comfortable for paste-then-wait flows, longer than the text
  // search debounce because URL extraction does a real upstream lookup.
  useEffect(() => {
    if (!isUrlMode || !loggedIn) {
      setUrlExtract(null);
      setUrlError(null);
      setUrlLoading(false);
      return;
    }
    setUrlError(null);
    setUrlLoading(true);
    const url = trimmedInput;
    const timer = setTimeout(async () => {
      try {
        const result = await extractFromUrl.mutateAsync(url);
        setUrlExtract(result);
      } catch (err: any) {
        const apiMessage = err?.response?.data?.error;
        setUrlError(apiMessage || 'URL을 인식하지 못했어요.');
        setUrlExtract(null);
      } finally {
        setUrlLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // extractFromUrl is stable from useMutation; excluded to avoid a
    // referential-equality re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedInput, isUrlMode, loggedIn]);

  function handleDbSelect(path: string) {
    setInput('');
    setQuery('');
    onSelect?.();
    navigate(path);
  }

  async function handleRegister(
    album: AlbumSearchResult,
    opts: { autoCurate?: boolean } = {}
  ) {
    if (pendingMbid) return;
    // Non-admin: confirm it's the right album before creating the
    // row. Admin trusts themselves — straight to submit.
    if (!isAdmin) {
      const confirmed = confirm(
        `"${album.title}" by ${album.artist} 맞나요?`
      );
      if (!confirmed) return;
    }
    setErrorMsg(null);
    setPendingMbid(album.mbid);
    try {
      const result = await submit.mutateAsync({
        mbid: album.mbid,
        title: album.title,
        artist: album.artist,
        year: album.year,
        coverArtUrl: album.coverArtUrl,
      });
      const target = (result?.slug as string | undefined) || album.mbid;
      onSelect?.();
      setInput('');
      setQuery('');
      // Auto-curation: admin-only shortcut for releases with known-
      // stable review coverage. Fire-and-forget via the global
      // CurationProgressContext — the floating panel tracks progress
      // after we navigate away.
      if (opts.autoCurate && isAdmin) {
        curation.startRun([{ mbid: album.mbid, title: album.title }]);
      }
      navigate(`/album/${target}`);
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error;
      setErrorMsg(apiMessage || '등록에 실패했어요. 잠시 뒤 다시 시도해주세요.');
      setPendingMbid(null);
    }
  }

  const dbAlbums = isUrlMode ? [] : (dbSearch.data?.albums ?? []).slice(0, 8);
  const dbMbids = new Set(dbAlbums.map((a) => a.mbid));
  // Hide externals that are already in the DB list to avoid "same
  // album twice, one with a register button".
  const externalAlbums = isUrlMode
    ? []
    : (externalSearch.data?.albums ?? []).filter((a) => !dbMbids.has(a.mbid));

  // Build a synthetic AlbumSearchResult for the URL-extract row so it
  // can flow through the same ExternalRow component as text-search
  // candidates. Only emit when the server returned an mbid (Discogs
  // path) — without one the registration endpoint has nothing to feed
  // into getOrFetchAlbumBaseForSubmission.
  const urlAlbum: AlbumSearchResult | null =
    urlExtract && urlExtract.mbid
      ? {
          mbid: urlExtract.mbid,
          title: urlExtract.title,
          artist: urlExtract.artist,
          year: urlExtract.year ? Number.parseInt(urlExtract.year, 10) || null : null,
          format: null,
          label: null,
          coverArtUrl: urlExtract.coverArtUrl ?? null,
        }
      : null;

  const showDropdown = isUrlMode ? trimmedInput.length >= 8 : query.length >= 1;
  const dbLoading = !isUrlMode && dbSearch.isFetching && query.length >= 1;
  const externalLoading =
    !isUrlMode && loggedIn && externalSearch.isFetching && query.length >= 2;
  const anyContent =
    dbAlbums.length > 0 || externalAlbums.length > 0 || urlAlbum !== null;

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

        {(dbLoading || externalLoading || urlLoading) && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-2 w-full bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {/* URL paste branch — the extracted Discogs candidate sits at
              the top by itself, no DB / external sections beside it.
              Loading + error states surface here too so the user
              doesn't see a silent dropdown while extraction runs. */}
          {isUrlMode && (
            <section>
              <SectionHeader label="URL에서 등록" />
              {urlLoading && (
                <div className="px-4 py-3 text-xs text-gray-500">
                  URL 분석 중…
                </div>
              )}
              {!urlLoading && urlError && (
                <div className="px-4 py-3 text-xs text-red-400 leading-snug">
                  {urlError}
                </div>
              )}
              {!urlLoading && !urlError && urlExtract && !urlAlbum && (
                <div className="px-4 py-3 text-xs text-gray-400 leading-snug">
                  이 URL은 직접 등록을 지원하지 않아요. "{urlExtract.artist}
                  {' '}— {urlExtract.title}"로 검색해 주세요.
                </div>
              )}
              {!urlLoading && urlAlbum && (
                <ExternalRow
                  album={urlAlbum}
                  isAdmin={isAdmin}
                  pending={pendingMbid === urlAlbum.mbid}
                  disabled={
                    pendingMbid !== null && pendingMbid !== urlAlbum.mbid
                  }
                  onRegister={() => handleRegister(urlAlbum)}
                  onRegisterCurate={() =>
                    handleRegister(urlAlbum, { autoCurate: true })
                  }
                />
              )}
              {!urlLoading && !loggedIn && (
                <div className="px-4 py-3 text-xs text-gray-400">
                  로그인하면 URL로 바로 등록할 수 있어요.
                </div>
              )}
            </section>
          )}

          {/* DB section — albums already in dig.haus. Clicking a row
              navigates; no register action needed. */}
          {dbAlbums.length > 0 && (
            <section>
              <SectionHeader label="dig.haus 컬렉션" />
              {dbAlbums.map((album) => (
                <DbRow
                  key={`db-${album.mbid}`}
                  album={album}
                  onSelect={() => handleDbSelect(`/album/${album.mbid}`)}
                />
              ))}
            </section>
          )}

          {/* External section — MB/Discogs candidates that aren't
              yet in dig.haus. Only shown for logged-in users
              (endpoint requires auth). */}
          {loggedIn && (externalLoading || externalAlbums.length > 0) && (
            <section>
              <SectionHeader label="아직 dig.haus에 없어요" />
              {externalLoading && externalAlbums.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-500">
                  외부 검색 중…
                </div>
              ) : (
                externalAlbums.map((album) => (
                  <ExternalRow
                    key={`ext-${album.mbid}`}
                    album={album}
                    isAdmin={isAdmin}
                    pending={pendingMbid === album.mbid}
                    disabled={
                      pendingMbid !== null && pendingMbid !== album.mbid
                    }
                    onRegister={() => handleRegister(album)}
                    onRegisterCurate={() =>
                      handleRegister(album, { autoCurate: true })
                    }
                  />
                ))
              )}
            </section>
          )}

          {/* Empty state — query has run, nothing came back from
              either source. Guests who could register via the external
              flow see a login hint instead. URL mode renders its own
              loading / error / result branches above and skips this. */}
          {!isUrlMode && !dbLoading && !externalLoading && !anyContent && (
            <div className="px-5 py-4 text-sm text-gray-400">
              {loggedIn
                ? '검색 결과가 없어요. 다른 키워드로 시도해보세요.'
                : '등록된 앨범이 없어요. 로그인하면 새 앨범을 등록할 수 있어요.'}
            </div>
          )}

          {errorMsg && (
            <div className="px-5 py-3 text-xs text-red-400 border-t border-white/5 bg-[#1f0f0f]">
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider text-gray-500 bg-[#181818]">
      {label}
    </div>
  );
}

function DbRow({
  album,
  onSelect,
}: {
  album: AlbumSearchResult;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
    >
      <Thumb album={album} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-100 truncate">
          {album.title}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {album.artist}
          {album.year && <span className="text-gray-500"> ({album.year})</span>}
        </p>
      </div>
    </button>
  );
}

function ExternalRow({
  album,
  isAdmin,
  pending,
  disabled,
  onRegister,
  onRegisterCurate,
}: {
  album: AlbumSearchResult;
  isAdmin: boolean;
  pending: boolean;
  disabled: boolean;
  onRegister: () => void;
  onRegisterCurate: () => void;
}) {
  return (
    <div
      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
        disabled ? 'opacity-40' : 'hover:bg-white/5'
      }`}
    >
      <Thumb album={album} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-100 truncate">
          {album.title}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {album.artist}
          {album.year && <span className="text-gray-500"> ({album.year})</span>}
          {album.label && <span className="text-gray-500"> · {album.label}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onRegister}
          disabled={disabled || pending}
          title="이 앨범을 dig.haus에 등록"
          aria-label="등록"
          className="w-7 h-7 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] text-base leading-none hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? (
            <span className="w-3 h-3 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
          ) : (
            '+'
          )}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={onRegisterCurate}
            disabled={disabled || pending}
            title="등록 후 자동 큐레이션까지 실행"
            aria-label="등록 + 큐레이션"
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#e8a020]/60 text-[#e8a020] text-base leading-none hover:bg-[#e8a020] hover:text-black transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚡
          </button>
        )}
      </div>
    </div>
  );
}

function Thumb({ album }: { album: AlbumSearchResult }) {
  return (
    <div className="w-8 h-8 flex-shrink-0 bg-[#252525] rounded overflow-hidden">
      {album.coverArtUrl ? (
        <img
          src={album.coverArtUrl}
          alt={album.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
    </div>
  );
}
