import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  useUpdateHomeMeta,
  useMoveHomeWall,
  type HomeFeatureItem,
  type HomeWall,
  type HomeMetaPatch,
} from '../../hooks/useHomeFeatures';

// SessionStorage key for the carousel's last-visible wall index. A
// fresh tab starts at idx 0; navigating away from `/` and back
// restores whichever slide the user was on, so a click into an
// album page doesn't flip them back to wall 1 on return. Scoped
// to the session because the persistence is only meaningful within
// the active visit — coming back next week shouldn't dictate which
// wall they see first.
const ACTIVE_WALL_STORAGE_KEY = 'dig.haus:home-active-wall-idx';

// Auto-advance interval — 7s sits in the standard gallery /
// curation range (5-7s for marketing, 7-10s for editorial). Slower
// would risk visitors not realising more walls exist; faster would
// fight the anti-algorithm "give visitors time to look" stance.
// Pauses on hover / touch / focus / admin-edit / tuner-open and
// respects prefers-reduced-motion.
const AUTO_ADVANCE_MS = 7500;
import { useAuth } from '../../contexts/AuthContext';
import { WallLP } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import VinylWallEditor from '../MyDig/VinylWallEditor';
import type { MyDigWallItem } from '../../hooks/useMyDig';
import HomeFeatureSticker from './HomeFeatureSticker';
import PostItNote from './PostItNote';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';
// HERO_BACKDROP_URL / HERO_THEME singletons used to drive the whole
// hero. They're now per-wall (each home_walls row carries its own
// backdrop_file + ink_color + shadow_css + wall_color) so the
// imports are gone — see HeroWallSlide below.

// basement_purple.avif: 2976×1500 wall-only strip (concrete-textured
// wall with two baked-in wood shelves and a small dig.haus neon in
// the top-right). The asset arrives pre-trimmed at the band aspect
// we want, so we render it at its natural ratio without further CSS
// cropping — the earlier HERO_ASPECT inner-frame trick is gone,
// sceneH just tracks the source aspect again.
//
// Coordinates below live in source-image px (2912×1464); a
// single `scale` factor (renderedWidth / 2912) projects them
// into screen px at render time. The hero_*.avif set the
// operator generated for the carousel ships at 2912×1464; older
// basement_*.avif files were 2976×1500, but the aspect difference
// (1.989 vs 1.984) is small enough that the existing tuner values
// still land approximately right after the constant change.
const SCENE_W = 2912;
const SCENE_H = 1464;

// Below MIN_W the scene stops shrinking and the surrounding
// container's overflow:hidden crops it. Keeps the shelves
// readable on narrow desktop windows / tablets.
const MIN_W = 1024;

// Top + bottom trim, in rendered px. The backdrop is authored at
// the band aspect we want, so no further CSS cropping — set to
// 0 to render the full image. Constants kept around in case a
// future asset wants the trim back.
const TRIM_TOP_PX = 0;
const TRIM_BOTTOM_PX = 0;

interface TunerValues {
  lpSize: number;
  lpGap: number;
  // Per-row LP X start (in source-image px). Splitting these
  // lets admins offset the upper and lower rows by a few pixels
  // so the wall doesn't read as a perfectly-aligned grid — a
  // small horizontal stagger between rows reads as more
  // hand-arranged.
  upperLpXStart: number;
  lowerLpXStart: number;
  upperLpY: number;
  lowerLpY: number;
  titleTopY: number;
  titleLeftX: number;
  // Source-image px font size for the handwritten title; the
  // description sub-line scales proportionally (≈43% of title)
  // so admins only have to tune one number. Tilt is in degrees,
  // negative = counter-clockwise.
  titleFontSize: number;
  titleRotationDeg: number;
}

// Defaults match the values an admin landed on against
// basement3.avif via the in-page tuner — captured from the
// 2026-04-27 calibration screenshot and folded back here so a
// fresh session paints to the same placement without needing
// a saved localStorage entry. Tuner remains the source of
// truth for further refinements.
// Local fallback when the home_meta query hasn't resolved yet.
// Server returns the same values as defaults so this only flashes
// for the brief window before /api/home/features comes back.
const DEFAULT_TUNER: TunerValues = {
  lpSize: 357,
  lpGap: 30,
  upperLpXStart: 531,
  lowerLpXStart: 531,
  upperLpY: 279,
  lowerLpY: 752,
  titleTopY: 102,
  titleLeftX: 305,
  titleFontSize: 67,
  titleRotationDeg: -1,
};

// Map the server's home_meta payload into the tuner's local
// shape. The title position fields reuse the existing
// header_*_px columns (legacy from the deleted HomeWall) since
// they're already wired into the meta PATCH endpoint; tuner
// names stay title* so the UI labels read naturally.
function metaToTuner(meta: HomeWall | undefined): TunerValues {
  if (!meta) return DEFAULT_TUNER;
  return {
    lpSize: meta.lpSize,
    lpGap: meta.lpGap,
    upperLpXStart: meta.upperLpXStart,
    lowerLpXStart: meta.lowerLpXStart,
    upperLpY: meta.upperLpY,
    lowerLpY: meta.lowerLpY,
    titleTopY: meta.headerTopPx,
    titleLeftX: meta.headerLeftPx,
    titleFontSize: meta.titleFontSize,
    titleRotationDeg: meta.titleRotationDeg,
  };
}

function tunerToPatch(t: TunerValues): HomeMetaPatch {
  return {
    lpSize: t.lpSize,
    lpGap: t.lpGap,
    upperLpXStart: t.upperLpXStart,
    lowerLpXStart: t.lowerLpXStart,
    upperLpY: t.upperLpY,
    lowerLpY: t.lowerLpY,
    headerTopPx: t.titleTopY,
    headerLeftPx: t.titleLeftX,
    titleFontSize: t.titleFontSize,
    titleRotationDeg: t.titleRotationDeg,
  };
}

// Plastic-wrap textures — same pool as the live HomeWall.
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

// Position-indexed texture assignment — the 10-slot wall and the
// 10-texture pool match 1:1, so picking by `position % N` guarantees
// each texture appears exactly once across the visible wall. The
// previous mbid-hash pick had collisions clustering 2–3 textures
// across the visible 10 slots and the wall read as repetitive even
// though the math said "uniform random". With position-indexing the
// only way two slots can share a texture is if N drops below 10.
function pickPlasticTexture(position: number): string {
  if (PLASTIC_TEXTURE_PATHS.length === 0) return '';
  // Slot 0's default texture (swrap01) was reading as too aggressive
  // — the upper-left slot draws the eye first and the wrinkle pattern
  // dominated whatever cover sat under it. Borrow slot 7's softer
  // wrap (swrap17) for slot 0; the duplication is acceptable because
  // the two slots sit on different rows + opposite halves of the
  // wall, so the eye doesn't read them as a repeat.
  if (position === 0) return PLASTIC_TEXTURE_PATHS[7]!;
  return PLASTIC_TEXTURE_PATHS[position % PLASTIC_TEXTURE_PATHS.length]!;
}

export default function HomeNextHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const { data, isLoading } = useHomeFeatures();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const walls = data?.walls ?? [];

  // activeIdx tracks the currently-centred carousel slide; its
  // IntersectionObserver setup lives further down. Tuner + editor
  // both target the active wall so the admin's "어디 편집하지" mental
  // model matches "swipe to a wall, edit it" instead of "every wall
  // edits land on wall 1".
  const [activeIdx, setActiveIdx] = useState(0);
  const activeWall = walls[activeIdx] ?? walls[0];

  // Tuner state binds to the active wall. `committed` is the server
  // truth for whichever wall the admin is currently looking at;
  // `draft` is the local working copy sliders write to. Switching
  // walls (= activeIdx changes) flips committed to the new wall's
  // values, and the effect below resyncs draft so the tuner panel
  // shows the new wall's positions instantly.
  const committed = metaToTuner(activeWall);
  const [draft, setDraft] = useState<TunerValues>(committed);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // Keep draft in sync with committed (server) whenever it
  // changes. Compares JSON form to avoid clobbering an in-flight
  // edit when the query revalidates with the same content. Also
  // includes activeWall.id so swiping to a different wall resets
  // the draft from that wall's committed values rather than
  // carrying the last wall's edits over.
  const committedKey = `${activeWall?.id ?? 0}:${JSON.stringify(committed)}`;
  useEffect(() => {
    setDraft(metaToTuner(activeWall));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey]);

  const tuner = draft;

  const isDirty =
    draft.lpSize !== committed.lpSize ||
    draft.lpGap !== committed.lpGap ||
    draft.upperLpXStart !== committed.upperLpXStart ||
    draft.lowerLpXStart !== committed.lowerLpXStart ||
    draft.upperLpY !== committed.upperLpY ||
    draft.lowerLpY !== committed.lowerLpY ||
    draft.titleTopY !== committed.titleTopY ||
    draft.titleLeftX !== committed.titleLeftX ||
    draft.titleFontSize !== committed.titleFontSize ||
    draft.titleRotationDeg !== committed.titleRotationDeg;

  const updateMeta = useUpdateHomeMeta(activeWall?.id ?? 1);
  const moveWall = useMoveHomeWall();

  function handleSaveTuner() {
    updateMeta.mutate(tunerToPatch(draft));
  }

  function handleRevertTuner() {
    setDraft(committed);
  }

  function handleResetTuner() {
    // Reset just stages defaults into draft — admin still has to
    // 저장 to persist, matching the other knobs' behaviour.
    setDraft(DEFAULT_TUNER);
  }

  // Width-driven scaling: track the container's actual rendered
  // width and derive everything else from it.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sceneW = Math.max(containerW, MIN_W);
  // sceneFullH = the image's natural rendered height (aspect
  // preserved). The inner frame is sized to this so LPs and
  // the image share one coord system. sceneH (the visible
  // band) trims TRIM_TOP_PX + TRIM_BOTTOM_PX off; the outer
  // container clips to sceneH and the inner frame is shifted
  // up by TRIM_TOP_PX so the trim falls on top + bottom.
  const sceneFullH = sceneW * (SCENE_H / SCENE_W);
  const sceneH = Math.max(0, sceneFullH - TRIM_TOP_PX - TRIM_BOTTOM_PX);
  const scale = sceneW / SCENE_W;

  const items = activeWall?.items ?? [];
  const meta = activeWall;

  // Carousel — horizontal scroll-snap container. Each wall is one
  // slide at 100% of the carousel width. The IntersectionObserver
  // below feeds setActiveIdx so the admin chips + dot pagination
  // know which wall the user is currently looking at.
  //
  // Looping carousel: when there are 2+ walls, we render
  // [lastClone, ...walls, firstClone] so swiping past either end
  // visually continues into the next wall. The boundary handler
  // (useEffect below) snaps scrollLeft back to the matching real
  // slide instantly once the snap settles, which the user perceives
  // as a seamless wrap. Clones don't carry data-wall-idx so the IO
  // observer ignores them — activeIdx only updates from real slides.
  const carouselRef = useRef<HTMLDivElement>(null);
  const isLooping = walls.length > 1;
  // Initial scroll position on mount — when looping is active, the
  // first real slide lives at DOM index 1 (DOM index 0 is the clone
  // of the last wall), so we always have to scroll past the leading
  // clone before paint. SessionStorage restore folds in here too:
  // the stored real index gets +1 in DOM space when looping. Gated
  // on walls.length + sceneW so this runs once data has arrived and
  // the carousel has real width to scroll inside.
  useLayoutEffect(() => {
    const root = carouselRef.current;
    if (!root || walls.length === 0 || sceneW <= 0) return;
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
    // Run only once per fresh mount-with-data — re-running on every
    // walls.length / sceneW change would fight the user's manual
    // swipes (each swipe writes to storage, then the restore would
    // pull them back). The empty deps + outer guards keep it
    // single-shot per page mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls.length > 0, sceneW > 0]);
  // Boundary handler — when the user (or auto-advance) lands on a
  // clone slide (DOM idx 0 or N+1), snap instantly to the matching
  // real slide. Debounced ~120ms so the native snap-mandatory
  // settle completes before we measure scrollLeft; firing during
  // an in-flight smooth scroll would interrupt the animation and
  // make the wrap visually jagged. The instant scrollTo re-emits
  // a scroll event which re-arms the timer, but the second pass
  // sees a non-boundary position and noops.
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
  // Persist the active wall on every change so the next mount can
  // restore it. SessionStorage (not local) so it scopes to this
  // browser session — opening the site again next week starts at
  // wall 1 again, which is the right default.
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

  // Auto-advance — fires every AUTO_ADVANCE_MS while no interaction
  // is in flight and respects reduced-motion preferences. The
  // timer resets whenever activeIdx changes (manual swipe, dot
  // click, reorder), so the visitor always gets a full window to
  // look at the wall they just navigated to.
  const [interactionPaused, setInteractionPaused] = useState(false);
  // Manual pause via the ⏸/▶ chip — sticks across renders so the
  // visitor's choice survives wall changes / mouse movement / etc.
  // Independent from the hover/touch interactionPaused which auto-
  // releases the moment the visitor moves away.
  const [userPaused, setUserPaused] = useState(false);
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reducedMotion) return;
    if (walls.length <= 1) return;
    if (interactionPaused || editing || tunerOpen || userPaused) return;
    const id = window.setInterval(() => {
      const root = carouselRef.current;
      if (!root) return;
      // Always advance one DOM slot to the right so the wrap from
      // last → first plays as a continuous slide into the firstClone
      // (the boundary handler then jumps instantly to real wall 0).
      // Using `(activeIdx + 1) % walls.length` directly would scroll
      // backward across N slides at the seam, which is what we're
      // trying to avoid in the first place.
      const currentDom = isLooping ? activeIdx + 1 : activeIdx;
      const nextDom = isLooping ? currentDom + 1 : (currentDom + 1) % walls.length;
      root.scrollTo({ left: nextDom * root.clientWidth, behavior: 'smooth' });
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [
    activeIdx,
    walls.length,
    interactionPaused,
    editing,
    tunerOpen,
    userPaused,
    reducedMotion,
  ]);

  // After a successful wall reorder, follow the moved wall to its
  // new slide so the admin doesn't end up looking at a different
  // wall (the one that took the moved wall's old slot). The move
  // mutation invalidates the query, which triggers a refetch with
  // walls re-sorted by the new position; this ref lets us scroll
  // *after* that re-render has actually happened.
  const followWallIdRef = useRef<number | null>(null);
  function handleMoveWall(dir: 'left' | 'right') {
    if (!activeWall) return;
    const wallId = activeWall.id;
    followWallIdRef.current = wallId;
    moveWall.mutate({ id: wallId, dir });
  }
  useEffect(() => {
    const target = followWallIdRef.current;
    if (target == null) return;
    const newIdx = walls.findIndex((w) => w.id === target);
    if (newIdx < 0) return;
    followWallIdRef.current = null;
    const root = carouselRef.current;
    if (!root) return;
    const domIdx = isLooping ? newIdx + 1 : newIdx;
    root.scrollTo({ left: domIdx * root.clientWidth, behavior: 'instant' });
    setActiveIdx(newIdx);
    // Keying on the joined id-order so the effect fires on every
    // post-move refetch (where the array reorders) but stays quiet
    // when only individual wall fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls.map((w) => w.id).join(',')]);

  return (
    <div
      ref={containerRef}
      className="group/hero relative w-full bg-[#0a0703]"
      style={{
        height:
          sceneH ||
          (MIN_W * SCENE_H) / SCENE_W - TRIM_TOP_PX - TRIM_BOTTOM_PX,
      }}
    >
      {/* Carousel scroll container — overflow-x scroll with snap-x
          mandatory makes mouse-wheel + touch swipe land on each
          wall cleanly. Each child slide is w-full of the carousel
          (= w-full of the outer container) so the scroll math
          stays trivial: scrollLeft = idx * clientWidth. */}
      <div
        ref={carouselRef}
        // Hover / touch / focus pause the auto-advance timer — when
        // any of these end, the timer resumes on the next render.
        // touchend has no immediate event in React but the browser
        // fires it after the touch lifts; combined with mouseleave
        // covers both desktop pointer and mobile touch flows.
        onMouseEnter={() => setInteractionPaused(true)}
        onMouseLeave={() => setInteractionPaused(false)}
        onTouchStart={() => setInteractionPaused(true)}
        onTouchEnd={() => setInteractionPaused(false)}
        onFocusCapture={() => setInteractionPaused(true)}
        onBlurCapture={() => setInteractionPaused(false)}
        className="absolute inset-0 overflow-x-auto overflow-y-hidden flex snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {sceneW > 0 && walls.length > 0 && (
          <>
            {/* Leading clone of the last wall — only rendered when
                looping is active. Sits at DOM index 0 so swiping left
                from real wall 0 visually slides into wall N-1's
                content; the boundary handler then instant-snaps to
                the real last slide. No data-wall-idx so the IO
                observer ignores it. */}
            {isLooping && (
              <HeroWallSlide
                key={`clone-last-${walls[walls.length - 1].id}`}
                wall={walls[walls.length - 1]}
                isFirst={false}
                tuner={metaToTuner(walls[walls.length - 1])}
                sceneW={sceneW}
                sceneFullH={sceneFullH}
                scale={scale}
                isLoading={isLoading}
              />
            )}
            {walls.map((w, i) => (
              <HeroWallSlide
                key={w.id}
                wall={w}
                dataWallIdx={i}
                isFirst={i === activeIdx}
                tuner={i === activeIdx ? tuner : metaToTuner(w)}
                sceneW={sceneW}
                sceneFullH={sceneFullH}
                scale={scale}
                isLoading={isLoading}
              />
            ))}
            {/* Trailing clone of the first wall — mirrors the leading
                clone for swipe-right past the last wall. */}
            {isLooping && (
              <HeroWallSlide
                key={`clone-first-${walls[0].id}`}
                wall={walls[0]}
                isFirst={false}
                tuner={metaToTuner(walls[0])}
                sceneW={sceneW}
                sceneFullH={sceneFullH}
                scale={scale}
                isLoading={isLoading}
              />
            )}
          </>
        )}
      </div>

      {/* Dot pagination — positioned along the bottom centre of the
          hero, above the scroll hint. Hidden when there's only one
          wall (carousel collapses to a single slide visually). The
          ⏸/▶ chip sits to the right of the dots so visitors can stop
          the auto-advance to read the post-it on a particular wall.
          Hidden when prefers-reduced-motion is on (carousel is then
          inert by default — surfacing a play control would fight the
          OS preference). */}
      {walls.length > 1 && (
        <div
          // group-has lift: when a post-it is hovered/tap-active
          // anywhere in the hero, the slide jumps to z-[60] (see
          // HeroWallSlide root) so its backdrop image starts painting
          // above this z-30 dot row, hiding the dots. Lifting the
          // dots to z-[70] in the same condition keeps them visible.
          // Same group is used for the admin chips below.
          className="absolute left-1/2 -translate-x-1/2 z-30 group-has-[.dig-postit:hover]/hero:z-[70] group-has-[.dig-postit[data-tap-active=true]]/hero:z-[70] flex items-center gap-3"
          style={{ bottom: 50 }}
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
              title={userPaused ? '자동 전환 재개' : '자동 전환 일시정지'}
              className="w-5 h-5 flex items-center justify-center text-[10px] leading-none text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
            >
              {userPaused ? '▶' : '❚❚'}
            </button>
          )}
        </div>
      )}

      {/* Admin chip pair — 편집 and 보정 anchored to the hero's top-
          right corner. Both chips target the currently-centred wall
          so swiping the carousel changes which wall the next click
          edits. Tooltip echoes the active position (1번째 / 2번째 /
          3번째) so the admin can confirm which wall is about to be
          touched before clicking. */}
      {isAdmin && !editing && !tunerOpen && (
        <div className="absolute top-3 right-3 z-30 group-has-[.dig-postit:hover]/hero:z-[70] group-has-[.dig-postit[data-tap-active=true]]/hero:z-[70] flex items-center gap-2 opacity-0 group-hover/hero:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-gray-200 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full px-3 py-1 transition-colors"
            title={`${activeIdx + 1}번째 벽 편집`}
          >
            ✏️ 편집
          </button>
          <button
            type="button"
            onClick={() => setTunerOpen(true)}
            className="text-[11px] text-gray-300 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full px-3 py-1 transition-colors flex items-center gap-1.5"
            title={`${activeIdx + 1}번째 벽 위치 보정`}
          >
            ⚙ 보정
            {isDirty && (
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full bg-[#e8a020]"
              />
            )}
          </button>
          {walls.length > 1 && activeWall && (
            <>
              <button
                type="button"
                onClick={() => handleMoveWall('left')}
                disabled={activeIdx === 0 || moveWall.isPending}
                title="이 벽을 왼쪽으로"
                aria-label="이 벽을 왼쪽으로"
                className="text-[11px] text-gray-300 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full w-7 h-7 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => handleMoveWall('right')}
                disabled={
                  activeIdx === walls.length - 1 || moveWall.isPending
                }
                title="이 벽을 오른쪽으로"
                aria-label="이 벽을 오른쪽으로"
                className="text-[11px] text-gray-300 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full w-7 h-7 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                →
              </button>
            </>
          )}
        </div>
      )}

      {isAdmin && editing && activeWall && (
        <VinylWallEditor
          target={{ kind: 'home-features', wallId: activeWall.id }}
          initialWall={homeItemsToWallItems(items)}
          initialTheme={meta?.theme ?? null}
          initialDescription={meta?.description ?? null}
          initialHeaderTopPx={meta?.headerTopPx ?? -120}
          initialHeaderLeftPx={meta?.headerLeftPx ?? 4}
          initialHeaderRotationDeg={meta?.headerRotationDeg ?? -4}
          onClose={() => setEditing(false)}
        />
      )}

      {isAdmin && tunerOpen && (
        <HeroTunerPanel
          values={draft}
          onChange={setDraft}
          isDirty={isDirty}
          onSave={handleSaveTuner}
          onRevert={handleRevertTuner}
          onReset={handleResetTuner}
          onClose={() => setTunerOpen(false)}
        />
      )}

      {/* The ">>" scroll-hint chevron used to live here. Removed once
          the carousel landed: the page now has two navigation axes
          (sideways for walls, down for activity), the chevron points
          one way, and the dot pagination above already telegraphs
          interactivity. Dots stay; chevron goes. */}
    </div>
  );
}

// One slide of the hero carousel — the per-wall renderer that used
// to be the inline body of HomeNextHero before the multi-wall lift.
// Reads its backdrop / theme / description / ink / shadow / wall
// colour entirely from `wall` so each track in the carousel carries
// its own visual identity. The active wall (idx 0 in v1) gets the
// admin's live tuner draft for an instant-feedback preview; other
// walls render with their own stored tuner values.
function HeroWallSlide({
  wall,
  dataWallIdx,
  isFirst,
  tuner,
  sceneW,
  sceneFullH,
  scale,
  isLoading,
}: {
  wall: HomeWall;
  /** Real wall index for IntersectionObserver to feed setActiveIdx.
   *  Omitted on clone slides (leading/trailing duplicates rendered
   *  by the looping carousel) so the observer ignores them and
   *  activeIdx only ever reflects a real wall. */
  dataWallIdx?: number;
  isFirst: boolean;
  tuner: TunerValues;
  sceneW: number;
  sceneFullH: number;
  scale: number;
  isLoading: boolean;
}) {
  const lpSize = Math.max(40, Math.round(tuner.lpSize * scale));
  const lpGap = Math.max(0, Math.round(tuner.lpGap * scale));
  const items = wall.items;
  const slots = Array.from({ length: 10 }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  return (
    <div
      {...(dataWallIdx !== undefined ? { 'data-wall-idx': dataWallIdx } : {})}
      // `z-0` baseline + `has-[.dig-postit:hover]:z-[60]` lift the
      // entire slide above the carousel's z-30 dot pagination + admin
      // chips when any post-it inside is hovered. The inner
      // -translate-x-1/2 frame creates its own stacking context, so
      // the post-it's own z-40 stays trapped inside the frame; lifting
      // here at the slide level is what propagates above the carousel
      // siblings in the hero's stacking context.
      className="relative flex-shrink-0 w-full h-full snap-center overflow-hidden z-0 has-[.dig-postit:hover]:z-[60] has-[.dig-postit[data-tap-active=true]]:z-[60]"
    >
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: -TRIM_TOP_PX,
          width: sceneW,
          height: sceneFullH,
        }}
      >
        <img
          src={`/backdrops/${wall.backdropFile}`}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{ maxWidth: 'none' }}
        />

        {/* Wall section header — per-wall theme + ink/shadow tokens.
            basement5 is a light surface so its ink_color resolves to
            dark brown; basement_purple is dark so its ink stays cream.
            Server-side extract-hero-theme samples each backdrop and
            stores the matching ink/shadow on the wall row. */}
        {wall.theme && wall.theme.trim().length > 0 && (
          <div
            className="absolute select-none pointer-events-none"
            style={{
              left: tuner.titleLeftX * scale,
              top: tuner.titleTopY * scale,
              fontFamily: GRAFFITI_FONT_STACK,
              transform: `rotate(${tuner.titleRotationDeg}deg)`,
              transformOrigin: 'top left',
              color: wall.inkColor,
              textShadow: wall.shadowCss,
            }}
          >
            <h2
              style={{
                fontSize: tuner.titleFontSize * scale,
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
                  fontSize: tuner.titleFontSize * 0.5 * scale,
                  fontWeight: 400,
                  marginTop: 20 * scale,
                  marginBottom: 0,
                  lineHeight: 1.2,
                }}
              >
                {wall.description}
              </p>
            )}
          </div>
        )}

        {/* LP rows — render even when items are empty so walls 2 + 3
            still show the rail composition (empty WallLPs at each
            slot). Without this the empty walls would read as just a
            backdrop, breaking visual continuity across the carousel. */}
        {(!isLoading || !isFirst) && (
          <>
            <ShelfRow
              slots={slots.slice(0, 5)}
              firstPosition={0}
              rowTopY={tuner.upperLpY * scale}
              rowLeftX={tuner.upperLpXStart * scale}
              lpSize={lpSize}
              lpGap={lpGap}
              plasticMeta={wall}
            />
            <ShelfRow
              slots={slots.slice(5, 10)}
              firstPosition={5}
              rowTopY={tuner.lowerLpY * scale}
              rowLeftX={tuner.lowerLpXStart * scale}
              lpSize={lpSize}
              lpGap={lpGap}
              plasticMeta={wall}
            />
          </>
        )}
      </div>
    </div>
  );
}

// home_features rows carry HomeFeatureAlbum (mbid-keyed, no
// numeric DB id). VinylWallEditor's draft state expects
// MyDigAlbum; padding with id=0 because home-features saves
// route by mbid, not albumId.
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

// Small triangular badge marking standout records (avgScore ≥ 86
// with ≥3 scored reviews backing it). Sits at the LP's bottom-
// left inside the cover-overlay slot so it tilts + scales with
// the sleeve. Width sits at 17.5% of LP — small enough not to
// dominate the cover. Per-LP rotation in the [-2°, 2°] range
// derived from a hash of the album mbid so the sticker reads
// as hand-applied (slightly off-square each time) but stable
// across renders for the same album.
function DighausPickSticker({
  lpSize,
  seed,
}: {
  lpSize: number;
  seed: string;
}) {
  const width = Math.round(lpSize * 0.175);
  // hashStr returns 0..2^32-1; modulo 401 gives 0..400, divided
  // by 100 → 0.00..4.00, shifted → -2.00..+2.00 in 0.01° steps.
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
        // Drop the default img max-width:100% from tailwind
        // preflight so the sticker isn't capped by parent width.
        maxWidth: 'none',
      }}
    />
  );
}

function ShelfRow({
  slots,
  firstPosition,
  rowTopY,
  rowLeftX,
  lpSize,
  lpGap,
  plasticMeta,
}: {
  slots: Array<HomeFeatureItem | null>;
  firstPosition: number;
  rowTopY: number;
  rowLeftX: number;
  lpSize: number;
  lpGap: number;
  plasticMeta: HomeWall | undefined;
}) {
  return (
    <>
      {slots.map((item, i) => {
        const position = firstPosition + i;
        const cellLeft = rowLeftX + i * (lpSize + lpGap);
        const topLink = item?.album.priceTagLinks?.[0] ?? null;
        // dig.haus PICK gate: needs the same MIN_SCORED_FOR_AVG=3
        // floor as the rest of the site so a single 100-point
        // review can't promote an album. Threshold 86 is the
        // "this is genuinely good" line agreed for the home wall.
        const score = item?.album.averageScore ?? null;
        const reviewCount = item?.album.reviewCount ?? 0;
        const isPick = score != null && score >= 86 && reviewCount >= 3;
        // Post-it note: home_features.note overrides admin's 50자 평
        // (the per-slot hero context wins over the album-page note
        // when both exist). Only render when at least one of them
        // has content — empty slots stay clean so the slots that
        // *do* carry a comment draw the eye naturally.
        const noteText = item?.note?.trim() || item?.adminReview?.trim() || null;
        // Slot height is extended past the LP to reserve space for
        // a post-it sitting on/around the rail below. The extension
        // also makes the group-hover region include the post-it
        // itself, so moving the cursor onto the note keeps it
        // expanded while the visitor reads.
        const slotHeight = lpSize + Math.round(lpSize * 0.45);
        return (
          <div
            key={position}
            // `relative z-0` baseline so the slot owns its stacking
            // context; the `has-[…]` rules lift it above sibling
            // slots when interactive content inside is engaged:
            //   - `.dig-postit:hover` / data-tap-active: post-it
            //     scales above the next slot's LP, the carousel dots,
            //     and the admin chips.
            //   - `.wall-hover-outer:hover` / data-tap-active: the LP
            //     itself hover-scales (162%) and would otherwise be
            //     buried by the next slot's cover (sibling slots
            //     share the same z-0 baseline, so DOM-order paint
            //     wins without the lift).
            className="absolute group/slot z-0 has-[.dig-postit:hover]:z-[60] has-[.dig-postit[data-tap-active=true]]:z-[60] has-[.wall-hover-outer:hover]:z-[60] has-[.wall-hover-outer[data-tap-active=true]]:z-[60]"
            style={{
              left: cellLeft,
              top: rowTopY,
              width: lpSize,
              height: slotHeight,
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
            {item ? (
              <WallHoverCard
                album={item.album}
                position={position}
                lpSize={lpSize}
                lampBias={1 - position / 10}
                href={`/album/${item.album.slug || item.album.mbid}`}
                plasticOverlaySrc={pickPlasticTexture(position)}
                plasticScalePct={plasticMeta?.plasticScalePct ?? 15}
                plasticOffsetXPx={plasticMeta?.plasticOffsetXPx ?? 5}
                plasticOffsetYPx={plasticMeta?.plasticOffsetYPx ?? 0}
                plasticBlendMode={plasticMeta?.plasticBlendMode ?? 'normal'}
                hoverScalePct={162}
                hoverOriginY="75%"
                playChipScale={0.75}
                playChipInsetPct={4}
                tapToActivate
                priceTagOverlay={
                  topLink ? (
                    <HomeFeatureSticker
                      link={topLink}
                      lpSize={lpSize}
                      albumTitle={item.album.titleKo || item.album.title}
                      albumArtist={item.album.artistKo || item.album.artist}
                      seed={item.album.mbid}
                    />
                  ) : null
                }
                coverOverlay={
                  isPick ? (
                    <DighausPickSticker
                      lpSize={lpSize}
                      seed={item.album.mbid}
                    />
                  ) : null
                }
              />
            ) : (
              <WallLP
                size={lpSize}
                seed={position}
                empty
                lampBias={1 - position / 10}
              />
            )}
            </div>
            {item && noteText && (
              <div
                className="absolute flex justify-center"
                style={{
                  // Sits just below the LP/rail boundary — tape edge
                  // crosses the rail line, paper body fully below
                  // the LP so the cover never gets occluded. The
                  // +6 desktop offset drops the whole note (tape +
                  // body) past the painted rail highlight in the
                  // backdrop so the tape reads as stuck to the
                  // wall, not to the rail's metal lip.
                  top: lpSize + 6,
                  left: 0,
                  width: lpSize,
                }}
              >
                <PostItNote
                  text={noteText}
                  lpSize={lpSize}
                  seed={item.album.mbid}
                  href={`/album/${item.album.slug || item.album.mbid}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// In-page admin tuner — sliders + number inputs for every
// position knob, persisted to localStorage. Pinned to the
// hero's bottom-right when expanded; collapses to a small
// chip when not in use so it doesn't compete with the scene.
function HeroTunerPanel({
  values,
  onChange,
  isDirty,
  onSave,
  onRevert,
  onReset,
  onClose,
}: {
  values: TunerValues;
  onChange: (next: TunerValues) => void;
  isDirty: boolean;
  onSave: () => void;
  onRevert: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 z-30 w-[280px] bg-black/85 border border-white/15 rounded-lg p-3 backdrop-blur-sm shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-200 font-semibold flex items-center gap-2">
          Hero 보정
          {isDirty && (
            <span className="text-[9px] text-[#e8a020] uppercase tracking-wide">
              미저장
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-gray-400 hover:text-[#e8a020] px-1.5 py-0.5 rounded border border-white/10 transition-colors"
            title="기본값으로 (저장 전)"
          >
            기본
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] text-gray-400 hover:text-gray-100 px-1.5 py-0.5 transition-colors"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      </div>
      <TunerRow
        label="LP 크기"
        value={values.lpSize}
        min={100}
        max={500}
        step={1}
        onChange={(v) => onChange({ ...values, lpSize: v })}
      />
      <TunerRow
        label="LP 간격"
        value={values.lpGap}
        min={0}
        max={80}
        step={1}
        onChange={(v) => onChange({ ...values, lpGap: v })}
      />
      <TunerRow
        label="상단 LP X"
        value={values.upperLpXStart}
        min={0}
        max={SCENE_W - 100}
        step={1}
        onChange={(v) => onChange({ ...values, upperLpXStart: v })}
      />
      <TunerRow
        label="하단 LP X"
        value={values.lowerLpXStart}
        min={0}
        max={SCENE_W - 100}
        step={1}
        onChange={(v) => onChange({ ...values, lowerLpXStart: v })}
      />
      <TunerRow
        label="상단 LP Y"
        value={values.upperLpY}
        min={0}
        max={SCENE_H - 100}
        step={1}
        onChange={(v) => onChange({ ...values, upperLpY: v })}
      />
      <TunerRow
        label="하단 LP Y"
        value={values.lowerLpY}
        min={0}
        max={SCENE_H - 100}
        step={1}
        onChange={(v) => onChange({ ...values, lowerLpY: v })}
      />
      <div className="mt-2 pt-2 border-t border-white/10">
        <TunerRow
          label="제목 X"
          value={values.titleLeftX}
          min={0}
          max={SCENE_W - 100}
          step={1}
          onChange={(v) => onChange({ ...values, titleLeftX: v })}
        />
        <TunerRow
          label="제목 Y"
          value={values.titleTopY}
          min={0}
          max={SCENE_H - 100}
          step={1}
          onChange={(v) => onChange({ ...values, titleTopY: v })}
        />
        <TunerRow
          label="제목 크기"
          value={values.titleFontSize}
          min={20}
          max={120}
          step={1}
          onChange={(v) => onChange({ ...values, titleFontSize: v })}
        />
        <TunerRow
          label="제목 기울기"
          value={values.titleRotationDeg}
          min={-20}
          max={20}
          step={1}
          onChange={(v) => onChange({ ...values, titleRotationDeg: v })}
        />
      </div>
      {/* Footer: 저장 / 되돌리기. 저장 commits draft to
          localStorage so the values survive a reload; 되돌리기
          discards unsaved sliding back to the last saved state.
          Both disable when nothing's changed so the buttons
          aren't tempting non-action clicks. */}
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onRevert}
          disabled={!isDirty}
          className="text-[11px] px-2 py-1 rounded border border-white/10 text-gray-300 hover:text-gray-100 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty}
          className="text-[11px] px-2.5 py-1 rounded bg-[#e8a020] text-[#1a1208] font-semibold hover:bg-[#f0b040] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          저장
        </button>
      </div>
    </div>
  );
}

function TunerRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-1.5 last:mb-0">
      <label className="text-[10px] text-gray-400 w-[64px] shrink-0">
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="flex-1 h-1 accent-[#e8a020]"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-[52px] bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[10px] text-gray-200 tabular-nums"
      />
    </div>
  );
}
