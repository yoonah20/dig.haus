import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import CoverArt from '../../CoverArt';
import PlayChip from '../../PlayChip';
import { WallLP } from './primitives';
import { extractSpotifyAlbumId } from '../../../hooks/useNowPlaying';

// Desktop wall-cell hover treatment shared by mydig + the home wall.
//
// Visual stack (top to bottom):
//   1. group hover:z-20 on the Link, perspective on the anchor so the
//      child 3D transforms read as depth instead of skew.
//   2. Scale wrapper — origin-bottom, 1.26× on hover, the sleeve grows
//      upward off the rail.
//   3. Tilt wrapper — mousemove writes --tilt-x/--tilt-y CSS vars,
//      ±7° rotateX/rotateY for the "lifting under cursor" feel.
//   4. WallLP holding the cover.
//   5. Lamp-anchored specular — radial gradient with --spec-x/--spec-y;
//      cursor moves the highlight INVERSE so reflections appear to
//      "roll" across the plastic as the sleeve tilts.
//   6. Fixed rim streak — diagonal highlight anchored to the upper-
//      left pendant, lifts on hover.
//   7. Optional ▶ PlayChip outside the tilt wrapper (so the icon
//      stays facing forward), gated on a Spotify URL existing.
//   8. Optional `children` rendered as siblings of the scale wrapper
//      inside the Link — used by mydig to mount its 50자 평 bubble.
//      The home wall renders without children.
//
// Mobile tap-activate (mydig-specific) lives in MyDig.tsx; this card
// is desktop-only. Both mydig + home wall fall back to plain WallLP
// on the mobile breakpoint.

export interface WallHoverAlbum {
  mbid: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
  spotifyUrl?: string | null;
}

interface Props {
  album: WallHoverAlbum;
  // Slot position — used to seed WallLP variation so neighbours don't
  // pixel-match each other.
  position: number;
  // Pixel size of the LP square. Drives PlayChip + bubble offsets.
  lpSize: number;
  // 0 → full lamp wash, 1 → fully shadowed. WallLP applies the lamp
  // gradient with this bias.
  lampBias: number;
  // Resolved /album/:slugOrMbid target.
  href: string;
  // Optional bubble / overlay rendered inside the Link as a sibling
  // of the scale wrapper. Mydig passes its CommentBubble here; home
  // wall doesn't pass anything.
  children?: ReactNode;
  // Mydig nudges cells horizontally to break the rigid-grid look
  // (per-row offsets, center cell at 0). Home wall passes 0 / omits.
  offsetX?: number;
  // Optional shrink-wrap raster overlay. The texture is white-on-
  // transparent, applied straight on top of the cover (no mix-blend
  // mode — it was washing out on busy covers). Lives inside the tilt
  // wrapper as a sibling of the LP so it scales and tilts with the
  // sleeve. Home wall opts in; mydig leaves null for now while we
  // evaluate. The three position knobs control how much larger the
  // overlay is than the cover (scalePct, % of lpSize) and any
  // additional pixel nudge from centre. Defaults match the values
  // we landed on through the live tuner.
  plasticOverlaySrc?: string | null;
  plasticScalePct?: number;
  plasticOffsetXPx?: number;
  plasticOffsetYPx?: number;
  // CSS mix-blend-mode for the overlay. 'normal' (default) lays the
  // texture straight on top with its own alpha; 'screen' / 'soft-light'
  // / 'overlay' etc blend with the cover underneath.
  plasticBlendMode?: string;
  // Hover scale as a percentage (126 = 1.26x). Default matches mydig
  // because CommentBubble's right/top offsets are derived from a
  // 0.26 expansion factor; raising it on mydig without updating those
  // offsets stranded bubbles inside the scaled sleeve. Home wall has
  // no bubble so it can dial higher freely.
  hoverScalePct?: number;
  // Optional slot rendered INSIDE the tilt wrapper so it scales,
  // tilts, and translates with the cover. Used by the home wall for
  // the price sticker. Distinct from `children` (which renders
  // outside the scale wrapper, used by mydig's CommentBubble).
  coverOverlay?: ReactNode;
}

// CAA covers come back at 250px. The home + mydig walls render up to
// ~168px native, but the 1.26× hover scale pushes that toward 215px,
// so the 250 thumbnails start to soften visibly. Bumping to 500 keeps
// the hovered wall crisp. Non-CAA hosts (Spotify 640, Last.fm
// originals, admin custom covers) are already large enough and pass
// through unchanged.
export function upgradeWallCoverUrl(url: string | null): string | null {
  if (!url) return url;
  if (!url.includes('coverartarchive.org/')) return url;
  return url.replace('/front-250', '/front-500');
}

export function upgradeWallCoverFallbacks(
  urls: string[] | undefined
): string[] | undefined {
  if (!urls || urls.length === 0) return urls;
  return urls.map((u) => upgradeWallCoverUrl(u) ?? u);
}

export default function WallHoverCard({
  album,
  position,
  lpSize,
  lampBias,
  href,
  children,
  offsetX = 0,
  plasticOverlaySrc = null,
  plasticScalePct = 15,
  plasticOffsetXPx = 5,
  plasticOffsetYPx = 0,
  plasticBlendMode = 'normal',
  hoverScalePct = 126,
  coverOverlay = null,
}: Props) {
  const spotifyAlbumId = extractSpotifyAlbumId(album.spotifyUrl ?? null);
  const hasPreview = !!spotifyAlbumId;

  const cardRef = useRef<HTMLAnchorElement>(null);

  // Cursor-tracked tilt + lamp-anchored specular — written to CSS
  // custom properties on the anchor element via a plain ref (no
  // React state per-pixel; mousemove fires every frame and setState
  // would thrash). Anchored at scene-upper-left at rest with wide
  // inverse travel so the shine sweeps roughly 70% × 55% across the
  // sleeve as the cursor moves; that "reflection lagging the tilt"
  // is what reads as shrink-wrap rather than flat card.
  const handleCursorMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const tiltY = (nx - 0.5) * 14;
    const tiltX = -(ny - 0.5) * 14;
    const specX = 50 - (nx - 0.5) * 70;
    const specY = 38 - (ny - 0.5) * 55;
    el.style.setProperty('--tilt-x', `${tiltX}deg`);
    el.style.setProperty('--tilt-y', `${tiltY}deg`);
    el.style.setProperty('--spec-x', `${specX}%`);
    el.style.setProperty('--spec-y', `${specY}%`);
  };
  const handleCursorLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--spec-x', '50%');
    el.style.setProperty('--spec-y', '38%');
  };

  const wallCoverUrl = upgradeWallCoverUrl(album.coverArtUrl);
  const wallCoverFallbacks = upgradeWallCoverFallbacks(album.coverArtFallbacks);

  return (
    <Link
      ref={cardRef}
      to={href}
      title={`${album.artist} — ${album.title}`}
      className="group relative block hover:z-20"
      onMouseMove={handleCursorMove}
      onMouseLeave={handleCursorLeave}
      style={{
        width: lpSize,
        height: lpSize,
        marginLeft: offsetX,
        textDecoration: 'none',
        // 900px perspective is mild — tighter values exaggerate the
        // tilt to the point of looking gimmicky.
        perspective: '900px',
        // Custom property consumed by the scale wrapper's arbitrary
        // tailwind value below. Caller-driven so home wall can run a
        // bigger hover than mydig without forking the component.
        ['--wall-hover-scale' as any]: String(hoverScalePct / 100),
      } as React.CSSProperties}
    >
      <div
        className="absolute inset-0 z-10 origin-bottom transition-[transform,filter] duration-[260ms] ease-out group-hover:[transform:scale(var(--wall-hover-scale))_translateZ(60px)] group-hover:[filter:drop-shadow(0_18px_22px_rgba(0,0,0,0.55))]"
        style={{
          transformOrigin: 'center bottom',
          // preserve-3d so the inner tilt rotateX/Y composes with the
          // outer scale + translateZ instead of getting flattened. The
          // Link parent has perspective:900px, which means translateZ
          // produces a real "closer to viewer" zoom on top of the
          // scale — that's what gives the "픽업한다" feel rather than
          // a plain 2D enlargement.
          transformStyle: 'preserve-3d',
        }}
      >
        <div
          className="w-full h-full transition-transform duration-[140ms] ease-out"
          style={{
            transform:
              'rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg))',
            transformStyle: 'preserve-3d',
            transformOrigin: 'center center',
          }}
        >
          <WallLP size={lpSize} seed={position} lampBias={lampBias}>
            <CoverArt
              src={wallCoverUrl}
              fallbacks={wallCoverFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
          </WallLP>

          {/* Shrink-wrap raster overlay — extended ~7px past every
              edge of the cover so the plastic visibly wraps around
              the sleeve rather than sitting flush with it. Real
              shrink-wrap reads strongest at the edges (where the film
              folds and catches light against whatever's behind the
              sleeve) — exact-fit overlays were getting lost on busy
              covers because the texture's interior is mostly subtle
              wrinkle highlights. Drop-shadow lifts the plastic a hair
              off the sleeve so the protrusion reads as a separate
              layer rather than a dirty crop. */}
          {plasticOverlaySrc && (() => {
            // Compute symmetric protrusion from scalePct, then add
            // the per-axis pixel offsets. Negative `top`/`left` push
            // the overlay's top-left past the cover's edge so the
            // plastic appears to wrap around it.
            const extra = (lpSize * plasticScalePct) / 100;
            const half = extra / 2;
            return (
              <img
                src={plasticOverlaySrc}
                alt=""
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  top: -half + plasticOffsetYPx,
                  left: -half + plasticOffsetXPx,
                  width: lpSize + extra,
                  height: lpSize + extra,
                  // Override Tailwind preflight's `img { max-width:
                  // 100% }` — without this the explicit width above
                  // gets capped at the parent's width, so the overlay
                  // grew vertically (height is unconstrained) but
                  // refused to grow horizontally past lpSize.
                  maxWidth: 'none',
                  objectFit: 'cover',
                  opacity: 1,
                  mixBlendMode:
                    plasticBlendMode as React.CSSProperties['mixBlendMode'],
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
                }}
              />
            );
          })()}

          {/* Lamp-anchored specular — single ambient gloss layer
              (holo conic was tested and dropped — the rainbow shift
              read as toy-like against album sleeves). Warm cream
              centre + soft-light blend gives a quiet shrink-wrap
              gloss that follows the cursor without dominating; peak
              + falloff dialed lower than earlier passes since the
              previous version still felt 번쩍. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-30 group-hover:opacity-90 transition-opacity duration-[220ms]"
            style={{
              background:
                'radial-gradient(circle at var(--spec-x,30%) var(--spec-y,25%), rgba(255,250,235,0.85) 4%, rgba(255,250,235,0.45) 16%, rgba(255,250,235,0.15) 32%, transparent 52%)',
              mixBlendMode: 'overlay',
            }}
          />
          {/* Fixed rim streak — thin diagonal anchored to the scene's
              upper-left pendant; present at rest, lifts on hover. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-35 group-hover:opacity-85 transition-opacity duration-[220ms]"
            style={{
              background:
                'linear-gradient(125deg, rgba(255,230,185,0.3) 0%, rgba(255,230,185,0.08) 18%, transparent 42%)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Caller-supplied cover overlay (e.g., home wall price
              sticker). Sits inside the tilt wrapper so it tilts +
              scales with the cover, but above the shine layers so
              the sticker text stays clearly readable. */}
          {coverOverlay}

          {/* Play chip — inside the tilt wrapper so it follows the
              cursor-driven rotateX/Y. Earlier this lived as a
              sibling of the tilt wrapper to keep the ▶ glyph facing
              the viewer, but the user preferred the chip tilting
              with the cover for a more cohesive read. The tilt is
              only ±7° so the icon stays clearly readable. */}
          {hasPreview && (
            <PlayChip
              albumMbid={album.mbid}
              spotifyUrl={album.spotifyUrl ?? null}
              title={album.title}
              artist={album.artist}
              size={Math.round(lpSize * 0.208)}
            />
          )}
        </div>
      </div>

      {children}
    </Link>
  );
}
