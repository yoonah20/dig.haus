import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { apiErrorMessage } from '../lib/apiError';

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

type SortKey = 'count' | 'name';

export default function AdminTags() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useTagList();
  const tags = data?.tags ?? [];

  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-tags'] });
    // The catalog's genres changed — album grids and lens results are
    // now stale. Drop the album-list caches so a return to /dig refetches.
    qc.invalidateQueries({ queryKey: ['album-list'] });
    qc.invalidateQueries({ queryKey: ['album-list-infinite'] });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? tags.filter((t) => t.label.toLowerCase().includes(q))
      : tags.slice();
    rows.sort((a, b) =>
      sortKey === 'count'
        ? b.count - a.count || a.label.localeCompare(b.label)
        : a.label.localeCompare(b.label)
    );
    return rows;
  }, [tags, query, sortKey]);

  const selectedList = useMemo(() => [...selected], [selected]);

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
        from.map((t) => `• ${t}`).join('\n') +
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
        selectedList.map((t) => `• ${t}`).join('\n') +
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

  if (isLoading) {
    return <div className="text-sm text-gray-400">태그를 불러오는 중…</div>;
  }
  if (isError) {
    return (
      <div className="text-sm text-red-400">태그 목록을 불러오지 못했습니다.</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-gray-200">태그 정리</h2>
        <span className="text-sm text-gray-500">
          distinct {tags.length}개
        </span>
      </div>
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
          <ul className="divide-y divide-white/5">
            {filtered.map((t) => {
              const isSel = selected.has(t.label);
              return (
                <li
                  key={t.label}
                  className={`flex items-center gap-3 px-3 py-1.5 text-sm ${isSel ? 'bg-accent/10' : 'hover:bg-white/[0.03]'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(t.label)}
                    className="cursor-pointer accent-[#e8a020]"
                  />
                  <button
                    onClick={() => toggle(t.label)}
                    className="flex-1 text-left text-gray-200 cursor-pointer truncate"
                  >
                    {t.label}
                  </button>
                  <span className="text-xs text-gray-500 tabular-nums w-10 text-right">
                    {t.count}
                  </span>
                  <button
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
        )}
      </div>
    </div>
  );
}
