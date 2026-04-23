import { useEffect, useRef, useState } from 'react';
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
// Mirrors the /my/:username page shell (header + wall) but fed
// entirely from the snapshot payload so the wall reflects the
// moment it was saved. No edit button — the snapshot is
// immutable from this screen. Owner can delete / toggle-public
// from the snapshot list on /my/:username, not here.
//
// Empty slots (positions without an item, or items whose album
// was deleted after the snapshot was saved) render as blank wall,
// same as the live page.

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

  // Build a position → album map; snapshot items may have album
  // === null when the album was deleted after capture.
  const byPosition = new Map<number, MyDigAlbum | null>();
  for (const it of items) byPosition.set(it.position, it.album);

  return (
    // Transparent — backdrop lives on the app-root. See App.tsx.
    <div className="flex-1">
      <main className="max-w-[1120px] mx-auto px-4 pt-4 pb-8 space-y-3">
        <SnapshotHeader
          username={user.username}
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          snapshotName={snapshot.name}
          createdAt={snapshot.createdAt}
          isPublic={snapshot.isPublic}
          shareUrl={shareUrl}
        />

        <WallSection>
          <SnapshotWallGrid byPosition={byPosition} />
        </WallSection>
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
    <header className="flex items-center gap-4 pt-2 pb-4" style={{ color: '#f5d89a' }}>
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
          className="text-[11px] text-[#c9a060] hover:text-[#e8a020] tracking-wider"
        >
          ← {name}의 my dig
        </Link>
        <h1
          className="text-xl sm:text-2xl font-serif italic text-[#f5e8c8] leading-tight truncate mt-0.5"
          title={snapshotName}
        >
          {snapshotName}
        </h1>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
          <span className="uppercase tracking-[0.22em] text-[#c9a060] tabular-nums">
            {formatDate(createdAt)}
          </span>
          <span
            className={
              isPublic
                ? 'uppercase tracking-[0.22em] text-[#e8a020]'
                : 'uppercase tracking-[0.22em] text-[#8a7250]'
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
  return iso.slice(0, 10);
}

function WallSection({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative',
        padding: '4px 12px 40px',
      }}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

// ─── Snapshot wall grid ───────────────────────────────────────
// Read-only mirror of VinylWallGrid in MyDig.tsx. Same layout
// (5×3 desktop / 3×5 mobile) + same rail treatment; no hover
// bubbles because snapshots don't carry user reviews. Empty
// slots (album === null after deletion) render as blank wall.
function SnapshotWallGrid({
  byPosition,
}: {
  byPosition: Map<number, MyDigAlbum | null>;
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
        // Same painterly post-process as MyDig's live wall, so
        // the snapshot view blends with the painted backdrop too.
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
              const album = byPosition.get(position);
              const lampBias = 1 - Math.min(1, (ri * cols + ci) / (rowCount * cols));
              const jx = variance(ri * 131 + ci * 17 + 1) * (mobile ? 2 : 4);
              if (!album) {
                return (
                  <div key={position} style={{ marginLeft: jx }}>
                    <WallLP size={lpSize} seed={position} empty lampBias={lampBias} />
                  </div>
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
                    marginLeft: jx,
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
    </div>
  );
}
