import {
  clearNowPlaying,
  extractSpotifyAlbumId,
  setNowPlaying,
  useNowPlaying,
} from '../hooks/useNowPlaying';

// Shared ▶ chip for every surface that shows an album cover and
// can hand off playback to the persistent Spotify player. Self-
// contained: reads the now-playing store to detect "am I the one
// currently playing?", dispatches set/clear on click, stops event
// propagation so the enclosing <Link> (album cover → detail page)
// doesn't fire on chip click.
//
// Returns null when the album has no resolvable Spotify album id —
// without a URL there's nothing for the embed to play, so the chip
// quietly hides rather than presenting a disabled button.
//
// Visual: a compact white-tinted circle positioned bottom-right of
// the parent. Positioning assumes the parent is `relative`. For
// surfaces that want the chip always visible (home grid), pass
// `alwaysVisible`; otherwise it fades in on the parent's
// `group-hover/cover` or `group-hover` state.
// Hover-reveal class strings. These have to exist as literal
// strings in source so Tailwind's JIT can detect and emit them —
// interpolating `${hoverGroup}:opacity-100` at render time would
// produce a class name the build step never sees, leaving the
// chip invisible in production. One entry per known parent
// `group/<name>` used around the app.
//
// The unscoped `group-hover` entry also reveals on
// `group-data-[tap-active=true]` so WallHoverCard's tap-to-
// activate gesture (touch devices) shows the chip alongside
// the scale-up — visitors on iPad / phones can hit play
// without first having to tap into the album detail page.
const HOVER_VISIBILITY: Record<string, string> = {
  'group-hover':
    'opacity-0 group-hover:opacity-100 group-data-[tap-active=true]:opacity-100',
  'group-hover/cover': 'opacity-0 group-hover/cover:opacity-100',
  'group-hover/card': 'opacity-0 group-hover/card:opacity-100',
};

interface PlayChipProps {
  albumMbid: string;
  spotifyUrl: string | null | undefined;
  title: string;
  artist: string;
  /** Visual diameter in px. Default 29 (≈80% of the previous 36)
   *  suits ~150–250px covers at a less-dominant footprint. */
  size?: number;
  /** When true, chip is always visible (no hover gate). Used when
   *  the parent handles visibility itself — e.g. AlbumCard's back
   *  face is only rendered post-flip, so chip doesn't need another
   *  hover trigger. */
  alwaysVisible?: boolean;
  /** Hover group selector — defaults to Tailwind's unscoped
   *  `group-hover`. Parents using a scoped group name (e.g.
   *  `group/cover`) pass the matching selector here so the chip
   *  reveals only on the right hover target. Must be one of the
   *  keys in HOVER_VISIBILITY above. */
  hoverGroup?: keyof typeof HOVER_VISIBILITY;
  /** Extra positioning — bottom-right by default. Caller can
   *  override via inline style if a cover has different insets. */
  className?: string;
  style?: React.CSSProperties;
}

export default function PlayChip({
  albumMbid,
  spotifyUrl,
  title,
  artist,
  size = 29,
  alwaysVisible = false,
  hoverGroup = 'group-hover',
  className = '',
  style,
}: PlayChipProps) {
  const spotifyAlbumId = extractSpotifyAlbumId(spotifyUrl ?? null);
  const currentlyPlaying = useNowPlaying();
  const isPlaying = currentlyPlaying?.albumMbid === albumMbid;

  if (!spotifyAlbumId) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPlaying) {
      clearNowPlaying();
    } else {
      setNowPlaying({
        albumMbid,
        spotifyUrl: spotifyUrl!,
        title,
        artist,
      });
    }
  };

  const iconSize = Math.round(size * 0.42);
  const visibility =
    alwaysVisible || isPlaying
      ? 'opacity-100'
      : HOVER_VISIBILITY[hoverGroup] ?? HOVER_VISIBILITY['group-hover'];

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={
        isPlaying ? `${title} 재생 정지` : `${title} 미리듣기`
      }
      title={isPlaying ? '정지' : `${title} · 미리듣기`}
      style={{
        width: size,
        height: size,
        right: '6%',
        bottom: '6%',
        ...style,
      }}
      className={`absolute z-20 rounded-full bg-[#141008]/85 border-2 border-[#e8a020] text-[#e8a020] hover:bg-[#e8a020] hover:text-[#141008] flex items-center justify-center shadow-[0_6px_20px_rgba(0,0,0,0.55)] transition-all duration-200 cursor-pointer ${visibility} ${className}`}
    >
      {isPlaying ? (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 12 12"
          aria-hidden
        >
          <rect x="3" y="2.5" width="2.2" height="7" fill="currentColor" rx="0.5" />
          <rect x="6.8" y="2.5" width="2.2" height="7" fill="currentColor" rx="0.5" />
        </svg>
      ) : (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 12 12"
          aria-hidden
        >
          {/* Triangle x-offset so its optical centre aligns with
              the circle's geometric centre. */}
          <path d="M3.8 2 L9.6 6 L3.8 10 Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
