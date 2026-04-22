import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useMyDig,
  useUpdateVinylWallTheme,
  useVinylWallSnapshots,
  type MyDigWallItem,
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

  // Wall items come back sparse (position → item). Build a map
  // keyed by slot position; WallScene looks up slots by position
  // and renders empty slots as bare wall.
  const wallByPosition = new Map<number, MyDigWallItem>();
  for (const it of data.vinylWall) wallByPosition.set(it.position, it);

  return (
    // Transparent so the app-root backdrop (painted wall image +
    // brightness/saturate filter) shows through behind the page
    // content. See App.tsx for the backdrop layer.
    <div className="flex-1">
      <main className="max-w-[1120px] mx-auto px-4 pt-4 pb-8 space-y-1">
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

        <WallSection>
          <VinylWallGrid
            wallByPosition={wallByPosition}
            isOwner={data.user.isOwner}
          />
        </WallSection>

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
              themePlaceholder ? 'text-[#c9a860]' : 'text-[#f5d89a]'
            }`}
            title={displayThemeText}
          >
            {displayThemeText}
          </h1>
          {isOwner && (
            <button
              type="button"
              onClick={onEditTheme}
              className="text-[11px] text-gray-400 hover:text-[#e8a020] cursor-pointer transition-colors"
              title="벽 제목 수정"
            >
              ✏️
            </button>
          )}
        </div>

        {/* Secondary: @username · {displayName}의 mydig (or just
            "@username의 mydig" when no distinct display name).
            Warmer amber tones than the earlier gray — reads clearly
            on the painted beige wall without a text-shadow halo. */}
        <div className="mt-1.5 text-sm truncate">
          <span className="text-[#e8a020]">@{username}</span>
          <span className="text-[#c9a060]">
            {displayName && displayName.toLowerCase() !== username.toLowerCase()
              ? ` · ${displayName}의 mydig`
              : '의 mydig'}
          </span>
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
    } catch (err) {
      // Surfaced in the red error line below via update.error;
      // logged here too so the browser console shows the full
      // response for debugging.
      console.error('[mydig/theme] save failed:', err);
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
          <p className="text-xs text-red-400 mt-3">
            저장 실패: {(update.error as any)?.response?.data?.error
              ?? (update.error as any)?.message
              ?? '알 수 없는 오류'}
          </p>
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
// Plain wrapper. Previous iterations layered radial lamp pools +
// concrete noise + dust motes here, then an image backdrop with
// scene container; both created visible zone boundaries against
// the rest of the page. Stripping the overlays keeps the whole
// page uniform warm walnut.
function WallSection({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        // Bottom padding also trimmed (was 40px) so the snapshot
        // strip beneath sits closer to the wall without a big
        // dead zone between.
        padding: '4px 12px 12px',
      }}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

// ─── Vinyl Wall grid ──────────────────────────────────────────
// CSS grid with wooden rail under each row. 5 cols × 3 rows on
// desktop, 3 cols × 5 rows on mobile — both cover the full 15
// slots. Container-width-driven via ResizeObserver so the cover
// size + rail width always track the available space cleanly.
function VinylWallGrid({
  wallByPosition,
  isOwner,
}: {
  wallByPosition: Map<number, MyDigWallItem>;
  isOwner: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mobile = width < 520;
  const cols = mobile ? 3 : 5;
  const rowCount = 15 / cols;
  const maxLpSize = mobile ? 128 : 168;
  const gapX = mobile ? 10 : 16;
  const rowGap = mobile ? 24 : 32;
  const overhang = mobile ? 14 : 36;
  const fit = (width - 2 * overhang - (cols - 1) * gapX) / cols;
  const lpSize = Math.max(40, Math.min(maxLpSize, Math.floor(fit)));
  const railWidth = Math.round(width);
  const railHeight = mobile ? 16 : 20;

  const rows = Array.from({ length: rowCount }, (_, ri) => ({
    positions: Array.from({ length: cols }, (_, ci) => ri * cols + ci),
  }));

  // Tiny deterministic pseudo-random so records don't sit on a
  // perfect x-axis. Applied via marginLeft (not transform) so the
  // wrapper isn't a new stacking context and hover:z-20 on the
  // cell can still raise it above its neighbours.
  const variance = (seed: number) => {
    const h = Math.abs(((seed * 2654435761) >>> 0) % 10000) / 10000;
    return h * 2 - 1;
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        paddingTop: 12,
        // Very subtle "painted" post-process so the photographic
        // covers and the SVG rails read as closer siblings of the
        // painted wall backdrop — slight desaturation + softer
        // contrast + tiny brightness knock pull the records out of
        // their photo-crisp look without making them hard to read.
        filter: 'contrast(0.94) saturate(0.88) brightness(0.97)',
      }}
    >
      {rows.map(({ positions }, ri) => (
        <div key={ri} style={{ position: 'relative', marginBottom: rowGap }}>
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
              const jx = variance(ri * 131 + ci * 17 + 1) * (mobile ? 2 : 4);
              if (!item) {
                return (
                  <div key={position} style={{ marginLeft: jx }}>
                    <WallLP
                      size={lpSize}
                      seed={position}
                      empty
                      lampBias={lampBias}
                    />
                  </div>
                );
              }
              return (
                <WallCell
                  key={position}
                  item={item}
                  position={position}
                  lpSize={lpSize}
                  lampBias={lampBias}
                  mobile={mobile}
                  offsetX={jx}
                />
              );
            })}
          </div>
          <div style={{ position: 'relative', marginTop: 0 }}>
            <WallRail
              width={railWidth}
              seed={ri * 37 + 13}
              height={railHeight}
              style={{ display: 'block' }}
            />
          </div>
        </div>
      ))}
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
// One filled slot. Desktop: hover triggers vinyl-peek + cover
// scale (bottom-origin so the record grows upward from the rail)
// + optional comment bubble on the owner's own 50자 평. Mobile:
// plain tap-to-navigate, no hover state.
function WallCell({
  item,
  position,
  lpSize,
  lampBias,
  mobile,
  offsetX,
}: {
  item: MyDigWallItem;
  position: number;
  lpSize: number;
  lampBias: number;
  mobile: boolean;
  offsetX: number;
}) {
  const { album, userReview } = item;
  const target = album.slug || album.mbid;

  if (mobile) {
    return (
      <Link
        to={`/album/${target}`}
        title={`${album.artist} — ${album.title}`}
        className="relative block"
        style={{
          width: lpSize,
          height: lpSize,
          marginLeft: offsetX,
          textDecoration: 'none',
        }}
      >
        <WallLP size={lpSize} seed={position} lampBias={lampBias}>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
        </WallLP>
      </Link>
    );
  }

  return (
    <Link
      to={`/album/${target}`}
      title={`${album.artist} — ${album.title}`}
      className="group relative block hover:z-20"
      style={{
        width: lpSize,
        height: lpSize,
        marginLeft: offsetX,
        textDecoration: 'none',
      }}
    >
      {/* Vinyl disc behind the cover — peeks out to the right on
          hover. Scales with the same bottom-center origin as the
          cover so both grow in lockstep from the rail line. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 origin-bottom transition-transform duration-[280ms] ease-out group-hover:translate-x-[24%] group-hover:rotate-[6deg] group-hover:scale-[1.2]"
      >
        <VinylDisc size={lpSize} />
      </div>

      {/* Cover — scales up 1.2× on hover, bottom-pinned so the
          record "grows up" rather than lifting off the rail. */}
      <div className="absolute inset-0 z-10 origin-bottom transition-transform duration-[280ms] ease-out group-hover:scale-[1.2]">
        <WallLP size={lpSize} seed={position} lampBias={lampBias}>
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
        </WallLP>
      </div>

      {userReview && (
        <CommentBubble
          body={userReview.body}
          emoji={userReview.emoji}
          rating={userReview.rating}
          lpSize={lpSize}
        />
      )}
    </Link>
  );
}

function CommentBubble({
  body,
  emoji,
  rating,
  lpSize,
}: {
  body: string;
  emoji: string | null;
  rating: string | null;
  lpSize: number;
}) {
  const ratingIcon =
    rating === 'up' ? '👍' : rating === 'down' ? '👎' : null;
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
          {body}
          {ratingIcon && <span className="not-italic ml-1.5">{ratingIcon}</span>}
          {emoji && <span className="not-italic ml-1">{emoji}</span>}
        </div>
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

