import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AlbumSearchResult } from '../types';
import CoverArt from './CoverArt';
import PriceTagStack from './PriceTagSticker';
import { getScoreColor, getScoreGlowRgb } from '../utils/score';

const GLOW_MIN_REVIEWS = 3;

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

export default function AlbumCard({ album }: { album: AlbumSearchResult }) {
  const up = album.upvotes ?? 0;
  const down = album.downvotes ?? 0;
  const priceTagLinks = album.priceTagLinks ?? [];

  // Flip-side glow follows the review score — cyan > green > yellow > red.
  // If there aren't at least 3 scored reviews yet, leave the back plain dark
  // so a single outlier rating doesn't mislead the color.
  const hasGlow =
    album.averageScore != null && (album.reviewCount ?? 0) >= GLOW_MIN_REVIEWS;
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
          {/* Front — cover art + price stickers */}
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
                {(album.averageScore != null || up > 0 || down > 0) && (
                  <div
                    className="flex items-center gap-2 tabular-nums"
                    style={{ marginTop: '6px', fontSize: '12px' }}
                  >
                    {album.averageScore != null && (
                      <span className={`font-semibold ${getScoreColor(album.averageScore)}`}>
                        ★ {album.averageScore}/100
                      </span>
                    )}
                    {(up > 0 || down > 0) && (
                      <>
                        <span className="text-[#e8a020]">▲{up}</span>
                        <span className="text-[#9a9a9a]">▼{down}</span>
                      </>
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
