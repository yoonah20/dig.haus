import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { apiErrorMessage } from '../lib/apiError';
import CoverArt from '../components/CoverArt';

// Tag management workspace, embedded in the /admin/tags tab. The genre
// "tags" are a free-text JSON blob per album with no normalisation
// table, so the catalog fragments (death metal / technical death metal
// / melodic death metal live as separate strings). This page is where
// the operator folds those families together (병합) and bans junk
// (블랙리스트) across the whole catalog. Match semantics mirror the
// server: exact case-insensitive match on the source tags for merge,
// substring only for the family-select helper.

interface TagRow {
  label: string;
  count: number;
}

function useTagList() {
  return useQuery<{ tags: TagRow[] }>({
    queryKey: ['admin-tags'],
    queryFn: async () => {
      const { data } = await axios.get<{ tags: TagRow[] }>('/api/admin/tags');
      return data;
    },
    staleTime: 1000 * 30,
  });
}

interface UntaggedAlbum {
  slug: string;
  title: string;
  artist: string | null;
  releaseYear: number | null;
  coverArtUrl: string | null;
  coverArtFallbacks: string[];
}

function useUntaggedAlbums() {
  return useQuery<{ total: number; albums: UntaggedAlbum[] }>({
    queryKey: ['admin-untagged-albums'],
    queryFn: async () =>
      (await axios.get('/api/admin/albums-without-tags')).data,
    staleTime: 1000 * 30,
  });
}

type SortKey = 'count' | 'name';
type View = 'tags' | 'untagged';

export default function AdminTags() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useTagList();
  const tags = data?.tags ?? [];
  const untagged = useUntaggedAlbums();

  const [view, setView] = useState<View>('tags');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyJunk, setOnlyJunk] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-tags'] });
    // Blacklisting from here changes the ban list and can empty an
    // album's tags, so refresh the sibling blacklist panel + the
    // untagged worklist too.
    qc.invalidateQueries({ queryKey: ['admin-tag-blacklist'] });
    qc.invalidateQueries({ queryKey: ['admin-untagged-albums'] });
    // The catalog's genres changed — album grids and lens results are
    // now stale. Drop the album-list caches so a return to /dig refetches.
    qc.invalidateQueries({ queryKey: ['album-list'] });
    qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? tags.filter((t) => t.label.toLowerCase().includes(q))
      : tags.slice();
    // Junk candidates: any tag containing a digit. Catches the biggest
    // noise bucket in the raw genres blob — year tags ("2026"),
    // date-ish scraps ("4-25"), listicle titles ("best albums 2023",
    // "top 10 2019"). Band names / one-off words can't be pattern-
    // detected, so those still need manual judgment. Heuristic only —
    // the blacklist confirm is the real gate before anything commits.
    if (onlyJunk) rows = rows.filter((t) => /\d/.test(t.label));
    rows.sort((a, b) =>
      sortKey === 'count'
        ? b.count - a.count || a.label.localeCompare(b.label)
        : a.label.localeCompare(b.label)
    );
    return rows;
  }, [tags, query, sortKey, onlyJunk]);

  const selectedList = useMemo(() => [...selected], [selected]);

  // Whether every currently-filtered row is selected — drives the
  // select-all checkbox state (checked / indeterminate / empty).
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.label));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((t) => selected.has(t.label));

  // Toggle the whole current view: if all filtered rows are already
  // selected, drop them from the selection; otherwise add them all.
  // Operates only on the filtered set, so selections made under a
  // previous search/filter survive (search "2026" → select all → search
  // "german" → add → blacklist the union in one go).
  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const t of filtered) next.delete(t.label);
      } else {
        for (const t of filtered) next.add(t.label);
      }
      return next;
    });
  };

  // Drag-to-select over rows (file-manager style). The row pressed
  // decides the operation: press an unselected row → the drag selects,
  // press a selected one → it deselects. Each move recomputes from the
  // snapshot taken at press time so back-tracking the drag shrinks the
  // range instead of leaving orphaned selections. Refs (not state) hold
  // the live drag context so the mouseenter/global-mouseup handlers
  // never read a stale closure mid-drag.
  const draggingRef = useRef(false);
  const dragStartRef = useRef(0);
  const dragModeRef = useRef<'select' | 'deselect'>('select');
  const dragBaseRef = useRef<Set<string>>(new Set());

  const applyDragRange = (endIdx: number) => {
    const start = dragStartRef.current;
    const [lo, hi] = start <= endIdx ? [start, endIdx] : [endIdx, start];
    const next = new Set(dragBaseRef.current);
    for (let k = lo; k <= hi; k++) {
      const label = filtered[k]?.label;
      if (!label) continue;
      if (dragModeRef.current === 'select') next.add(label);
      else next.delete(label);
    }
    setSelected(next);
  };

  const startDrag = (idx: number, label: string, e: React.MouseEvent) => {
    e.preventDefault(); // suppress text selection while dragging
    draggingRef.current = true;
    dragStartRef.current = idx;
    dragModeRef.current = selected.has(label) ? 'deselect' : 'select';
    dragBaseRef.current = new Set(selected);
    applyDragRange(idx);
  };

  const onDragEnter = (idx: number) => {
    if (draggingRef.current) applyDragRange(idx);
  };

  // End any drag on mouseup anywhere — including releases outside the
  // list — so a drag that runs off the bottom edge still terminates.
  useEffect(() => {
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const toggle = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setMergeTarget('');
  };

  // Confirm dialogs can now cover a bulk selection (hundreds of junk
  // tags). Cap the enumerated preview so the native alert stays legible.
  const previewList = (items: string[], cap = 25): string => {
    const shown = items.slice(0, cap).map((t) => `• ${t}`);
    if (items.length > cap) shown.push(`…외 ${items.length - cap}개`);
    return shown.join('\n');
  };

  // Select every tag that contains this one as a substring (the tag's
  // subgenre family) — e.g. "death metal" grabs "technical death metal",
  // "melodic death metal". A fast way to gather a family before merging.
  const selectFamily = (root: string) => {
    const rootLower = root.toLowerCase();
    const family = tags
      .filter((t) => t.label.toLowerCase().includes(rootLower))
      .map((t) => t.label);
    setSelected(new Set(family));
    setMergeTarget(root);
  };

  const doMerge = async () => {
    const to = mergeTarget.trim();
    if (!to || selectedList.length === 0 || busy) return;
    // Sources = selected tags minus the target itself (merging a tag
    // into itself is a no-op the server would ignore anyway).
    const from = selectedList.filter(
      (t) => t.toLowerCase() !== to.toLowerCase()
    );
    if (from.length === 0) {
      alert('대상과 다른 태그를 선택하세요.');
      return;
    }
    const ok = window.confirm(
      `${from.length}개 태그를 "${to}" 로 병합합니다.\n\n` +
        previewList(from) +
        `\n\n카탈로그 전체의 해당 태그가 "${to}" 로 치환됩니다. 계속할까요?`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data: res } = await axios.post<{ albumsChanged: number }>(
        '/api/admin/tags/merge',
        { from, to }
      );
      clearSelection();
      refresh();
      alert(`병합 완료 — 앨범 ${res.albumsChanged}개 수정됨.`);
    } catch (err) {
      alert(apiErrorMessage(err, '병합 실패'));
    } finally {
      setBusy(false);
    }
  };

  const doBlacklist = async () => {
    if (selectedList.length === 0 || busy) return;
    const ok = window.confirm(
      `${selectedList.length}개 태그를 블랙리스트에 추가합니다.\n\n` +
        previewList(selectedList) +
        `\n\n향후 자동 import에서 차단되고, 카탈로그 전체에서 제거됩니다. 계속할까요?`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data: res } = await axios.post<{ strippedAlbumCount: number }>(
        '/api/admin/tags/blacklist',
        { tags: selectedList }
      );
      clearSelection();
      refresh();
      alert(`블랙리스트 추가 완료 — 앨범 ${res.strippedAlbumCount}개에서 제거됨.`);
    } catch (err) {
      alert(apiErrorMessage(err, '블랙리스트 실패'));
    } finally {
      setBusy(false);
    }
  };

  const untaggedCount = untagged.data?.total;

  return (
    <div className="space-y-4">
      {/* View toggle — the tag-cleanup list vs the no-tag album
          worklist. Aggressive blacklisting (nuking "metal" etc.) empties
          some albums, so the second view is where they get re-tagged. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ViewTab active={view === 'tags'} onClick={() => setView('tags')}>
          태그 목록 ({tags.length})
        </ViewTab>
        <ViewTab
          active={view === 'untagged'}
          onClick={() => setView('untagged')}
        >
          태그 없는 앨범{untaggedCount != null ? ` (${untaggedCount})` : ''}
        </ViewTab>
      </div>

      {view === 'untagged' ? (
        <UntaggedAlbums
          isLoading={untagged.isLoading}
          isError={untagged.isError}
          albums={untagged.data?.albums ?? []}
        />
      ) : isLoading ? (
        <div className="text-sm text-gray-400">태그를 불러오는 중…</div>
      ) : isError ? (
        <div className="text-sm text-red-400">
          태그 목록을 불러오지 못했습니다.
        </div>
      ) : (
        <>
      <p className="text-xs text-gray-500 leading-relaxed max-w-2xl">
        장르 태그는 앨범마다 자유 문자열로 저장돼 계열이 파편화됩니다
        (death metal / technical death metal / melodic death metal).
        태그를 골라 하나로 <b className="text-gray-400">병합</b>하거나, 쓰레기
        태그(연도·밴드명 등)를 <b className="text-gray-400">블랙리스트</b>로
        일괄 제거하세요. "계열 선택"은 그 태그를 포함하는 하위 장르를 한 번에
        고릅니다.
      </p>

      {/* Toolbar: search + sort */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="태그 검색…"
          className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 w-56"
        />
        <div className="flex items-center gap-1 text-gray-500">
          <span>정렬:</span>
          <button
            onClick={() => setSortKey('count')}
            className={`cursor-pointer ${sortKey === 'count' ? 'text-accent font-semibold' : 'hover:text-gray-200'}`}
          >
            개수
          </button>
          <span className="text-gray-700">/</span>
          <button
            onClick={() => setSortKey('name')}
            className={`cursor-pointer ${sortKey === 'name' ? 'text-accent font-semibold' : 'hover:text-gray-200'}`}
          >
            이름
          </button>
        </div>
        <button
          onClick={() => setOnlyJunk((v) => !v)}
          className={`rounded-full border px-2.5 py-1 cursor-pointer transition-colors ${
            onlyJunk
              ? 'border-red-500/50 bg-red-900/30 text-red-300'
              : 'border-white/10 text-gray-500 hover:text-gray-200 hover:border-white/20'
          }`}
          title="숫자가 포함된 태그(연도·날짜 등 쓰레기 후보)만 표시"
        >
          숫자 포함만
        </button>
        <span className="text-gray-600">{filtered.length}개 표시</span>
      </div>

      {/* Action bar — sticky when a selection exists */}
      {selectedList.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-[#1a1a1a]/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
          <span className="text-gray-300">
            {selectedList.length}개 선택
          </span>
          <button
            onClick={clearSelection}
            className="text-gray-500 hover:text-gray-200 cursor-pointer"
          >
            해제
          </button>
          <span className="text-gray-700 mx-1">|</span>
          <input
            type="text"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder="병합 대상 태그"
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 w-40"
          />
          <button
            onClick={doMerge}
            disabled={busy || !mergeTarget.trim()}
            className="rounded bg-accent/20 border border-accent/40 px-2.5 py-1 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            병합
          </button>
          <span className="text-gray-700 mx-1">|</span>
          <button
            onClick={doBlacklist}
            disabled={busy}
            className="rounded bg-red-900/30 border border-red-500/40 px-2.5 py-1 text-red-300 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            블랙리스트
          </button>
        </div>
      )}

      {/* Tag table */}
      <div className="rounded-lg border border-white/10 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            일치하는 태그가 없습니다.
          </div>
        ) : (
          <>
          {/* Select-all header — checks/unchecks every row in the
              current view at once. Indeterminate when only some are
              selected. */}
          <div className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-white/10 bg-white/[0.02]">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = someFilteredSelected;
              }}
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="cursor-pointer accent-[#e8a020]"
              aria-label="현재 목록 전체 선택"
            />
            <button
              onClick={toggleSelectAllFiltered}
              className="flex-1 text-left text-gray-400 hover:text-gray-200 cursor-pointer"
            >
              {allFilteredSelected ? '전체 해제' : `전체 선택 (${filtered.length})`}
            </button>
          </div>
          {/* select-none: a drag across rows must not paint a text
              selection over the labels. */}
          <ul className="divide-y divide-white/5 select-none">
            {filtered.map((t, i) => {
              const isSel = selected.has(t.label);
              return (
                <li
                  key={t.label}
                  onMouseDown={(e) => startDrag(i, t.label, e)}
                  onMouseEnter={() => onDragEnter(i)}
                  className={`flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer ${isSel ? 'bg-accent/10' : 'hover:bg-white/[0.03]'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    // Let the native checkbox own its own click without
                    // also starting a row drag.
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={() => toggle(t.label)}
                    className="cursor-pointer accent-[#e8a020]"
                  />
                  <span className="flex-1 text-gray-200 truncate">
                    {t.label}
                  </span>
                  <span className="text-xs text-gray-500 tabular-nums w-10 text-right">
                    {t.count}
                  </span>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => selectFamily(t.label)}
                    className="text-[11px] text-gray-500 hover:text-accent cursor-pointer whitespace-nowrap"
                    title={`"${t.label}" 을(를) 포함하는 하위 장르를 모두 선택`}
                  >
                    계열 선택
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
}

// Segmented view switcher between the tag list and the untagged-album
// worklist.
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 cursor-pointer transition-colors ${
        active
          ? 'bg-accent/20 border border-accent/40 text-accent font-semibold'
          : 'border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20'
      }`}
    >
      {children}
    </button>
  );
}

// Albums whose display tags are empty — the re-tagging worklist. Each
// row links to the album page, where tags are added via the header
// TagEditor. Returning here refetches on mount (short staleTime), so
// re-tagged albums drop off the list.
function UntaggedAlbums({
  isLoading,
  isError,
  albums,
}: {
  isLoading: boolean;
  isError: boolean;
  albums: UntaggedAlbum[];
}) {
  if (isLoading) {
    return <div className="text-sm text-gray-400">불러오는 중…</div>;
  }
  if (isError) {
    return (
      <div className="text-sm text-red-400">
        태그 없는 앨범을 불러오지 못했습니다.
      </div>
    );
  }
  if (albums.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-gray-500">
        태그 없는 앨범이 없습니다. 전부 태그가 붙어 있어요.
      </div>
    );
  }
  return (
    <>
      <p className="text-xs text-gray-500 leading-relaxed max-w-2xl">
        표시할 태그가 하나도 없는 앨범입니다. 앨범을 열어 헤더에서 태그를
        추가하세요. 태그를 붙이면 이 목록에서 사라집니다.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {albums.map((a) => (
          <li key={a.slug}>
            <Link
              to={`/album/${a.slug}`}
              className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/[0.03] hover:border-white/20 transition-colors"
            >
              <CoverArt
                src={a.coverArtUrl}
                fallbacks={a.coverArtFallbacks}
                alt={a.title}
                className="w-10 h-10 rounded object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="text-sm text-gray-200 truncate">{a.title}</div>
                <div className="text-xs text-gray-500 truncate">
                  {a.artist}
                  {a.releaseYear ? ` · ${a.releaseYear}` : ''}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
