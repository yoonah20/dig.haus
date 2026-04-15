import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AlbumSearchResult } from '../types';
import CoverArt from './CoverArt';
import PriceTagStack from './PriceTagSticker';
import { getScoreColor } from '../utils/score';

type VinylPhase = 'idle' | 'eject' | 'fly';

const EJECT_MS = 1000;
const FLY_MS = 500;

// Cross-card active state for touch devices: only one card can show its overlay at a time.
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

function VinylSvg() {
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full"
      style={{ filter: 'drop-shadow(2px 2px 8px rgba(0,0,0,0.8))' }}
      aria-hidden
    >
      <circle cx="50" cy="50" r="50" fill="#1a1a1a" />
      {[10, 20, 30, 40, 45].map((r) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#2a2a2a" strokeWidth="0.5" />
      ))}
      <circle cx="50" cy="50" r="15" fill="#e8a020" />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: "'Syne', 'Inter', sans-serif",
          fontWeight: 700,
          fontSize: '14px',
          letterSpacing: '-0.03em',
          fill: '#000',
        }}
      >
        dig
      </text>
      <circle cx="50" cy="50" r="2" fill="#0f0f0f" />
    </svg>
  );
}

export default function AlbumCard({ album }: { album: AlbumSearchResult }) {
  const up = album.upvotes ?? 0;
  const down = album.downvotes ?? 0;
  const priceTagLinks = album.priceTagLinks ?? [];

  const navigate = useNavigate();
  const [phase, setPhase] = useState<VinylPhase>('idle');
  const phaseRef = useRef<VinylPhase>('idle');
  const cardRef = useRef<HTMLDivElement>(null);
  const vinylRef = useRef<HTMLDivElement>(null);
  const isHoverNoneRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const TAP_THRESHOLD_PX = 10;

  const activeId = useSyncExternalStore(
    subscribeActiveCard,
    getActiveCardSnapshot,
    getActiveCardSnapshot
  );
  const isActive = activeId === album.mbid;

  const HOVER_TRANSFORM = 'scale(1.09) translateY(-8px)';

  const resetCardTransform = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = '';
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (phaseRef.current !== 'idle' || isHoverNoneRef.current) return;
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = HOVER_TRANSFORM;
  }, []);

  const handleMouseLeave = useCallback(() => {
    resetCardTransform();
  }, [resetCardTransform]);

  useEffect(() => {
    isHoverNoneRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none)').matches;
  }, []);

  // Touch-only: close this card's overlay when user taps outside any album card
  // or starts scrolling.
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

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isHoverNoneRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
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

      // Treat as tap: suppress the synthetic click and drive navigation ourselves.
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

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Touch devices handle activation + navigation in touchend; block any synthetic click.
      if (isHoverNoneRef.current) {
        e.preventDefault();
        return;
      }
      // Let middle/right/modified clicks fall through (open-in-new-tab, etc)
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (phaseRef.current !== 'idle') {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      const cardEl = cardRef.current;
      const vinylEl = vinylRef.current;
      if (!cardEl || !vinylEl) {
        navigate(`/album/${album.mbid}`);
        return;
      }

      const rect = cardEl.getBoundingClientRect();
      const cardCenterX = rect.left + rect.width / 2;
      const cardCenterY = rect.top + rect.height / 2;
      const dx = window.innerWidth / 2 - cardCenterX;
      const dy = window.innerHeight / 2 - cardCenterY;

      vinylEl.style.setProperty('--fly-x', `${dx}px`);
      vinylEl.style.setProperty('--fly-y', `${dy}px`);

      // Reset 3D hover transform so vinyl animates in un-transformed parent
      resetCardTransform();

      setPhase('eject');
      window.setTimeout(() => setPhase('fly'), EJECT_MS);
      window.setTimeout(() => {
        navigate(`/album/${album.mbid}`);
      }, EJECT_MS + FLY_MS);
    },
    [album.mbid, navigate, resetCardTransform]
  );

  let vinylStyle: React.CSSProperties | undefined;
  if (phase === 'eject') {
    vinylStyle = {
      animation: `vinylEject ${EJECT_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
    };
  } else if (phase === 'fly') {
    vinylStyle = {
      animation: `vinylFly ${FLY_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`,
      zIndex: 50,
    };
  }

  return (
    <Link
      to={`/album/${album.mbid}`}
      className={`block album-card-outer relative${isActive ? ' is-active' : ''}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={phase !== 'idle' ? { zIndex: 20 } : undefined}
    >
      <div
        className="relative aspect-square album-card-3d rounded-xl"
        ref={cardRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Vinyl — absolute sibling, behind the cover by default */}
        <div
          ref={vinylRef}
          className="vinyl absolute inset-0 pointer-events-none"
          style={vinylStyle}
          aria-hidden
        >
          <div
            className="vinyl-spinner"
            style={phase !== 'idle' ? { animation: 'none' } : undefined}
          >
            <VinylSvg />
          </div>
        </div>

        {/* Cover */}
        <div className="absolute inset-0 bg-[#1a1a1a] rounded-xl overflow-hidden">
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover"
          />
          <PriceTagStack links={priceTagLinks} maxVisible={1} showOverflow={false} />
        </div>
      </div>

      {/* Info popup — slides down below the cover on hover / active */}
      <div className="album-card-info absolute left-0 right-0 top-full pointer-events-none">
        <div className="bg-[#141414] rounded-lg px-3 py-2.5 ring-1 ring-white/5">
          <h3
            className="text-white line-clamp-1"
            style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.3 }}
          >
            {album.title}
          </h3>
          <p
            className="text-gray-400 line-clamp-1"
            style={{ fontSize: '12px', marginTop: '2px' }}
          >
            {album.artist}
            {album.year && <> · {album.year}</>}
          </p>
          {(album.averageScore != null || up > 0 || down > 0) && (
            <div
              className="flex items-center gap-2 tabular-nums mt-1.5"
              style={{ fontSize: '12px' }}
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
      </div>
    </Link>
  );
}
