import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import AlbumCard from '../components/AlbumCard';
import ActivityRail from '../components/Home/ActivityRail';
import CommentTicker from '../components/Home/CommentTicker';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { useHomeState, type DensityValue } from '../contexts/HomeStateContext';
import { useAuth } from '../contexts/AuthContext';
import type { AlbumSearchResult } from '../types';
import { type SortValue, SORT_OPTIONS } from '../lib/homeSort';

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Per-density page sizes. Single table regardless of rail state —
// the grid column counts at lg/xl also stay constant per density,
// so page_size is always an exact multiple of the xl col count
// (comfortable 6×3, dense 8×4, ultra 10×5) and the last row fills
// at the primary desktop breakpoints. What DOES change with rail
// state is card size (main is ~77% width when the rail is open),
// which is an acceptable trade for keeping the ticker's y-position
// fixed when the user toggles density.
const MOBILE_QUERY = '(max-width: 767px)';
const PAGE_SIZE_BY_DENSITY: Record<string, number> = {
  comfortable: 18,
  dense: 32,
  ultra: 50,
};

// Desktop-only: rail toggle + density switcher + reveal animation all
// key off whether the viewport is wide enough to benefit from them.
// Grid data itself runs the same pagination on every viewport, so
// isMobile no longer gates any query — only UI chrome.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

async function fetchAlbumPage(
  sort: SortValue,
  page: number,
  pageSize: number,
  seed?: number
) {
  const { data } = await axios.get<AlbumListResponse>('/api/albums', {
    params: { sort, page, pageSize, ...(seed != null ? { seed } : {}) },
  });
  return data;
}

function useAlbumList(
  sort: SortValue,
  page: number,
  pageSize: number,
  enabled: boolean,
  seed?: number
) {
  return useQuery<AlbumListResponse>({
    queryKey: ['album-list', sort, page, pageSize, seed ?? null],
    queryFn: () => fetchAlbumPage(sort, page, pageSize, seed),
    staleTime: 1000 * 60 * 5,
    // Always refetch when the user lands on Home, not just when the
    // cache is past staleTime. Without this, returning to / via
    // browser back after registering an album or running review
    // summary would keep showing the old grid (no ⚠️ badge clearing,
    // no newly-registered album appearing) until a manual refresh —
    // invalidation from those mutations alone wasn't reliably waking
    // the inactive query. The extra page fetch is cheap.
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
    enabled,
  });
}

function paginationItems(current: number, total: number): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) items.push('ellipsis-left');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push('ellipsis-right');
  items.push(total);
  return items;
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openOverlay } = useSearchOverlay();
  const isMobile = useIsMobile();
  // sort / page / seed live in HomeStateContext — no URL involvement,
  // so the address bar stays at '/'. See contexts/HomeStateContext.tsx
  // for the persistence rules (localStorage for sort, in-memory for
  // page + seed).
  const {
    sort,
    setSort,
    page,
    setPage,
    seed,
    density,
    setDensity,
    railOpen,
    setRailOpen,
  } = useHomeState();

  useDocumentHead({
    title: 'Home | dig.haus',
    description: '앨범 커버로 파고, 감으로 찾는 레코드 컬렉터의 음악 리서치 허브.',
    url: 'https://dig.haus/',
    type: 'website',
  });

  // Deep-link: /?q=artist opens the nav search overlay and clears the
  // param. This is the one URL param Home still touches — external
  // inbound links use it so a friend can share `dig.haus/?q=artist`.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      openOverlay(q);
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openOverlay]);

  // With the seed owned by the context, it's set synchronously when
  // the sort becomes 'random' — no async round-trip like the old
  // URL-based seed-effect used to have. So seedReady is always true
  // for non-random sorts, and true for random once the provider
  // finishes its first render (which it has by the time Home's
  // effects run).
  const seedReady = sort !== 'random' || seed !== undefined;
  const pageSize =
    PAGE_SIZE_BY_DENSITY[density] ?? PAGE_SIZE_BY_DENSITY.comfortable;

  const query = useAlbumList(sort, page, pageSize, seedReady, seed);
  const albums: AlbumSearchResult[] = query.data?.albums ?? [];
  const totalPages = query.data?.totalPages ?? 1;
  const isLoading = query.isLoading;

  // Shuffle the reveal delays per page so the (up to 50) tiles don't
  // all land in a single sweep. Reshuffles whenever the rendered page
  // changes — page click, sort change, reseed on random sort, density
  // tier change — so flipping through the grid reads as a new scatter
  // each time rather than a repeating cascade. Max delay caps the
  // total reveal window at ~400ms so the grid feels lively, not
  // laggy.
  const STAGGER_MS = 22;
  const revealDelays = useMemo(() => {
    const arr = Array.from({ length: pageSize }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [sort, page, seed, pageSize]);

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const items = paginationItems(page, totalPages);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? '';

  // Density → grid-cols + gap map. One unified table regardless of
  // rail state — keeping the lg/xl column counts constant means the
  // grid's row count per density doesn't shift when the user toggles
  // the rail, which in turn keeps the ticker below the grid at a
  // stable y. Card size shrinks proportionally when the rail is
  // open (main gets 77% of viewport instead of 100%), which is a
  // visible but expected consequence of the layout change.
  //
  // xs grids use 3 cols at every density (previously 2 at comfortable)
  // so a mobile wall is 3 × page-size/3 = 3×6 for comfortable, which
  // the user found the sweet spot for phone browsing — denser packs
  // covers below comfortable tap-target size and more-per-row added
  // visual noise.
  //
  // lg and xl share the same col count per density so the grid
  // height is stable across that whole desktop breakpoint band.
  const DESKTOP_GRID_CLASSES: Record<DensityValue, string> = {
    comfortable:
      'grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6',
    dense:
      'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 xl:grid-cols-8',
    ultra:
      'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 xl:grid-cols-10',
  };
  const DESKTOP_GAP_CLASSES: Record<DensityValue, string> = {
    comfortable: 'gap-5',
    dense: 'gap-3',
    ultra: 'gap-2',
  };
  const desktopGridCols = DESKTOP_GRID_CLASSES[density];
  const desktopGap = DESKTOP_GAP_CLASSES[density];

  return (
    <div className="flex-1 flex flex-col px-4 pt-8">
      <section className="w-full max-w-[1280px] mx-auto">
        {/* Two-column home: album grid on the left, activity rail
            on the right. Below Tailwind `lg` the layout collapses
            to a single stacked column — main first, rail below.
            The grid container is always `lg:grid` at desktop+ so
            the grid-template-columns transition can animate the
            rail column from 2fr → 0fr on close (and back on
            reopen). When the rail is closed the rail column has
            0 width, so the rail content also slides out rightward
            via the inner transform. `items-start` prevents the
            rail from stretching to the grid's min-height when
            there's less content to fill. */}
        <div
          className="flex flex-col gap-6 lg:grid lg:items-stretch lg:transition-[grid-template-columns] lg:duration-300"
          style={{
            gridTemplateColumns: railOpen
              ? 'minmax(0, 7.7fr) minmax(0, 2.3fr)'
              : 'minmax(0, 7.7fr) minmax(0, 0fr)',
          }}
        >
          {/* min-h lingers only for the rail-closed state, where no
              rail sits next to the grid to anchor the height.
              Rail-open doesn't need it because the rail itself is
              the height anchor — see the pagination reshuffle
              below — and the grid-row height just tracks whichever
              column ends up tallest. */}
          <main
            className={`order-1 min-w-0 ${
              railOpen ? '' : 'lg:min-h-[730px]'
            }`}
          >
        {/* Grid header — sort trigger on the left, density switcher
            + (when rail is collapsed) a small open-rail handle on
            the right. The rail's close button lives inside the
            rail's own section header now, so this strip only carries
            the rail toggle when the rail itself isn't visible on
            desktop. Mobile skips the rail toggle entirely since the
            rail stacks below rather than beside. */}
        {albums.length > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
            <SortTrigger
              sort={sort}
              onChange={setSort}
              label={currentSortLabel}
            />
            <div className="flex items-center gap-3">
              {!isMobile && (
                <DensitySwitcher density={density} onChange={setDensity} />
              )}
              {!isMobile && !railOpen && (
                <OpenRailHandle onClick={() => setRailOpen(true)} />
              )}
            </div>
          </div>
        )}
        {isLoading && albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">불러오는 중...</div>
        ) : albums.length === 0 ? (
          <div className="text-center py-20 text-sm text-gray-500">등록된 앨범이 없습니다.</div>
        ) : (
          // Grid key tracks the actual displayed album list (first + last
          // mbid + length) rather than the query params, so the remount —
          // and the reveal animation — fires only when new data lands,
          // not at the click that requested it. keepPreviousData keeps
          // the previous page visible during fetch; if we keyed on
          // `page` instead, animations would play on the stale page just
          // before it got replaced.
          <div
            key={`grid-${albums.length}-${albums[0]?.mbid ?? ''}-${albums[albums.length - 1]?.mbid ?? ''}`}
            className={`grid ${desktopGridCols} ${desktopGap}`}
          >
            {albums.map((album, i) => (
              <div
                key={album.mbid}
                className="album-reveal"
                style={{
                  animationDelay: `${(revealDelays[i] ?? i) * STAGGER_MS}ms`,
                }}
              >
                <AlbumCard album={album} />
              </div>
            ))}
          </div>
        )}

          </main>
          {/* Rail wrapper: always mounted so the slide-right
              animation has somewhere to live. At lg+ the outer
              grid column shrinks to 0fr when closed — combined
              with overflow-hidden here and an inner translate +
              fade, the rail content visibly slides off to the
              right rather than popping out. Below lg the rail
              always stacks below main regardless of railOpen
              (opacity + transform classes are lg:-prefixed). */}
          <div
            id="home-activity-rail"
            className={`order-2 min-w-0 overflow-hidden lg:transition-[opacity,transform] lg:duration-300 ${
              railOpen
                ? 'lg:opacity-100 lg:translate-x-0'
                : 'lg:opacity-0 lg:translate-x-full lg:pointer-events-none'
            }`}
          >
            <ActivityRail onClose={() => setRailOpen(false)} />
          </div>
        </div>

        {/* Pagination sits OUTSIDE the grid+rail row so it doesn't
            push the main column past the rail's height. Album grid
            bottom ≈ snapshot cards bottom by design (natural heights
            within ~5px across all three densities), and pagination
            is a full-width control below the row. `mt-8` matches
            the spacing the pagination used to get inside main. */}
        {totalPages > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-1 flex-wrap" aria-label="Pagination">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-[#e8a020] disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
              aria-label="이전 페이지"
            >
              ←
            </button>
            {items.map((it, idx) =>
              typeof it === 'number' ? (
                <button
                  key={idx}
                  onClick={() => goToPage(it)}
                  className={`min-w-[2rem] px-2.5 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
                    it === page
                      ? 'text-[#e8a020] font-semibold'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
                  }`}
                  aria-current={it === page ? 'page' : undefined}
                >
                  {it}
                </button>
              ) : (
                <span key={idx} className="px-1 text-gray-600 select-none">…</span>
              )
            )}
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-[#e8a020] disabled:text-gray-700 disabled:cursor-not-allowed cursor-pointer"
              aria-label="다음 페이지"
            >
              →
            </button>
          </nav>
        )}

        {/* Marquee 50자 평 ticker below the grid+rail row, spanning
            the full 1280px section — the earlier placement inside
            <main> left it boxed at 8fr width when the rail was open,
            which felt pinched next to the rail's dead space below
            the snapshot cards. Full-width lets the horizontal scroll
            read the way a shop's "now playing" crawl does. */}
        {albums.length > 0 && <CommentTicker />}
      </section>
    </div>
  );
}

// Small open-rail handle. Only renders when the rail is collapsed
// on desktop — the rail's own close button (inside its section
// header) handles the other direction. Styled identically to the
// close button so the two affordances feel like a paired set
// rather than two unrelated glyphs.
function OpenRailHandle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={false}
      aria-controls="home-activity-rail"
      title="활동 레일 펴기"
      aria-label="활동 레일 펴기"
      className="inline-flex items-center justify-center w-5 h-5 rounded-md border border-white/15 bg-[#1a130a]/40 hover:border-[#e8a020]/60 hover:bg-[#e8a020]/10 text-gray-400 hover:text-[#e8a020] transition-colors cursor-pointer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3 h-3"
        aria-hidden
      >
        <path d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
    </button>
  );
}

// Inline sort trigger — text-style ("정렬: 발매 최신순 ▾") with an
// overlay dropdown of SORT_OPTIONS. Lives above the album grid
// instead of in the nav, so discovery of "how is this feed ordered"
// and the mechanism to change it sit together where the user is
// looking. Admin-only sort options (e.g. "등록 요청작") are filtered
// out for non-admins so the dropdown stays clean.
function SortTrigger({
  sort,
  onChange,
  label,
}: {
  sort: SortValue;
  onChange: (v: SortValue) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const visibleOptions = useMemo(
    () => SORT_OPTIONS.filter((o) => !o.adminOnly || isAdmin),
    [isAdmin]
  );

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 tabular-nums text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        정렬: <span className="text-gray-300">{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-3 h-3 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-1 w-44 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 z-50"
        >
          {visibleOptions.map((opt) => {
            const isCurrent = opt.value === sort;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  onChange(opt.value as SortValue);
                  setOpen(false);
                }}
                className={`block w-full text-left px-4 py-2 text-sm cursor-pointer hover:bg-white/5 transition-colors ${
                  isCurrent
                    ? 'text-[#e8a020] font-semibold'
                    : opt.adminOnly
                      ? 'text-[#e8a020]/80 italic'
                      : 'text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 3-step density slider: comfortable / dense / ultra. A range input
// with three stops (0 = comfortable, 1 = dense, 2 = ultra) — replaces
// the earlier 3-button dot-matrix toggle. A slider reads more
// naturally as a "continuous smaller → bigger" gesture, even though
// we snap to three discrete values. Dot-matrix glyphs on either end
// (2×2 ↔ 4×4) serve as the smaller/bigger labels — the same icons
// that sat on the previous button triplet, now re-purposed as the
// slider's endpoints. Lives above the desktop grid only — mobile
// density is fixed at 2 cols, adjusting it would pack covers too
// small to tap.
const DENSITY_STEPS: DensityValue[] = ['comfortable', 'dense', 'ultra'];
const DENSITY_LABELS: Record<DensityValue, string> = {
  comfortable: '넉넉하게',
  dense: '빽빽하게',
  ultra: '더 빽빽하게',
};

// Dot-matrix glyph. Used as the smaller/bigger endpoint icons on the
// slider; also reads as a visual cue for "this is what density looks
// like" at a glance. `active` lights up the dots in amber when the
// slider rests on that endpoint; otherwise they stay muted.
function DensityGlyph({ dots, active }: { dots: number; active: boolean }) {
  return (
    <span
      className="inline-grid gap-[2px]"
      style={{
        gridTemplateColumns: `repeat(${dots}, 3px)`,
        gridTemplateRows: `repeat(${dots}, 3px)`,
      }}
      aria-hidden
    >
      {Array.from({ length: dots * dots }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] h-[3px] rounded-sm ${
            active ? 'bg-[#e8a020]' : 'bg-gray-500'
          }`}
        />
      ))}
    </span>
  );
}

function DensitySwitcher({
  density,
  onChange,
}: {
  density: DensityValue;
  onChange: (v: DensityValue) => void;
}) {
  const current = DENSITY_STEPS.indexOf(density);
  return (
    <div className="density-slider inline-flex items-center gap-2">
      <DensityGlyph dots={2} active={density === 'comfortable'} />
      <div className="relative flex items-center">
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={current >= 0 ? current : 0}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            const next = DENSITY_STEPS[idx];
            if (next) onChange(next);
          }}
          title={`크기: ${DENSITY_LABELS[density]}`}
          aria-label={`크기 조정: ${DENSITY_LABELS[density]}`}
          aria-valuetext={DENSITY_LABELS[density]}
          className="density-slider-input"
        />
        {/* Tick marks — three dots behind the thumb, aligned with the
            0 / 1 / 2 stops. Decorative: the real value is on the
            <input>. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-[7px]">
          {DENSITY_STEPS.map((s) => (
            <span
              key={s}
              aria-hidden
              className={`w-[2px] h-[2px] rounded-full ${
                s === density ? 'bg-[#e8a020]' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>
      <DensityGlyph dots={4} active={density === 'ultra'} />
    </div>
  );
}
