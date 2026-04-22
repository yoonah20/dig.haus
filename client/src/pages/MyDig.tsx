import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useMyDig,
  useUpdateVinylWallTheme,
  useVinylWallSnapshots,
  type MyDigWallItem,
  type MyDigShelfSlot,
  type MyDigCrate,
} from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
import SnapshotSaveModal from '../components/MyDig/SnapshotSaveModal';
import SnapshotList from '../components/MyDig/SnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
import { VinylDisc, WallLP, WallRail } from '../components/MyDig/storefront/primitives';
import { resolveApiUrl } from '../utils/apiUrl';

// Phase 3a skeleton — the four-layer placeholder scaffold described
// in CLAUDE.md. No edit mode, no drag-drop, no flip-through yet —
// just the read-only "storefront" rendered with whatever items the
// server returns (empty arrays for users who haven't placed
// anything, which is everyone right now).
//
// The empty-is-OK aesthetic is the whole point of this commit:
// Wall renders 22 slots always, Shelf renders 6 bins always, Crate
// renders only what exists (zero crates = no crate row). Subsequent
// sub-phases (3b-3d) layer item-level interactions on top of this
// scaffold without touching the layout logic.

// Vinyl Wall rows: 5-5-5 = 15 slots, equal cover sizes. Reverted
// from the short-lived 5-5-6-6 experiment — the late-night pendant
// scene reads cleaner with three symmetric rows framing the lamp
// pool on all sides, and 22 slots squeezed covers narrower on
// mobile than the shopfront aesthetic wanted.
// Vinyl Wall rows: 5-5-5 = 15 slots on three rails. Earlier trim
// to 10 (5-5) was a workaround for a layout bug where the second
// row was landing on the baseboard because ShopScene was a
// fixed-ratio box that sliced its own interior into wall vs
// floor. The real fix is to drop the box (no more wall/floor
// boundary), which means there's no boundary to clip against
// anymore and all three rails fit naturally.
const WALL_ROW_SIZES = [5, 5, 5] as const;

const SHELF_BIN_COUNT = 6;

export default function MyDig() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, error } = useMyDig(username);
  const [editingWall, setEditingWall] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [editingTheme, setEditingTheme] = useState(false);
  const snapshotsQuery = useVinylWallSnapshots(username);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg">이 페이지를 불러오지 못했어요.</p>
          <Link to="/" className="text-[#e8a020] mt-4 inline-block hover:underline">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  // Private mode — under-construction placeholder. Preserves the
  // shop aesthetic instead of showing a cold 403/404. Per CLAUDE.md
  // the visual should read as "fabric drape over the storefront +
  // A4 notice taped on"; the full illustration lands in 3a polish.
  if (!data.isPublic) {
    return (
      <div className="flex-1 max-w-[1120px] mx-auto px-4 py-12">
        <div className="rounded-2xl bg-[#12100d] border border-white/5 p-10 sm:p-16 text-center">
          <div className="text-5xl mb-4" aria-hidden>🚧</div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-3">
            {data.user.displayName || data.user.username}님의 가게가 준비 중입니다
          </h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
            문 열 준비가 되면 다시 찾아주세요.
          </p>
        </div>
      </div>
    );
  }

  // Wall items come back sparse (position → item). Build a dense
  // 15-element array with nulls for the empty-frame render.
  const wallByPosition = new Map<number, MyDigWallItem>();
  for (const it of data.vinylWall) wallByPosition.set(it.position, it);

  // Shelf slots come back sparse too — fill 6 bins, null where
  // admin hasn't assigned a genre yet.
  const shelfByPosition = new Map<number, MyDigShelfSlot>();
  for (const s of data.shelf) shelfByPosition.set(s.position, s);

  return (
    <div className="flex-1" style={{ background: '#0a0503' }}>
      <main className="max-w-[1120px] mx-auto px-4 py-8 space-y-6">
        {/* Hybrid profile header: avatar block + display name block.
            Sits OUTSIDE the shop scene below — lets visitors see who
            they're visiting before the scene's late-night immersion
            takes over. Kept to a single quiet row so the header
            doesn't fight the lamp-pool drama. */}
        <ProfileHeader
          username={data.user.username}
          displayName={data.user.displayName}
          avatarUrl={data.user.avatarUrl}
          isOwner={data.user.isOwner}
          wallTheme={data.vinylWallTheme}
          onEdit={() => setEditingWall(true)}
          onSaveSnapshot={() => setSavingSnapshot(true)}
          onEditTheme={() => setEditingTheme(true)}
          shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        />

        {/* Tier 1 — Vinyl Wall. Three rails (5-5-5 = 15) sitting
            on a soft ambient page background. No bordered container,
            no floor / baseboard bands — the wall flows straight
            out of the profile header above and out to the snapshot
            list below. */}
        <WallSection>
          <VinylWallGrid
            wallByPosition={wallByPosition}
            isOwner={data.user.isOwner}
          />
        </WallSection>

        {/* Snapshot archive — horizontal strip of past walls. Owner
            sees private + public; visitors see only public. Each
            card links into /my/:username/snap/:slug. The whole
            strip hides itself when there are no snapshots to show. */}
        {username && (
          <SnapshotList
            username={username}
            snapshots={snapshotsQuery.data?.snapshots ?? []}
            isOwner={data.user.isOwner}
          />
        )}

        {editingWall && username && (
          <VinylWallEditor
            username={username}
            initialWall={data.vinylWall}
            onClose={() => setEditingWall(false)}
          />
        )}

        {savingSnapshot && username && (
          <SnapshotSaveModal
            username={username}
            onClose={() => setSavingSnapshot(false)}
          />
        )}

        {editingTheme && username && (
          <ThemeEditModal
            username={username}
            initialValue={data.vinylWallTheme}
            onClose={() => setEditingTheme(false)}
          />
        )}

        {/* Shelf + Crate tiers temporarily hidden while we focus on
            getting Vinyl Wall right. Server routes + schema are
            untouched; the tier renders just don't mount. Restore
            when the design + interaction for those tiers is worth
            showing. */}
      </main>
    </div>
  );
}

// ─── Profile header ────────────────────────────────────────────
// Avatar + name block that sits above the shop scene. Avatar is a
// circle portrait; right column stacks the @username breadcrumb,
// the italic-serif display name, and a warm amber "open" indicator
// that matches the dig.haus accent colour elsewhere.
// ─── Profile header ──────────────────────────────────────────
// Hierarchy:
//   [avatar]  WALL THEME (big italic serif — primary focus)
//             @username · displayName (medium muted line)
//             · open ·  [edit] [snapshot] [share]  (small meta row)
//
// The theme replaces the earlier "{name}의 my dig" hybrid title
// that mixed italic + non-italic inside a single h1 and read as
// cluttered. Now only one italic block, one readable-size handle
// line, one compact meta row. Each element has one clear size.
function ProfileHeader({
  username,
  displayName,
  avatarUrl,
  isOwner,
  wallTheme,
  onEdit,
  onSaveSnapshot,
  onEditTheme,
  shareUrl,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  wallTheme: string | null;
  onEdit: () => void;
  onSaveSnapshot: () => void;
  onEditTheme: () => void;
  shareUrl: string;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const displayThemeText = wallTheme || 'my dig';
  const themePlaceholder = !wallTheme;
  return (
    <header className="flex items-start gap-4 pt-2 pb-6">
      <div className="shrink-0">
        {resolvedAvatar ? (
          <img
            src={resolvedAvatar}
            alt=""
            aria-hidden
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border border-white/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#1a1410] border border-white/10 flex items-center justify-center">
            <span className="text-2xl sm:text-3xl text-[#e8a020]/70 font-serif italic">
              {initial}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 pt-1">
        {/* Primary: wall theme (italic serif h1). Owner gets a tiny
            inline pencil that swaps into an input via onEditTheme. */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1
            className={`text-2xl sm:text-3xl font-serif italic leading-tight truncate ${
              themePlaceholder ? 'text-[#7a6650]' : 'text-[#f5e8c8]'
            }`}
            title={displayThemeText}
          >
            {displayThemeText}
          </h1>
          {isOwner && (
            <button
              type="button"
              onClick={onEditTheme}
              className="text-[11px] text-gray-500 hover:text-[#e8a020] cursor-pointer transition-colors"
              title="벽 제목 수정"
            >
              ✏️
            </button>
          )}
        </div>

        {/* Secondary: @username + optional displayName. Readable
            size (text-sm) — no longer the mouse-hunt 11px tracking
            that made the earlier header feel lopsided. */}
        <div className="mt-1.5 text-sm text-gray-400 truncate">
          <span className="text-[#a88a60]">@{username}</span>
          {displayName &&
            displayName.toLowerCase() !== username.toLowerCase() && (
              <span className="text-gray-500"> · {displayName}</span>
            )}
        </div>

        {/* Meta row: status + owner actions + share */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-[#e8a020]">
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[#e8a020]"
              style={{ boxShadow: '0 0 5px rgba(232, 160, 32, 0.7)' }}
            />
            open
          </span>
          {isOwner && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                ✏️ 편집
              </button>
              <button
                type="button"
                onClick={onSaveSnapshot}
                className="text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title="현재 벽을 스냅샷으로 저장"
              >
                📸 스냅샷
              </button>
            </>
          )}
          <ShareButton url={shareUrl} label="공유" />
        </div>
      </div>
    </header>
  );
}

// ─── Theme edit modal ────────────────────────────────────────
// Mirrors SnapshotSaveModal's shape so the two edit surfaces feel
// like siblings. Submits a PATCH; server persists to users.
// vinyl_wall_theme. Empty input clears the theme back to the
// "my dig" fallback.
function ThemeEditModal({
  username,
  initialValue,
  onClose,
}: {
  username: string;
  initialValue: string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const update = useUpdateVinylWallTheme(username);

  const handleSave = async () => {
    if (update.isPending) return;
    try {
      await update.mutateAsync(value.trim() ? value.trim() : null);
      onClose();
    } catch {
      /* error surfaced below */
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg text-white font-serif italic mb-1">벽 제목</h2>
        <p className="text-xs text-gray-500 mb-4">
          지금 벽의 주제를 한 줄로 적어주세요. 비워두면 "my dig"로 돌아가요.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          autoFocus
          className="w-full bg-[#0a0503] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e8a020] focus:outline-none"
          placeholder="예: 2026년 4월의 최애"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSave();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        {update.isError && (
          <p className="text-xs text-red-400 mt-3">저장에 실패했어요.</p>
        )}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 cursor-pointer disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={update.isPending}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/50 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 transition-colors"
          >
            {update.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Wall section ─────────────────────────────────────────────
// The previous version was boxed + banded (wall/floor ratio,
// baseboard, plank seams, pendant overlays) which clipped rows
// and read as a framed panel. This version keeps the page flow
// but restores atmosphere so the wall has air around it:
//   - Soft vertical warmth gradient (no hard wall/floor boundary)
//   - Warm lamp pool concentrated upper-left (matches each WallLP's
//     lampBias direction so the shadow play stays consistent)
//   - Very faint painted-surface noise for texture
//   - A few ambient dust motes in the lit area
// No enclosing border, no background box — the section sits on
// the same #0a0503 base as the rest of the page so records look
// hung on the page, not mounted inside a window.
function WallSection({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        // Top padding is generous so hover-triggered comment
        // bubbles on the first row have room above the cover
        // without spilling out of the scene.
        padding: '72px 12px 40px',
        // overflow: visible so bubbles and the scaled-up hovered
        // cover can extend past the nominal section bounds. The
        // -40 inset gradients bleed slightly into surrounding
        // page space but the effect reads as ambient, not broken.
      }}
    >
      {/* 1. Vertical warmth — slightly brighter warm top fading to
          deeper dark at the bottom. Implies gravity / depth without
          a hard line. Mixed over the page's base (#0a0503) so the
          bottom effectively returns to the page color. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(56, 38, 20, 0.55) 0%, rgba(30, 20, 10, 0.35) 50%, rgba(12, 7, 3, 0.5) 100%)',
        }}
      />

      {/* 2. Primary lamp pool — visible but not a spotlight. Upper-
          left biased so it agrees with each WallLP's per-slot
          lampBias direction. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -40,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 55% 50% at 32% 22%, rgba(255, 200, 120, 0.18) 0%, rgba(255, 185, 100, 0.06) 45%, transparent 75%)',
        }}
      />

      {/* 3. Secondary ambient lift on the bottom-right. Earlier
          version had the primary lamp upper-left with no counter-
          light, which left the opposite corner reading as "too
          dark, something's missing." A small weak warm pool here
          balances the frame without introducing a competing
          spotlight — strength tuned low enough that the upper-
          left still reads as the dominant source. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -40,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 40% 35% at 78% 80%, rgba(255, 180, 110, 0.11) 0%, rgba(255, 170, 100, 0.04) 45%, transparent 75%)',
        }}
      />

      {/* 4. Concrete wall texture — porous mid-frequency noise
          with a warm-gray tint sitting under a fine-grain cream
          fleck overlay. Together they read as painted concrete /
          stucco: bigger blotches from the 0.5-freq pass, tiny
          flecks from the 0.9-freq pass. Overlay blend lets the
          underlying warmth through instead of caking a flat color
          on top. */}
      <svg
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.22,
          mixBlendMode: 'overlay',
        }}
      >
        <defs>
          <filter id="mydigWallConcrete">
            <feTurbulence baseFrequency="0.5" numOctaves="3" seed="11" />
            <feColorMatrix values="0 0 0 0 0.72  0 0 0 0 0.68  0 0 0 0 0.6  0 0 0 0.7 0" />
          </filter>
          <filter id="mydigWallFleck">
            <feTurbulence baseFrequency="0.9" numOctaves="2" seed="7" />
            <feColorMatrix values="0 0 0 0 0.9  0 0 0 0 0.78  0 0 0 0 0.55  0 0 0 0.6 0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#mydigWallConcrete)" />
        <rect width="100%" height="100%" filter="url(#mydigWallFleck)" opacity="0.55" />
      </svg>

      {/* 5. Dust motes — tiny warm specks in the lit area. Low
          opacity so they read as ambient dust, not stars. */}
      <svg
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.45,
        }}
      >
        {[
          { x: 180, y: 70, r: 0.7 },
          { x: 260, y: 130, r: 0.5 },
          { x: 340, y: 100, r: 0.6 },
          { x: 420, y: 160, r: 0.5 },
          { x: 210, y: 220, r: 0.6 },
          { x: 380, y: 250, r: 0.4 },
        ].map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#ffd08a" />
        ))}
      </svg>

      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

// Layout reused from the /my-preview Storefront Wall. Four rows
// (5/5/6/6), all LPs the same pixel size, per-row wooden rail sized
// to that row's width, shorter rows centered under the widest row.
// The live mydig page differs from the preview in two ways:
//  (1) content is real album data (CoverArt) instead of FakeCover
//      seeded sleeves, and
//  (2) filled slots are clickable Links to the album page.
// WallLP takes a `children` prop so this component can inject its
// own cover node without forking the primitive.
function VinylWallGrid({
  wallByPosition,
  isOwner,
}: {
  wallByPosition: Map<number, MyDigWallItem>;
  isOwner: boolean;
}) {
  // Measure the actual container width via ResizeObserver so the
  // cover sizing + rail width always track the available space.
  // The previous matchMedia-based version used a fixed lpSize and
  // could overflow or leave records pinned to the left on
  // intermediate viewports. Container-measurement eliminates both
  // modes.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Initial sync (don't wait for first ResizeObserver callback)
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mobile = width < 520;
  // Desktop = 5 cols × 3 rows; mobile = 3 cols × 5 rows. Both cover
  // the full 15 slots cleanly. "2×5"는 15장이 나눠 떨어지지 않아
  // 세로 지향 의도만 살려 3×5로 맞춤 — 원하면 2로 내려 8-row
  // layout으로 변경 가능.
  const cols = mobile ? 3 : 5;
  const rowCount = 15 / cols;
  // 20% bigger than the earlier 140 → 168 desktop ceiling. Actual
  // size floors to whatever fits the measured width so records
  // never overflow or get crammed to one side.
  const maxLpSize = mobile ? 108 : 168;
  const gapX = mobile ? 10 : 16;
  const rowGap = mobile ? 24 : 32;
  // Overhang = how much wider the rail is than the record row.
  // Gives the rail shoulder room so the first/last record doesn't
  // sit flush at the rail's edge — fixes the "레일 왼쪽 끝에 딱
  // 앨범이 고정" awkwardness.
  const overhang = mobile ? 18 : 36;
  const fit = (width - 2 * overhang - (cols - 1) * gapX) / cols;
  const lpSize = Math.max(40, Math.min(maxLpSize, Math.floor(fit)));
  const railWidth = Math.round(width);

  // Rows derived from col count: three rows of 5 on desktop, five
  // rows of 3 on mobile.
  const rows = Array.from({ length: rowCount }, (_, ri) => ({
    positions: Array.from({ length: cols }, (_, ci) => ri * cols + ci),
  }));

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        paddingTop: 12,
      }}
    >
      {rows.map(({ positions }, ri) => {
        return (
          <div key={ri} style={{ position: 'relative', marginBottom: rowGap }}>
            {/* LP row — explicit grid with fixed column width +
                justifyContent:center so the whole cluster is
                always centered within the parent (which matches
                the rail width below). */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, ${lpSize}px)`,
                gap: gapX,
                justifyContent: 'center',
                alignItems: 'end',
              }}
            >
              {positions.map((position, ci) => {
                const item = wallByPosition.get(position);
                const lampBias = 1 - Math.min(1, (ri * cols + ci) / (rowCount * cols));
                if (!item) {
                  return (
                    <WallLP
                      key={position}
                      size={lpSize}
                      seed={position}
                      empty
                      lampBias={lampBias}
                    />
                  );
                }
                return (
                  <WallCell
                    key={position}
                    item={item}
                    position={position}
                    lpSize={lpSize}
                    lampBias={lampBias}
                  />
                );
              })}
            </div>
            {/* Rail — spans the full measured container width so
                records always sit centered on a longer rail with
                breathing room on both sides. */}
            <div style={{ position: 'relative', marginTop: -1 }}>
              <WallRail
                width={railWidth}
                seed={ri * 37 + 13}
                style={{ display: 'block' }}
              />
            </div>
          </div>
        );
      })}
      {wallByPosition.size === 0 && (
        <p className="text-center text-xs text-gray-600 pt-2">
          {isOwner
            ? '아직 벽이 비어 있어요. 편집 버튼으로 앨범을 걸어보세요.'
            : '이 벽은 아직 비어 있어요.'}
        </p>
      )}
    </div>
  );
}

// ─── Wall cell ────────────────────────────────────────────────
// One filled slot. Layout is a .group wrapper Link with three
// layers stacked absolutely:
//   1. VinylDisc — sits behind the cover, translates right + tilts
//      + scales on group-hover. Ports the peek interaction we used
//      to have on the home grid (pre-3036c13). No spin — it reads
//      as overkill at this scale; the still disc is enough.
//   2. WallLP + CoverArt — the cover itself. Scales up 1.04× on
//      group-hover so the whole record rises a hair under the
//      cursor.
//   3. SpeechBubble — optional cartoon bubble on the top-right
//      when the page owner has written a 50자 평 for this album.
//
// z-10 on the cell while hovered so the peeking vinyl + raised
// cover don't get clipped by neighbouring grid cells.
function WallCell({
  item,
  position,
  lpSize,
  lampBias,
}: {
  item: MyDigWallItem;
  position: number;
  lpSize: number;
  lampBias: number;
}) {
  const { album, userReview } = item;
  const target = album.slug || album.mbid;
  return (
    <Link
      to={`/album/${target}`}
      title={`${album.artist} — ${album.title}`}
      className="group relative block hover:z-20"
      style={{
        width: lpSize,
        height: lpSize,
        textDecoration: 'none',
      }}
    >
      {/* Vinyl disc — behind the cover, peeks ~30% out to the
          right on hover. Reduced from the earlier 55% peek which
          read as a full disc ejecting rather than the "just a
          glimpse" effect the home grid used to have. Rotation
          stays gentle. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 transition-transform duration-[280ms] ease-out group-hover:translate-x-[32%] group-hover:rotate-[6deg]"
      >
        <VinylDisc size={lpSize} />
      </div>

      {/* Cover — scales up noticeably on hover (≈1.12) so the
          hovered record clearly rises above its neighbours. */}
      <div
        className="absolute inset-0 z-10 transition-transform duration-[280ms] ease-out group-hover:scale-[1.12]"
      >
        <WallLP size={lpSize} seed={position} lampBias={lampBias}>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
        </WallLP>
      </div>

      {/* Comment bubble — hover-only. Holds the full 50자 평 body
          (with emoji prefix if present). Hidden by default;
          fades + scales in when the cell is hovered, in sync
          with the cover-scale + vinyl peek so all three
          animations hit together. Positioned above the cover,
          tail pointing down. */}
      {userReview && (
        <CommentBubble body={userReview.body} emoji={userReview.emoji} lpSize={lpSize} />
      )}
    </Link>
  );
}

function CommentBubble({
  body,
  emoji,
  lpSize,
}: {
  body: string;
  emoji: string | null;
  lpSize: number;
}) {
  // Cartoon speech bubble. Sits above the cover (bottom:
  // calc(100% + 10px)) so the hovering action doesn't get
  // crowded. Origin-bottom keeps the scale animation grounded
  // to the tail. max-width scales with the cover so larger
  // covers get slightly wider bubbles.
  return (
    <div
      aria-hidden
      className="absolute z-40 pointer-events-none opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-[220ms] ease-out"
      style={{
        bottom: 'calc(100% + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        transformOrigin: '50% 100%',
        width: 'max-content',
        maxWidth: Math.min(260, lpSize * 1.5),
      }}
    >
      <div className="relative">
        <div
          className="px-3 py-2 rounded-xl text-[12px] leading-snug font-serif italic"
          style={{
            background: '#f5e8c8',
            color: '#141008',
            boxShadow:
              '0 6px 14px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(20,14,8,0.2)',
          }}
        >
          {emoji && <span className="not-italic mr-1.5">{emoji}</span>}
          {body}
        </div>
        {/* Tail — rotated square pointing down toward the cover. */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -5,
            marginLeft: -6,
            width: 12,
            height: 12,
            background: '#f5e8c8',
            transform: 'rotate(45deg)',
            boxShadow: '3px 3px 6px rgba(0,0,0,0.3)',
            clipPath: 'polygon(100% 0%, 100% 100%, 0% 100%)',
          }}
        />
      </div>
    </div>
  );
}

function ShelfRow({
  shelfByPosition,
  isOwner,
}: {
  shelfByPosition: Map<number, MyDigShelfSlot>;
  isOwner: boolean;
}) {
  const bins = Array.from({ length: SHELF_BIN_COUNT }, (_, i) =>
    shelfByPosition.get(i) ?? null
  );
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
      {bins.map((slot, idx) => (
        <ShelfBin key={idx} slot={slot} isOwner={isOwner} />
      ))}
    </div>
  );
}

function ShelfBin({ slot, isOwner }: { slot: MyDigShelfSlot | null; isOwner: boolean }) {
  // Empty slot (no genre assigned yet) — furniture outline with
  // "unset" copy. Owner sees a slightly more inviting message.
  if (!slot) {
    return (
      <div className="aspect-[4/5] rounded-md border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center p-3">
        <span className="text-[11px] text-gray-600 text-center leading-tight">
          {isOwner ? '빈 선반' : '—'}
        </span>
      </div>
    );
  }

  const genreLabel = slot.genre ? slot.genre.nameKo : '장르 미지정';
  const firstItem = slot.items[0];
  return (
    <div className="aspect-[4/5] rounded-md bg-[#14120e] border border-white/5 overflow-hidden flex flex-col">
      {/* Bin "stack" preview — first item's cover if any, otherwise
          empty bin interior. Future 3c commits swap this for a
          "stack of LPs with edges" illustration. */}
      <div className="flex-1 relative bg-[#0f0d0a]">
        {firstItem ? (
          <CoverArt
            src={firstItem.album.coverArtUrl}
            fallbacks={firstItem.album.coverArtFallbacks}
            alt={firstItem.album.title}
            className="w-full h-full object-cover opacity-90"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-xl">
            ♪
          </div>
        )}
        {slot.items.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded tabular-nums">
            {slot.items.length}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-white/5">
        <div className="text-[11px] text-[#e8a020] truncate">{genreLabel}</div>
        {slot.genre && (
          <div className="text-[9px] text-gray-600 truncate uppercase tracking-wider">
            {slot.genre.nameEn}
          </div>
        )}
      </div>
    </div>
  );
}

function CrateRow({ crates, isOwner }: { crates: MyDigCrate[]; isOwner: boolean }) {
  if (crates.length === 0) {
    return (
      <p className="text-xs text-gray-600 py-4">
        {isOwner
          ? '크레이트는 나중에 만들 수 있어요.'
          : '크레이트 없음.'}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
      {crates.map((crate) => (
        <CrateBox key={crate.crateId} crate={crate} />
      ))}
    </div>
  );
}

function CrateBox({ crate }: { crate: MyDigCrate }) {
  const firstItem = crate.items[0];
  return (
    <div
      className="aspect-[4/5] rounded-md bg-gradient-to-br from-[#1e1b17] to-[#14110e] border border-white/10 overflow-hidden flex flex-col relative"
      title={crate.description ?? undefined}
    >
      {/* Milk-crate vibe — subtle grid pattern overlay. 3d commit
          will replace this with the full illustration (label tape,
          crate slats, drop-shadow from the "floor"). */}
      <div
        className="flex-1 relative bg-[#0f0d0a]"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '18% 18%',
        }}
      >
        {firstItem ? (
          <CoverArt
            src={firstItem.album.coverArtUrl}
            fallbacks={firstItem.album.coverArtFallbacks}
            alt={firstItem.album.title}
            className="w-full h-full object-cover opacity-85 mix-blend-luminosity"
          />
        ) : null}
        {crate.items.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded tabular-nums">
            {crate.items.length}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-white/5">
        <div className="text-[11px] text-white truncate font-medium">
          {crate.title}
        </div>
      </div>
    </div>
  );
}
