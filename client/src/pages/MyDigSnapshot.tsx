import { useParams, Link } from 'react-router-dom';
import {
  useVinylWallSnapshot,
  type MyDigAlbum,
} from '../hooks/useMyDig';
import CoverArt from '../components/CoverArt';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ShareButton from '../components/MyDig/ShareButton';
import { WallLP, WallRail } from '../components/MyDig/storefront/primitives';
import { resolveApiUrl } from '../utils/apiUrl';

// Read-only snapshot viewer. URL = /my/:username/snap/:slug.
// Mirrors the /my/:username page shell (header + shop-scene wall)
// but fed entirely from the snapshot payload so the wall reflects
// the moment it was saved. No edit button — the snapshot is
// immutable from this screen. Owner can delete / toggle-public
// from the snapshot list on /my/:username, not here.
//
// Empty slots (positions without an item, or items whose album
// was deleted after the snapshot was saved) render as blank wall,
// same as the live page.
const WALL_ROW_SIZES = [5, 5] as const;

export default function MyDigSnapshot() {
  const { username, slug } = useParams<{ username: string; slug: string }>();
  const { data, isLoading, error } = useVinylWallSnapshot(username, slug);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-400 text-lg">스냅샷을 불러오지 못했어요.</p>
          {username && (
            <Link
              to={`/my/${encodeURIComponent(username)}`}
              className="text-[#e8a020] mt-4 inline-block hover:underline text-sm"
            >
              ← 현재 벽으로 돌아가기
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { snapshot, user, items } = data;
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  // Build a position → album map so the render loop is the same
  // shape as /my/:username's.
  const byPosition = new Map<number, MyDigAlbum | null>();
  for (const it of items) byPosition.set(it.position, it.album);

  return (
    <div className="flex-1" style={{ background: '#0a0503' }}>
      <main className="max-w-[1120px] mx-auto px-4 py-8 space-y-6">
        <SnapshotHeader
          username={user.username}
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          snapshotName={snapshot.name}
          createdAt={snapshot.createdAt}
          isPublic={snapshot.isPublic}
          shareUrl={shareUrl}
        />

        <ShopScene>
          <SnapshotWallGrid byPosition={byPosition} />
        </ShopScene>
      </main>
    </div>
  );
}

function SnapshotHeader({
  username,
  displayName,
  avatarUrl,
  snapshotName,
  createdAt,
  isPublic,
  shareUrl,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  snapshotName: string;
  createdAt: string;
  isPublic: boolean;
  shareUrl: string;
}) {
  const initial = (displayName || username).charAt(0).toUpperCase();
  const resolvedAvatar = resolveApiUrl(avatarUrl);
  const name = displayName || username;
  return (
    <header className="flex items-center gap-4 pt-2 pb-4">
      <div className="shrink-0">
        {resolvedAvatar ? (
          <img
            src={resolvedAvatar}
            alt=""
            aria-hidden
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border border-white/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#1a1410] border border-white/10 flex items-center justify-center">
            <span className="text-2xl text-[#e8a020]/70 font-serif italic">
              {initial}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          to={`/my/${encodeURIComponent(username)}`}
          className="text-[11px] text-gray-500 hover:text-[#e8a020] tracking-wider"
        >
          ← {name}
        </Link>
        <h1
          className="text-xl sm:text-2xl font-serif italic text-[#f5e8c8] leading-tight truncate mt-0.5"
          title={snapshotName}
        >
          {snapshotName}
        </h1>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
          <span className="uppercase tracking-[0.22em] text-gray-500 tabular-nums">
            {formatDate(createdAt)}
          </span>
          <span
            className={
              isPublic
                ? 'uppercase tracking-[0.22em] text-[#e8a020]'
                : 'uppercase tracking-[0.22em] text-gray-600'
            }
          >
            · {isPublic ? 'public' : 'private'}
          </span>
          <ShareButton url={shareUrl} label="공유" />
        </div>
      </div>
    </header>
  );
}

function formatDate(iso: string): string {
  // Server returns 'YYYY-MM-DD HH:MM:SS'. Slice to just the date
  // for the header — the relative time lives on the list card.
  return iso.slice(0, 10);
}

function SnapshotWallGrid({
  byPosition,
}: {
  byPosition: Map<number, MyDigAlbum | null>;
}) {
  const lpSize = typeof window !== 'undefined' && window.innerWidth < 640 ? 64 : 140;
  const gapX = lpSize < 100 ? 6 : 14;
  const rowSpacing = lpSize < 100 ? 14 : 22;
  const maxCols = Math.max(...WALL_ROW_SIZES);
  let cursor = 0;
  const rows = WALL_ROW_SIZES.map((count) => {
    const positions = Array.from({ length: count }, (_, i) => cursor + i);
    cursor += count;
    return { count, positions };
  });

  return (
    <div
      style={{
        position: 'relative',
        width: maxCols * lpSize + (maxCols - 1) * gapX,
        maxWidth: '100%',
        margin: '0 auto',
        paddingTop: 12,
      }}
    >
      {rows.map(({ count, positions }, ri) => {
        const rowW = count * lpSize + (count - 1) * gapX;
        return (
          <div
            key={ri}
            style={{ position: 'relative', marginBottom: rowSpacing }}
          >
            <div
              style={{
                display: 'flex',
                gap: gapX,
                justifyContent: 'center',
                alignItems: 'flex-end',
              }}
            >
              {positions.map((position, ci) => {
                const album = byPosition.get(position);
                const lampBias =
                  1 - Math.min(1, (ri * maxCols + ci) / (WALL_ROW_SIZES.length * maxCols));
                if (!album) {
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
                const target = album.slug || album.mbid;
                return (
                  <Link
                    key={position}
                    to={`/album/${target}`}
                    title={`${album.artist} — ${album.title}`}
                    style={{
                      display: 'block',
                      width: lpSize,
                      height: lpSize,
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
              })}
            </div>
            <div style={{ position: 'relative', marginTop: -1 }}>
              <WallRail
                width={rowW + 20}
                seed={ri * 37 + 13}
                style={{ margin: '0 auto' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Shop scene (copied from MyDig) ────────────────────────────
// Same layered scene as the live page. Keeping it inline here
// keeps the snapshot view self-contained; if we ever pull the
// scene out into a shared component, both pages will switch over
// in one change.
function ShopScene({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#0a0503',
        minHeight: 380,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          bottom: '16%',
          background: `
            radial-gradient(ellipse 75% 60% at 38% 35%, #3a2818 0%, #241a0f 55%, #130c06 100%)
          `,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          bottom: '16%',
          pointerEvents: 'none',
          opacity: 0.6,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${((i + 1) * 100) / 7}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.25))',
              boxShadow: '1px 0 0 rgba(255, 220, 160, 0.04)',
            }}
          />
        ))}
      </div>
      <div style={{ position: 'relative', zIndex: 1, padding: '32px 16px 0' }}>
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '16%',
          height: 5,
          background: '#050301',
          boxShadow: 'inset 0 1px 0 rgba(232, 160, 32, 0.18)',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '16%',
          background: `
            radial-gradient(ellipse 60% 120% at 40% 0%, rgba(70, 45, 20, 0.28) 0%, transparent 70%),
            linear-gradient(180deg, #1a0f08, #0a0503)
          `,
          zIndex: 2,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${(i + 1) * 25}%`,
              height: 1,
              background:
                'linear-gradient(90deg, transparent, rgba(0,0,0,0.55), transparent)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 90% 75% at 45% 40%, transparent 0%, transparent 55%, rgba(10, 5, 3, 0.4) 100%)',
          zIndex: 5,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 60% 50% at 40% 32%, rgba(255, 208, 138, 0.14) 0%, rgba(255, 196, 110, 0.05) 45%, transparent 80%)',
          mixBlendMode: 'screen',
          zIndex: 6,
        }}
      />
    </section>
  );
}
