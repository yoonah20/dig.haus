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
interface PlayChipProps {
  albumMbid: string;
  spotifyUrl: string | null | undefined;
  title: string;
  artist: string;
  /** Visual diameter in px. Default 36 suits ~150–250px covers. */
  size?: number;
  /** When true, chip is always visible (no hover gate). Used on
   *  home grid covers where hover already does other things. */
  alwaysVisible?: boolean;
  /** Hover group selector — defaults to the Tailwind default
   *  `group-hover:`. If the parent uses a scoped group name (e.g.
   *  `group/cover`), pass that selector (e.g. `group-hover/cover:`)
   *  so the chip reveals only on the right hover target. */
  hoverGroup?: string;
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
  size = 36,
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
      : `opacity-0 ${hoverGroup}:opacity-100`;

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
      className={`absolute z-20 rounded-full bg-white/90 border border-white/60 text-[#141008] flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.45)] hover:bg-white transition-opacity duration-200 cursor-pointer ${visibility} ${className}`}
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
