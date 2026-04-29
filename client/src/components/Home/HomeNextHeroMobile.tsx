import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Same sessionStorage key the desktop hero uses — the two heroes
// can't both render simultaneously (breakpoint-gated), so they
// share one persisted slot. A user who opens dig.haus on a phone
// (mobile hero) and later resizes to a desktop layout (desktop
// hero) will see the same wall they last left on, which is what
// "remember which wall I was on" should mean across viewports.
const ACTIVE_WALL_STORAGE_KEY = 'dig.haus:home-active-wall-idx';

// Auto-advance interval — same 7s as desktop. See HomeNextHero for
// the reasoning (gallery / curation surface, slow enough to read,
// fast enough to signal multiple walls exist).
const AUTO_ADVANCE_MS = 7500;
import {
  useHomeFeatures,
  type HomeFeatureItem,
  type HomeWall,
} from '../../hooks/useHomeFeatures';
import { WallLP, WallRail } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import HomeFeatureSticker from './HomeFeatureSticker';
import PostItNote from './PostItNote';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

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
  // Mirror the desktop tweak — slot 0 borrows slot 7's softer wrap
  // (swrap17) so the upper-left slot doesn't dominate. See the
  // matching note in HomeNextHero.tsx.
  if (position === 0) return PLASTIC_TEXTURE_PATHS[7]!;
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
const ROW_GAP_Y = 6;
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

  const walls = data?.walls ?? [];

  // Carousel — same horizontal scroll-snap pattern as desktop. On
  // phones the snap behaviour is "swipe to the next wall" which is
  // exactly what a touch user expects from a hero band of multiple
  // tracks. activeIdx drives the dot pagination below the rails.
  // Looping mirror of the desktop pattern — see HomeNextHero for
  // the [lastClone, ...walls, firstClone] rationale.
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const isLooping = walls.length > 1;
  // Restore last-visible wall on mount — and always seek past the
  // leading clone when looping is active, otherwise the carousel
  // would land on the clone of the last wall on first paint.
  useLayoutEffect(() => {
    const root = carouselRef.current;
    if (!root || walls.length === 0 || lpSize <= 0) return;
    if (typeof window === 'undefined') return;
    let realIdx = 0;
    const raw = window.sessionStorage.getItem(ACTIVE_WALL_STORAGE_KEY);
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < walls.length) {
        realIdx = parsed;
      }
    }
    const domIdx = isLooping ? realIdx + 1 : realIdx;
    root.scrollTo({ left: domIdx * root.clientWidth, behavior: 'instant' });
    setActiveIdx(realIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls.length > 0, lpSize > 0]);
  // Boundary handler — snap from clone slides back to their real
  // counterparts after the native snap settles. Mirrors the desktop
  // implementation; the mobile carousel uses the same DOM layout
  // and same scroll-snap mechanics, so the math is identical.
  useEffect(() => {
    const root = carouselRef.current;
    if (!root || !isLooping) return;
    const N = walls.length;
    let timer: number | null = null;
    function check() {
      if (!root) return;
      const w = root.clientWidth;
      if (w <= 0) return;
      const left = root.scrollLeft;
      const eps = 4;
      if (left < eps) {
        root.scrollTo({ left: N * w, behavior: 'instant' });
      } else if (left > (N + 1) * w - eps) {
        root.scrollTo({ left: w, behavior: 'instant' });
      }
    }
    function onScroll() {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(check, 120);
    }
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [isLooping, walls.length]);
  useEffect(() => {
    const root = carouselRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.wallIdx ?? '0'
            );
            setActiveIdx(idx);
          }
        }
      },
      { root, threshold: [0.5, 0.75] }
    );
    root.querySelectorAll('[data-wall-idx]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [walls.length]);
  // Persist active wall on every change so the next mount can restore.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      ACTIVE_WALL_STORAGE_KEY,
      String(activeIdx)
    );
  }, [activeIdx]);

  function scrollToIdx(idx: number) {
    const root = carouselRef.current;
    if (!root) return;
    const domIdx = isLooping ? idx + 1 : idx;
    root.scrollTo({ left: domIdx * root.clientWidth, behavior: 'smooth' });
  }

  // Auto-advance — fires every AUTO_ADVANCE_MS while no touch is
  // in flight and respects reduced-motion. Resets on every
  // activeIdx change so manual swipes get their own full window.
  const [interactionPaused, setInteractionPaused] = useState(false);
  // Manual pause via the ⏸/▶ chip — sticks across renders. Touch-
  // driven interactionPaused auto-releases on touchend, so a
  // separate flag is needed for "I want it stopped, period".
  const [userPaused, setUserPaused] = useState(false);
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reducedMotion) return;
    if (walls.length <= 1) return;
    if (interactionPaused || userPaused) return;
    const id = window.setInterval(() => {
      const root = carouselRef.current;
      if (!root) return;
      const currentDom = isLooping ? activeIdx + 1 : activeIdx;
      const nextDom = isLooping ? currentDom + 1 : (currentDom + 1) % walls.length;
      root.scrollTo({ left: nextDom * root.clientWidth, behavior: 'smooth' });
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [activeIdx, walls.length, interactionPaused, userPaused, reducedMotion]);

  return (
    <div
      ref={containerRef}
      // group/hero so the dot pagination can lift its z-index when
      // a post-it inside any slot is hovered/tap-active. Without
      // the lift the slide's z-[60] (set by the same has-condition
      // on the row + slot wrappers) buries this row's dots.
      className="group/hero relative w-full"
    >
      <div
        ref={carouselRef}
        // Touch / focus pauses auto-advance; resumes on touchend /
        // blur. Mobile rarely sees mouseenter/leave but they're
        // included for the few non-touch tablets that report mouse
        // events.
        onMouseEnter={() => setInteractionPaused(true)}
        onMouseLeave={() => setInteractionPaused(false)}
        onTouchStart={() => setInteractionPaused(true)}
        onTouchEnd={() => setInteractionPaused(false)}
        onFocusCapture={() => setInteractionPaused(true)}
        onBlurCapture={() => setInteractionPaused(false)}
        className="flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {walls.length > 0 && (
          <>
            {/* Leading clone of the last wall — see HomeNextHero
                desktop comment for the looping rationale. */}
            {isLooping && (
              <HeroWallSlideMobile
                key={`clone-last-${walls[walls.length - 1].id}`}
                wall={walls[walls.length - 1]}
                dataWallIdx={walls.length - 1}
                isClone
                isLoading={isLoading}
                lpSize={lpSize}
                railWidth={railWidth}
                railLeftPx={railLeftPx}
              />
            )}
            {walls.map((w, i) => (
              <HeroWallSlideMobile
                key={w.id}
                wall={w}
                dataWallIdx={i}
                isLoading={isLoading}
                lpSize={lpSize}
                railWidth={railWidth}
                railLeftPx={railLeftPx}
              />
            ))}
            {isLooping && (
              <HeroWallSlideMobile
                key={`clone-first-${walls[0].id}`}
                wall={walls[0]}
                dataWallIdx={0}
                isClone
                isLoading={isLoading}
                lpSize={lpSize}
                railWidth={railWidth}
                railLeftPx={railLeftPx}
              />
            )}
          </>
        )}
      </div>

      {walls.length > 1 && (
        <div
          // Same group-has lift pattern as desktop: when any
          // post-it inside the hero is hovered or tap-active, the
          // row + slot wrappers push the slide stacking context up,
          // and this row also lifts to stay above the slide
          // backdrop instead of getting buried.
          className="absolute left-1/2 -translate-x-1/2 z-30 group-has-[.dig-postit:hover]/hero:z-[70] group-has-[.dig-postit[data-tap-active=true]]/hero:z-[70] flex items-center gap-3"
          style={{ bottom: 8 }}
        >
          <div className="flex items-center gap-2">
            {walls.map((w, i) => (
              <button
                key={w.id}
                type="button"
                onClick={() => scrollToIdx(i)}
                aria-label={`${i + 1}번째 wall로 이동`}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === activeIdx
                    ? 'bg-white scale-125'
                    : 'bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
          {!reducedMotion && (
            <button
              type="button"
              onClick={() => setUserPaused((v) => !v)}
              aria-label={
                userPaused ? '자동 전환 재개' : '자동 전환 일시정지'
              }
              className="w-5 h-5 flex items-center justify-center text-[10px] leading-none text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
            >
              {userPaused ? '▶' : '❚❚'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Per-wall mobile slide — wraps the rails / LP grid composition for
// one wall so the parent component can stack N of them horizontally
// in the carousel. Each slide carries its own bg colour + paper
// overlay tone driven by `wall.wallColor`, ink + shadow driven by
// `wall.inkColor` + `wall.shadowCss`. Sliding from basement_purple →
// basement_gray → basement5 reads as walking along three different
// painted walls in the same shop.
function HeroWallSlideMobile({
  wall,
  dataWallIdx,
  isClone = false,
  isLoading,
  lpSize,
  railWidth,
  railLeftPx,
}: {
  wall: HomeWall;
  /** Real wall index. Used both for the data attribute the IO
   *  observer reads, and as a seed input for the per-wall rail
   *  texture variation. Clone slides still receive the index of
   *  the wall they're cloning so the rail visual matches; the
   *  data attribute is suppressed via isClone instead. */
  dataWallIdx: number;
  /** True for the leading/trailing clone slides rendered by the
   *  looping carousel. Suppresses the data-wall-idx attribute so
   *  the IO observer skips the clone but lets the seed math run
   *  with the real index it's cloning. */
  isClone?: boolean;
  isLoading: boolean;
  lpSize: number;
  railWidth: number;
  railLeftPx: number;
}) {
  const items = wall.items;
  const slots = Array.from({ length: ROWS * COLS }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  return (
    <div
      {...(isClone ? {} : { 'data-wall-idx': dataWallIdx })}
      className="relative flex-shrink-0 w-full snap-center overflow-hidden"
      style={{
        // Per-wall surface tone. Replaces the singleton
        // HERO_THEME.wall — basement_purple's #4c3c54 stays for
        // wall 1, while wall 2 (basement_gray) and wall 3
        // (basement5) carry their own sampled hues.
        backgroundColor: wall.wallColor,
      }}
    >
      {/* Paper-grain texture overlay — repeat-y so the slide auto-
          grows with content height. Soft-light blend lets the wall
          colour drive luminance/hue and the texture only contributes
          surface noise. */}
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

      {/* Soft vignette — bottom darken so the activity sections
          below the hero hand off cleanly. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, transparent 70%, rgba(0, 0, 0, 0.22) 100%)',
        }}
      />

      {/* Handwritten section title — anchored top-left of the wall.
          Per-wall ink + shadow so the title stays readable against
          basement5's light surface (dark ink) and basement_purple's
          dark surface (cream ink) without a manual swap. */}
      {wall.theme && wall.theme.trim().length > 0 && (
        <div
          className="absolute select-none pointer-events-none"
          style={{
            top: TITLE_TOP_PX,
            left: railLeftPx,
            right: PAD_X,
            fontFamily: GRAFFITI_FONT_STACK,
            color: wall.inkColor,
            textShadow: wall.shadowCss,
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
            {wall.theme}
          </h2>
          {wall.description && wall.description.trim().length > 0 && (
            <p
              style={{
                fontSize: 13,
                fontWeight: 400,
                marginTop: 6,
                marginBottom: 0,
                lineHeight: 1.2,
              }}
            >
              {wall.description}
            </p>
          )}
        </div>
      )}

      {/* Rails + LPs — render even with empty items so walls 2 + 3
          still show the rail composition; otherwise the empty walls
          would read as just a backdrop without visual continuity. */}
      {lpSize > 0 && (
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
              <div
                key={ri}
                // Row needs its own z-bump on post-it hover too —
                // slot-level z only beats neighbours inside the same
                // row's grid; without lifting the row, the next row's
                // content (later in DOM) still paints over the
                // scaled post-it. `relative z-0` gives every row a
                // baseline stacking context so the hovered row's
                // z-50 actually wins against neighbours.
                className="relative z-0 has-[.dig-postit:hover]:z-[60] has-[.dig-postit[data-tap-active=true]]:z-[60]"
                style={{
                  marginBottom: ri < ROWS - 1 ? ROW_GAP_Y : 0,
                }}
              >
                {/* Rail rendered as an absolute layer at LP-bottom
                    height so post-its (which extend past the LP into
                    the slot's bottom extension) cross the rail line
                    visually — same composition as desktop, where the
                    backdrop image bakes the rail directly under the
                    LPs. Drawn first in DOM so the post-it overflow
                    paints over it. */}
                <div
                  className="absolute pointer-events-none flex justify-center"
                  style={{
                    top: lpSize,
                    left: 0,
                    right: 0,
                    zIndex: 0,
                  }}
                >
                  <WallRail
                    width={railWidth}
                    seed={ri * 37 + 13 + dataWallIdx * 41}
                    height={RAIL_HEIGHT}
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${COLS}, ${lpSize}px)`,
                    gap: COVER_GAP_X,
                    justifyContent: 'center',
                    alignItems: 'end',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  {Array.from({ length: COLS }, (_, ci) => {
                    const position = startPos + ci;
                    const item = slots[position];
                    // Same precedence as desktop: home_features.note
                    // overrides admin's 50자 평. Empty result skips
                    // PostItNote entirely so uncommented slots stay
                    // clean.
                    const noteText =
                      item?.note?.trim() ||
                      item?.adminReview?.trim() ||
                      null;
                    // Slot reserves just enough vertical space to
                    // contain the post-it body (33.6% × lpSize) plus
                    // a couple of px so the tape's negative top
                    // doesn't get clipped. Earlier 45% left a thick
                    // empty band between the post-it and the next
                    // row of LPs; tightening to 38% pulls the next
                    // row up so the post-it bottom lands close to
                    // the next album cover, the way it does on
                    // desktop where the rail/cover spacing is baked
                    // into the backdrop.
                    const slotHeight =
                      lpSize + Math.round(lpSize * 0.38);
                    return (
                      <div
                        key={position}
                        // `dig-hero-slot` (index.css) wraps the same
                        // four trigger states the desktop slot uses
                        // — post-it / cover, hover / tap-active —
                        // with asymmetric z-index transition timing
                        // so the discrete z-down jump fires only
                        // after the inner scale-down transform has
                        // finished, not the moment hover ends.
                        className="group/slot dig-hero-slot"
                        style={{
                          width: lpSize,
                          height: slotHeight,
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: lpSize,
                            height: lpSize,
                          }}
                        >
                          {item && !isLoading ? (
                            <MobileFeatureCell
                              item={item}
                              position={position}
                              lpSize={lpSize}
                              plasticMeta={wall}
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
                        {item && noteText && (
                          <div
                            className="absolute flex justify-center"
                            style={{
                              // Sits at the LP/rail boundary —
                              // tape crosses the rail line, paper
                              // body fully below LP.
                              top: lpSize + 2,
                              left: 0,
                              width: lpSize,
                            }}
                          >
                            <PostItNote
                              text={noteText}
                              lpSize={lpSize}
                              seed={item.album.mbid}
                              href={`/album/${item.album.slug || item.album.mbid}`}
                              isMobile
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
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
  // Post-it lives on the rail (rendered as a sibling by the parent
  // slot div) so it doesn't overlap the play chip / pick sticker
  // / store-link sticker on the cover. coverOverlay below stays
  // cover-only.

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
      priceTagOverlay={
        topLink ? (
          <HomeFeatureSticker
            link={topLink}
            lpSize={lpSize}
            albumTitle={album.titleKo || album.title}
            albumArtist={album.artistKo || album.artist}
            releaseDate={album.releaseDate}
            seed={album.mbid}
          />
        ) : null
      }
      coverOverlay={
        isPick ? <MobilePickSticker lpSize={lpSize} seed={album.mbid} /> : null
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
      src="/textures/pick.webp"
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
