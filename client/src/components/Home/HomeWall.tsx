import { useEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  type HomeFeatureItem,
} from '../../hooks/useHomeFeatures';
import { useAuth } from '../../contexts/AuthContext';
import { WallLP, WallRail } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import VinylWallEditor from '../MyDig/VinylWallEditor';
import type { MyDigWallItem } from '../../hooks/useMyDig';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// Admin-curated 10-album home wall (5-5) — the home page is dig.haus's
// own mydig: same wood-rail + LP primitives, same edit affordances,
// scoped to a single global wall instead of per-user. Started as 5-5-5
// (15) for parity with mydig but at the front door 15 sleeves felt
// dense and intimidating; cut to two rails so the page reads quieter
// on first visit. The dense album grid browsing surface lives at /dig.

const SLOTS_PER_ROW = 5;
const ROW_COUNT = 2;
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
      {/* Handwritten section header anchored to the wall's upper-left,
          rotated a few degrees so it reads as marker scrawled on the
          painted wall rather than typeset UI. Same Poor Story stack +
          near-black ink as mydig's signature block — both surfaces
          live on a warm-toned painted backdrop, so the typography
          register transfers cleanly. */}
      <h2
        className="absolute z-10 select-none pointer-events-none"
        style={{
          top: '-18px',
          left: '4px',
          fontFamily: GRAFFITI_FONT_STACK,
          transform: 'rotate(-4deg)',
          color: '#1a1208',
          fontSize: '28px',
          fontWeight: 700,
          letterSpacing: '0.01em',
          // Soft warm halo lets the dark ink hold against busier
          // patches of the orange brick backdrop without reading as a
          // typeset drop-shadow.
          textShadow: '0 1px 0 rgba(255, 230, 195, 0.25)',
        }}
      >
        딕하우스 4월 추천 앨범
      </h2>

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
            {/* Rails sit centred under each LP row — no per-row x
                offset. The bohemian-misaligned look mydig uses isn't
                a fit for the entry-page first impression. */}
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
  return (
    <WallHoverCard
      album={album}
      position={position}
      lpSize={lpSize}
      lampBias={lampBias}
      href={`/album/${target}`}
    />
  );
}

