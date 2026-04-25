import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useHomeFeatures,
  useReplaceHomeFeatures,
  useUpdateHomeMeta,
  type HomeFeatureItem,
  type HomeMeta,
} from '../../hooks/useHomeFeatures';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../hooks/useSearch';
import { extractSpotifyAlbumId } from '../../hooks/useNowPlaying';
import { WallLP, WallRail } from '../MyDig/storefront/primitives';
import CoverArt from '../CoverArt';
import PlayChip from '../PlayChip';

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
        <HomeWallEditor
          initialItems={items}
          initialMeta={meta}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
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

function HomeWallEditor({
  initialItems,
  initialMeta,
  onClose,
}: {
  initialItems: HomeFeatureItem[];
  initialMeta: HomeMeta;
  onClose: () => void;
}) {
  const replace = useReplaceHomeFeatures();
  const updateMeta = useUpdateHomeMeta();
  const [drafts, setDrafts] = useState<Array<HomeFeatureItem | null>>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) =>
      initialItems.find((it) => it.position === i) ?? null
    )
  );
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [theme, setTheme] = useState(initialMeta.theme ?? '');
  const [description, setDescription] = useState(initialMeta.description ?? '');
  const saving = replace.isPending || updateMeta.isPending;

  const handleSave = async () => {
    const items = drafts
      .map((d, i) => (d ? { position: i, mbid: d.album.mbid, note: d.note } : null))
      .filter((x): x is { position: number; mbid: string; note: string | null } => !!x);
    try {
      await Promise.all([
        replace.mutateAsync(items),
        updateMeta.mutateAsync({
          theme: theme.trim() || null,
          description: description.trim() || null,
        }),
      ]);
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const handleClear = (i: number) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? null : d)));
  };

  const handlePick = (i: number, item: HomeFeatureItem) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? item : d)));
    setActiveSlot(null);
  };

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-[#1a1a1a]/95 p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-200">
          dig.haus 벽 편집 — 시그니처 + 15장
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs font-medium text-[#e8a020] border border-[#e8a020]/60 hover:bg-[#e8a020]/15 rounded-md px-3 py-1 disabled:opacity-40 cursor-pointer"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3 mb-4 pb-4 border-b border-white/10">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">시그니처 제목</span>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="예: dig.haus / 이번 달 픽"
            maxLength={80}
            className="bg-[#0f0f0f] border border-white/10 rounded px-2 py-1 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">설명</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="예: 운영자가 한 달 동안 발굴한 15장"
            maxLength={240}
            className="bg-[#0f0f0f] border border-white/10 rounded px-2 py-1 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {drafts.map((draft, i) => (
          <SlotEditor
            key={i}
            position={i}
            draft={draft}
            isActive={activeSlot === i}
            onActivate={() => setActiveSlot((cur) => (cur === i ? null : i))}
            onClear={() => handleClear(i)}
            onPick={(item) => handlePick(i, item)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotEditor({
  position,
  draft,
  isActive,
  onActivate,
  onClear,
  onPick,
}: {
  position: number;
  draft: HomeFeatureItem | null;
  isActive: boolean;
  onActivate: () => void;
  onClear: () => void;
  onPick: (item: HomeFeatureItem) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useSearch(query);

  return (
    <div className="rounded-md border border-white/10 bg-[#0f0f0f] p-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono text-gray-500 w-6">#{position + 1}</span>
        {draft ? (
          <>
            <CoverArt
              src={draft.album.coverArtUrl}
              fallbacks={draft.album.coverArtFallbacks}
              alt={draft.album.title}
              className="w-8 h-8 rounded object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-200 truncate" title={draft.album.title}>
                {draft.album.title}
              </div>
              <div className="text-[10px] text-gray-500 truncate" title={draft.album.artist}>
                {draft.album.artist}
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-gray-500 hover:text-red-400 px-1 cursor-pointer"
              aria-label="비우기"
              title="비우기"
            >
              ×
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-500 flex-1">비어 있음</span>
        )}
      </div>
      <button
        type="button"
        onClick={onActivate}
        className="w-full text-[11px] text-gray-400 hover:text-[#e8a020] border border-white/10 hover:border-[#e8a020]/40 rounded px-2 py-1 cursor-pointer transition-colors"
      >
        {isActive ? '닫기' : draft ? '바꾸기' : '앨범 고르기'}
      </button>
      {isActive && (
        <div className="mt-2 space-y-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목 / 아티스트"
            autoFocus
            className="w-full bg-[#0f0a05] border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {search.data?.albums.slice(0, 8).map((a) => (
              <button
                key={a.mbid}
                type="button"
                onClick={() =>
                  onPick({
                    position,
                    note: null,
                    album: {
                      mbid: a.mbid,
                      slug: null,
                      title: a.title,
                      artist: a.artist,
                      coverArtUrl: a.coverArtUrl,
                      coverArtFallbacks: a.coverArtFallbacks,
                      spotifyUrl: a.spotifyUrl ?? null,
                      releaseDate: a.releaseDate ?? null,
                    },
                  })
                }
                className="w-full flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer text-left"
              >
                <CoverArt
                  src={a.coverArtUrl}
                  fallbacks={a.coverArtFallbacks}
                  alt={a.title}
                  className="w-7 h-7 rounded object-cover shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-200 truncate">{a.title}</div>
                  <div className="text-[10px] text-gray-500 truncate">{a.artist}</div>
                </div>
              </button>
            ))}
            {query.length >= 1 && search.data?.albums.length === 0 && !search.isLoading && (
              <div className="text-[10px] text-gray-600 text-center py-2">
                결과 없음
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
