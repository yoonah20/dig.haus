import { useEffect, useRef, useState } from 'react';
import CoverArt from '../CoverArt';
import QuickRegister from './QuickRegister';
import SnapshotSaveModal from './SnapshotSaveModal';
import {
  useMyDigCandidates,
  useSaveVinylWall,
  useSaveVinylWallSnapshotItems,
  useUpdateVinylWallSnapshot,
  useUpdateVinylWallTheme,
  type MyDigAlbum,
  type MyDigCandidate,
  type MyDigCandidateSource,
  type MyDigWallItem,
} from '../../hooks/useMyDig';

// Phase 3b — Vinyl Wall edit mode. 80/20 split, native HTML5
// drag-drop on desktop, tap-to-select + tap-slot on touch. Edit
// state lives entirely in-memory here; submit button pushes the
// full 15-slot array to PUT /api/mydig/vinyl-wall/items (bulk
// replace in a transaction server-side). Cancel resets to the
// server snapshot.

const WALL_ROW_SIZES = [5, 5, 5] as const;
const WALL_TOTAL = 15;

// Header title builder. Wall target → "현재 마이딕 편집"; snapshot
// target → "{name} ({YYYY년 M월 D일}) 편집" (falls back to
// name-only if no date). Kept inline instead of hoisted to a utils
// file since it's the only place that formats this phrasing.
function editorTitle(
  isSnapshotTarget: boolean,
  name: string | null,
  createdAt: string | null
): string {
  if (!isSnapshotTarget) return '현재 마이딕 편집';
  const displayName = name?.trim() || '스냅샷';
  if (!createdAt) return `${displayName} 편집`;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return `${displayName} 편집`;
  return `${displayName} (${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일) 편집`;
}

type DraftSlot = MyDigAlbum | null;

// What the editor is editing. The default target is the owner's
// live wall (PUT /api/mydig/vinyl-wall/items + backed by the
// `vinyl_wall_items` table). Snapshot mode points the save action
// at a specific saved snapshot instead, so the owner can re-open
// and rearrange a previously archived wall from its detail page.
export type EditTarget =
  | { kind: 'wall' }
  | { kind: 'snapshot'; id: number; slug: string };

interface Props {
  username: string;
  initialWall: MyDigWallItem[];
  onClose: () => void;
  target?: EditTarget;
  // Shared "wall header" fields. For a wall target these come from
  // `users.vinyl_wall_theme` / `users.vinyl_wall_description`; for a
  // snapshot target they come from the snapshot row itself. The
  // editor treats both the same way so name + description + albums
  // are a single "편집" surface regardless of target.
  initialTheme?: string | null;
  initialDescription?: string | null;
  // Snapshot-target only — starting public flag. The editor shows a
  // public toggle alongside the title/description block when the
  // target is a snapshot.
  initialIsPublic?: boolean;
  // Snapshot-target only — ISO timestamp of when the snapshot was
  // captured. Drives the "{name} ({YYYY년 M월 D일}) 편집" header
  // title; optional so we can fall back to name-only if missing.
  initialSnapshotDate?: string | null;
}

export default function VinylWallEditor({
  username,
  initialWall,
  onClose,
  target = { kind: 'wall' },
  initialTheme = null,
  initialDescription = null,
  initialIsPublic = false,
  initialSnapshotDate = null,
}: Props) {
  const isSnapshotTarget = target.kind === 'snapshot';
  // Hydrate the 22-element draft array from the sparse server payload.
  const [draft, setDraft] = useState<DraftSlot[]>(() => {
    const arr: DraftSlot[] = new Array(WALL_TOTAL).fill(null);
    for (const it of initialWall) {
      if (it.position >= 0 && it.position < WALL_TOTAL) {
        arr[it.position] = it.album;
      }
    }
    return arr;
  });

  const [source, setSource] = useState<MyDigCandidateSource>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  // Selection state for the click/tap path (mobile primary, desktop
  // secondary-to-drag). A selected album can originate either from the
  // right-side candidate panel (`selectedSource === null`) or from an
  // occupied wall slot (`selectedSource === <position>`). The source
  // distinguishes placement semantics: panel → place-or-overwrite,
  // wall → swap. This replaces the older single-field selection that
  // only tracked the album and treated every tap as "overwrite", which
  // left wall-to-wall rearrangement unreachable for non-drag users.
  const [selectedAlbum, setSelectedAlbum] = useState<MyDigAlbum | null>(null);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  // While native drag-drop is in flight, this holds the source
  // position (if reordering from inside the wall) or `-1` for
  // drags originating in the candidate panel. Only used so
  // dragover highlights skip the same-slot-no-op case.
  const dragSource = useRef<number | null>(null);

  // Debounce search input so every keystroke doesn't hit the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Browser-back support for the edit modal. We pushState a marker
  // entry on mount so pressing Back pops that entry instead of
  // leaving /my/:u. The popstate handler closes the editor in that
  // case; programmatic close (from 취소 / 저장) explicitly pops the
  // entry so forward history stays tidy.
  //
  // onCloseRef / skipHistoryPopRef dance:
  //   - popstate → flip `skip` and call onClose. React unmounts the
  //     editor → cleanup runs, sees `skip=true`, skips its own
  //     history.back() (the entry is already popped).
  //   - close-button → onClose runs, unmount → cleanup runs with
  //     `skip=false` → history.back() pops the marker so the URL
  //     returns to the pre-edit state.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const skipHistoryPopRef = useRef(false);
  useEffect(() => {
    const prevState = window.history.state;
    window.history.pushState(
      { ...(prevState ?? {}), myDigEditOpen: true },
      '',
      window.location.href
    );
    const onPopstate = () => {
      skipHistoryPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPopstate);
    return () => {
      window.removeEventListener('popstate', onPopstate);
      if (!skipHistoryPopRef.current) {
        const state = window.history.state as { myDigEditOpen?: boolean } | null;
        if (state?.myDigEditOpen) {
          window.history.back();
        }
      }
    };
  }, []);

  const candidates = useMyDigCandidates(source, debouncedQ, true);
  // Both save hooks share the same (items) => Promise shape, so the
  // rest of the editor can stay agnostic — the target just picks
  // which endpoint the PUT hits.
  const wallSave = useSaveVinylWall(username);
  const snapshotSave = useSaveVinylWallSnapshotItems(
    username,
    target.kind === 'snapshot' ? target.id : null,
    target.kind === 'snapshot' ? target.slug : null
  );
  const save = isSnapshotTarget ? snapshotSave : wallSave;
  const themeUpdate = useUpdateVinylWallTheme(username);
  const snapshotMetaUpdate = useUpdateVinylWallSnapshot(username);

  // Title + description + (snapshot-only) public flag. Shared by
  // both targets so the owner edits name + description + albums in
  // one modal regardless of whether they're editing the live wall
  // or an archived snapshot.
  const [themeInput, setThemeInput] = useState(initialTheme ?? '');
  const [descriptionInput, setDescriptionInput] = useState(
    initialDescription ?? ''
  );
  const [isPublicInput, setIsPublicInput] = useState(initialIsPublic);

  // Save flow. 저장 opens `saveChoicePrompt` first (wall target
  // only), asking whether to also capture the draft as a snapshot.
  // 기억하며 저장 → `snapshotModalOpen` opens the snapshot metadata
  // form. After the snapshot saves, `postSnapshotPrompt` asks
  // whether to revert the wall to its pre-edit state (the snapshot
  // already preserved this moment) or keep the current draft on
  // the wall. 그냥 저장 commits wall directly. Snapshot-target
  // skips the entire flow because "save a snapshot edit as another
  // snapshot" is nonsense.
  const [saveChoicePrompt, setSaveChoicePrompt] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [postSnapshotPrompt, setPostSnapshotPrompt] = useState(false);

  const itemsDirty = draft.some((slot, idx) => {
    const serverItem = initialWall.find((it) => it.position === idx);
    if (!slot && !serverItem) return false;
    if (!slot || !serverItem) return true;
    return slot.id !== serverItem.album.id;
  });
  // Title/description dirty applies to both targets. Public flag
  // only changes in snapshot mode (wall mode handles mydig_public
  // via a different surface).
  const metaDirty =
    themeInput.trim() !== (initialTheme ?? '') ||
    descriptionInput.trim() !== (initialDescription ?? '') ||
    (isSnapshotTarget && isPublicInput !== initialIsPublic);
  const dirty = itemsDirty || metaDirty;

  // Draft → flat items payload, shared by wall-save and
  // snapshot-from-draft paths.
  const draftItems = () =>
    draft
      .map((slot, position) =>
        slot ? { position, albumId: slot.id } : null
      )
      .filter((x): x is { position: number; albumId: number } => x !== null);

  // Core commit path — runs after the snapshot-or-not choice is
  // resolved. Persists meta (title/description and, for snapshots,
  // the public flag) first so a mid-flow failure on items doesn't
  // leave the header desynced. Only patches fields that actually
  // changed — the PATCH handlers treat missing fields as "don't
  // touch".
  const commitWall = async () => {
    const themeTrimmed = themeInput.trim();
    const descTrimmed = descriptionInput.trim();
    const themeChanged = themeTrimmed !== (initialTheme ?? '');
    const descChanged = descTrimmed !== (initialDescription ?? '');
    if (!isSnapshotTarget) {
      const body: { theme?: string | null; description?: string | null } = {};
      if (themeChanged) {
        body.theme = themeTrimmed.length > 0 ? themeTrimmed : null;
      }
      if (descChanged) {
        body.description = descTrimmed.length > 0 ? descTrimmed : null;
      }
      if (body.theme !== undefined || body.description !== undefined) {
        await themeUpdate.mutateAsync(body);
      }
    } else if (target.kind === 'snapshot') {
      const body: {
        id: number;
        name?: string;
        description?: string | null;
        isPublic?: boolean;
      } = { id: target.id };
      if (themeChanged) {
        // Snapshot names can't be blank — fall back to the prior
        // name if the input was emptied.
        body.name =
          themeTrimmed.length > 0 ? themeTrimmed : (initialTheme ?? '');
      }
      if (descChanged) {
        body.description = descTrimmed.length > 0 ? descTrimmed : null;
      }
      if (isPublicInput !== initialIsPublic) {
        body.isPublic = isPublicInput;
      }
      if (
        body.name !== undefined ||
        body.description !== undefined ||
        body.isPublic !== undefined
      ) {
        await snapshotMetaUpdate.mutateAsync(body);
      }
    }
    if (itemsDirty) {
      await save.mutateAsync(draftItems());
    }
  };

  const handleSave = () => {
    if (
      save.isPending ||
      themeUpdate.isPending ||
      snapshotMetaUpdate.isPending
    ) {
      return;
    }
    // Snapshot target saves directly — no "also snapshot?" prompt.
    if (isSnapshotTarget) {
      void (async () => {
        try {
          await commitWall();
          onClose();
        } catch (err: any) {
          alert(err?.response?.data?.error || '저장 실패');
        }
      })();
      return;
    }
    // Wall target: ask whether to also save a snapshot before
    // committing. The modal handles the branch from here.
    setSaveChoicePrompt(true);
  };

  const handleSaveWithoutSnapshot = async () => {
    setSaveChoicePrompt(false);
    try {
      await commitWall();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const handleSaveWithSnapshot = () => {
    // Flip from choice prompt → snapshot metadata modal. The modal
    // saves the snapshot first; its onSaved callback then commits
    // the wall and closes the editor.
    setSaveChoicePrompt(false);
    setSnapshotModalOpen(true);
  };

  const handleCancel = () => {
    if (save.isPending) return;
    if (dirty && !confirm('편집 내용을 버리고 닫을까요?')) return;
    onClose();
  };

  const handleClearAll = () => {
    // Fast path to a scratch wall — the owner typically hits this
    // right before building a themed snapshot that has nothing to
    // do with what's currently on the live wall. Confirm when the
    // current draft already has anything on it so the click isn't
    // destructive.
    const hasAnything = draft.some((s) => s != null);
    if (hasAnything && !confirm('벽의 15장을 모두 비울까요?')) return;
    setDraft(new Array(WALL_TOTAL).fill(null));
    clearSelection();
  };

  // After the snapshot saves, ask whether to revert the wall to its
  // pre-edit state (snapshot already preserved the in-flight draft
  // so it's safe to discard) or keep the draft on the wall.
  const handleAfterSnapshotSaved = () => {
    setSnapshotModalOpen(false);
    setPostSnapshotPrompt(true);
  };

  // Revert → close without touching the wall. The snapshot is
  // already saved, so the moment isn't lost; the wall just stays
  // at whatever it was before the editor opened.
  const handleRevertAfterSnapshot = () => {
    setPostSnapshotPrompt(false);
    onClose();
  };

  // Keep → commit the wall (items + theme/description) with the
  // current draft + inputs.
  const handleKeepAfterSnapshot = async () => {
    setPostSnapshotPrompt(false);
    try {
      await commitWall();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '벽 저장 실패');
    }
  };

  const placeAtSlot = (targetPosition: number, album: MyDigAlbum) => {
    setDraft((prev) => {
      const next = [...prev];
      next[targetPosition] = album;
      return next;
    });
  };

  const swapSlots = (from: number, to: number) => {
    if (from === to) return;
    setDraft((prev) => {
      const next = [...prev];
      const tmp = next[from];
      next[from] = next[to];
      next[to] = tmp;
      return next;
    });
  };

  const clearSlot = (position: number) => {
    setDraft((prev) => {
      const next = [...prev];
      next[position] = null;
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedAlbum(null);
    setSelectedSource(null);
  };

  // Click/tap on a slot resolves against the current selection state.
  // Full table of the four cases the wall handles:
  //
  //   1. No selection + empty slot       → noop
  //   2. No selection + filled slot      → pick up (select from wall)
  //   3. Selection (this slot) + tap it  → deselect
  //   4. Selection + other slot
  //      - selectedSource === null       → place/overwrite (panel drop)
  //      - selectedSource is a position  → swap
  //
  // Path (2) is the one that was missing before — without it the click
  // flow could only place albums from the candidate panel and never
  // rearrange what was already on the wall.
  const handleSlotTap = (position: number) => {
    if (!selectedAlbum) {
      const pickup = draft[position];
      if (pickup) {
        setSelectedAlbum(pickup);
        setSelectedSource(position);
      }
      return;
    }
    if (selectedSource === position) {
      clearSelection();
      return;
    }
    if (selectedSource !== null) {
      swapSlots(selectedSource, position);
    } else {
      placeAtSlot(position, selectedAlbum);
    }
    clearSelection();
  };

  // Split 22 positions into 4 rows (5-5-6-6).
  let cursor = 0;
  const rows = WALL_ROW_SIZES.map((count) => {
    const positions = Array.from({ length: count }, (_, i) => cursor + i);
    cursor += count;
    return positions;
  });

  return (
    <div className="fixed inset-0 z-40 bg-[#0a0703] flex flex-col">
      {/* Header bar — title + dirty indicator on the left, build
          tools (🧹 다 지우기) in the middle, exit actions (취소,
          저장) on the right. 저장 opens a "also save as snapshot?"
          prompt for wall targets; snapshot targets save directly.
          The standalone 📸 스냅샷 button was removed in favour of
          that flow so there's one obvious "I'm done" action. */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-[#12100d]">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#e8a020]">
            {editorTitle(
              isSnapshotTarget,
              initialTheme,
              initialSnapshotDate
            )}
          </span>
          {dirty && (
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
              저장되지 않음
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={save.isPending || !draft.some((s) => s != null)}
            className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="벽의 15장 모두 비우기"
          >
            🧹 다 지우기
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <button
            type="button"
            onClick={handleCancel}
            disabled={save.isPending || themeUpdate.isPending || snapshotMetaUpdate.isPending}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={save.isPending || themeUpdate.isPending || snapshotMetaUpdate.isPending || !dirty}
            className="text-xs font-medium text-[#e8a020] border border-[#e8a020]/60 hover:bg-[#e8a020]/10 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {save.isPending || themeUpdate.isPending || snapshotMetaUpdate.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </header>

      {/* 80 / 20 split layout — the main "mydig" side stays full
          width on mobile (picker collapses into a bottom drawer
          via flex-col reverse). Desktop gets the proper split. */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[780px] mx-auto flex flex-col gap-3 sm:gap-4">
            {/* Title + description + (snapshot-only) public flag.
                Same block for both targets so the owner edits header
                text and albums in one trip; for snapshots the same
                PATCH also renames the snapshot + flips public, which
                previously lived in a separate SnapshotRenameModal. */}
            <div className="flex flex-col gap-2 pb-3 border-b border-white/10">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500">
                {isSnapshotTarget ? '스냅샷 이름' : '벽 제목'}
              </label>
              <input
                type="text"
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                maxLength={isSnapshotTarget ? 60 : 80}
                placeholder={
                  isSnapshotTarget
                    ? '예: 2026년 봄 플레이리스트'
                    : '예: 2026년 4월의 최애'
                }
                className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none placeholder-gray-600"
              />
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mt-1">
                {isSnapshotTarget ? '스냅샷 설명' : '벽 설명'}
              </label>
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                maxLength={240}
                rows={2}
                placeholder={
                  isSnapshotTarget
                    ? '이 스냅샷이 어떤 순간인지 짧게 남겨보세요.'
                    : '예: 4월 내내 열심히 듣고 있는 앨범들입니다.'
                }
                className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none placeholder-gray-600 resize-none leading-snug"
              />
              <p className="text-[10px] text-gray-600 text-right">
                {descriptionInput.length}/240
              </p>
              {isSnapshotTarget && (
                <label className="flex items-center gap-2 mt-1 cursor-pointer text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={isPublicInput}
                    onChange={(e) => setIsPublicInput(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#e8a020] cursor-pointer"
                  />
                  공개 (방문자도 볼 수 있어요)
                </label>
              )}
            </div>
            {rows.map((positions, rowIdx) => (
              <div
                key={rowIdx}
                // 5-column grid matches WALL_ROW_SIZES (5/5/5). An
                // earlier iteration used 6 columns from the 5-5-6-6
                // era, leaving an empty right-hand column that made
                // the records look left-aligned instead of centered.
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                }}
                className="gap-3 sm:gap-4"
              >
                {positions.map((position) => {
                  return (
                    <div key={position} className="w-full aspect-square">
                      <EditWallSlot
                        position={position}
                        album={draft[position]}
                        isSelecting={!!selectedAlbum}
                        isSelectedSource={selectedSource === position}
                        dragSource={dragSource}
                        onDropAlbum={(album) => placeAtSlot(position, album)}
                        onSwap={swapSlots}
                        onClear={clearSlot}
                        onTap={() => handleSlotTap(position)}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </main>

        <aside className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-white/5 bg-[#12100d] flex flex-col max-h-[50vh] lg:max-h-none">
          {/* Source tabs. 굿굿 first surfaces albums the user has
              already endorsed — a natural starting point for wall
              curation. '내 상자' (crate) was dropped from the picker
              while the public crate tier is shelved per the Phase 3
              storefront pivot; 살거 stays as a candidate pool even
              though the wall itself isn't a shopping list. */}
          <div className="flex border-b border-white/5 text-xs">
            {([
              { key: 'upvote', label: '굿굿' },
              { key: 'collection', label: '샀음' },
              { key: 'wantlist', label: '살거' },
              { key: 'all', label: '전체' },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSource(t.key)}
                className={`flex-1 px-2 py-2 transition-colors cursor-pointer ${
                  source === t.key
                    ? 'text-[#e8a020] border-b-2 border-[#e8a020]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Quick-register appears only on the 전체 tab — the other
              three tabs are filtered views of the user's own
              collections, where "this album isn't in dig.haus yet"
              doesn't apply. */}
          {source === 'all' && <QuickRegister />}

          <div className="p-3 border-b border-white/5">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="아티스트 / 앨범 검색"
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none"
            />
            {selectedAlbum ? (
              <div className="mt-2 text-[11px] text-[#e8a020]">
                선택됨: {selectedAlbum.title}
                {selectedSource !== null
                  ? ' — 다른 슬롯 탭으로 교환'
                  : ' — 슬롯 탭으로 배치'}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-gray-600 leading-snug">
                앨범을 <span className="text-gray-400">드래그</span>해서 벽에 놓거나,
                슬롯/앨범을 탭해 선택 후 다른 슬롯을 탭하세요.
              </div>
            )}
          </div>

          <CandidateList
            candidates={candidates}
            selectedAlbum={selectedAlbum}
            selectedSource={selectedSource}
            onSelectAlbum={(album) => {
              // Picking from the candidate panel while a wall slot is
              // already selected replaces the selection — the user's
              // most recent gesture wins, and the previous wall source
              // just goes back to its slot untouched.
              if (
                selectedAlbum?.id === album.id &&
                selectedSource === null
              ) {
                clearSelection();
                return;
              }
              setSelectedAlbum(candidateToAlbum(album));
              setSelectedSource(null);
            }}
            dragSource={dragSource}
            debouncedQ={debouncedQ}
          />
        </aside>
      </div>

      {/* Scratch-snapshot machinery — wall-target only. Editing a
          snapshot itself doesn't need the "save as snapshot" detour
          or the "revert vs keep" follow-up. */}
      {!isSnapshotTarget && saveChoicePrompt && (
        <SaveChoicePrompt
          pending={save.isPending || themeUpdate.isPending || snapshotMetaUpdate.isPending}
          onWallOnly={handleSaveWithoutSnapshot}
          onWithSnapshot={handleSaveWithSnapshot}
          onCancel={() => setSaveChoicePrompt(false)}
        />
      )}

      {!isSnapshotTarget && snapshotModalOpen && (
        <SnapshotSaveModal
          username={username}
          items={draftItems()}
          onClose={() => setSnapshotModalOpen(false)}
          onSaved={handleAfterSnapshotSaved}
        />
      )}

      {!isSnapshotTarget && postSnapshotPrompt && (
        <RevertOrKeepPrompt
          pending={save.isPending || themeUpdate.isPending}
          onRevert={handleRevertAfterSnapshot}
          onKeep={handleKeepAfterSnapshot}
        />
      )}
    </div>
  );
}

// After 기억하며 저장 finishes the snapshot half, ask whether to
// roll the wall back or keep the draft. Snapshot captured the
// moment already, so "roll back" costs nothing — it just skips the
// wall PUT / theme PATCH. "Keep" commits the draft normally.
function RevertOrKeepPrompt({
  pending,
  onRevert,
  onKeep,
}: {
  pending: boolean;
  onRevert: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5">
        <h2 className="text-lg text-white font-serif italic mb-1">
          기억 저장됨
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          '기억'을 남겼으니 편집 하기 전 상태로 돌아갈까요? 아니라고
          하시면 지금의 구성이 현재 마이딕에 그대로 남아요.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onKeep}
            disabled={pending}
            className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-md border border-white/10 hover:border-white/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? '저장 중…' : '아니요, 이 상태 유지'}
          </button>
          <button
            type="button"
            onClick={onRevert}
            disabled={pending}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/60 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            네, 원래대로
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveChoicePrompt({
  pending,
  onWallOnly,
  onWithSnapshot,
  onCancel,
}: {
  pending: boolean;
  onWallOnly: () => void;
  onWithSnapshot: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal
    >
      <div className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5">
        <h2 className="text-lg text-white font-serif italic mb-1">
          저장하기
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          지금의 앨범 구성을 '기억'할까요? 그렇게 하면 기록이 남아
          추후에 언제든지 이 구성을 확인할 수 있어요.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onWallOnly}
            disabled={pending}
            className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-md border border-white/10 hover:border-white/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? '저장 중…' : '그냥 저장'}
          </button>
          <button
            type="button"
            onClick={onWithSnapshot}
            disabled={pending}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/60 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            📸 기억하며 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function candidateToAlbum(c: MyDigCandidate): MyDigAlbum {
  return {
    id: c.id,
    mbid: c.mbid,
    slug: c.slug,
    title: c.title,
    artist: c.artist,
    releaseYear: c.releaseYear,
    coverArtUrl: c.coverArtUrl,
    coverArtFallbacks: c.coverArtFallbacks ?? [],
  };
}

function EditWallSlot({
  position,
  album,
  isSelecting,
  isSelectedSource,
  dragSource,
  onDropAlbum,
  onSwap,
  onClear,
  onTap,
}: {
  position: number;
  album: MyDigAlbum | null;
  isSelecting: boolean;
  isSelectedSource: boolean;
  dragSource: React.MutableRefObject<number | null>;
  onDropAlbum: (album: MyDigAlbum) => void;
  onSwap: (from: number, to: number) => void;
  onClear: (position: number) => void;
  onTap: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);

  // Native dragstart listener. React's synthetic onDragStart
  // doesn't fire reliably here (confirmed via tracing) — binding
  // through addEventListener bypasses the synthetic event system
  // and fires when the browser initiates the drag. Other drag
  // phases (over, leave, drop, end) stay on React handlers.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !album) return;
    const handler = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      dragSource.current = position;
      e.dataTransfer.effectAllowed = 'move';
      const payload = JSON.stringify({
        ...album,
        _sourcePosition: position,
      });
      e.dataTransfer.setData('application/x-mydig-album', payload);
      // text/plain fallback — some browsers refuse to enter the
      // drop phase unless a standard type is present.
      e.dataTransfer.setData('text/plain', payload);
    };
    el.addEventListener('dragstart', handler);
    return () => el.removeEventListener('dragstart', handler);
  }, [album, position, dragSource]);

  const handleDragOver = (e: React.DragEvent) => {
    if (dragSource.current === position) return;
    e.preventDefault();
    // Match dropEffect to the source's effectAllowed. A copy-from-
    // candidate (source = -1) must show dropEffect='copy' or the
    // browser rejects the drop outright and onDrop never fires.
    // Slot-to-slot drags are semantically moves.
    e.dataTransfer.dropEffect = dragSource.current === -1 ? 'copy' : 'move';
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data =
      e.dataTransfer.getData('application/x-mydig-album') ||
      e.dataTransfer.getData('text/plain');
    if (!data) {
      dragSource.current = null;
      return;
    }
    try {
      const payload = JSON.parse(data) as MyDigAlbum & { _sourcePosition?: number };
      if (typeof payload._sourcePosition === 'number') {
        onSwap(payload._sourcePosition, position);
      } else {
        onDropAlbum(payload);
      }
    } catch {
      /* malformed payload; ignore */
    }
    dragSource.current = null;
  };

  const handleDragEnd = () => {
    dragSource.current = null;
  };

  const baseClass =
    'relative w-full h-full rounded-md overflow-hidden transition-all group';
  // Highlight priority: dragOver (hovering a drop target) > selected
  // source (click/tap selection) > filled > empty. DragOver borrows the
  // same amber ring as selection — both signal "this slot is active"
  // and reusing the look keeps the edit canvas quiet. Selected source
  // dims the slot so the picked-up album visually "lifts off" the wall
  // while the user decides where to drop it.
  const stateClass = dragOver
    ? 'ring-2 ring-[#e8a020] ring-offset-2 ring-offset-[#0a0703]'
    : isSelectedSource
      ? 'ring-2 ring-[#e8a020] ring-offset-2 ring-offset-[#0a0703] opacity-60'
      : album
        ? 'bg-[#1a1a1a]'
        : `border border-dashed bg-white/[0.02] ${
            isSelecting ? 'border-[#e8a020]/60 hover:border-[#e8a020]' : 'border-white/10'
          }`;

  // Single element handles both drag source (when the slot holds an
  // album) and drop target. The earlier nested `<div draggable>`
  // inside the drop-target div was failing to fire its onDragStart
  // in some browsers — the browser would start a native drag on the
  // element, bypassing React's synthetic onDragStart, so setData()
  // never ran and drop received an empty payload. Collapsing to one
  // div gets React's event delegation to reliably catch dragstart.
  return (
    <div
      ref={slotRef}
      draggable={!!album}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={onTap}
      className={`${baseClass} ${stateClass} ${
        album ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {album ? (
        <>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear(position);
            }}
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-[11px] bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500 transition-opacity"
            aria-label="이 슬롯 비우기"
          >
            ×
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-700">
          {position + 1}
        </div>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  selectedAlbum,
  selectedSource,
  onSelectAlbum,
  dragSource,
  debouncedQ,
}: {
  candidates: ReturnType<typeof useMyDigCandidates>;
  selectedAlbum: MyDigAlbum | null;
  selectedSource: number | null;
  onSelectAlbum: (album: MyDigCandidate) => void;
  dragSource: React.MutableRefObject<number | null>;
  debouncedQ: string;
}) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = candidates;
  // Flatten all pages into one sequence for rendering. React Query
  // keeps pages across paginations so already-loaded rows don't
  // re-render as the user scrolls.
  const albums = data?.pages.flatMap((p) => p.albums) ?? [];

  // Sentinel at the end of the list — when it intersects the
  // scroll container, request the next page. Fetch is guarded by
  // hasNextPage + isFetchingNextPage so we never over-request.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }
      },
      { rootMargin: '120px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 text-xs text-gray-500">로딩 중…</div>
      </div>
    );
  }
  if (albums.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 text-xs text-gray-500">
          {debouncedQ ? '검색 결과 없음' : '항목 없음'}
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto divide-y divide-white/5">
      {albums.map((album) => (
        <CandidateRow
          key={album.id}
          album={album}
          // Only highlight a candidate row when the selection
          // specifically originated from the panel (source === null).
          // A wall-origin selection of the same album elsewhere
          // shouldn't light up the candidate row — they're different
          // actions even though the album id matches.
          isSelected={
            selectedAlbum?.id === album.id && selectedSource === null
          }
          onSelect={() => onSelectAlbum(album)}
          dragSource={dragSource}
        />
      ))}
      {/* Sentinel row at the very bottom. Takes minimal space but
          is tall enough for the IntersectionObserver to reliably
          fire as it scrolls into view. */}
      <div ref={sentinelRef} className="h-8 flex items-center justify-center">
        {isFetchingNextPage && (
          <span className="text-[10px] text-gray-600">더 불러오는 중…</span>
        )}
        {!hasNextPage && albums.length > 20 && (
          <span className="text-[10px] text-gray-700">더 없음</span>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  album,
  isSelected,
  onSelect,
  dragSource,
}: {
  album: MyDigCandidate;
  isSelected: boolean;
  onSelect: () => void;
  dragSource: React.MutableRefObject<number | null>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Same native dragstart workaround as EditWallSlot.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const handler = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      dragSource.current = -1;
      e.dataTransfer.effectAllowed = 'copy';
      const payload = JSON.stringify(candidateToAlbum(album));
      e.dataTransfer.setData('application/x-mydig-album', payload);
      e.dataTransfer.setData('text/plain', payload);
    };
    el.addEventListener('dragstart', handler);
    return () => el.removeEventListener('dragstart', handler);
  }, [album, dragSource]);

  const handleDragEnd = () => {
    dragSource.current = null;
  };

  return (
    <div
      ref={rowRef}
      draggable
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      // cursor-grab signals the row is draggable; it flips to
      // grabbing while the drag is in flight via active:cursor.
      className={`p-2 flex items-center gap-2 cursor-grab active:cursor-grabbing transition-colors ${
        isSelected ? 'bg-[#e8a020]/15' : 'hover:bg-white/5'
      }`}
    >
      <CoverArt
        src={album.coverArtUrl}
        fallbacks={album.coverArtFallbacks}
        alt={album.title}
        className="w-10 h-10 rounded object-cover flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white font-medium truncate">{album.title}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {album.artist}
          {album.releaseYear ? ` · ${album.releaseYear}` : ''}
        </div>
      </div>
    </div>
  );
}
