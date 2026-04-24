import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AlbumSearchResult } from '../types';
import CoverArt from './CoverArt';
import PlayChip from './PlayChip';
import PriceTagStack from './PriceTagSticker';
import { getScoreColor, getScoreGlowRgb } from '../utils/score';
import { MIN_SCORED_FOR_AVG } from '../lib/reviewThresholds';
import { useAuth } from '../contexts/AuthContext';

// Cross-card active state for touch devices: only one card can show its
// flipped back at a time. First tap flips; second tap on the active card
// navigates to the album page (handled in touchEnd below).
let activeCardId: string | null = null;
const activeCardListeners = new Set<() => void>();
function setActiveCardId(id: string | null) {
  if (activeCardId === id) return;
  activeCardId = id;
  activeCardListeners.forEach((l) => l());
}
function subscribeActiveCard(listener: () => void) {
  activeCardListeners.add(listener);
  return () => {
    activeCardListeners.delete(listener);
  };
}
function getActiveCardSnapshot() {
  return activeCardId;
}

// Treat a touch as a tap only when the gesture is unambiguously a tap:
//   1. Final position within TAP_THRESHOLD_PX of where the finger landed
//   2. No noticeable vertical drift during the gesture (SCROLL_CANCEL_DY)
//   3. Total duration under TAP_MAX_MS — anything longer is hold/scroll-prep
//   4. The browser didn't fire a touchcancel (it does when scroll wins)
// Each gate had to be tightened progressively because mobile users were
// still triggering flips while starting to scroll over a card.
const TAP_THRESHOLD_PX = 12;
const SCROLL_CANCEL_DY = 5;
const TAP_MAX_MS = 350;

// Releases stamped within this window get the "NEW" sticker so the
// grid reads like a record-shop 신보 코너. 30 days is forgiving enough
// to catch late-add releases from the last few weeks; any longer and
// the badge stops feeling informative.
const NEW_BADGE_DAYS = 30;

function parseReleaseTimestamp(releaseDate: string | null | undefined): number | null {
  if (!releaseDate) return null;
  const match = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ts) ? null : ts;
}

function isRecentRelease(releaseDate: string | null | undefined): boolean {
  const ts = parseReleaseTimestamp(releaseDate);
  if (ts === null) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  // Past-only window now — future releases get the SOON sticker
  // instead. The day the release date arrives, this flips to NEW
  // automatically because diffDays crosses 0.
  return diffDays >= 0 && diffDays <= NEW_BADGE_DAYS;
}

// Returns days until release (positive integer) for upcoming albums,
// or null if the album is already out / has no usable release date.
// The home grid uses this both as the SOON-vs-NEW gate and as the
// label content (D-N) so we don't compute the diff twice.
function daysUntilRelease(releaseDate: string | null | undefined): number | null {
  const ts = parseReleaseTimestamp(releaseDate);
  if (ts === null) return null;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return null;
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Record-shop sticker family. All share the same chip shape so a
// card carrying multiple (stacked top-down: SOON / NEW → HOT) reads
// as one column of labels rather than competing elements. The "soon"
// entry is the only one with a dynamic label — it renders the
// days-to-release countdown (D-N) rather than its static "SOON"
// lines, which we keep around as the aria fallback. SOON and NEW
// occupy the same top slot and are mutually exclusive (an album is
// either before or after its release date). NEW moved from yellow
// to sky so it doesn't collide with SALE's yellow; the countdown
// chip uses a brighter electric violet with near-black text so the
// digits stay legible at sticker scale. PRE-ORDER, SALE, and SOLD
// OUT don't render as cover stickers — the PriceTagStack already
// carries those signals on the price tag itself (green fill, yellow
// fill, strike-through) and doubling up made the cover area feel
// crowded whenever two chips stacked in the same corner.
type CoverStickerKind = 'soon' | 'new' | 'hot';

interface StickerSpec {
  bg: string;
  fg: string;
  lines: string[];
  aria: string;
  /** Per-sticker typography tuning. Defaults target the single-word
   *  stickers (NEW / HOT / SALE); multi-line ones override to match
   *  the visual footprint. PRE-ORDER and SOLD OUT need different
   *  numbers because "ORDER" is 5 chars but "SOLD" is only 4 —
   *  sharing one multi-line config made SOLD OUT look cramped
   *  and PRE-ORDER slightly oversized. */
  fontSize?: string;
  letterSpacing?: string;
  padding?: string;
  lineHeight?: number;
  minWidth?: string;
}

const STICKER_PALETTE: Record<CoverStickerKind, StickerSpec> = {
  soon: {
    bg: '#b78bff',
    fg: '#15001f',
    lines: ['SOON'],
    aria: '발매 예정',
  },
  new: {
    bg: '#5aa9e6',
    fg: '#0b1d2e',
    lines: ['NEW'],
    aria: '최근 30일 이내 발매',
  },
  hot: {
    bg: '#e84a3b',
    fg: '#ffffff',
    lines: ['HOT'],
    aria: '굿굿 또는 별루 상위 10',
  },
};

function CoverStickerBadge({
  kind,
  lines: linesOverride,
  ariaOverride,
}: {
  kind: CoverStickerKind;
  /** Replaces palette.lines for stickers whose label is data-driven
   *  (currently only 'soon' for the D-N countdown). All other kinds
   *  rely on the static palette text and leave this undefined. */
  lines?: string[];
  ariaOverride?: string;
}) {
  const palette = STICKER_PALETTE[kind];
  const lines = linesOverride ?? palette.lines;
  return (
    <span
      className="inline-flex flex-col items-center justify-center font-extrabold uppercase rounded-sm shadow-md"
      style={{
        background: palette.bg,
        color: palette.fg,
        fontFamily: "'Syne', 'Inter', sans-serif",
        // Scale the sticker with the card container (see containerType:
        // inline-size on the Link root). Floor at 6px so labels stay
        // legible on the tightest ultra-density tier; max at the
        // original tuned values so wide comfortable-density covers
        // look exactly as before.
        fontSize:
          palette.fontSize ?? `clamp(6px, 4.2cqw, 8.3px)`,
        letterSpacing: palette.letterSpacing ?? '0.06em',
        padding: palette.padding ?? 'clamp(1px, 1.1cqw, 2.2px) clamp(3px, 2.7cqw, 5.4px)',
        lineHeight: palette.lineHeight ?? 1,
        minWidth: palette.minWidth,
        // Tabular numerals keep the countdown digits from jiggling as
        // the album rolls D-99 → D-7 day by day.
        fontVariantNumeric: 'tabular-nums',
      }}
      aria-label={ariaOverride ?? palette.aria}
    >
      {lines.map((line) => {
        // D-N countdown: keep the 'D-' prefix at the same size as
        // NEW/HOT/SOLD, scale just the digits up so they're
        // readable at small densities without changing the chip's
        // overall footprint. em-relative size means it tracks the
        // clamp() parent without a second clamp of its own.
        const dayMatch =
          kind === 'soon' ? line.match(/^(D-)(\d+)$/) : null;
        if (dayMatch) {
          return (
            <span key={line}>
              {dayMatch[1]}
              <span style={{ fontSize: '1.35em' }}>{dayMatch[2]}</span>
            </span>
          );
        }
        return <span key={line}>{line}</span>;
      })}
    </span>
  );
}

export default function AlbumCard({ album }: { album: AlbumSearchResult }) {
  const up = album.upvotes ?? 0;
  const down = album.downvotes ?? 0;
  const userReviewCount = album.userReviewCount ?? 0;
  const priceTagLinks = album.priceTagLinks ?? [];
  const daysToRelease = daysUntilRelease(album.releaseDate);
  const isSoon = daysToRelease !== null;
  // SOON takes precedence over NEW — they share the top slot and are
  // mutually exclusive. The day the release date arrives, daysToRelease
  // returns null and isRecentRelease flips to true on the same render,
  // so the sticker auto-transitions to NEW with no server round-trip.
  const isNew = !isSoon && isRecentRelease(album.releaseDate);
  // hasPreorderLink / hasSaleLink / hasSoldoutLink still come down
  // from the server but don't render as cover stickers — the
  // PriceTagStack already communicates those states on the price tag
  // itself (green for pre-order, yellow for sale, strike-through for
  // sold out), so carrying them as big chips on the cover too was
  // redundant and made the corner feel crowded.
  const hasAnyCoverSticker = isSoon || isNew || album.isHot;

  // Flip-side glow + card-face score both need at least N scored
  // reviews before we surface a number — see MIN_SCORED_FOR_AVG for
  // the why. album.reviewCount counts *scored* reviews only (server
  // SQL filters manual_score OR score IS NOT NULL), so it's the
  // right denominator here.
  const scoredCount = album.reviewCount ?? 0;
  const hasEnoughScores = scoredCount >= MIN_SCORED_FOR_AVG;
  const hasGlow = album.averageScore != null && hasEnoughScores;
  const showAvg = album.averageScore != null && hasEnoughScores;
  const glowRgb = hasGlow ? getScoreGlowRgb(album.averageScore!) : null;
  const ctaColor = glowRgb ? `rgb(${glowRgb})` : '#9a9a9a';

  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const isHoverNoneRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const activeId = useSyncExternalStore(
    subscribeActiveCard,
    getActiveCardSnapshot,
    getActiveCardSnapshot
  );
  const isActive = activeId === album.mbid;

  useEffect(() => {
    isHoverNoneRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none)').matches;
  }, []);

  // While a card is flipped on touch, clear it when the user taps outside
  // any card or starts scrolling.
  useEffect(() => {
    if (!isActive) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (target?.closest?.('.album-card-outer')) return;
      setActiveCardId(null);
    }
    const isTouch =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none)').matches;
    function onScroll() {
      setActiveCardId(null);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    if (isTouch) {
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      if (isTouch) {
        window.removeEventListener('scroll', onScroll);
      }
    };
  }, [isActive]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isHoverNoneRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: performance.now() };
  }, []);

  // Cancel the pending tap as soon as the finger drifts more than a few
  // pixels vertically — that's the start of a scroll, not a tap. Without
  // this, the only check happens at touchend (final position), so a
  // user who lifts close to where they started after a small scroll wiggle
  // would still get a flip.
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isHoverNoneRef.current) return;
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dy) > SCROLL_CANCEL_DY || Math.hypot(dx, dy) > TAP_THRESHOLD_PX) {
      touchStartRef.current = null;
    }
  }, []);

  // The browser fires touchcancel when it decides to take over the gesture
  // for native scrolling. That's the most reliable "this was not a tap"
  // signal — short-circuit immediately.
  const handleTouchCancel = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isHoverNoneRef.current) return;
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) return;
      // Long touches almost always mean the user paused over the card on
      // the way to a scroll or a context-menu — refuse to treat as a tap.
      if (performance.now() - start.t > TAP_MAX_MS) return;

      // Treat as tap. First tap flips; second tap navigates.
      e.preventDefault();
      if (activeCardId !== album.mbid) {
        setActiveCardId(album.mbid);
      } else {
        setActiveCardId(null);
        navigate(`/album/${album.mbid}`);
      }
    },
    [album.mbid, navigate]
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Touch devices route navigation through touchend so the first tap
    // flips instead of navigating. Suppress the synthetic click.
    if (isHoverNoneRef.current) {
      e.preventDefault();
    }
  }, []);

  // Cards with no review crawl yet used to render dim on the grid; the
  // dim made them feel unfinished to regular users, so we drop the
  // visual penalty and surface the state only to admins via a small
  // top-right note badge below. Non-admins see a normal card.
  const reviewsPending = album.reviewsCrawledAt === null;

  return (
    <Link
      to={`/album/${album.mbid}`}
      className={`block album-card-outer relative${isActive ? ' is-active' : ''}`}
      // containerType: inline-size makes the card a container query
      // root — every `cqw` unit below resolves to 1% of THIS card's
      // width, not the viewport. Everything that used to be fixed
      // px (title / artist / sticker / padding) now scales with the
      // grid density automatically. containerName lets us scope the
      // queries without leaking to nested cards.
      style={{
        containerType: 'inline-size',
        containerName: 'album-card',
      }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div
        className="relative aspect-square"
        style={{ perspective: '1000px' }}
      >
        <div className="album-flip relative w-full h-full">
          {/* Front — cover art + price stickers + optional NEW / HOT flags */}
          <div
            className="absolute inset-0 bg-[#1a1a1a] rounded-xl overflow-hidden"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <CoverArt
              src={album.coverArtUrl}
              fallbacks={album.coverArtFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
            {hasAnyCoverSticker && (
              <div
                className="absolute flex flex-col items-start gap-1 select-none"
                // Inset scales with card width (cqw) so the sticker
                // stays at a consistent % from the corner instead of
                // creeping inward on smaller grids. clamp floors at
                // 2px (always visibly off the edge) and caps at 8px
                // (the previous fixed top-2/left-2 value).
                style={{
                  top: 'clamp(2px, 2.5cqw, 8px)',
                  left: 'clamp(2px, 2.5cqw, 8px)',
                }}
              >
                {isSoon && (
                  <CoverStickerBadge
                    kind="soon"
                    lines={[`D-${daysToRelease}`]}
                    ariaOverride={`발매 ${daysToRelease}일 전`}
                  />
                )}
                {isNew && <CoverStickerBadge kind="new" />}
                {album.isHot && <CoverStickerBadge kind="hot" />}
              </div>
            )}
            {/* Admin-only pending-review mark. Bare emoji in the top-
                right corner — the chip+backdrop-blur treatment we
                started with both muted the emoji visually and broke
                the flip-backface behaviour. The `album-front-decor`
                class fades the badge out in sync with the first
                half of the card flip so it doesn't bleed through
                onto the back face (see index.css).
                Suppressed on upcoming releases — "no reviews" is
                the expected state before the album is out, so
                flagging it reads as noise. The badge reappears the
                day the release date arrives (isSoon flips false
                via daysUntilRelease). */}
            {isAdmin && reviewsPending && !isSoon && (
              <div
                className="album-front-decor absolute top-1 right-1.5 leading-none select-none"
                aria-label="리뷰 수집 대기"
                title="리뷰 수집 대기 — 이 앨범 페이지에서 🔍 리뷰 모아오기 실행"
                style={{ fontSize: 'clamp(10px, 7.5cqw, 15px)' }}
              >
                ⚠️
              </div>
            )}
            <PriceTagStack links={priceTagLinks} maxVisible={1} showOverflow={false} />
          </div>

          {/* Back — mirrored darkened cover + amber wash + info.
              Whole card is the Link, so tapping anywhere on the
              back navigates. */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              background: '#0f0f0f',
            }}
          >
            {/* Mirrored, desaturated, slightly-darker cover as base */}
            <div
              className="absolute inset-0"
              style={{
                transform: 'scaleX(-1)',
                filter: 'grayscale(1) brightness(0.2)',
              }}
              aria-hidden
            >
              <CoverArt
                src={album.coverArtUrl}
                fallbacks={album.coverArtFallbacks}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            {/* Score-colored wash — only when the album has ≥3 scored reviews. */}
            {glowRgb && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(135deg, rgba(${glowRgb},0.12), rgba(${glowRgb},0.04))`,
                }}
                aria-hidden
              />
            )}
            {glowRgb && (
              <div
                className="absolute inset-0 pointer-events-none rounded-xl"
                style={{ boxShadow: `inset 0 0 24px rgba(${glowRgb},0.32)` }}
                aria-hidden
              />
            )}

            <div className="absolute inset-0 flex flex-col">
              {/* Info — title / artist / score stacked tightly at the top.
                  Every px value is a clamp() driven by cqw so the
                  text shrinks with the cover at high density. Ranges
                  are tuned so the comfortable tier (~200px+ covers)
                  hits the previous fixed values, and the ultra tier
                  (~90-100px) still has legible baseline minimums. */}
              <div
                style={{
                  padding:
                    'clamp(8px, 9cqw, 18px) clamp(6px, 7cqw, 14px) 0',
                }}
              >
                <h3
                  className="text-white line-clamp-2"
                  style={{
                    fontSize: 'clamp(10px, 8cqw, 16px)',
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {album.title}
                </h3>
                <p
                  className="text-gray-300 line-clamp-1"
                  style={{
                    fontSize: 'clamp(8px, 6cqw, 12px)',
                    marginTop: 'clamp(2px, 2cqw, 4px)',
                  }}
                >
                  {album.artist}
                  {album.year && <> · {album.year}</>}
                </p>
                {(showAvg || up > 0 || down > 0 || userReviewCount > 0) && (
                  <div
                    className="flex items-center gap-2 tabular-nums flex-wrap"
                    style={{
                      marginTop: 'clamp(3px, 3cqw, 6px)',
                      fontSize: 'clamp(8px, 6cqw, 12px)',
                    }}
                  >
                    {showAvg && (
                      <span className={`font-semibold ${getScoreColor(album.averageScore!)}`}>
                        ★ {album.averageScore}/100
                      </span>
                    )}
                    {(up > 0 || down > 0) && (
                      <>
                        <span style={{ color: '#88a2bf' }}>▲{up}</span>
                        <span style={{ color: '#c08888' }}>▼{down}</span>
                      </>
                    )}
                    {userReviewCount > 0 && (
                      <span className="text-gray-300">
                        <span aria-hidden>💬</span> {userReviewCount}
                      </span>
                    )}
                  </div>
                )}
                {((album.ownedCount ?? 0) > 0 || (album.wantedCount ?? 0) > 0) && (
                  <div
                    className="flex items-center gap-2 tabular-nums text-gray-300 flex-wrap"
                    style={{
                      marginTop: 'clamp(2px, 2cqw, 4px)',
                      fontSize: 'clamp(8px, 6cqw, 12px)',
                    }}
                  >
                    {(album.ownedCount ?? 0) > 0 && (
                      <span>
                        <span aria-hidden>💿</span> {album.ownedCount}
                      </span>
                    )}
                    {(album.wantedCount ?? 0) > 0 && (
                      <span>
                        <span aria-hidden>🎯</span> {album.wantedCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div style={{ flex: 1 }} />

              {/* "자세히 보기" CTA used to sit here. The whole card
                  is still a <Link> so any click on the back
                  navigates to the detail page, which is what the
                  CTA used to do. The ▶ chip below replaces the CTA
                  as the back-face action affordance. */}
            </div>
            {/* ▶ chip on the back face. The flip (.album-flip via
                :hover on .album-card-outer) already handles the
                "hidden by default, revealed when the card is
                flipped" logic via backface-visibility, so the chip
                uses alwaysVisible to skip PlayChip's own hover
                gate — we don't want two layered hover triggers
                that would double-time the reveal. */}
            <PlayChip
              albumMbid={album.mbid}
              spotifyUrl={album.spotifyUrl ?? null}
              title={album.title}
              artist={album.artist}
              size={26}
              alwaysVisible
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
