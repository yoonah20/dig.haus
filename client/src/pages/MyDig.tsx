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
import GraffitiSnapshotList from '../components/MyDig/GraffitiSnapshotList';
import ShareButton from '../components/MyDig/ShareButton';
import UserHoverCard from '../components/UserHoverCard';
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
          userId={data.user.id ?? null}
          username={data.user.username}
          displayName={data.user.displayName}
          avatarUrl={data.user.avatarUrl}
          isOwner={data.user.isOwner}
          wallTheme={data.vinylWallTheme}
          wallDescription={data.vinylWallDescription}
          onEdit={() => setEditingWall(true)}
          onSaveSnapshot={() => setSavingSnapshot(true)}
          onEditTheme={() => setEditingTheme(true)}
          shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        />

        {/* Wall left, scribbled snapshot names right. Grid tracks
            are 1fr / 320px so the scribble column has room to
            breathe; the wall itself caps at 720px internally +
            left-aligns (no more mx-auto) so it stays anchored
            to the leading edge rather than drifting toward the
            track center. Below md the two stack — wall first,
            scribbles below. */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4 md:gap-6">
          <WallSection>
            <VinylWallGrid
              wallByPosition={wallByPosition}
              isOwner={data.user.isOwner}
            />
          </WallSection>
          {username && (
            <GraffitiSnapshotList
              username={username}
              snapshots={snapshotsQuery.data?.snapshots ?? []}
              isOwner={data.user.isOwner}
            />
          )}
        </div>

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
            initialTheme={data.vinylWallTheme}
            initialDescription={data.vinylWallDescription}
            onClose={() => setEditingTheme(false)}
          />
        )}
      </main>
    </div>
  );
}

// ─── Profile header ──────────────────────────────────────────
// Hierarchy on wide viewports:
//   [avatar]  WALL THEME (big italic serif)        [·open· 편집 📸 공유]
//             @username · displayName
//
// Actions (open indicator + owner controls + share) used to sit in a
// third row below the username, which forced the wall to start well
// below the avatar's bottom edge. Moving them into a right-aligned
// cluster on the same line as the title lets the header collapse to
// avatar-height and the wall rail starts ~40–50px higher. On narrow
// viewports the cluster wraps below the title block so none of it
// gets squashed.
function ProfileHeader({
  userId,
  username,
  displayName,
  avatarUrl,
  isOwner,
  wallTheme,
  wallDescription,
  onEdit,
  onSaveSnapshot,
  onEditTheme,
  shareUrl,
}: {
  userId: number | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  wallTheme: string | null;
  wallDescription: string | null;
  onEdit: () => void;
  onSaveSnapshot: () => void;
  onEditTheme: () => void;
  shareUrl: string;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const displayThemeText = wallTheme || 'my dig';
  const themePlaceholder = !wallTheme;
  const hasDistinctDisplayName =
    !!displayName && displayName.toLowerCase() !== username.toLowerCase();
  const avatarEl = resolvedAvatar ? (
    <img
      src={resolvedAvatar}
      alt=""
      aria-hidden
      className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border border-white/10"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#1a1410] border border-white/10 flex items-center justify-center">
      <span className="text-xl sm:text-2xl text-[#e8a020]/70 font-serif italic">
        {initial}
      </span>
    </div>
  );
  return (
    <header className="pt-2 pb-3 flex flex-col gap-2">
      {/* Avatar + @username sit on one compact row. The separate
          "@ line under the title" the earlier layout had is gone —
          visitors read identity once, up top, attached to the
          portrait, and the theme + description below get all the
          vertical space. Avatar wraps in UserHoverCard so the
          same popover that surfaces on album-detail comment rows
          works here too. */}
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {userId != null ? (
            <UserHoverCard userId={userId}>{avatarEl}</UserHoverCard>
          ) : (
            avatarEl
          )}
        </div>
        <div className="min-w-0 text-sm truncate">
          <span className="text-[#e8a020]">@{username}</span>
          <span className="text-[#c9a060]">
            {hasDistinctDisplayName
              ? ` · ${displayName}의 mydig`
              : '의 mydig'}
          </span>
        </div>
      </div>

      {/* Theme title + its edit pencil. Own row so the h1 has
          room without a name line next to it. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <h1
          className={`text-xl sm:text-2xl font-serif italic leading-tight truncate ${
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
            title="제목 / 설명 수정"
          >
            ✏️
          </button>
        )}
      </div>

      {/* Description — smaller, muted. Shown to everyone when the
          owner has filled one in; when empty, we render nothing
          for visitors and a faint placeholder hint for the
          owner so the affordance is discoverable. */}
      {wallDescription ? (
        <p className="text-[13px] text-[#c9a060]/90 leading-relaxed max-w-[640px]">
          {wallDescription}
        </p>
      ) : isOwner ? (
        <p className="text-[12px] text-gray-600 italic">
          ✏️ 버튼으로 간단한 설명을 추가할 수 있어요.
        </p>
      ) : null}

      {/* Owner action cluster — tucked below the description line,
          right-aligned in the header row. Visibly separate from
          identity (avatar + @username) and content (theme +
          description) but close enough that the edit gesture is
          still tied to the page header. OPEN indicator is gone —
          it was ornament without information. */}
      {isOwner && (
        <div className="flex items-center gap-2 flex-wrap justify-end -mt-1">
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
          >
            ✏️ 편집
          </button>
          <button
            type="button"
            onClick={onSaveSnapshot}
            className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
            title="현재 벽을 스냅샷으로 저장"
          >
            📸 스냅샷
          </button>
          <ShareButton url={shareUrl} label="공유" />
        </div>
      )}
      {!isOwner && (
        <div className="flex items-center gap-2 flex-wrap justify-end -mt-1">
          <ShareButton url={shareUrl} label="공유" />
        </div>
      )}
    </header>
  );
}

// ─── Theme + description edit modal ──────────────────────────
// One modal for both fields — they live side by side under the
// wall title so editing them together reads more naturally than
// two separate dialogs. Empty values clear back to defaults
// (theme falls back to "my dig"; description just hides).
function ThemeEditModal({
  username,
  initialTheme,
  initialDescription,
  onClose,
}: {
  username: string;
  initialTheme: string | null;
  initialDescription: string | null;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState(initialTheme ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const update = useUpdateVinylWallTheme(username);

  const handleSave = async () => {
    if (update.isPending) return;
    try {
      await update.mutateAsync({
        theme: theme.trim() ? theme.trim() : null,
        description: description.trim() ? description.trim() : null,
      });
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
        <h2 className="text-lg text-white font-serif italic mb-1">벽 정보</h2>
        <p className="text-xs text-gray-500 mb-4">
          벽의 제목과 짧은 설명을 적어주세요. 비워두면 기본값으로 돌아가요.
        </p>

        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
          제목
        </label>
        <input
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          maxLength={80}
          autoFocus
          className="w-full bg-[#0a0503] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e8a020] focus:outline-none"
          placeholder="예: 2026년 4월의 최애"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />

        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1 mt-4">
          설명
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={240}
          rows={3}
          className="w-full bg-[#0a0503] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e8a020] focus:outline-none resize-none"
          placeholder="예: 4월 내내 열심히 듣고 있는 앨범들입니다."
        />
        <p className="text-[10px] text-gray-600 mt-1">
          {description.length}/240
        </p>
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
        maxWidth: 720,
        marginLeft: 0,
        marginRight: 'auto',
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
          {/* Per-row horizontal offset so the three rails don't
              sit in perfectly lined-up positions. Small deltas
              only — the wall still reads as one wall, just with
              the rails clearly not joined seams. */}
          <div
            style={{
              position: 'relative',
              marginTop: 0,
              transform: `translateX(${[0, 10, -5][ri] ?? 0}px)`,
            }}
          >
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
          className="px-3 py-2 rounded-xl text-[11px] leading-snug font-serif italic"
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

