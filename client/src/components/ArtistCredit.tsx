import { useNavigate } from 'react-router-dom';
import type { ArtistCreditEntry } from '../types';
import { artistLensTo } from '../utils/lens';

/**
 * Renders an album's artist credit as a list of clickable names
 * separated by ", ". Each name opens the /dig artist lens scoped to
 * that name — a filtered catalog view of that artist's albums. (This
 * used to open a search overlay as a stand-in; the lens replaced it.)
 * Note the lens matches on albums.artist_name exactly, so for a
 * multi-artist credit, clicking one member only finds albums where
 * that member is the sole credited artist — the accepted text-match
 * tradeoff until artist_mbid matching lands.
 *
 * Pass `credit` whenever it's available (server populates it on
 * fresh-fetched albums and lazily backfills legacy rows). When
 * `credit` is empty or undefined, falls back to rendering the
 * single `fallback` string as one clickable name. Once every album
 * row has structured credit the fallback can come out.
 */
export default function ArtistCredit({
  credit,
  fallback,
  className,
}: {
  credit?: ArtistCreditEntry[] | null;
  fallback?: string | null;
  /** Caller-supplied utility classes for the wrapping element.
   *  Each name re-uses the same classes so the appearance is
   *  identical across multi- and single-artist albums; the wrapper
   *  itself only carries layout (inline-flex, gap). */
  className?: string;
}) {
  const navigate = useNavigate();
  const entries: ArtistCreditEntry[] =
    credit && credit.length > 0
      ? credit
      : fallback && fallback.trim().length > 0
        ? [{ name: fallback, mbid: null }]
        : [];

  if (entries.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-baseline">
      {entries.map((entry, i) => (
        <span key={`${entry.name}-${entry.mbid ?? i}`}>
          <button
            type="button"
            onClick={() => navigate(artistLensTo(entry.name))}
            className={className ?? 'hover:underline cursor-pointer'}
          >
            {entry.name}
          </button>
          {i < entries.length - 1 && (
            <span className="mr-1 select-none">,</span>
          )}
        </span>
      ))}
    </span>
  );
}
