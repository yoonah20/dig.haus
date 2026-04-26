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
import HomeFeatureSticker from './HomeFeatureSticker';

// Admin-curated 10-album home wall (5-5) — the home page is dig.haus's
// own mydig: same wood-rail + LP primitives, same edit affordances,
// scoped to a single global wall instead of per-user. Started as 5-5-5
// (15) for parity with mydig but at the front door 15 sleeves felt
// dense and intimidating; cut to two rails so the page reads quieter
// on first visit. The dense album grid browsing surface lives at /dig.

// Total slot count is constant across breakpoints — only the grid
// orientation flips: desktop renders 5×2 (wide horizontal), mobile
// flips to 2×5 (narrow vertical scroll). Resolved per-render below
// based on the container width vs the mobile breakpoint.
//
// Both counts are overridable via props so the new vertical-scroll
// home composition (HomeNext) can render the wall as a 1×5 hero
// row above its other sections without forking the component.
const DEFAULT_SLOT_COUNT = 10;
const DEFAULT_ROWS_DESKTOP = 2;
const DEFAULT_ROWS_MOBILE = 5;
const MOBILE_BREAKPOINT = 520;

// Plastic-wrap texture pool. Each LP picks one based on a hash of
// its album mbid, so the same album always gets the same wrap (no
// flicker on re-render) while neighbouring LPs vary. Add new entries
// to this array as more texture files land in client/public/textures/.
const PLASTIC_TEXTURE_PATHS = [
  '/textures/swrap01.webp',
  '/textures/swrap02.webp',
  '/textures/swrap03.webp',
  '/textures/swrap04.webp',
  '/textures/swrap09.webp',
  '/textures/swrap15.webp',
  '/textures/swrap16.webp',
  '/textures/swrap17.webp',
  '/textures/swrap19.webp',
  '/textures/swrap21.webp',
];

// FNV-1a 32-bit hash — better mid-string distribution than the
// previous djb2 variant, which clustered noticeably at small bucket
// counts (10 textures × 10 LPs was hitting visible same-texture
// runs). Keeps the result deterministic per mbid so the same album
// still always picks the same wrap.
function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickPlasticTexture(seed: string): string {
  if (PLASTIC_TEXTURE_PATHS.length === 0) return '';
  return PLASTIC_TEXTURE_PATHS[
    hashStr(seed) % PLASTIC_TEXTURE_PATHS.length
  ]!;
}

interface HomeWallProps {
  /** Override the total slot count. Defaults to 10 (the live home).
   *  When set, the wall slices the saved features list to this many
   *  positions so callers can render a smaller hero row without
   *  touching the underlying picks. */
  slotCount?: number;
  /** Override the desktop row count. Mobile flips to a vertical
   *  layout regardless. Defaults to 2 (5×2). */
  desktopRows?: number;
  /** Hide the admin edit affordance — the editor expects the live
   *  10-slot layout, so any caller that overrides slotCount should
   *  set this to true. */
  readOnly?: boolean;
  /** Hide the wood rails painted under each row. Use when the host
   *  scene already has shelves baked into its backdrop image (like
   *  the HomeNext hero) — drawing rails on top would double up. */
  hideRails?: boolean;
}

export default function HomeWall({
  slotCount = DEFAULT_SLOT_COUNT,
  desktopRows = DEFAULT_ROWS_DESKTOP,
  readOnly = false,
  hideRails = false,
}: HomeWallProps = {}) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin && !readOnly;
  const { data, isLoading } = useHomeFeatures();
  const [editing, setEditing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  // Re-run on isLoading flip — the loading branch early-returns
  // without rendering the section, so on first mount containerRef
  // is null. Without this dep the observer never attaches, width
  // stays stuck at the initial 880 and the LP size never recomputes
  // even as the viewport resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading]);

  const mobile = width < MOBILE_BREAKPOINT;
  // Desktop = slotCount distributed across `desktopRows` rows.
  // Mobile flips to a tall 2-wide grid regardless of the desktop
  // shape — narrow viewports always read better as vertical scroll.
  // Both axes derive from slotCount so a 5/1 caller renders 1×5 on
  // desktop and stacks to (slotCount/2 ≈ 3) rows × 2 on mobile.
  const desktopSlotsPerRow = Math.max(1, Math.ceil(slotCount / desktopRows));
  const slotsPerRow = mobile ? Math.min(2, slotCount) : desktopSlotsPerRow;
  const rowCount = mobile
    ? Math.max(1, Math.ceil(slotCount / slotsPerRow))
    : desktopRows;
  const gapX = mobile ? 12 : 16;
  const overhang = mobile ? 12 : 36;
  const rowGap = mobile ? 28 : 32;
  // Desktop cap 180 pairs with section max-w-[960px] for ~165 LPs.
  // Mobile cap 170 lets the wall fill a typical phone width
  // (~360-414) at ~140-180 per LP — large enough to read sleeve
  // detail without dropping below 2-up density.
  const maxLpSize = mobile ? 170 : 180;
  const fit =
    (width - 2 * overhang - (slotsPerRow - 1) * gapX) / slotsPerRow;
  const lpSize = Math.max(40, Math.min(maxLpSize, Math.floor(fit)));
  const railWidth = Math.round(width);
  const railHeight = mobile ? 16 : 20;

  const items = data?.items ?? [];
  const meta = data?.meta ?? {
    theme: null,
    description: null,
    headerTopPx: -120,
    headerLeftPx: 4,
    headerRotationDeg: -4,
    plasticScalePct: 15,
    plasticOffsetXPx: 5,
    plasticOffsetYPx: 0,
    plasticBlendMode: 'normal',
  };

  // Plastic overlay knobs are read directly from saved meta now —
  // the live admin tuner that used to mediate this state was retired.
  // Saved values still propagate into the wall via these props; if a
  // future iteration wants a tuner UI back, restore local state +
  // PlasticTuner here.
  const slots = Array.from({ length: slotCount }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  const rows = Array.from({ length: rowCount }, (_, ri) => ({
    positions: Array.from(
      { length: slotsPerRow },
      (_, ci) => ri * slotsPerRow + ci
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
    <section
      className="relative group/homewall"
      // Mobile pushes the LP grid down so the in-flow space above
      // the grid leaves room for the absolutely-positioned header
      // pinned at top:4. Desktop's header sits above the section
      // entirely (top:-120) so no padding needed there.
      style={mobile ? { paddingTop: 64 } : undefined}
    >
      {/* Handwritten section header anchored to the wall's upper-left.
          Source = the home_meta singleton (theme + optional
          description) so admins edit the copy through the same wall
          editor they edit the LPs in; no separate UI needed. Same
          Poor Story stack + near-black ink as mydig's signature
          block — both surfaces live on a warm-toned painted backdrop,
          so the typography register transfers cleanly.

          Stacking: explicit z-index removed so the header sits in
          DOM order — rendered before the LP grid container, so it
          paints UNDER the album sleeves where they overlap. The
          painted-on-the-wall read needs the LPs to obscure the ink,
          not the other way round. The edit-button below keeps its
          z-10 because it's an actionable control, not decoration. */}
      {meta.theme && meta.theme.trim().length > 0 && (
        <div
          className="absolute select-none pointer-events-none"
          style={{
            // Mobile overrides the admin-tunable position knobs:
            // viewport is short and the wall takes the full height,
            // so the desktop default of top:-120 lands above the
            // visible area. Pin to top:4 / left:8 with a softer
            // tilt so the title sits cleanly above the first row.
            top: mobile ? 4 : meta.headerTopPx,
            left: mobile ? 8 : meta.headerLeftPx,
            fontFamily: GRAFFITI_FONT_STACK,
            transform: `rotate(${mobile ? -2 : meta.headerRotationDeg}deg)`,
            transformOrigin: 'top left',
            color: '#1a1208',
          }}
        >
          <h2
            style={{
              fontSize: mobile ? '22px' : '28px',
              fontWeight: 700,
              letterSpacing: '0.01em',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {meta.theme}
          </h2>
          {meta.description && meta.description.trim().length > 0 && (
            <p
              style={{
                fontSize: mobile ? '13px' : '16px',
                fontWeight: 500,
                marginTop: 4,
                marginBottom: 0,
                lineHeight: 1.2,
              }}
            >
              {meta.description}
            </p>
          )}
        </div>
      )}

      {isAdmin && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          // Pushed off the wall section's top-right corner so the
          // chip clears the LP grid even when hover scaling lifts the
          // first row's covers a few pixels up. Negative top sits the
          // chip just above the section edge against the storefront
          // wallpaper; right-2 → -right-1 pulls it past the right LP
          // by a hair so the chip no longer overlaps the wrap edge of
          // the rightmost cover.
          className="absolute -top-9 -right-1 z-10 text-xs text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/40 rounded-full px-2.5 py-0.5 transition-colors cursor-pointer opacity-0 group-hover/homewall:opacity-100 focus:opacity-100"
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
                gridTemplateColumns: `repeat(${slotsPerRow}, ${lpSize}px)`,
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
                  lampBias={1 - (ri * slotsPerRow + ci) / slotCount}
                  plasticScalePct={meta.plasticScalePct}
                  plasticOffsetXPx={meta.plasticOffsetXPx}
                  plasticOffsetYPx={meta.plasticOffsetYPx}
                  plasticBlendMode={meta.plasticBlendMode}
                />
              ))}
            </div>
            {/* Rails sit centred under each LP row — no per-row x
                offset. The bohemian-misaligned look mydig uses isn't
                a fit for the entry-page first impression. Skipped
                entirely when the host already paints shelves into
                its scene (HomeNext hero). */}
            {!hideRails && (
              <div style={{ position: 'relative', marginTop: 0 }}>
                <WallRail
                  width={railWidth}
                  seed={ri * 37 + 13}
                  height={railHeight}
                  style={{ display: 'block' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && editing && (
        <VinylWallEditor
          target={{ kind: 'home-features' }}
          initialWall={homeItemsToWallItems(items)}
          initialTheme={meta.theme}
          initialDescription={meta.description}
          initialHeaderTopPx={meta.headerTopPx}
          initialHeaderLeftPx={meta.headerLeftPx}
          initialHeaderRotationDeg={meta.headerRotationDeg}
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
  plasticScalePct,
  plasticOffsetXPx,
  plasticOffsetYPx,
  plasticBlendMode,
}: {
  item: HomeFeatureItem | null;
  position: number;
  lpSize: number;
  lampBias: number;
  plasticScalePct: number;
  plasticOffsetXPx: number;
  plasticOffsetYPx: number;
  plasticBlendMode: string;
}) {
  if (!item) {
    return <WallLP size={lpSize} seed={position} empty lampBias={lampBias} />;
  }
  const { album } = item;
  const target = album.slug || album.mbid;
  // Top purchase-link sticker, when one is registered. Server already
  // sorted soldout last + cheapest first, so [0] is the right pick.
  const topLink = album.priceTagLinks?.[0] ?? null;
  return (
    <WallHoverCard
      album={album}
      position={position}
      lpSize={lpSize}
      lampBias={lampBias}
      href={`/album/${target}`}
      // Hash album.mbid into the texture pool so the same album
      // always gets the same wrap (stable across renders) while
      // neighbouring LPs vary.
      plasticOverlaySrc={pickPlasticTexture(album.mbid)}
      plasticScalePct={plasticScalePct}
      plasticOffsetXPx={plasticOffsetXPx}
      plasticOffsetYPx={plasticOffsetYPx}
      plasticBlendMode={plasticBlendMode}
      hoverScalePct={150}
      coverOverlay={
        topLink ? (
          <HomeFeatureSticker link={topLink} lpSize={lpSize} />
        ) : null
      }
    />
  );
}

