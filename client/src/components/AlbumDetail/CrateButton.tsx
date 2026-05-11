import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useAddToCrate,
  useAlbumCrateMembership,
  useCreateCrate,
  useMyCrates,
  useRemoveFromCrate,
} from '../../hooks/useCrates';

interface Props {
  // Numeric album.id (not mbid/slug) — the crate item endpoint keys
  // on the integer FK. AlbumPage threads it through from the cached
  // detail response.
  albumId: number | null;
  // Public count of distinct users who have this album in any of
  // their public crates. Replaces the prior 샀음/살거 split count;
  // surfaces alongside the chip when > 0.
  crateCount: number;
}

// 담기 button — single chip + dropdown picker. Replaces the legacy
// 샀음/살거 split-pill after the crate absorption (post-Phase 3
// roadmap item 2). Click flow:
//
//   1. Logged out  → opens login.
//   2. Logged in   → toggles a dropdown anchored under the chip.
//      The dropdown lists all of the caller's crates with a
//      checkmark on those already containing the album. Top of
//      the list is "+ 새 상자 만들기" which inlines a name
//      input; Enter creates and adds the album in one shot.
//   3. Clicking a crate row toggles membership (in → remove,
//      out → add). The dropdown stays open so multiple crates
//      can be picked in one session.
//
// The chip itself reflects "is this album in any of my crates" via
// fill/outline state — owners want a glance-confirm that they've
// already saved it. The dropdown reveals which specific crates.
// crateCount next to the chip is the public count and surfaces to
// everyone, logged in or not.
export default function CrateButton({ albumId, crateCount }: Props) {
  const { user, login } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // myCrates is only fetched when the dropdown opens (full crate
  // list with cover thumbs is wasteful otherwise). Membership runs
  // as long as the user is logged in so the chip color is right
  // before any click.
  const myCrates = useMyCrates(!!user && open);
  const membership = useAlbumCrateMembership(albumId, !!user);
  const add = useAddToCrate();
  const remove = useRemoveFromCrate();
  const create = useCreateCrate();

  // Inline new-crate composer — null when collapsed, string while
  // typing. Saves on Enter; Esc / blur collapses without commit.
  const [newCrateName, setNewCrateName] = useState<string | null>(null);

  // Lightweight inline toast for add / remove confirmations. We don't
  // wire up a global toast provider for this single surface — the
  // chip is the only place a 담기 result needs surfacing. Auto-clears
  // after ~1.6s, with the timeout id stashed on a ref so a repeat
  // toggle resets the clock instead of stacking timers.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1600);
  };
  useEffect(
    () => () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  // Close on outside click. Pointerdown beats click for touch devices
  // where a tap on the chip would otherwise re-open immediately after
  // the outside handler closes.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
        setNewCrateName(null);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const inCrateIds = new Set(membership.data?.crateIds ?? []);

  const handleChipClick = () => {
    if (!user) {
      login();
      return;
    }
    setOpen((v) => !v);
  };

  const handleToggle = async (crateId: number) => {
    if (albumId == null) return;
    const crate = myCrates.data?.crates.find((c) => c.id === crateId);
    const title = crate?.title ?? '상자';
    if (inCrateIds.has(crateId)) {
      await remove.mutateAsync({ crateId, albumId });
      showToast(`${title}에서 뺐어요`);
    } else {
      await add.mutateAsync({ crateId, albumId });
      showToast(`${title}에 담았어요`);
    }
  };

  const handleCreate = async () => {
    const title = (newCrateName ?? '').trim();
    if (!title) {
      setNewCrateName(null);
      return;
    }
    if (albumId == null) return;
    try {
      const created = await create.mutateAsync({ title, isPublic: false });
      await add.mutateAsync({ crateId: created.id, albumId });
      setNewCrateName(null);
      showToast(`${title}에 담았어요`);
    } catch (err: any) {
      alert(err?.response?.data?.error || '상자 만들기 실패');
    }
  };

  const isInAnyCrate = inCrateIds.size > 0;

  // Count surfaced inside the chip:
  //   - In any of the caller's own crates → ✓ N (personal count). The
  //     personal "where I have it" stat is what owners actually want
  //     to see at a glance — "did I save it, and how many times?"
  //   - Otherwise, fall back to the public crateCount when > 0 so the
  //     social signal ("N people have this") still shows.
  //   - When nothing applies the chip just reads "📦 담기".
  const chipCount = isInAnyCrate ? inCrateIds.size : crateCount;
  const chipCountPrefix = isInAnyCrate ? '✓ ' : '';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleChipClick}
        aria-expanded={open}
        aria-label="담기"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold border transition-colors cursor-pointer ${
          isInAnyCrate
            ? 'bg-accent border-accent text-panel-strong hover:bg-accent-hover'
            : 'bg-transparent border-accent/60 text-accent hover:bg-accent/10 hover:border-accent'
        }`}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>📦</span>
        <span>담기</span>
        {chipCount > 0 && (
          <span className="tabular-nums opacity-80">
            {chipCountPrefix}
            {chipCount.toLocaleString()}
          </span>
        )}
      </button>

      {/* Inline toast — sits just below the chip, fades out after a
          beat. Pointer-events-none so it can't accidentally swallow
          clicks meant for the chip mid-fade. */}
      {toast && (
        <div
          className="absolute z-40 left-0 top-full mt-2 px-3 py-1.5 rounded-md text-[12px] text-panel-strong bg-accent shadow-[0_4px_12px_rgba(0,0,0,0.45)] pointer-events-none whitespace-nowrap animate-[fadeInUp_220ms_ease-out]"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      {open && (
        <div
          role="menu"
          className="absolute z-30 mt-1.5 left-0 min-w-[220px] max-w-[280px] rounded-md border border-white/15 bg-panel-strong shadow-[0_8px_24px_rgba(0,0,0,0.55)] py-1"
        >
          {/* Inline create row — top of the list so it's the natural
              starting point for a fresh crate without leaving the
              dropdown. */}
          {newCrateName == null ? (
            <button
              type="button"
              onClick={() => setNewCrateName('')}
              className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-white/5 cursor-pointer flex items-center gap-1.5"
            >
              <span>＋</span>
              <span>새 상자 만들기</span>
            </button>
          ) : (
            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
              <input
                type="text"
                autoFocus
                value={newCrateName}
                onChange={(e) => setNewCrateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setNewCrateName(null);
                  }
                }}
                placeholder="상자 이름"
                maxLength={60}
                className="flex-1 min-w-0 bg-panel-strong border border-white/10 rounded px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={create.isPending || !newCrateName?.trim()}
                className="text-sm text-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                담기
              </button>
            </div>
          )}

          <div className="max-h-[300px] overflow-y-auto">
            {myCrates.isLoading && (
              <div className="px-3 py-2 text-sm text-gray-500">
                불러오는 중…
              </div>
            )}
            {!myCrates.isLoading && (myCrates.data?.crates.length ?? 0) === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">
                아직 만든 상자가 없어요.
              </div>
            )}
            {myCrates.data?.crates.map((c) => {
              const inCrate = inCrateIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void handleToggle(c.id)}
                  disabled={add.isPending || remove.isPending}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 cursor-pointer flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] ${
                      inCrate
                        ? 'bg-accent text-panel-strong'
                        : 'border border-white/20'
                    }`}
                  >
                    {inCrate ? '✓' : ''}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-gray-200">
                    {c.title}
                  </span>
                  <span className="text-[11px] text-gray-500 tabular-nums">
                    {c.itemCount}
                  </span>
                  {!c.isPublic && (
                    <span className="text-[10px] text-gray-600" title="비공개">
                      🔒
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
