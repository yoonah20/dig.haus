import { useLayoutEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  type HomeFeatureItem,
  type HomeWall,
} from '../../hooks/useHomeFeatures';
import { WallLP, WallRail } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import HomeFeatureSticker from './HomeFeatureSticker';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';
import { HERO_THEME } from '../../lib/heroTheme';

// Mobile hero uses a different visual strategy from the desktop
// asset-driven hero. The painted basement strip relies on the
// image being wide enough to fill the viewport horizontally;
// portrait phone viewports clip too aggressively for that to
// work. Instead, the mobile hero ducks the image entirely:
// flat dark-concrete bg simulated with a turbulence noise
// layer + a subtle vertical gradient, then five WallRail SVGs
// (the same primitive mydig uses) painted in DOM, two LPs per
// rail. No baked shelves, no hand-tuned coordinate math —
// everything composes from primitives the layout already trusts.
//
// Activity sections below the hero stay shared across mobile
// and desktop; only the hero swaps.

// Plastic-wrap textures — same pool as the desktop hero so
// covers across breakpoints share the same weathered feel.
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

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Position-indexed texture assignment — see HomeNextHero for the
// rationale. 10-slot wall + 10-texture pool match 1:1, so picking
// by position guarantees each texture appears exactly once across
// the visible wall and the mbid-hash collisions that made the wall
// read as repetitive go away.
function pickPlasticTexture(position: number): string {
  if (PLASTIC_TEXTURE_PATHS.length === 0) return '';
  return PLASTIC_TEXTURE_PATHS[position % PLASTIC_TEXTURE_PATHS.length]!;
}

const COLS = 2;
const ROWS = 5;
// Padding from viewport edges. Tight margins on phones — the
// covers want to feel close to the screen edge so the wall
// reads as a tall stripe rather than a centred frame.
const PAD_X = 16;
// PAD_TOP includes breathing room above the title (top:32) AND
// below it before the first row of LPs starts. The earlier 80
// landed the title flush against the upper LP row; bumping to
// 108 gives the handwritten copy a clear band of empty wall on
// both sides of itself.
const PAD_TOP = 108;
const PAD_BOTTOM = 24;
const TITLE_TOP_PX = 32;
const COVER_GAP_X = 14;
const ROW_GAP_Y = 22;
// Rail is a hair thicker (was 14) and slightly longer past the
// LPs (was 12 each side) so it reads as a real plank, not a
// thin shelf strip.
const RAIL_HEIGHT = 20;
const RAIL_OVERHANG_PX = 18;

export default function HomeNextHeroMobile() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const { data, isLoading } = useHomeFeatures();

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(0, containerW - PAD_X * 2);
  // Two LPs per row + a single horizontal gap between them. Cap
  // at 200 so on borderline-tablet widths the LPs don't grow
  // beyond a comfortable phone-cover scale. The 0.9 multiplier
  // shrinks each cover ~10% from the row's full available width
  // so they don't crowd the screen edges; the leftover slack is
  // absorbed by `justifyContent: center` on the row grid.
  const lpSize = Math.min(
    200,
    Math.floor(((innerW - COVER_GAP_X) / COLS) * 0.9)
  );
  const railWidth = lpSize * COLS + COVER_GAP_X + RAIL_OVERHANG_PX * 2;
  // Left-edge of the rail in container coordinates. Rails sit centred
  // inside the padded inner band, so this is `PAD_X + (innerW - rail)/2`
  // and lines the title's left edge up with where the wooden plank
  // actually starts on the page (the LP row sits RAIL_OVERHANG_PX
  // inside that, which is why the prior fixed `PAD_X + 28` lined the
  // title up with the leftmost cover instead of the rail).
  const railLeftPx = Math.max(
    0,
    Math.round(PAD_X + (innerW - railWidth) / 2)
  );

  // v1 of the multi-wall response — render the first wall only.
  // Carousel wrapping (multiple walls swipeable horizontally) is
  // the next commit.
  const wall = data?.walls?.[0];
  const items = wall?.items ?? [];
  const meta = wall;
  const slots = Array.from({ length: ROWS * COLS }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{
        // Solid wall colour comes first so the surface tone
        // matches the desktop backdrop. The paper texture is
        // re-layered as a low-opacity grain overlay below so the
        // colour drives the look and the texture only contributes
        // surface noise. Height auto-grows from flow content
        // (rails carry a 10 px shadow tail beyond their visible
        // plank height, so a fixed-pixel heroH would clip the
        // last row's shadow).
        backgroundColor: HERO_THEME.wall,
      }}
    >
      {/* Paper-grain layer — the same mobild_drop.webp that used
          to be the whole surface, now repurposed as a grain
          overlay over the wall colour. Soft-light blend keeps the
          paper's mid-tones translucent and lets the wall colour
          set luminance + hue; opacity tames the result so the
          grain reads as wall texture rather than a separate sheet
          of paper laid on top. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url('/textures/mobild_drop.webp')",
          backgroundSize: '100% auto',
          backgroundRepeat: 'repeat-y',
          backgroundPosition: 'top center',
          mixBlendMode: 'soft-light',
          opacity: 0.6,
        }}
      />

      {/* Soft vignette only — the photo carries enough natural
          tone variation that the earlier turbulence + linear
          gradient overlays just muddied it. Bottom darken keeps
          the activity sections handing-off cleanly. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, transparent 70%, rgba(0, 0, 0, 0.22) 100%)',
        }}
      />

      {/* Legacy noise overlay kept around (now hidden) in case
          we want to layer texture on top of the photo later;
          removing the SVG entirely loses the filter id reference
          if anything else picks it up. */}
      <svg
        aria-hidden
        className="hidden"
      >
        <defs>
          <filter id="mobileConcreteNoise">
            <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="11" />
            <feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0.55 0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#mobileConcreteNoise)" />
      </svg>

      {/* Handwritten section title — anchored top-left of the
          wall. No tilt on mobile (the desktop -3° read as
          casual on a wide composition; on the narrower mobile
          band the same tilt was just hard to read). Ink colour
          + shadow come from HERO_THEME so the mobile title
          stays readable against whichever wall tone the desktop
          backdrop drove (cream against dark plum, dark brown
          against light tan, etc.). */}
      {meta?.theme && meta.theme.trim().length > 0 && (
        <div
          className="absolute select-none pointer-events-none"
          style={{
            // Title left tracks the rail's actual left edge so the
            // handwritten copy hangs off the same plank line as the
            // shelf below. Computed dynamically (railLeftPx) because
            // the rail's position depends on lpSize → innerW → the
            // running viewport width.
            top: TITLE_TOP_PX,
            left: railLeftPx,
            right: PAD_X,
            fontFamily: GRAFFITI_FONT_STACK,
            color: HERO_THEME.ink,
            textShadow: HERO_THEME.shadow,
          }}
        >
          <h2
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.01em',
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            {meta.theme}
          </h2>
          {meta.description && meta.description.trim().length > 0 && (
            <p
              style={{
                fontSize: 13,
                fontWeight: 400,
                marginTop: 6,
                marginBottom: 0,
                lineHeight: 1.2,
              }}
            >
              {meta.description}
            </p>
          )}
        </div>
      )}

      {/* Rails + LPs — five rows stacked vertically. Each row's
          rail is centred under the two covers; rail seed varies
          per-row so successive rails don't share the same knot
          pattern. */}
      {!isLoading && lpSize > 0 && (
        <div
          className="relative"
          style={{
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
            paddingLeft: PAD_X,
            paddingRight: PAD_X,
          }}
        >
          {Array.from({ length: ROWS }, (_, ri) => {
            const startPos = ri * COLS;
            return (
              <div key={ri} style={{ marginBottom: ri < ROWS - 1 ? ROW_GAP_Y : 0 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${COLS}, ${lpSize}px)`,
                    gap: COVER_GAP_X,
                    justifyContent: 'center',
                    alignItems: 'end',
                  }}
                >
                  {Array.from({ length: COLS }, (_, ci) => {
                    const position = startPos + ci;
                    const item = slots[position];
                    return (
                      <div
                        key={position}
                        style={{ width: lpSize, height: lpSize, position: 'relative' }}
                      >
                        {item ? (
                          <MobileFeatureCell
                            item={item}
                            position={position}
                            lpSize={lpSize}
                            plasticMeta={meta}
                          />
                        ) : (
                          <WallLP
                            size={lpSize}
                            seed={position}
                            empty
                            lampBias={1 - position / (ROWS * COLS)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-center" style={{ marginTop: 0 }}>
                  <WallRail
                    width={railWidth}
                    seed={ri * 37 + 13}
                    height={RAIL_HEIGHT}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileFeatureCell({
  item,
  position,
  lpSize,
  plasticMeta,
}: {
  item: HomeFeatureItem;
  position: number;
  lpSize: number;
  plasticMeta: HomeWall | undefined;
}) {
  const album = item.album;
  const target = album.slug || album.mbid;
  const topLink = album.priceTagLinks?.[0] ?? null;
  const score = album.averageScore ?? null;
  const reviewCount = album.reviewCount ?? 0;
  const isPick = score != null && score >= 86 && reviewCount >= 3;

  return (
    <WallHoverCard
      album={album}
      position={position}
      lpSize={lpSize}
      lampBias={1 - position / 10}
      href={`/album/${target}`}
      plasticOverlaySrc={pickPlasticTexture(position)}
      plasticScalePct={plasticMeta?.plasticScalePct ?? 15}
      plasticOffsetXPx={plasticMeta?.plasticOffsetXPx ?? 5}
      plasticOffsetYPx={plasticMeta?.plasticOffsetYPx ?? 0}
      plasticBlendMode={plasticMeta?.plasticBlendMode ?? 'normal'}
      hoverScalePct={130}
      tapToActivate
      coverOverlay={
        <>
          {isPick && <MobilePickSticker lpSize={lpSize} seed={album.mbid} />}
          {topLink && <HomeFeatureSticker link={topLink} lpSize={lpSize} />}
        </>
      }
    />
  );
}

// Mirror of the desktop's DighausPickSticker — same gate, same
// asset, same hand-applied rotation. Lives here rather than
// imported because the desktop component lives next door and
// duplicating ~20 lines is cheaper than refactoring both
// components into a third shared file just for one badge.
function MobilePickSticker({
  lpSize,
  seed,
}: {
  lpSize: number;
  seed: string;
}) {
  const width = Math.round(lpSize * 0.175);
  const rot = (hashStr(seed) % 401) / 100 - 2;
  return (
    <img
      src="/textures/dighauspick.webp"
      alt=""
      aria-hidden
      className="absolute z-10 pointer-events-none select-none"
      style={{
        bottom: 4,
        left: 4,
        width,
        height: 'auto',
        transform: `rotate(${rot.toFixed(2)}deg)`,
        transformOrigin: 'bottom left',
        maxWidth: 'none',
      }}
    />
  );
}
