import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useHomeFeatures,
  type HomeFeatureItem,
} from '../../hooks/useHomeFeatures';
import { useAuth } from '../../contexts/AuthContext';
import { extractSpotifyAlbumId } from '../../hooks/useNowPlaying';
import { WallLP, WallRail } from '../MyDig/storefront/primitives';
import CoverArt from '../CoverArt';
import PlayChip from '../PlayChip';
import VinylWallEditor from '../MyDig/VinylWallEditor';
import type { MyDigWallItem } from '../../hooks/useMyDig';

// Admin-curated 15-album home wall (5-5-5) — the home page is now
// dig.haus's own mydig: same wood-rail + LP primitives, same
// signature graffiti header, same edit affordances, scoped to a
// single global wall instead of per-user. The dense album grid
// browsing surface lives at /dig.

const SLOTS_PER_ROW = 5;
const ROW_COUNT = 3;
const SLOT_COUNT = SLOTS_PER_ROW * ROW_COUNT;
const MOBILE_BREAKPOINT = 520;

export default function HomeWall() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const { data, isLoading } = useHomeFeatures();
  const [editing, setEditing] = useState(false);

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

  const mobile = width < MOBILE_BREAKPOINT;
  const gapX = mobile ? 8 : 16;
  const overhang = mobile ? 4 : 36;
  const rowGap = mobile ? 24 : 32;
  const maxLpSize = mobile ? 80 : 168;
  const fit = (width - 2 * overhang - (SLOTS_PER_ROW - 1) * gapX) / SLOTS_PER_ROW;
  const lpSize = Math.max(40, Math.min(maxLpSize, Math.floor(fit)));
  const railWidth = Math.round(width);
  const railHeight = mobile ? 16 : 20;

  const items = data?.items ?? [];
  const meta = data?.meta ?? { theme: null, description: null };
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  const rows = Array.from({ length: ROW_COUNT }, (_, ri) => ({
    positions: Array.from(
      { length: SLOTS_PER_ROW },
      (_, ci) => ri * SLOTS_PER_ROW + ci
    ),
  }));

  if (isLoading) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-gray-600">
        불러오는 중…
      </div>
    );
  }

  return (
    <section className="relative group/homewall">
      {/* Signature header intentionally NOT rendered — the dig.haus
          logo already lives in the top nav and a second masthead on
          the wall page reads as redundant. The home_meta singleton
          (theme + description) stays in the editor + DB so the
          editor unification PR can decide whether to surface it
          elsewhere (page <title>, social meta, etc.) without
          re-introducing the on-page header. */}

      {isAdmin && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute top-0 right-2 z-10 text-xs text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/40 rounded-full px-2.5 py-0.5 transition-colors cursor-pointer opacity-0 group-hover/homewall:opacity-100 focus:opacity-100"
          title="dig.haus 벽 편집"
        >
          ✏️ 편집
        </button>
      )}

      <div ref={containerRef} className="relative">
        {rows.map(({ positions }, ri) => (
          <div key={ri} style={{ position: 'relative', marginBottom: rowGap }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${SLOTS_PER_ROW}, ${lpSize}px)`,
                gap: gapX,
                justifyContent: 'center',
                alignItems: 'end',
              }}
            >
              {positions.map((position, ci) => (
                <FeatureCell
                  key={position}
                  item={slots[position]}
                  position={position}
                  lpSize={lpSize}
                  lampBias={1 - (ri * SLOTS_PER_ROW + ci) / SLOT_COUNT}
                />
              ))}
            </div>
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
      </div>

      {isAdmin && editing && (
        <VinylWallEditor
          target={{ kind: 'home-features' }}
          initialWall={homeItemsToWallItems(items)}
          initialTheme={meta.theme}
          initialDescription={meta.description}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

// home_features rows carry HomeFeatureAlbum (mbid-keyed, no numeric
// DB id). VinylWallEditor's draft state expects MyDigAlbum; we pad
// with id=0 because home-features saves use mbid, not albumId.
function homeItemsToWallItems(items: HomeFeatureItem[]): MyDigWallItem[] {
  return items.map((it) => ({
    position: it.position,
    album: {
      id: 0,
      mbid: it.album.mbid,
      slug: it.album.slug,
      title: it.album.title,
      artist: it.album.artist,
      releaseYear: null,
      coverArtUrl: it.album.coverArtUrl,
      coverArtFallbacks: it.album.coverArtFallbacks ?? [],
      coverDominantColor: it.album.coverDominantColor ?? null,
      spotifyUrl: it.album.spotifyUrl ?? null,
    },
    userReview: null,
  }));
}

function FeatureCell({
  item,
  position,
  lpSize,
  lampBias,
}: {
  item: HomeFeatureItem | null;
  position: number;
  lpSize: number;
  lampBias: number;
}) {
  if (!item) {
    return <WallLP size={lpSize} seed={position} empty lampBias={lampBias} />;
  }
  const { album } = item;
  const target = album.slug || album.mbid;
  const spotifyAlbumId = extractSpotifyAlbumId(album.spotifyUrl ?? null);
  const hasPreview = !!spotifyAlbumId;

  return (
    <Link
      to={`/album/${target}`}
      title={`${album.artist} — ${album.title}`}
      className="group relative block transition-transform duration-200 ease-out hover:-translate-y-1 hover:z-10"
      style={{
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
      {hasPreview && (
        <PlayChip
          albumMbid={album.mbid}
          spotifyUrl={album.spotifyUrl ?? null}
          title={album.title}
          artist={album.artist}
          size={Math.round(lpSize * 0.208)}
        />
      )}
    </Link>
  );
}

