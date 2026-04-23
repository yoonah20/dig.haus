import { Link } from 'react-router-dom';
import CoverArt from '../CoverArt';
import { resolveApiUrl } from '../../utils/apiUrl';
import { formatRelativeKo } from '../../utils/relativeTime';
import type { HomeSnapshot } from '../../hooks/useHomeSnapshots';

// The live wall renders as 15 slots in a 5-5-5 row layout
// (see VinylWallEditor's WALL_ROW_SIZES). The card's mosaic
// mirrors that shape exactly — a snapshot of N<15 items leaves
// the remaining positions as empty dark cells so the grid still
// reads as "a wall" rather than a tight cover pack. Matching
// positions (not compacting) also preserves the owner's
// composition when visitors glance at the card.
const WALL_TOTAL = 15;
const WALL_COLS = 5;

export default function SnapshotCard({ snap }: { snap: HomeSnapshot }) {
  const byPosition = new Map(snap.items.map((it) => [it.position, it]));
  const avatar = resolveApiUrl(snap.user.avatarUrl) ?? null;
  const displayName = snap.user.displayName || snap.user.username;
  const relative = formatRelativeKo(snap.createdAt);

  return (
    <Link
      to={`/my/${snap.user.username}/snap/${snap.slug}`}
      className="block rounded-lg border border-white/5 bg-[#110b04] p-2 hover:border-[#e8a020]/40 transition-colors"
    >
      <div
        className="grid gap-0.5 mb-2"
        style={{ gridTemplateColumns: `repeat(${WALL_COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: WALL_TOTAL }, (_, i) => {
          const item = byPosition.get(i);
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
      <div className="flex items-center gap-2 min-w-0">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="w-6 h-6 rounded-full object-cover shrink-0 border border-white/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-6 h-6 rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center shrink-0 border border-white/10 text-[11px] font-semibold"
            aria-hidden
          >
            {(displayName || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-gray-200 truncate">{snap.name}</div>
          <div className="text-[10px] text-gray-500 truncate">
            {displayName}
          </div>
        </div>
        <div className="text-[10px] text-gray-500 shrink-0">{relative}</div>
      </div>
    </Link>
  );
}
