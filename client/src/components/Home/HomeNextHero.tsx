import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useHomeFeatures,
  useUpdateHomeMeta,
  type HomeFeatureItem,
  type HomeMeta,
  type HomeMetaPatch,
} from '../../hooks/useHomeFeatures';
import { useAuth } from '../../contexts/AuthContext';
import { WallLP } from '../MyDig/storefront/primitives';
import WallHoverCard from '../MyDig/storefront/WallHoverCard';
import VinylWallEditor from '../MyDig/VinylWallEditor';
import type { MyDigWallItem } from '../../hooks/useMyDig';
import HomeFeatureSticker from './HomeFeatureSticker';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';

// basement_gray.avif: 2976×1500 wall-only strip (concrete-textured
// wall with two baked-in wood shelves and a small dig.haus neon
// in the top-right). The asset arrives pre-trimmed at the band
// aspect we want, so we render it at its natural ratio without
// further CSS cropping — the earlier HERO_ASPECT inner-frame
// trick is gone, sceneH just tracks the source aspect again.
//
// Coordinates below live in source-image px (2976×1500); a
// single `scale` factor (renderedWidth / 2976) projects them
// into screen px at render time.
const SCENE_W = 2976;
const SCENE_H = 1500;

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
function metaToTuner(meta: HomeMeta | undefined): TunerValues {
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
  return PLASTIC_TEXTURE_PATHS[position % PLASTIC_TEXTURE_PATHS.length]!;
}

export default function HomeNextHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const { data, isLoading } = useHomeFeatures();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  // Tuner values now live in home_meta on the server so a 저장
  // click publishes globally. `committed` is derived from
  // data?.meta each render; `draft` is the local working copy
  // sliders write to. When the meta query refreshes (after a
  // save), the effect resyncs draft from committed so isDirty
  // collapses to false. 되돌리기 = setDraft(committed).
  const committed = metaToTuner(data?.meta);
  const [draft, setDraft] = useState<TunerValues>(committed);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // Keep draft in sync with committed (server) whenever it
  // changes. Compares JSON form to avoid clobbering an in-flight
  // edit when the query revalidates with the same content.
  const committedKey = JSON.stringify(committed);
  useEffect(() => {
    setDraft(metaToTuner(data?.meta));
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

  const updateMeta = useUpdateHomeMeta();

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
      className="group/hero relative w-full overflow-hidden bg-[#0a0703]"
      // Outer container sits at sceneH (image height minus the
      // top + bottom trim). Inner frame still holds the image at
      // its natural aspect — shifted up by TRIM_TOP_PX so the
      // top trim lands above the visible band and overflow-hidden
      // chops the matching strip off the bottom.
      style={{
        height:
          sceneH ||
          (MIN_W * SCENE_H) / SCENE_W - TRIM_TOP_PX - TRIM_BOTTOM_PX,
      }}
    >
      {sceneW > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            top: -TRIM_TOP_PX,
            width: sceneW,
            height: sceneFullH,
          }}
        >
          <img
            src="/backdrops/basement_gray.avif"
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
                transform: `rotate(${tuner.titleRotationDeg}deg)`,
                transformOrigin: 'top left',
                color: '#1a1208',
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
                {meta.theme}
              </h2>
              {meta.description && meta.description.trim().length > 0 && (
                <p
                  style={{
                    // Description tracks 50% of the title's px size
                    // — the original 0.43 ratio felt too thin on
                    // the lighter basement wall, but 0.6 turned it
                    // into a near-second headline. 0.5 splits the
                    // difference so the sub-line reads as a
                    // sub-line.
                    fontSize: tuner.titleFontSize * 0.5 * scale,
                    fontWeight: 400,
                    marginTop: 20 * scale,
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
                rowLeftX={tuner.upperLpXStart * scale}
                lpSize={lpSize}
                lpGap={lpGap}
                plasticMeta={meta}
              />
              <ShelfRow
                slots={slots.slice(5, 10)}
                firstPosition={5}
                rowTopY={tuner.lowerLpY * scale}
                rowLeftX={tuner.lowerLpXStart * scale}
                lpSize={lpSize}
                lpGap={lpGap}
                plasticMeta={meta}
              />
            </>
          )}
        </div>
      )}

      {/* Bottom fade — softens the hard horizontal cut between
          the painted floor and the dark page bg of the activity
          sections that follow. Anchored to the section bottom (not
          the scaled scene anchor) so the fade band stays at a
          stable px height regardless of viewport size. The
          gradient stops just past 100% of the band so the
          transition into #0a0703 finishes cleanly inside the band
          rather than pushing colour past it. */}

      {/* Admin chip pair — both 편집 and 보정 sit centred at the
          hero's bottom edge and only fade in on hover. Group keeps
          them paired visually so the two affordances read as a
          single "admin tools" cluster rather than two separate
          ornaments. Hidden while the editor or tuner panel is
          open so the chips don't sit underneath their own popups. */}
      {isAdmin && !editing && !tunerOpen && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 opacity-0 group-hover/hero:opacity-100 focus-within:opacity-100 transition-opacity"
        >
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-gray-200 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full px-3 py-1 transition-colors"
            title="dig.haus 벽 편집"
          >
            ✏️ 편집
          </button>
          <button
            type="button"
            onClick={() => setTunerOpen(true)}
            className="text-[11px] text-gray-300 bg-black/70 border border-white/15 hover:border-[#e8a020]/60 hover:text-[#e8a020] rounded-full px-3 py-1 transition-colors flex items-center gap-1.5"
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
        </div>
      )}

      {isAdmin && editing && (
        <VinylWallEditor
          target={{ kind: 'home-features' }}
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

      {/* Scroll hint — handwritten ">>" rotated 90° so it points
          down. Sits in the lower band of the hero so the user
          picks up that the page continues past the painted
          basement strip. Lifted off the very edge to bottom 22
          so the chevron sits in the visible scene rather than
          looking glued to the page chrome. Admin chip pair fades
          in on hover at bottom-3 with z-30, painting above the
          z-20 chevron in the rare admin-hover overlap. Hidden
          while editing / tuner is open since the popups already
          claim the page focus. */}
      {!editing && !tunerOpen && (
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none select-none scroll-hint z-20"
          style={{
            bottom: 22,
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize: 20,
            color: 'rgba(245, 230, 200, 0.7)',
            lineHeight: 1,
          }}
        >
          <span style={{ display: 'inline-block', transform: 'rotate(90deg)' }}>
            {'>>'}
          </span>
        </div>
      )}
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
  plasticMeta: HomeMeta | undefined;
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
                plasticOverlaySrc={pickPlasticTexture(position)}
                plasticScalePct={plasticMeta?.plasticScalePct ?? 15}
                plasticOffsetXPx={plasticMeta?.plasticOffsetXPx ?? 5}
                plasticOffsetYPx={plasticMeta?.plasticOffsetYPx ?? 0}
                plasticBlendMode={plasticMeta?.plasticBlendMode ?? 'normal'}
                hoverScalePct={180}
                hoverOriginY="75%"
                playChipScale={0.75}
                playChipInsetPct={4}
                tapToActivate
                coverOverlay={
                  <>
                    {isPick && (
                      <DighausPickSticker
                        lpSize={lpSize}
                        seed={item.album.mbid}
                      />
                    )}
                    {topLink && (
                      <HomeFeatureSticker
                        link={topLink}
                        lpSize={lpSize}
                        seed={item.album.mbid}
                      />
                    )}
                  </>
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
