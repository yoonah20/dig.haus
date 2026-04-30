import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CoverArt from '../../CoverArt';
import PlayChip from '../../PlayChip';
import { WallLP } from './primitives';
import { extractSpotifyAlbumId } from '../../../hooks/useNowPlaying';
import { useTapActivate } from '../../../hooks/useTapActivate';
import { liftHeroSlot, releaseHeroSlot } from '../../../utils/heroSlotLift';

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
  // tilts, and translates with the cover. Sits *above* the
  // shrink-wrap raster + shine layers so the contents (PICK
  // sticker, price tag, etc.) read clearly without the plastic
  // film texturing them. Distinct from `children` (which renders
  // outside the scale wrapper, used by mydig's CommentBubble).
  coverOverlay?: ReactNode;
  // Same as coverOverlay but rendered BELOW the shrink-wrap raster
  // (and the shine layers built on top of it) — anything in this
  // slot reads as "stuck to the sleeve, then sealed under the
  // plastic". The price tag uses this so the wrap visibly textures
  // the sticker. Tried this once before, reverted in 42ea82e when
  // the wrap shredded the price digits, but the new tag2.webp puts
  // the digits in a tight slot where the wrap reads as gloss
  // rather than illegibility.
  priceTagOverlay?: ReactNode;
  // When true the hover transform also pushes the sleeve
  // forward in 3D via translateZ — the "popping out of the
  // wall" emphasis. Default is false now: the effect was
  // visually nice but caused noticeable hover stutter on
  // longer mydig walls (15 LPs × per-cell perspective) so we
  // pulled it as a default. Pass `popOnHover` if a particular
  // surface really wants the lift.
  popOnHover?: boolean;
  // Vertical anchor for the hover scale's transform-origin. Default
  // 'bottom' = grow purely upward (mydig's CommentBubble offsets
  // assume this). Pass a percentage like '75%' to shift the anchor
  // off the bottom edge so growth distributes mostly upward but
  // partly downward — useful when the scene has empty space above
  // AND below the sleeve and a fully-bottom anchor reads too rigid.
  hoverOriginY?: string;
  // Multiplier on the default play-chip size factor (0.208 of
  // lpSize). 1 = unchanged. Pass <1 (e.g. 0.6) when the host
  // surface already runs a large hover scale, since the chip
  // grows with the cover and a default-sized chip on a 1.8×
  // hover ends up dominating the sleeve.
  playChipScale?: number;
  // Enable tap-to-activate on touch devices: first tap shows the
  // hover scale, second tap navigates. Default false keeps the
  // mydig + mobile-hero direct-tap behaviour where the card just
  // navigates immediately on touch (those surfaces don't run
  // a big hover scale that needs revealing).
  tapToActivate?: boolean;
  // Inset (in % of LP width) for the ▶ play chip from the
  // bottom-right corner. 6 is the PlayChip default; the home
  // hero passes a smaller value so the chip pushes closer to
  // the corner and away from the cover area.
  playChipInsetPct?: number;
  // Optional CSS-pixel X translation applied alongside the hover
  // scale, in screen coordinates (i.e., NOT scaled by the hover
  // factor — translateX is written before scale() in the transform
  // string so 84px here means 84 visual pixels post-scale).
  // Used by the mobile hero so a tapped left/right column cover
  // can recenter on the slide rather than ballooning out of its
  // own column. Default 0 leaves the desktop wall + mydig
  // behaviour unchanged.
  hoverTranslateX?: number;
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

// Translate a transform-origin Y token ('top' / 'center' / 'bottom'
// / '0%' / '50%' / '100%' / arbitrary percentage) into a 0-1 fraction
// of the element's height. Used by the cursor-tilt math to project
// the link's stable layout rect through the same origin the scale
// wrapper uses, so cursor normalisation hits the visual sleeve's
// real centre instead of the layout box's centre (which the home
// wall's 75% origin pulls noticeably off).
function parseOriginYFrac(raw: string): number {
  if (raw === 'top') return 0;
  if (raw === 'center') return 0.5;
  if (raw === 'bottom') return 1;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (m) return Math.min(1, Math.max(0, Number(m[1]!) / 100));
  return 1;
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
  priceTagOverlay = null,
  popOnHover = false,
  hoverOriginY = 'bottom',
  playChipScale = 1,
  tapToActivate = false,
  playChipInsetPct,
  hoverTranslateX = 0,
}: Props) {
  const spotifyAlbumId = extractSpotifyAlbumId(album.spotifyUrl ?? null);
  const hasPreview = !!spotifyAlbumId;

  const cardRef = useRef<HTMLAnchorElement>(null);

  // Cursor-tracked tilt + specular — pokemon-cards-css pattern,
  // rebuilt from scratch after multiple wrong-base iterations.
  //
  // Two conventions, both PARALLAX (cursor and visual response move
  // *together*, not opposite):
  //   - Tilt: cursor near an edge tilts that edge toward the viewer.
  //     Cursor right of centre → right edge forward → rotateY(+).
  //     Cursor below centre → bottom edge forward → rotateX(+).
  //   - Specular: highlight tracks the cursor. Earlier passes had
  //     spec offset opposite to the cursor on an explicit "reverse
  //     direction" request, but the operator's later review traced
  //     the "something feels off" feeling back to that anti-parallax
  //     spec. Both signals share the parallax convention now so the
  //     cover reads as a glossy sleeve under a single light source
  //     anchored to the cursor.
  //
  // Reference is the *visual* rect centre, not the layout rect
  // centre — hover-scale + origin shifts the visual centre off the
  // layout centre (origin "bottom" pulls it up ~38% of lpSize on
  // the home wall), and normalising against the wrong centre is
  // exactly what made `dy=0` land on a tilted-looking sleeve in
  // earlier passes.
  //
  // No clamp: cursor outside the visual rect fires mouseleave, so
  // dx/dy stay roughly in [-1, +1] with a tiny graceful overshoot
  // near the edges.
  //
  // ±12° tilt reads as a gentle shrink-wrap glance — wider than
  // the prior ±7° (which was hard to perceive against the busy
  // covers) but a long way short of the ±30° diagnostic window
  // that confirmed the parallax direction. Spec travel stays at
  // ±50% so the highlight reaches the cover edges instead of
  // stalling near the centre.
  const TILT_MAX = 12;
  const SPEC_TRAVEL = 50;
  // Pointer-driven tilt + spec — shared by mouse (desktop) and
  // touch (mobile tap-active drag). The Link element itself is not
  // transformed; its inner scale wrapper is. So getBoundingClientRect
  // here returns the LAYOUT box at the unscaled cell position, and
  // we project the visual centre forward by the scale + translate
  // applied by the hover transform. hoverTranslateX is in CSS-pixel
  // screen space (transform string is `translateX(...) scale(...)`,
  // so the translate applies post-scale and shifts the visual rect
  // by exactly that many on-screen pixels).
  const updateTiltFromPointer = (clientX: number, clientY: number) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = hoverScalePct / 100;
    const originYFrac = parseOriginYFrac(hoverOriginY);
    const halfVW = (rect.width * scale) / 2;
    const halfVH = (rect.height * scale) / 2;
    const visualCenterX = rect.left + rect.width / 2 + hoverTranslateX;
    const originAbsY = rect.top + rect.height * originYFrac;
    const visualTop = originAbsY - scale * (originAbsY - rect.top);
    const visualCenterY = visualTop + halfVH;
    const dx = (clientX - visualCenterX) / halfVW;
    const dy = (clientY - visualCenterY) / halfVH;
    const tiltY = dx * TILT_MAX;
    const tiltX = dy * TILT_MAX;
    const specX = 50 + dx * SPEC_TRAVEL;
    const specY = 50 + dy * SPEC_TRAVEL;
    el.style.setProperty('--tilt-x', `${tiltX}deg`);
    el.style.setProperty('--tilt-y', `${tiltY}deg`);
    el.style.setProperty('--spec-x', `${specX}%`);
    el.style.setProperty('--spec-y', `${specY}%`);
  };
  const handleCursorMove = (e: React.MouseEvent<HTMLElement>) => {
    updateTiltFromPointer(e.clientX, e.clientY);
  };
  const handleCursorEnter = () => {
    liftHeroSlot(cardRef.current);
  };
  const handleCursorLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    // Spec resets to centre instead of the prior 50% / 38%
    // (which assumed the lamp lived in the upper-left and the
    // highlight should bias upward at rest). The new parallax-
    // tracked spec doesn't anchor to a fixed lamp position, so
    // the rest state is just centred.
    el.style.setProperty('--spec-x', '50%');
    el.style.setProperty('--spec-y', '50%');
    releaseHeroSlot(el);
  };

  const wallCoverUrl = upgradeWallCoverUrl(album.coverArtUrl);
  const wallCoverFallbacks = upgradeWallCoverFallbacks(album.coverArtFallbacks);

  // Tap-to-activate on touch devices when the host opts in (the
  // home hero does — its 1.8× hover scale is the whole point of
  // the gesture). Mydig + the mobile-band hero leave it off so
  // taps still navigate immediately.
  const navigate = useNavigate();
  const tap = useTapActivate({
    cardId: `wall-${album.mbid}-${position}`,
    outsideSelector: '.wall-hover-outer',
    enabled: tapToActivate,
  });

  // Touch-driven tilt for the mobile hero. While the card is
  // tap-active the user can drag a finger across the lifted sleeve
  // to tilt + roll the spec highlight, mirroring the desktop
  // cursor-parallax. Gated on tap.isActive so a first tap (which
  // fires touchstart → touchmove → touchend before isActive
  // flips true) doesn't tilt a still-flat sleeve. We don't
  // preventDefault here — useTapActivate's touchmove still needs
  // to track scroll-cancel against the same event.
  const handleTouchMove = (e: React.TouchEvent<HTMLAnchorElement>) => {
    tap.handlers.onTouchMove(e);
    if (!tap.isActive) return;
    const t = e.touches[0];
    if (!t) return;
    updateTiltFromPointer(t.clientX, t.clientY);
  };

  // Tap-active transitions on touch devices need to mirror the
  // mouseenter/leave path on desktop:
  //   - Lift the slot's z-index so the scaled sleeve paints above
  //     the slot's neighbours within the same row (the cover grows
  //     past its lpSize footprint into the slot's reserved bottom
  //     extension and beyond, where its sibling LPs would otherwise
  //     paint over it).
  //   - Reset --tilt-x / --tilt-y / --spec-x / --spec-y back to
  //     neutral when the card deactivates so the next activation
  //     pops clean instead of inheriting the last finger position.
  // The release uses the default 300ms delay to match the
  // scale-down transition (260ms) — dropping the z-index instantly
  // would let neighbouring slots paint over the still-shrinking
  // sleeve mid-transition.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (tap.isActive) {
      liftHeroSlot(el);
      return;
    }
    releaseHeroSlot(el);
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--spec-x', '50%');
    el.style.setProperty('--spec-y', '50%');
  }, [tap.isActive]);

  return (
    <Link
      ref={cardRef}
      to={href}
      className="wall-hover-outer group relative block hover:z-20 data-[tap-active=true]:z-20"
      onMouseMove={handleCursorMove}
      onMouseEnter={handleCursorEnter}
      onMouseLeave={handleCursorLeave}
      onTouchStart={tap.handlers.onTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={tap.handlers.onTouchCancel}
      onTouchEnd={(e) => tap.handlers.onTouchEnd(e, () => navigate(href))}
      onClick={tap.handlers.onClick}
      data-tap-active={tap.isActive ? 'true' : undefined}
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
        // Companion translate applied alongside the scale — used by
        // the mobile hero to recenter a column-anchored cover on
        // the slide. Default 0px keeps existing surfaces (desktop
        // wall, mydig) unchanged.
        ['--wall-hover-tx' as any]: `${hoverTranslateX}px`,
      } as React.CSSProperties}
    >
      <div
        // Single drop-shadow per state — earlier we ran a six-
        // function side-splay that read closer to the photo
        // reference, but six Gaussian blur passes per frame
        // bogged down even desktop Chrome once the scale +
        // filter transition kicked in. Collapsed to one
        // function on each side so CSS still interpolates
        // smoothly (matched function counts) and the GPU only
        // owes one blur pass; the splay is sacrificed for the
        // sake of the animation staying at frame rate. Hover
        // grows the shadow rather than swapping its shape.
        // clip-path crops top + bottom flush at rest so the LP
        // on the shelf can't bleed shadow onto the wall above
        // or the shelf below (sides -18 px loose). Once the
        // sleeve lifts (hover / tap-active) the LP is no longer
        // sitting on the shelf so all four sides open up
        // (-60 px) and the lift shadow can fully show.
        // Animating four inset axes is cheap next to the old
        // six-blur drop-shadow load.
        className={`absolute inset-0 z-10 transition-[transform,filter,clip-path] duration-[260ms] ease-out [filter:drop-shadow(0_4px_6px_rgba(0,0,0,0.30))] [clip-path:inset(0_-18px_0_-18px)] group-hover:[filter:drop-shadow(0_16px_20px_rgba(0,0,0,0.45))] group-hover:[clip-path:inset(-60px_-60px_-60px_-60px)] group-data-[tap-active=true]:[filter:drop-shadow(0_16px_20px_rgba(0,0,0,0.45))] group-data-[tap-active=true]:[clip-path:inset(-60px_-60px_-60px_-60px)] ${
          popOnHover
            ? 'group-hover:[transform:translateX(var(--wall-hover-tx,0px))_scale(var(--wall-hover-scale))_translateZ(60px)] group-data-[tap-active=true]:[transform:translateX(var(--wall-hover-tx,0px))_scale(var(--wall-hover-scale))_translateZ(60px)]'
            : 'group-hover:[transform:translateX(var(--wall-hover-tx,0px))_scale(var(--wall-hover-scale))] group-data-[tap-active=true]:[transform:translateX(var(--wall-hover-tx,0px))_scale(var(--wall-hover-scale))]'
        }`}
        style={{
          transformOrigin: `center ${hoverOriginY}`,
          // preserve-3d so the inner tilt rotateX/Y composes with the
          // outer scale (+ optional translateZ pop) instead of getting
          // flattened. The Link parent has perspective:900px, which
          // means translateZ — when popOnHover is on — produces a real
          // "closer to viewer" zoom that reads as "픽업한다". With
          // popOnHover off the same chain still preserves the cursor-
          // driven tilt; only the forward push is dropped.
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

          {/* Price-tag slot — rendered before the plastic raster so
              DOM-order stacking lets the wrap (and the shine layers
              built on top of it) paint over the tag. "Stuck to the
              sleeve, then sealed in" composition. */}
          {priceTagOverlay}

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
                'radial-gradient(circle at var(--spec-x,50%) var(--spec-y,50%), rgba(255,250,235,0.85) 4%, rgba(255,250,235,0.45) 16%, rgba(255,250,235,0.15) 32%, transparent 52%)',
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
              size={Math.round(lpSize * 0.208 * playChipScale)}
              style={
                playChipInsetPct != null
                  ? {
                      right: `${playChipInsetPct}%`,
                      bottom: `${playChipInsetPct}%`,
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {children}
    </Link>
  );
}
