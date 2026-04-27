import type { ArtistCreditEntry } from '../types';
import { useSearchOverlay } from '../contexts/SearchOverlayContext';

/**
 * Renders an album's artist credit as a list of clickable names
 * separated by ", ". Each name opens the search overlay scoped to
 * that artist — there's no per-artist page yet (entry 2 in the
 * post-Phase 3 roadmap), so a search-results view stands in as the
 * "all participations of X" surface for now.
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
  const { openOverlay } = useSearchOverlay();
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
            onClick={() => openOverlay(entry.name)}
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
