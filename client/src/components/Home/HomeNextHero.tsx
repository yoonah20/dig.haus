import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  type HomeFeatureItem,
  type HomeMeta,
} from '../../hooks/useHomeFeatures';
import { useAuth } from '../../contexts/AuthContext';
import { WallLP } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import HomeFeatureSticker from './HomeFeatureSticker';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// store3.webp: 2528×1300 painted storefront with two empty wood
// shelves baked into the wall, monstera plant on the left, alley
// + dig.haus neon sign on the right. The hero composes the live
// LPs from /api/home/features on top of those shelves.
//
// Scaling model is **width-driven**: the scene fills the
// viewport's width (down to a min-width floor) and its height
// follows from the source aspect ratio. Earlier height-driven
// scaling (height=100vh, width=aspect) had the scene overflow
// horizontally on most desktops because 100vh × 1.5 ratio is
// almost always wider than viewport — the alley and neon sign
// got clipped. Width-driven keeps the full painting visible
// edge-to-edge and produces a shorter, more stable hero.
//
// Coordinates below all live in source-image px (2528×1400);
// a single `scale` factor (renderedWidth / 2528) projects them
// into screen px at render time.
const SCENE_W = 2528;
const SCENE_H = 1300;

// Below MIN_W the scene stops shrinking and the surrounding
// container's overflow:hidden crops it. Keeps the shelves
// readable on narrow desktop windows / tablets.
const MIN_W = 1024;

interface TunerValues {
  lpSize: number;
  lpGap: number;
  lpXStart: number;
  upperLpY: number;
  lowerLpY: number;
  titleTopY: number;
  titleLeftX: number;
}

// Defaults eyeballed against store3.webp; the in-page tuner is
// the source of truth for refinements (writes to localStorage,
// hard-coded defaults updated when we settle).
const DEFAULT_TUNER: TunerValues = {
  lpSize: 300,
  lpGap: 24,
  lpXStart: 470,
  // LP top-edge Y for each row. Upper shelf surface ≈ y=480 in
  // source, so a 300-px LP sits with its top at 480-300=180.
  // Lower shelf surface ≈ y=860, so 860-300=560.
  upperLpY: 180,
  lowerLpY: 560,
  titleTopY: 80,
  titleLeftX: 470,
};

// v2 — store3.webp shelves moved relative to store2, so any
// values an admin saved against the old asset would land off
// the new shelves. Bumping the key forces a fresh start.
const TUNER_STORAGE_KEY = 'homeNext:heroTuner:v2';

function loadTuner(): TunerValues {
  if (typeof window === 'undefined') return DEFAULT_TUNER;
  try {
    const raw = window.localStorage.getItem(TUNER_STORAGE_KEY);
    if (!raw) return DEFAULT_TUNER;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TUNER, ...parsed };
  } catch {
    return DEFAULT_TUNER;
  }
}

function saveTuner(values: TunerValues) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TUNER_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // localStorage may be disabled (Safari private mode etc.) — silent
    // fail is fine, the tuner just won't persist across reloads.
  }
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

function pickPlasticTexture(seed: string): string {
  if (PLASTIC_TEXTURE_PATHS.length === 0) return '';
  return PLASTIC_TEXTURE_PATHS[hashStr(seed) % PLASTIC_TEXTURE_PATHS.length]!;
}

export default function HomeNextHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const { data, isLoading } = useHomeFeatures();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  // Two tuner states: `committed` is what's persisted to
  // localStorage and what the page mounts with on a fresh load.
  // `draft` is the live working copy the sliders write to and
  // the hero renders against — that gives a real-time preview as
  // the admin drags handles. The 저장 button copies draft into
  // committed (and writes through to localStorage); 되돌리기
  // throws away unsaved changes by snapping draft back to
  // committed. Without this split, sliders auto-saved on every
  // change which made experimenting feel risky — there was no
  // "checkpoint" you could roll back to.
  const [committed, setCommitted] = useState<TunerValues>(DEFAULT_TUNER);
  const [draft, setDraft] = useState<TunerValues>(DEFAULT_TUNER);
  const [tunerOpen, setTunerOpen] = useState(false);

  useEffect(() => {
    const loaded = loadTuner();
    setCommitted(loaded);
    setDraft(loaded);
  }, []);

  const tuner = draft;

  const isDirty =
    draft.lpSize !== committed.lpSize ||
    draft.lpGap !== committed.lpGap ||
    draft.lpXStart !== committed.lpXStart ||
    draft.upperLpY !== committed.upperLpY ||
    draft.lowerLpY !== committed.lowerLpY ||
    draft.titleTopY !== committed.titleTopY ||
    draft.titleLeftX !== committed.titleLeftX;

  function handleSaveTuner() {
    saveTuner(draft);
    setCommitted(draft);
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
  const sceneH = sceneW * (SCENE_H / SCENE_W);
  const scale = sceneW / SCENE_W;

  const lpSize = Math.max(40, Math.round(tuner.lpSize * scale));
  const lpGap = Math.max(0, Math.round(tuner.lpGap * scale));

  const items = data?.items ?? [];
  const meta = data?.meta;
  const slots = Array.from({ length: 10 }, (_, i) =>
    items.find((it) => it.position === i) ?? null
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-[#0a0703]"
      // Container's intrinsic height matches the scene height so
      // the page flow below the hero starts immediately under
      // the painting's bottom edge. minHeight pegs to the same
      // floor as MIN_W * aspect so a sub-min viewport still
      // reserves the right amount of vertical real estate for
      // the (centred, clipped) scene.
      style={{ height: sceneH || (MIN_W * SCENE_H) / SCENE_W }}
    >
      {sceneW > 0 && (
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2"
          style={{ width: sceneW, height: sceneH }}
        >
          <img
            src="/backdrops/store3.webp"
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ maxWidth: 'none' }}
          />

          {/* Wall section header — handwritten title pulled from
              home_meta. Position tunable so we can nudge it
              against the new backdrop's negative space. */}
          {meta?.theme && meta.theme.trim().length > 0 && (
            <div
              className="absolute select-none pointer-events-none"
              style={{
                left: tuner.titleLeftX * scale,
                top: tuner.titleTopY * scale,
                fontFamily: GRAFFITI_FONT_STACK,
                transform: 'rotate(-3deg)',
                transformOrigin: 'top left',
                color: '#1a1208',
              }}
            >
              <h2
                style={{
                  fontSize: 56 * scale,
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
                    fontSize: 24 * scale,
                    fontWeight: 500,
                    marginTop: 6 * scale,
                    marginBottom: 0,
                    lineHeight: 1.2,
                  }}
                >
                  {meta.description}
                </p>
              )}
            </div>
          )}

          {!isLoading && (
            <>
              <ShelfRow
                slots={slots.slice(0, 5)}
                firstPosition={0}
                rowTopY={tuner.upperLpY * scale}
                rowLeftX={tuner.lpXStart * scale}
                lpSize={lpSize}
                lpGap={lpGap}
                plasticMeta={meta}
              />
              <ShelfRow
                slots={slots.slice(5, 10)}
                firstPosition={5}
                rowTopY={tuner.lowerLpY * scale}
                rowLeftX={tuner.lpXStart * scale}
                lpSize={lpSize}
                lpGap={lpGap}
                plasticMeta={meta}
              />
            </>
          )}
        </div>
      )}

      {isAdmin && (
        <HeroTuner
          values={draft}
          onChange={setDraft}
          isDirty={isDirty}
          onSave={handleSaveTuner}
          onRevert={handleRevertTuner}
          onReset={handleResetTuner}
          open={tunerOpen}
          onOpenChange={setTunerOpen}
        />
      )}
    </div>
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
  plasticMeta: HomeMeta | undefined;
}) {
  return (
    <>
      {slots.map((item, i) => {
        const position = firstPosition + i;
        const cellLeft = rowLeftX + i * (lpSize + lpGap);
        const topLink = item?.album.priceTagLinks?.[0] ?? null;
        return (
          <div
            key={position}
            className="absolute"
            style={{
              left: cellLeft,
              top: rowTopY,
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
                plasticOverlaySrc={pickPlasticTexture(item.album.mbid)}
                plasticScalePct={plasticMeta?.plasticScalePct ?? 15}
                plasticOffsetXPx={plasticMeta?.plasticOffsetXPx ?? 5}
                plasticOffsetYPx={plasticMeta?.plasticOffsetYPx ?? 0}
                plasticBlendMode={plasticMeta?.plasticBlendMode ?? 'normal'}
                hoverScalePct={150}
                coverOverlay={
                  topLink ? (
                    <HomeFeatureSticker link={topLink} lpSize={lpSize} />
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
        );
      })}
    </>
  );
}

// In-page admin tuner — sliders + number inputs for every
// position knob, persisted to localStorage. Pinned to the
// hero's bottom-right when expanded; collapses to a small
// chip when not in use so it doesn't compete with the scene.
function HeroTuner({
  values,
  onChange,
  isDirty,
  onSave,
  onRevert,
  onReset,
  open,
  onOpenChange,
}: {
  values: TunerValues;
  onChange: (next: TunerValues) => void;
  isDirty: boolean;
  onSave: () => void;
  onRevert: () => void;
  onReset: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        // Dirty pip on the chip when there are unsaved changes,
        // so the admin doesn't lose track of pending edits while
        // the panel is collapsed.
        className="absolute bottom-3 right-3 z-30 text-[11px] text-gray-300 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full px-3 py-1 transition-colors flex items-center gap-1.5"
        title="Hero 위치 보정"
      >
        ⚙ 보정
        {isDirty && (
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-[#e8a020]"
          />
        )}
      </button>
    );
  }

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
            onClick={() => onOpenChange(false)}
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
        label="LP 시작 X"
        value={values.lpXStart}
        min={0}
        max={SCENE_W - 100}
        step={1}
        onChange={(v) => onChange({ ...values, lpXStart: v })}
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
