import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  useReplaceHomeFeatures,
  useUpdateHomeMeta,
} from '../../hooks/useHomeFeatures';
import { useSearch } from '../../hooks/useSearch';

// Phase 3b — Vinyl Wall edit mode. 80/20 split, native HTML5
// drag-drop on desktop, tap-to-select + tap-slot on touch. Edit
// state lives entirely in-memory here; submit button pushes the
// full 15-slot array to PUT /api/mydig/vinyl-wall/items (bulk
// replace in a transaction server-side). Cancel resets to the
// server snapshot.

// Default slot grid (mydig wall + snapshots): 5-5-5 = 15 slots. The
// home-features target overrides this with 5-5 = 10; see DEFAULT_ROW_SIZES
// vs the slotConfig prop below.
const DEFAULT_ROW_SIZES = [5, 5, 5] as const;
const HOME_FEATURES_ROW_SIZES = [5, 5] as const;

// Header title builder. Per target:
//   - wall            → "현재 마이딕 편집"
//   - snapshot        → "{name} ({YYYY년 M월 D일}) 편집" (date optional)
//   - home-features   → "dig.haus 벽 편집" (admin-curated singleton)
//   - fresh-snapshot  → "새 기억 만들기" (blank canvas, save jumps
//                       straight to snapshot capture without touching
//                       the live wall)
function editorTitle(
  targetKind: EditTarget['kind'],
  name: string | null,
  createdAt: string | null
): string {
  if (targetKind === 'home-features') return 'dig.haus 벽 편집';
  if (targetKind === 'wall') return '현재 마이딕 편집';
  if (targetKind === 'fresh-snapshot') return '새 기억 만들기';
  const displayName = name?.trim() || '스냅샷';
  if (!createdAt) return `${displayName} 편집`;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return `${displayName} 편집`;
  return `${displayName} (${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일) 편집`;
}

type DraftSlot = MyDigAlbum | null;

// Flattened candidate panel view fed into <CandidateList>. Either
// the mydig 4-tab infinite query or the home-features DB-search
// query gets adapted into this shape so the list rendering stays
// target-agnostic.
interface CandidatePanelData {
  albums: MyDigCandidate[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

// What the editor is editing.
//   - wall            — owner's live mydig wall (PUT /api/mydig/vinyl-wall/items)
//   - snapshot        — a specific saved snapshot row
//   - home-features   — the admin-curated global home wall, single
//                       `home_features` + `home_meta` row in DB; no
//                       per-user scope, no snapshot concept
//   - fresh-snapshot  — blank-canvas snapshot composer. Identical UX
//                       to wall mode but 저장 skips the "also save
//                       wall?" branch and goes directly to the
//                       snapshot capture modal; the live wall is
//                       never touched. Entry point: 📸 기억 남기기
//                       → "처음부터 새 기억" branch on /my/:username.
export type EditTarget =
  | { kind: 'wall' }
  | { kind: 'snapshot'; id: number; slug: string }
  | { kind: 'home-features'; wallId: number }
  | { kind: 'fresh-snapshot' };

interface Props {
  // Optional because home-features has no per-user scope. Required
  // for wall + snapshot targets — runtime guards inside save/meta
  // hooks already short-circuit on missing username, but in practice
  // the mydig surfaces always pass it.
  username?: string;
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
  // home-features target only — current handwritten-header position
  // knobs from home_meta. The editor surfaces 3 small inputs for
  // these alongside the title + description; PATCH /home/meta accepts
  // them. Optional so non-home-features callers don't need to pass
  // them.
  initialHeaderTopPx?: number;
  initialHeaderLeftPx?: number;
  initialHeaderRotationDeg?: number;
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
  initialHeaderTopPx = -120,
  initialHeaderLeftPx = 4,
  initialHeaderRotationDeg = -4,
}: Props) {
  const isSnapshotTarget = target.kind === 'snapshot';
  const isHomeFeaturesTarget = target.kind === 'home-features';
  const isWallTarget = target.kind === 'wall';
  const isFreshSnapshotTarget = target.kind === 'fresh-snapshot';
  // Slot count is target-driven: home-features uses 5-5 (10), the
  // mydig wall + snapshots stay on 5-5-5 (15). Server-side the
  // home_features.position CHECK is `< 15`, so 10 fits comfortably;
  // shrinking the editor matches what the public home wall renders.
  const wallRowSizes = isHomeFeaturesTarget
    ? HOME_FEATURES_ROW_SIZES
    : DEFAULT_ROW_SIZES;
  const wallTotal = wallRowSizes.reduce((a, b) => a + b, 0);
  // Hydrate the draft array from the sparse server payload.
  const [draft, setDraft] = useState<DraftSlot[]>(() => {
    const arr: DraftSlot[] = new Array(wallTotal).fill(null);
    for (const it of initialWall) {
      if (it.position >= 0 && it.position < wallTotal) {
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

  // Two candidate sources, picked per target. Both flatten to the
  // same MyDigCandidate[] view fed into <CandidateList>.
  //   - mydig (wall + snapshot) → 4-tab infinite query
  //   - home-features          → DB-only album search (admin scope,
  //     no per-user filters); single page, no pagination, so the
  //     panel just hides the load-more sentinel
  const myDigCandidates = useMyDigCandidates(
    source,
    debouncedQ,
    !isHomeFeaturesTarget
  );
  const homeSearch = useSearch(isHomeFeaturesTarget ? debouncedQ : '');
  const candidatePanel: CandidatePanelData = useMemo(() => {
    if (isHomeFeaturesTarget) {
      const albums = (homeSearch.data?.albums ?? []).map(
        (a): MyDigCandidate => ({
          // No numeric DB id from /albums/search — home-features
          // saves use mbid, so id is unused in this mode. Kept as 0
          // for the shared MyDigCandidate shape; React keys + identity
          // checks switched to mbid below.
          id: 0,
          mbid: a.mbid,
          slug: null,
          title: a.title,
          artist: a.artist,
          releaseYear: a.year,
          coverArtUrl: a.coverArtUrl,
          coverArtFallbacks: a.coverArtFallbacks,
        })
      );
      return {
        albums,
        isLoading: homeSearch.isLoading,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: () => {},
      };
    }
    return {
      albums: myDigCandidates.data?.pages.flatMap((p) => p.albums) ?? [],
      isLoading: myDigCandidates.isLoading,
      hasNextPage: !!myDigCandidates.hasNextPage,
      isFetchingNextPage: !!myDigCandidates.isFetchingNextPage,
      fetchNextPage: () => myDigCandidates.fetchNextPage(),
    };
  }, [
    isHomeFeaturesTarget,
    homeSearch.data,
    homeSearch.isLoading,
    myDigCandidates.data,
    myDigCandidates.isLoading,
    myDigCandidates.hasNextPage,
    myDigCandidates.isFetchingNextPage,
    myDigCandidates.fetchNextPage,
  ]);

  // Save + meta hooks for all three targets. All instantiated up-front
  // (hooks are unconditional) and dispatched per-target inside
  // commitWall. The mydig hooks already no-op on missing username, so
  // home-features instantiates them harmlessly.
  const wallSave = useSaveVinylWall(username);
  const snapshotSave = useSaveVinylWallSnapshotItems(
    username,
    target.kind === 'snapshot' ? target.id : null,
    target.kind === 'snapshot' ? target.slug : null
  );
  const homeFeaturesWallId = isHomeFeaturesTarget
    ? (target as { kind: 'home-features'; wallId: number }).wallId
    : 1;
  const homeFeaturesSave = useReplaceHomeFeatures(homeFeaturesWallId);
  const save = isHomeFeaturesTarget
    ? homeFeaturesSave
    : isSnapshotTarget
      ? snapshotSave
      : wallSave;
  const themeUpdate = useUpdateVinylWallTheme(username);
  const snapshotMetaUpdate = useUpdateVinylWallSnapshot(username);
  const homeMetaUpdate = useUpdateHomeMeta(homeFeaturesWallId);

  // Title + description + (snapshot-only) public flag. Shared by
  // both targets so the owner edits name + description + albums in
  // one modal regardless of whether they're editing the live wall
  // or an archived snapshot.
  const [themeInput, setThemeInput] = useState(initialTheme ?? '');
  const [descriptionInput, setDescriptionInput] = useState(
    initialDescription ?? ''
  );
  const [isPublicInput, setIsPublicInput] = useState(initialIsPublic);
  // home-features-only — handwritten header position knobs. Number
  // inputs in the editor sidebar; commitWall folds the changed ones
  // into the same PATCH /home/meta call as theme + description.
  const [headerTopInput, setHeaderTopInput] = useState(initialHeaderTopPx);
  const [headerLeftInput, setHeaderLeftInput] = useState(initialHeaderLeftPx);
  const [headerRotationInput, setHeaderRotationInput] = useState(
    initialHeaderRotationDeg
  );

  // Save flow. 저장 opens `saveChoicePrompt` first (wall target
  // only), asking whether to also capture the draft as a snapshot.
  // 기억하며 저장 → `snapshotModalOpen` opens the snapshot metadata
  // form. After the snapshot saves, the editor closes immediately —
  // the draft is committed to the live wall and the snapshot is the
  // archived moment. We previously prompted "revert or keep?" here
  // but the question added a step without giving the user anything
  // they couldn't already do (snapshots are immutable archives;
  // "revert" was effectively asking them to discard their edit).
  // 그냥 저장 commits wall directly. Snapshot-target skips the
  // entire flow because "save a snapshot edit as another snapshot"
  // is nonsense.
  const [saveChoicePrompt, setSaveChoicePrompt] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);

  const itemsDirty = draft.some((slot, idx) => {
    const serverItem = initialWall.find((it) => it.position === idx);
    if (!slot && !serverItem) return false;
    if (!slot || !serverItem) return true;
    // Compare on mbid — search-derived candidates carry id=0, so
    // equality on the numeric id would falsely flag two different
    // albums as identical in home-features mode.
    return slot.mbid !== serverItem.album.mbid;
  });
  // Title/description dirty applies to all targets. Public flag is a
  // snapshot-only concept — wall mode is public-by-default with no
  // owner-side toggle, and home-features has no concept of private.
  // Header position knobs are home-features-only.
  const headerPosDirty =
    isHomeFeaturesTarget &&
    (headerTopInput !== initialHeaderTopPx ||
      headerLeftInput !== initialHeaderLeftPx ||
      headerRotationInput !== initialHeaderRotationDeg);
  const metaDirty =
    themeInput.trim() !== (initialTheme ?? '') ||
    descriptionInput.trim() !== (initialDescription ?? '') ||
    (isSnapshotTarget && isPublicInput !== initialIsPublic) ||
    headerPosDirty;
  const dirty = itemsDirty || metaDirty;

  // Draft → flat items payload, shared by mydig wall + snapshot
  // paths (both keyed on numeric albumId).
  const draftItems = () =>
    draft
      .map((slot, position) =>
        slot ? { position, albumId: slot.id } : null
      )
      .filter((x): x is { position: number; albumId: number } => x !== null);

  // Home-features uses mbid + note instead of albumId — matches the
  // PUT /api/home/features/items endpoint. Note is null for now;
  // the editor doesn't surface a per-slot note input yet.
  const draftHomeFeatureItems = () =>
    draft
      .map((slot, position) =>
        slot ? { position, mbid: slot.mbid, note: null } : null
      )
      .filter(
        (x): x is { position: number; mbid: string; note: null } => x !== null
      );

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

    if (isWallTarget) {
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
    } else if (isHomeFeaturesTarget) {
      // Home-meta PATCH treats missing fields as "don't touch" so we
      // only send what changed (matches the snapshot/wall PATCH
      // behaviour). Theme/description and the three header position
      // knobs all flow through the same mutation.
      const body: import('../../hooks/useHomeFeatures').HomeMetaPatch = {};
      if (themeChanged) {
        body.theme = themeTrimmed.length > 0 ? themeTrimmed : null;
      }
      if (descChanged) {
        body.description = descTrimmed.length > 0 ? descTrimmed : null;
      }
      if (headerTopInput !== initialHeaderTopPx) {
        body.headerTopPx = headerTopInput;
      }
      if (headerLeftInput !== initialHeaderLeftPx) {
        body.headerLeftPx = headerLeftInput;
      }
      if (headerRotationInput !== initialHeaderRotationDeg) {
        body.headerRotationDeg = headerRotationInput;
      }
      if (Object.keys(body).length > 0) {
        await homeMetaUpdate.mutateAsync(body);
      }
    }

    if (itemsDirty) {
      if (isHomeFeaturesTarget) {
        await homeFeaturesSave.mutateAsync(draftHomeFeatureItems());
      } else if (isSnapshotTarget) {
        await snapshotSave.mutateAsync(draftItems());
      } else {
        await wallSave.mutateAsync(draftItems());
      }
    }
  };

  const handleSave = () => {
    if (
      save.isPending ||
      themeUpdate.isPending ||
      snapshotMetaUpdate.isPending ||
      homeMetaUpdate.isPending
    ) {
      return;
    }
    // Snapshot + home-features targets save directly — no
    // "also snapshot?" detour. Snapshots have nothing to capture (the
    // user is editing one already); home-features is a global
    // singleton with no snapshot concept.
    if (isSnapshotTarget || isHomeFeaturesTarget) {
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
    // Fresh-snapshot target: skip the "also save wall?" detour because
    // the whole point of this entry path is to compose a snapshot
    // without touching the live wall. Jump directly to the snapshot
    // metadata modal; once it saves, the editor closes without
    // committing anything to vinyl_wall_items.
    if (isFreshSnapshotTarget) {
      setSnapshotModalOpen(true);
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
    // do with what's currently on the live wall. Wipes the title +
    // description inputs alongside the slot grid so a rebuild
    // starts from a fully blank canvas instead of the previous
    // theme leaking into the new arrangement. Confirm when there's
    // anything on the wall (slots) OR in the meta inputs.
    const hasAnything =
      draft.some((s) => s != null) ||
      themeInput.trim() !== '' ||
      descriptionInput.trim() !== '';
    if (hasAnything && !confirm(`벽의 ${wallTotal}장과 제목 · 설명을 모두 비울까요?`)) return;
    setDraft(new Array(wallTotal).fill(null));
    setThemeInput('');
    setDescriptionInput('');
    clearSelection();
  };

  // After the snapshot saves, commit the wall edit and close. Wall
  // target: persist the draft into vinyl_wall_items (the user
  // explicitly chose 기억하며 저장, so they want both the snapshot
  // and the live wall updated). Fresh-snapshot target: skip the
  // commit because that path never touches the live wall by design.
  const handleAfterSnapshotSaved = async () => {
    setSnapshotModalOpen(false);
    if (isFreshSnapshotTarget) {
      onClose();
      return;
    }
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

  // Split positions into rows per the active row-size config (mydig
  // 5-5-5, home-features 5-5).
  let cursor = 0;
  const rows = wallRowSizes.map((count) => {
    const positions = Array.from({ length: count }, (_, i) => cursor + i);
    cursor += count;
    return positions;
  });

  return (
    <div className="fixed inset-0 z-40 bg-panel-strong flex flex-col">
      {/* Header bar — title + dirty indicator on the left, build
          tools (🧹 다 지우기) in the middle, exit actions (취소,
          저장) on the right. 저장 opens a "also save as snapshot?"
          prompt for wall targets; snapshot targets save directly.
          The standalone 📸 스냅샷 button was removed in favour of
          that flow so there's one obvious "I'm done" action. */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-[#12100d]">
        <div className="flex items-center gap-3">
          <span className="text-sm text-accent">
            {editorTitle(target.kind, initialTheme, initialSnapshotDate)}
          </span>
          {dirty && (
            <span className="text-[12px] font-medium text-gray-500 uppercase tracking-wider">
              저장되지 않음
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={save.isPending || !draft.some((s) => s != null)}
            className="text-sm text-gray-400 hover:text-white px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="벽의 15장 모두 비우기"
          >
            🧹 다 지우기
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <button
            type="button"
            onClick={handleCancel}
            disabled={
              save.isPending ||
              themeUpdate.isPending ||
              snapshotMetaUpdate.isPending ||
              homeMetaUpdate.isPending
            }
            className="text-sm text-gray-400 hover:text-white px-3 py-1.5 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              save.isPending ||
              themeUpdate.isPending ||
              snapshotMetaUpdate.isPending ||
              homeMetaUpdate.isPending ||
              !dirty
            }
            className="text-sm font-medium text-accent border border-accent/60 hover:bg-accent/10 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {save.isPending ||
            themeUpdate.isPending ||
            snapshotMetaUpdate.isPending ||
            homeMetaUpdate.isPending
              ? '저장 중…'
              : '저장'}
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
              <label className="block text-[12px] uppercase tracking-wider text-gray-500">
                {isSnapshotTarget
                  ? '스냅샷 이름'
                  : isHomeFeaturesTarget
                    ? '시그니처 제목'
                    : '제목'}
              </label>
              <input
                type="text"
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                maxLength={isSnapshotTarget ? 60 : 80}
                placeholder={
                  isSnapshotTarget
                    ? '예: 2026년 봄 플레이리스트'
                    : isHomeFeaturesTarget
                      ? '예: dig.haus / 이번 달 픽'
                      : '예: 2026년 4월의 최애'
                }
                className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none placeholder-gray-600"
              />
              <label className="block text-[12px] uppercase tracking-wider text-gray-500 mt-1">
                {isSnapshotTarget
                  ? '스냅샷 설명'
                  : isHomeFeaturesTarget
                    ? '시그니처 설명'
                    : '설명'}
              </label>
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                maxLength={240}
                rows={2}
                placeholder={
                  isSnapshotTarget
                    ? '이 스냅샷이 어떤 순간인지 짧게 남겨보세요.'
                    : isHomeFeaturesTarget
                      ? '예: 운영자가 한 달 동안 발굴한 15장'
                      : '예: 4월 내내 열심히 듣고 있는 앨범들입니다.'
                }
                className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none placeholder-gray-600 resize-none leading-snug"
              />
              <p className="text-[12px] text-gray-600 text-right">
                {descriptionInput.length}/240
              </p>
              {isSnapshotTarget && (
                <label className="flex items-center gap-2 mt-1 cursor-pointer text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={isPublicInput}
                    onChange={(e) => setIsPublicInput(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                  />
                  공개 (방문자도 볼 수 있어요)
                </label>
              )}
              {isHomeFeaturesTarget && (
                <div className="mt-2 pt-3 border-t border-white/10">
                  <div className="text-[12px] uppercase tracking-wider text-gray-500 mb-2">
                    손글씨 위치
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] text-gray-500">위 (px)</span>
                      <input
                        type="number"
                        value={headerTopInput}
                        onChange={(e) =>
                          setHeaderTopInput(parseInt(e.target.value) || 0)
                        }
                        min={-800}
                        max={800}
                        step={4}
                        className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] text-gray-500">왼쪽 (px)</span>
                      <input
                        type="number"
                        value={headerLeftInput}
                        onChange={(e) =>
                          setHeaderLeftInput(parseInt(e.target.value) || 0)
                        }
                        min={-800}
                        max={1200}
                        step={4}
                        className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] text-gray-500">기울기 (°)</span>
                      <input
                        type="number"
                        value={headerRotationInput}
                        onChange={(e) =>
                          setHeaderRotationInput(parseInt(e.target.value) || 0)
                        }
                        min={-45}
                        max={45}
                        step={1}
                        className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-accent focus:outline-none"
                      />
                    </label>
                  </div>
                  <p className="text-[12px] text-gray-600 mt-1.5 leading-relaxed">
                    위는 음수일수록 위로, 왼쪽은 양수일수록 오른쪽으로. 저장하면 홈 화면에 바로 반영됩니다.
                  </p>
                </div>
              )}
            </div>
            {rows.map((positions, rowIdx) => (
              <div
                key={rowIdx}
                // 5-column grid matches the row sizes (mydig 5/5/5,
                // home-features 5/5). An earlier iteration used 6
                // columns from the 5-5-6-6 era, leaving an empty
                // right-hand column that made the records look
                // left-aligned instead of centered.
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
          {/* Source tabs — mydig only. Home-features is admin-curated
              and has no per-user "굿굿 / 샀음 / 살거" semantics; the
              picker collapses to plain DB search. */}
          {!isHomeFeaturesTarget && (
            <div className="flex border-b border-white/5 text-sm">
              {([
                { key: 'upvote', label: '굿굿' },
                { key: 'crate', label: '내 상자' },
                { key: 'all', label: '전체' },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSource(t.key)}
                  className={`flex-1 px-2 py-2 transition-colors cursor-pointer ${
                    source === t.key
                      ? 'text-accent border-b-2 border-accent'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Quick-register appears only on the mydig 전체 tab — the
              other three tabs are filtered views of the user's own
              collections, where "this album isn't in dig.haus yet"
              doesn't apply. Hidden for home-features (admin scope;
              the admin can register albums via the dedicated UI). */}
          {!isHomeFeaturesTarget && source === 'all' && <QuickRegister />}

          <div className="p-3 border-b border-white/5">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="아티스트 / 앨범 검색"
              className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none"
            />
            {selectedAlbum ? (
              <div className="mt-2 text-[13px] text-accent">
                선택됨: {selectedAlbum.title}
                {selectedSource !== null
                  ? ' — 다른 슬롯 탭으로 교환'
                  : ' — 슬롯 탭으로 배치'}
              </div>
            ) : (
              <div className="mt-2 text-[12px] text-gray-600 leading-snug">
                앨범을 <span className="text-gray-400">드래그</span>해서 벽에 놓거나,
                슬롯/앨범을 탭해 선택 후 다른 슬롯을 탭하세요.
              </div>
            )}
          </div>

          <CandidateList
            panel={candidatePanel}
            selectedAlbum={selectedAlbum}
            selectedSource={selectedSource}
            onSelectAlbum={(album) => {
              // Picking from the candidate panel while a wall slot is
              // already selected replaces the selection — the user's
              // most recent gesture wins, and the previous wall source
              // just goes back to its slot untouched. Identity check
              // uses mbid because home-features candidates carry id=0.
              if (
                selectedAlbum?.mbid === album.mbid &&
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

      {/* Scratch-snapshot machinery — mydig wall target only. Editing
          a snapshot itself doesn't need the "save as snapshot" detour;
          home-features is global + has no snapshot concept. The
          isWallTarget gate also narrows `username` to `string` for the
          SnapshotSaveModal mount below. */}
      {isWallTarget && saveChoicePrompt && (
        <SaveChoicePrompt
          pending={save.isPending || themeUpdate.isPending || snapshotMetaUpdate.isPending}
          onWallOnly={handleSaveWithoutSnapshot}
          onWithSnapshot={handleSaveWithSnapshot}
          onCancel={() => setSaveChoicePrompt(false)}
        />
      )}

      {(isWallTarget || isFreshSnapshotTarget) && snapshotModalOpen && username && (
        <SnapshotSaveModal
          username={username}
          items={draftItems()}
          // Pre-fill the snapshot name with the editor's current
          // theme input (falls back to the originally-saved theme
          // if the input is empty, then to today's date inside the
          // modal). Description likewise mirrors the editor so the
          // owner doesn't have to retype either field.
          initialName={themeInput.trim() || initialTheme || null}
          initialDescription={descriptionInput.trim() || null}
          onClose={() => setSnapshotModalOpen(false)}
          onSaved={handleAfterSnapshotSaved}
        />
      )}

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
      <div className="w-full max-w-md bg-panel-strong border border-white/10 rounded-xl p-5">
        <h2 className="text-lg text-white font-serif italic mb-1">
          저장하기
        </h2>
        <p className="text-sm text-gray-400 mb-5 leading-relaxed">
          지금의 앨범 구성을 '기억'할까요? 그렇게 하면 기록이 남아
          추후에 언제든지 이 구성을 확인할 수 있어요.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onWallOnly}
            disabled={pending}
            className="text-sm text-gray-300 hover:text-white px-3 py-1.5 rounded-md border border-white/10 hover:border-white/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? '저장 중…' : '그냥 저장'}
          </button>
          <button
            type="button"
            onClick={onWithSnapshot}
            disabled={pending}
            className="text-sm text-accent hover:text-accent-hover border border-accent/60 hover:border-accent rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
    ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel-strong'
    : isSelectedSource
      ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel-strong opacity-60'
      : album
        ? 'bg-panel'
        : `border border-dashed bg-white/[0.02] ${
            isSelecting ? 'border-accent/60 hover:border-accent' : 'border-white/10'
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
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-[13px] bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500 transition-opacity"
            aria-label="이 슬롯 비우기"
          >
            ×
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[12px] text-gray-700">
          {position + 1}
        </div>
      )}
    </div>
  );
}

function CandidateList({
  panel,
  selectedAlbum,
  selectedSource,
  onSelectAlbum,
  dragSource,
  debouncedQ,
}: {
  panel: CandidatePanelData;
  selectedAlbum: MyDigAlbum | null;
  selectedSource: number | null;
  onSelectAlbum: (album: MyDigCandidate) => void;
  dragSource: React.MutableRefObject<number | null>;
  debouncedQ: string;
}) {
  const {
    albums,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = panel;

  // Sentinel at the end of the list — when it intersects the
  // scroll container, request the next page. Fetch is guarded by
  // hasNextPage + isFetchingNextPage so we never over-request.
  // Home-features panel always sets hasNextPage=false so this just
  // doesn't fire there.
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
        <div className="p-4 text-sm text-gray-500">로딩 중…</div>
      </div>
    );
  }
  if (albums.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 text-sm text-gray-500">
          {debouncedQ ? '검색 결과 없음' : '항목 없음'}
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto divide-y divide-white/5">
      {albums.map((album) => (
        <CandidateRow
          // mbid is the only id field guaranteed to be unique across
          // both candidate sources (mydig DB rows + home-features
          // search-derived rows where numeric id is 0).
          key={album.mbid}
          album={album}
          // Only highlight a candidate row when the selection
          // specifically originated from the panel (source === null).
          // A wall-origin selection of the same album elsewhere
          // shouldn't light up the candidate row — they're different
          // actions even though the album mbid matches.
          isSelected={
            selectedAlbum?.mbid === album.mbid && selectedSource === null
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
          <span className="text-[12px] text-gray-600">더 불러오는 중…</span>
        )}
        {!hasNextPage && albums.length > 20 && (
          <span className="text-[12px] text-gray-700">더 없음</span>
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
        isSelected ? 'bg-accent/15' : 'hover:bg-white/5'
      }`}
    >
      <CoverArt
        src={album.coverArtUrl}
        fallbacks={album.coverArtFallbacks}
        alt={album.title}
        className="w-10 h-10 rounded object-cover flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium truncate">{album.title}</div>
        <div className="text-[12px] text-gray-500 truncate">
          {album.artist}
          {album.releaseYear ? ` · ${album.releaseYear}` : ''}
        </div>
      </div>
    </div>
  );
}
