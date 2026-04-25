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
      }}
    >
      <div
        className="absolute inset-0 z-10 origin-bottom transition-transform duration-[260ms] ease-out group-hover:scale-[1.26]"
        style={{ transformOrigin: 'center bottom' }}
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

          {/* Lamp-anchored specular — at rest the warm halo seats near
              the upper-left pendant, on hover it lifts to full and
              tracks inverse to the cursor. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-25 group-hover:opacity-100 transition-opacity duration-[220ms]"
            style={{
              background:
                'radial-gradient(circle at var(--spec-x,22%) var(--spec-y,18%), rgba(255,245,220,0.6) 0%, rgba(255,245,220,0.32) 18%, rgba(255,245,220,0.12) 38%, transparent 62%)',
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
        </div>

        {/* Play chip lives inside the scale wrapper (sibling of the
            tilt wrapper) so it grows with the cover on hover, but
            outside the tilt so the triangle icon stays facing forward
            instead of skewing under cursor movement. */}
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

      {children}
    </Link>
  );
}
