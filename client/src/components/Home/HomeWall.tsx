import { useEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  useUpdateHomeMeta,
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

const SLOTS_PER_ROW = 5;
const ROW_COUNT = 2;
const SLOT_COUNT = SLOTS_PER_ROW * ROW_COUNT;
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

export default function HomeWall() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
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
  const gapX = mobile ? 8 : 16;
  const overhang = mobile ? 4 : 36;
  const rowGap = mobile ? 24 : 32;
  // Desktop cap 180 — pairs with the section's max-w-[960px] in
  // Home.tsx to land lpSize at ~165 (about +10% over mydig's effective
  // 150). Cap is just above the fit value so the cap doesn't bite on
  // typical desktop viewports.
  const maxLpSize = mobile ? 80 : 180;
  const fit = (width - 2 * overhang - (SLOTS_PER_ROW - 1) * gapX) / SLOTS_PER_ROW;
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

  // Local plastic-overlay state for the live tuner. Initialised from
  // saved meta and only persisted on Save click; while the admin
  // drags sliders the overlay updates in real time without writing
  // to DB on every frame.
  const [plasticScale, setPlasticScale] = useState(meta.plasticScalePct);
  const [plasticOffsetX, setPlasticOffsetX] = useState(meta.plasticOffsetXPx);
  const [plasticOffsetY, setPlasticOffsetY] = useState(meta.plasticOffsetYPx);
  const [plasticBlendMode, setPlasticBlendMode] = useState(
    meta.plasticBlendMode
  );
  // Sync local state when the saved meta changes (e.g., another
  // admin saves elsewhere, or the editor saves text and triggers a
  // refetch). Keeps the tuner aligned with what's actually persisted.
  useEffect(() => {
    setPlasticScale(meta.plasticScalePct);
    setPlasticOffsetX(meta.plasticOffsetXPx);
    setPlasticOffsetY(meta.plasticOffsetYPx);
    setPlasticBlendMode(meta.plasticBlendMode);
  }, [
    meta.plasticScalePct,
    meta.plasticOffsetXPx,
    meta.plasticOffsetYPx,
    meta.plasticBlendMode,
  ]);
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
            top: meta.headerTopPx,
            left: meta.headerLeftPx,
            fontFamily: GRAFFITI_FONT_STACK,
            transform: `rotate(${meta.headerRotationDeg}deg)`,
            transformOrigin: 'top left',
            color: '#1a1208',
            // No textShadow — the previous warm halo read as a
            // typeset drop-shadow, undermining the "marker scrawled
            // straight on the wall" feel the user is going for.
          }}
        >
          <h2
            style={{
              fontSize: '28px',
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
                fontSize: '16px',
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
                  plasticScalePct={plasticScale}
                  plasticOffsetXPx={plasticOffsetX}
                  plasticOffsetYPx={plasticOffsetY}
                  plasticBlendMode={plasticBlendMode}
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
          initialHeaderTopPx={meta.headerTopPx}
          initialHeaderLeftPx={meta.headerLeftPx}
          initialHeaderRotationDeg={meta.headerRotationDeg}
          onClose={() => setEditing(false)}
        />
      )}

      {isAdmin && !editing && (
        <PlasticTuner
          scalePct={plasticScale}
          offsetXPx={plasticOffsetX}
          offsetYPx={plasticOffsetY}
          blendMode={plasticBlendMode}
          onScaleChange={setPlasticScale}
          onOffsetXChange={setPlasticOffsetX}
          onOffsetYChange={setPlasticOffsetY}
          onBlendModeChange={setPlasticBlendMode}
          savedScalePct={meta.plasticScalePct}
          savedOffsetXPx={meta.plasticOffsetXPx}
          savedOffsetYPx={meta.plasticOffsetYPx}
          savedBlendMode={meta.plasticBlendMode}
        />
      )}
    </section>
  );
}

// Live tuner panel for the plastic-wrap overlay. Admin-only; floats
// in the bottom-right of the viewport so it doesn't intrude on the
// wall composition. Slider drags update local state in HomeWall (live
// preview), Save button PATCHes home_meta. Collapses to a small chip
// when not in use to stay out of the way.
// Trimmed to the two modes that read well in practice — soft-light /
// overlay / lighten / hard-light / plus-lighter were all judged off
// when A/B'd against these. Server still accepts the longer list, so
// re-adding options later is just a one-line append here.
const BLEND_MODE_OPTIONS = [
  { value: 'normal', label: '기본' },
  { value: 'screen', label: 'Screen (화이트 add)' },
];

function PlasticTuner({
  scalePct,
  offsetXPx,
  offsetYPx,
  blendMode,
  onScaleChange,
  onOffsetXChange,
  onOffsetYChange,
  onBlendModeChange,
  savedScalePct,
  savedOffsetXPx,
  savedOffsetYPx,
  savedBlendMode,
}: {
  scalePct: number;
  offsetXPx: number;
  offsetYPx: number;
  blendMode: string;
  onScaleChange: (v: number) => void;
  onOffsetXChange: (v: number) => void;
  onOffsetYChange: (v: number) => void;
  onBlendModeChange: (v: string) => void;
  savedScalePct: number;
  savedOffsetXPx: number;
  savedOffsetYPx: number;
  savedBlendMode: string;
}) {
  const [open, setOpen] = useState(false);
  const updateMeta = useUpdateHomeMeta();
  const dirty =
    scalePct !== savedScalePct ||
    offsetXPx !== savedOffsetXPx ||
    offsetYPx !== savedOffsetYPx ||
    blendMode !== savedBlendMode;

  const save = async () => {
    if (!dirty || updateMeta.isPending) return;
    try {
      await updateMeta.mutateAsync({
        plasticScalePct: scalePct,
        plasticOffsetXPx: offsetXPx,
        plasticOffsetYPx: offsetYPx,
        plasticBlendMode: blendMode,
      });
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const reset = () => {
    onScaleChange(savedScalePct);
    onOffsetXChange(savedOffsetXPx);
    onOffsetYChange(savedOffsetYPx);
    onBlendModeChange(savedBlendMode);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 text-[11px] text-gray-300 bg-[#141008]/85 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-3 py-1.5 cursor-pointer transition-colors backdrop-blur-sm"
      >
        🎨 비닐 조정
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 w-64 bg-[#141008]/95 border border-white/15 rounded-lg p-3 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-400">
          비닐 포장 조정
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        <SliderRow
          label="크기"
          value={scalePct}
          min={0}
          max={50}
          step={1}
          unit="%"
          onChange={onScaleChange}
        />
        <SliderRow
          label="X 위치"
          value={offsetXPx}
          min={-50}
          max={50}
          step={1}
          unit="px"
          onChange={onOffsetXChange}
        />
        <SliderRow
          label="Y 위치"
          value={offsetYPx}
          min={-50}
          max={50}
          step={1}
          unit="px"
          onChange={onOffsetYChange}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400">블렌드 모드</span>
          <select
            value={blendMode}
            onChange={(e) => onBlendModeChange(e.target.value)}
            className="w-full bg-[#0f0a05] border border-white/10 rounded px-2 py-1 text-[11px] text-gray-200 focus:border-[#e8a020] focus:outline-none cursor-pointer"
          >
            {BLEND_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-white/10">
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || updateMeta.isPending}
          className="text-[11px] text-gray-400 hover:text-white px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || updateMeta.isPending}
          className="text-[11px] font-medium text-[#e8a020] border border-[#e8a020]/60 hover:bg-[#e8a020]/15 rounded-md px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {updateMeta.isPending ? '저장 중…' : dirty ? '저장' : '저장됨'}
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>{label}</span>
        <span className="font-mono text-gray-300">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full accent-[#e8a020] cursor-pointer"
      />
    </label>
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

