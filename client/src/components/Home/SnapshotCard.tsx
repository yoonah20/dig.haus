import { Link } from 'react-router-dom';
import CoverArt from '../CoverArt';
import { resolveApiUrl } from '../../utils/apiUrl';
import type { HomeSnapshot } from '../../hooks/useHomeSnapshots';

// Compact teaser: a single row of 5 cells instead of the full 5×3
// mini-wall. Cells 0-3 show the first four cover thumbnails, cell 4
// either shows the fifth cover (for walls of exactly 5) or a "+N"
// counter for the remaining albums (for walls of >5). The earlier
// full mosaic put a lot of thumbnails in every rail card, which
// added up to a visually busy rail that competed with the main
// album grid. One row + overflow count reads as a curated preview
// rather than a mini dump of the whole wall.
const ROW_LENGTH = 5;

export default function SnapshotCard({ snap }: { snap: HomeSnapshot }) {
  const avatar = resolveApiUrl(snap.user.avatarUrl) ?? null;
  const displayName = snap.user.displayName || snap.user.username;
  // Items come sorted by position. Pick up to the first 5 that
  // actually carry an album (skipping any null entries from
  // deleted albums). The overflow count excludes those same nulls
  // so "+11" reflects real albums the visitor could click through
  // to, not placeholders.
  const filledItems = snap.items.filter((it) => it.album != null);
  const visible = filledItems.slice(0, ROW_LENGTH);
  const overflow = filledItems.length - ROW_LENGTH;
  const showOverflow = overflow > 0;

  return (
    <Link
      to={`/my/${snap.user.username}/snap/${snap.slug}`}
      className="block rounded-lg border border-white/5 bg-[#110b04] p-2 hover:border-[#e8a020]/40 transition-colors"
    >
      <div
        className="grid gap-0.5 mb-2"
        style={{ gridTemplateColumns: `repeat(${ROW_LENGTH}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: ROW_LENGTH }, (_, i) => {
          // Last cell is an overflow marker whenever filled count
          // exceeds 5. Otherwise cell i shows visible[i], or an
          // empty dark cell if the snapshot has fewer than 5 items.
          const isLast = i === ROW_LENGTH - 1;
          if (isLast && showOverflow) {
            return (
              <div
                key={i}
                className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden flex items-center justify-center text-[11px] font-medium text-[#c9a060] tabular-nums"
                aria-label={`${overflow}개 더`}
              >
                +{overflow}
              </div>
            );
          }
          const item = visible[i];
          return (
            <div
              key={i}
              className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden"
            >
              {item?.album?.coverArtUrl && (
                <CoverArt
                  src={item.album.coverArtUrl}
                  fallbacks={item.album.coverArtFallbacks}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Compact footer — avatar + snapshot name only. Display name
          and relative-time text used to sit here too, but the
          homepage already has a dense grid + rail; adding three
          text lines per card made the whole page feel noisy.
          Visual identity still comes through via the avatar. */}
      <div className="flex items-center gap-2 min-w-0">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="w-5 h-5 rounded-full object-cover shrink-0 border border-white/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-5 h-5 rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center shrink-0 border border-white/10 text-[10px] font-semibold"
            aria-hidden
          >
            {(displayName || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0 text-[12px] text-gray-200 truncate">
          {snap.name}
        </div>
      </div>
    </Link>
  );
}
