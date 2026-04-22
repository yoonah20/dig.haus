import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMyDig, type MyDigWallItem, type MyDigShelfSlot, type MyDigCrate } from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import VinylWallEditor from '../components/MyDig/VinylWallEditor';
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
const WALL_ROW_SIZES = [5, 5, 5] as const;

const SHELF_BIN_COUNT = 6;

export default function MyDig() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, error } = useMyDig(username);
  const [editingWall, setEditingWall] = useState(false);

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

  const filledCount = wallByPosition.size;

  return (
    <div
      className="flex-1"
      style={{
        background: '#0a0705',
        // Ultra-subtle radial warmth across the whole page — not a
        // simulated light pool, just a tone shift so the background
        // isn't a flat expanse. Strength low enough that it reads as
        // "warm paper" ambient, not "something is lit over there."
        backgroundImage:
          'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(70, 44, 20, 0.35) 0%, transparent 60%)',
      }}
    >
      <main className="max-w-[980px] mx-auto px-5 sm:px-8 py-10 sm:py-14">
        <MastHead
          username={data.user.username}
          displayName={data.user.displayName}
          avatarUrl={data.user.avatarUrl}
          isOwner={data.user.isOwner}
          filledCount={filledCount}
          onEdit={() => setEditingWall(true)}
        />

        <SectionDivider />

        <WallGrid wallByPosition={wallByPosition} />

        {editingWall && username && (
          <VinylWallEditor
            username={username}
            initialWall={data.vinylWall}
            onClose={() => setEditingWall(false)}
          />
        )}

        {/* Shelf + Crate tiers temporarily hidden while Vinyl Wall
            finds its final look. Data flow + schema intact; components
            below remain in the file for 3c. */}
      </main>
    </div>
  );
}

// ─── Vinyl avatar ──────────────────────────────────────────────
// Circular black vinyl disk with a colored centre label. If the
// user has a real avatar photo, the photo becomes the label; if
// not, their initial sits on an amber label. Single small design
// call-out that ties the identity chrome to the page's subject
// matter (records) without leaning on a literal record-shop scene
// simulation. The concentric groove lines are drawn with a
// repeating radial gradient so they stay crisp at any size.
function VinylAvatar({
  avatarUrl,
  initial,
  size = 128,
}: {
  avatarUrl: string | null;
  initial: string;
  size?: number;
}) {
  const resolved = resolveApiUrl(avatarUrl);
  const labelSize = size * 0.42;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        // Deep black vinyl with a whisper of warm reflection on the
        // upper-left quadrant so it doesn't read as a flat disc.
        background: `
          radial-gradient(circle at 30% 30%, #2a1a10 0%, #120805 30%, #050301 70%),
          #0a0503
        `,
        boxShadow:
          '0 6px 18px rgba(0,0,0,0.55), 0 0 0 1px rgba(232, 160, 32, 0.1) inset',
        flexShrink: 0,
      }}
    >
      {/* Concentric grooves — repeating radial gradient with a
          very faint warm stroke so they imply etched surface
          without screaming "there are lines on me." */}
      <div
        style={{
          position: 'absolute',
          inset: '6%',
          borderRadius: '50%',
          background:
            'repeating-radial-gradient(circle at 50% 50%, rgba(255, 218, 175, 0.035) 0px, rgba(255, 218, 175, 0.035) 0.5px, transparent 0.5px, transparent 2.5px)',
        }}
      />
      {/* Center label — avatar photo if we have one, initial if
          not. Amber ring around the label edge echoes dig.haus's
          accent without making the whole page amber. */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: labelSize,
          height: labelSize,
          borderRadius: '50%',
          overflow: 'hidden',
          background: resolved ? '#1a1108' : '#e8a020',
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(232, 160, 32, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {resolved ? (
          <img
            src={resolved}
            alt=""
            aria-hidden
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            style={{
              color: '#0a0503',
              fontFamily: '"Fraunces", Georgia, serif',
              fontSize: labelSize * 0.5,
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {initial}
          </span>
        )}
      </div>
      {/* Spindle hole */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: size * 0.05,
          height: size * 0.05,
          borderRadius: '50%',
          background: '#050301',
          boxShadow: '0 0 0 1px rgba(255, 218, 175, 0.15)',
        }}
      />
    </div>
  );
}

// ─── Masthead ──────────────────────────────────────────────────
// Editorial-grade header: vinyl avatar left, stacked display name
// block right. @username sits as a tiny eyebrow above the big
// display name so the page reads as a magazine spread rather than
// a social media card. The meta row carries the status indicator
// + record count + (owner-only) edit trigger.
function MastHead({
  username,
  displayName,
  avatarUrl,
  isOwner,
  filledCount,
  onEdit,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  filledCount: number;
  onEdit: () => void;
}) {
  const name = displayName || username;
  const initial = name.charAt(0).toUpperCase();
  const showHandle =
    !!displayName && displayName.toLowerCase() !== username.toLowerCase();
  return (
    <header className="flex items-center gap-6 sm:gap-8">
      <VinylAvatar avatarUrl={avatarUrl} initial={initial} size={112} />
      <div className="flex-1 min-w-0">
        {showHandle && (
          <div
            className="text-[11px] uppercase tracking-[0.28em] text-[#a88a60] mb-1.5"
          >
            @{username}
          </div>
        )}
        <h1
          className="font-serif text-[#f5e8c8] leading-[1.05] truncate"
          style={{
            fontSize: 'clamp(2rem, 6vw, 3.4rem)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
          title={name}
        >
          {name}
        </h1>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-[#e8a020]">
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[#e8a020]"
              style={{ boxShadow: '0 0 6px rgba(232, 160, 32, 0.6)' }}
            />
            open
          </span>
          <span className="text-[11px] text-[#7a6650] tabular-nums">
            · {filledCount} / 15 on the wall
          </span>
          {isOwner && (
            <button
              type="button"
              onClick={onEdit}
              className="ml-auto text-[11px] text-[#a88a60] hover:text-[#e8a020] border border-[#a88a60]/30 hover:border-[#e8a020]/60 rounded-full px-3 py-1 cursor-pointer transition-colors"
            >
              벽 편집
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Section divider ───────────────────────────────────────────
// Thin warm-gold hairline flanked by an uppercase label. Pulls
// the editorial vocabulary through the page — the record covers
// themselves carry most of the visual weight, so dividers need to
// be quiet.
function SectionDivider() {
  return (
    <div className="flex items-center gap-4 my-10 sm:my-14">
      <span className="text-[10px] uppercase tracking-[0.32em] text-[#a88a60] shrink-0">
        Vinyl Wall
      </span>
      <div
        className="flex-1 h-px"
        style={{
          background:
            'linear-gradient(90deg, rgba(232, 160, 32, 0.4), transparent)',
        }}
      />
    </div>
  );
}

// ─── Wall grid ─────────────────────────────────────────────────
// Five-column grid of 15 square cells. Filled cells carry the
// album cover with a subtle warm-black halo drop shadow; empty
// cells render as nothing — the grid's structure is implied by
// the filled tiles, not by visible placeholders. Hover lifts the
// cover slightly and reveals the album title below the grid cell.
// Clicking navigates to the album page.
function WallGrid({
  wallByPosition,
}: {
  wallByPosition: Map<number, MyDigWallItem>;
}) {
  const positions = Array.from({ length: 15 }, (_, i) => i);
  const hasAny = wallByPosition.size > 0;
  return (
    <div>
      <div className="grid grid-cols-5 gap-3 sm:gap-5">
        {positions.map((pos) => {
          const item = wallByPosition.get(pos);
          if (!item) return <EmptyCell key={pos} />;
          return <WallCell key={pos} item={item} />;
        })}
      </div>
      {!hasAny && (
        <p className="text-center text-[11px] text-[#7a6650] mt-6 tracking-wider">
          아직 벽이 비어 있어요
        </p>
      )}
    </div>
  );
}

function EmptyCell() {
  // Barely-there dotted outline so the grid structure is legible
  // when the wall is mostly empty, without the cell reading as
  // "drop your record here." Disappears entirely at extreme zooms.
  return (
    <div
      className="aspect-square rounded-sm"
      style={{
        border: '1px dashed rgba(232, 160, 32, 0.08)',
      }}
    />
  );
}

function WallCell({ item }: { item: MyDigWallItem }) {
  const { album } = item;
  const target = album.slug || album.mbid;
  return (
    <Link
      to={`/album/${target}`}
      className="group relative block aspect-square"
      title={`${album.artist} — ${album.title}`}
    >
      {/* Shadow layer — sits behind the cover, stays in place on
          hover so the lift reads as the cover rising off its
          shadow rather than everything moving together. */}
      <div
        className="absolute inset-0 rounded-sm transition-transform duration-200"
        style={{
          background: '#0a0503',
          boxShadow:
            '0 8px 20px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4)',
        }}
      />
      {/* Cover — lifts 2px on hover, picks up a faint amber ring
          so the hovered record reads as "warm under attention." */}
      <div
        className="absolute inset-0 rounded-sm overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:ring-1 group-hover:ring-[#e8a020]/40"
        style={{
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.4)',
        }}
      >
        <CoverArt
          src={album.coverArtUrl}
          fallbacks={album.coverArtFallbacks}
          alt={album.title}
          className="w-full h-full object-cover"
        />
      </div>
      {/* Title ghost — appears below the cell on hover. Absolutely
          positioned so neighbouring cells don't shift. */}
      <div
        className="absolute left-0 right-0 -bottom-5 text-center text-[10px] text-[#f5e8c8]/80 opacity-0 group-hover:opacity-100 transition-opacity duration-150 truncate pointer-events-none"
        style={{ fontFamily: '"Fraunces", Georgia, serif' }}
      >
        {album.title}
      </div>
    </Link>
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
