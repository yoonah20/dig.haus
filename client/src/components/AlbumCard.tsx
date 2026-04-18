import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AlbumSearchResult } from '../types';
import CoverArt from './CoverArt';
import PriceTagStack from './PriceTagSticker';
import { getScoreColor, getScoreGlowRgb } from '../utils/score';
import { MIN_SCORED_FOR_AVG } from '../lib/reviewThresholds';

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

// Releases stamped within this window get the "NEW!" sticker so the
// grid reads like a record-shop 신보 코너. 30 days is forgiving enough
// to catch late-add releases from the last few weeks; any longer and
// the badge stops feeling informative.
const NEW_BADGE_DAYS = 30;

function isRecentRelease(releaseDate: string | null | undefined): boolean {
  if (!releaseDate) return false;
  const match = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ts)) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  // Include not-yet-released albums too — the sticker already reads as
  // "new". The floor is what matters (> 30 days = not new).
  return diffDays <= NEW_BADGE_DAYS;
}

// Record-shop sticker family. All share the same chip shape so a
// card carrying multiple (stacked top-down: NEW → HOT → PRE-ORDER
// → SALE → SOLD OUT) reads as one column of labels rather than
// five competing elements. NEW moved from yellow to sky so it
// doesn't collide with SALE's yellow. Labels drop the trailing
// '!'; the typography carries the energy. PRE-ORDER and SOLD OUT
// render as two-line chips (hyphen/space split) so they stay
// narrow enough to sit over the cover without stretching past
// single-word stickers.
type CoverStickerKind = 'new' | 'hot' | 'preorder' | 'sale' | 'soldout';

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
  preorder: {
    bg: '#2fa46a',
    fg: '#07231a',
    lines: ['PRE', 'ORDER'],
    aria: '발매 예정 구매처 있음',
    // "ORDER" is 5 chars — tighter letter-spacing + smaller font keeps
    // the chip from overshooting the single-word ones.
    fontSize: '6.8px',
    letterSpacing: '0.01em',
    padding: '2px 2.5px',
    lineHeight: 1.05,
    minWidth: '28px',
  },
  sale: {
    bg: '#f5c542',
    fg: '#3a2400',
    lines: ['SALE'],
    aria: '세일 중인 구매처 있음',
  },
  soldout: {
    bg: '#f08a3c',
    fg: '#2a1300',
    lines: ['SOLD', 'OUT'],
    aria: '품절된 구매처 있음',
    // "SOLD" is shorter than "ORDER" so this chip was shrinking below
    // its neighbours. Pull font + padding closer to the single-word
    // defaults; min-width matches the visual target.
    fontSize: '7.5px',
    letterSpacing: '0.04em',
    padding: '2.1px 4px',
    lineHeight: 1.05,
    minWidth: '34px',
  },
};

function CoverStickerBadge({ kind }: { kind: CoverStickerKind }) {
  const palette = STICKER_PALETTE[kind];
  return (
    <span
      className="inline-flex flex-col items-center justify-center font-extrabold uppercase rounded-sm shadow-md"
      style={{
        background: palette.bg,
        color: palette.fg,
        fontFamily: "'Syne', 'Inter', sans-serif",
        fontSize: palette.fontSize ?? '8.3px',
        letterSpacing: palette.letterSpacing ?? '0.06em',
        padding: palette.padding ?? '2.2px 5.4px',
        lineHeight: palette.lineHeight ?? 1,
        minWidth: palette.minWidth,
      }}
      aria-label={palette.aria}
    >
      {palette.lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

export default function AlbumCard({ album }: { album: AlbumSearchResult }) {
  const up = album.upvotes ?? 0;
  const down = album.downvotes ?? 0;
  const priceTagLinks = album.priceTagLinks ?? [];
  const isNew = isRecentRelease(album.releaseDate);
  // Status stickers use the server-computed flags (which look at
  // *all* links, not just the top-3 cheapest that priceTagLinks
  // carries). Otherwise a cheap regular-status listing would mask
  // a soldout or pre-order entry on the same album.
  const hasPreorder = !!album.hasPreorderLink;
  // hasSaleLink / hasSoldoutLink still come down from the server but
  // don't render as cover stickers anymore — PriceTagStack already
  // communicates those states on the price tag itself.
  const hasAnyCoverSticker = isNew || album.isHot || hasPreorder;

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

  // User-submitted albums whose review crawl hasn't run yet get a
  // subtle opacity dim — reads as "incomplete" without shouting
  // "pending approval". Only explicit `null` dims; `undefined`
  // (older client / pre-redeploy cache) stays bright to avoid a
  // transient dimming of fully-indexed albums.
  const shouldDim = album.reviewsCrawledAt === null;

  return (
    <Link
      to={`/album/${album.mbid}`}
      className={`block album-card-outer relative${isActive ? ' is-active' : ''}${shouldDim ? ' album-card-dim' : ''}`}
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
              <div className="absolute top-2 left-2 flex flex-col items-start gap-1 select-none">
                {isNew && <CoverStickerBadge kind="new" />}
                {album.isHot && <CoverStickerBadge kind="hot" />}
                {hasPreorder && <CoverStickerBadge kind="preorder" />}
                {/* SALE / SOLD OUT stickers removed — the same signals
                    live on the PriceTagStack corner (strike-through
                    for soldout, yellow fill for sale) so carrying
                    them as big chips on the cover too was redundant
                    and noisy on the grid. */}
              </div>
            )}
            <PriceTagStack links={priceTagLinks} maxVisible={1} showOverflow={false} />
          </div>

          {/* Back — mirrored darkened cover + amber wash + info (70%) +
              "자세히 보기" CTA (30%). Whole card is the Link, so tapping
              anywhere on the back navigates. */}
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
              {/* Info — title / artist / score stacked tightly at the top */}
              <div style={{ padding: '18px 14px 0' }}>
                <h3
                  className="text-white line-clamp-2"
                  style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.2 }}
                >
                  {album.title}
                </h3>
                <p
                  className="text-gray-300 line-clamp-1"
                  style={{ fontSize: '12px', marginTop: '4px' }}
                >
                  {album.artist}
                  {album.year && <> · {album.year}</>}
                </p>
                {(showAvg || up > 0 || down > 0) && (
                  <div
                    className="flex items-center gap-2 tabular-nums"
                    style={{ marginTop: '6px', fontSize: '12px' }}
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
                  </div>
                )}
                {((album.ownedCount ?? 0) > 0 || (album.wantedCount ?? 0) > 0) && (
                  <div
                    className="flex items-center gap-2 tabular-nums text-gray-300"
                    style={{ marginTop: '4px', fontSize: '12px' }}
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

              {/* "자세히 보기" CTA — compact outlined button, symmetric
                  bottom padding to the top title spacing. */}
              <div
                className="flex items-center justify-center"
                style={{ padding: '0 16px 18px' }}
              >
                <div
                  className="flex items-center justify-center transition-colors hover:bg-white/5"
                  style={{
                    width: '58%',
                    padding: '4px 0',
                    border: `1px solid ${ctaColor}`,
                    color: ctaColor,
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  자세히 보기
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
