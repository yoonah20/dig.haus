import { Link } from 'react-router-dom';
import CoverArt from '../CoverArt';
import { resolveApiUrl } from '../../utils/apiUrl';
import { formatRelativeKo } from '../../utils/relativeTime';
import type { HomeSnapshot } from '../../hooks/useHomeSnapshots';

// Compact teaser: five cover thumbnails plus a slim "+N" trailing
// chip when the snapshot has more than five albums (for a full
// 15-album wall that's "+10"). The overflow chip is half the width
// of a cover cell so it reads as a counter rather than another
// slot competing with the covers. Cards of five or fewer albums
// get an empty slim cell to keep the row baseline consistent.
const ROW_LENGTH = 6;
const VISIBLE_COVERS = 5;
// Grid template. Covers take `1fr` each, the trailing overflow
// chip takes `0.5fr` — narrower so it doesn't register as another
// cover, freeing a bit of horizontal room inside the card.
const GRID_TEMPLATE = `repeat(${VISIBLE_COVERS}, minmax(0, 1fr)) minmax(0, 0.5fr)`;

export default function SnapshotCard({ snap }: { snap: HomeSnapshot }) {
  const avatar = resolveApiUrl(snap.user.avatarUrl) ?? null;
  const displayName = snap.user.displayName || snap.user.username;
  // Items come sorted by position. Skip any null entries (albums
  // that were deleted after the snapshot was captured) so the
  // overflow count reflects actual clickable content, not
  // placeholders.
  const filledItems = snap.items.filter((it) => it.album != null);
  const total = filledItems.length;
  const visible = filledItems.slice(0, VISIBLE_COVERS);
  const overflow = total - VISIBLE_COVERS;
  const showOverflow = overflow > 0;
  const relative = formatRelativeKo(snap.createdAt);

  return (
    <Link
      to={`/my/${snap.user.username}/snap/${snap.slug}`}
      className="block rounded-lg border border-white/5 bg-[#110b04]/60 p-2 hover:border-[#e8a020]/40 transition-colors"
    >
      <div
        className="grid gap-0.5 mb-[6px] items-center"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        {Array.from({ length: ROW_LENGTH }, (_, i) => {
          // Cell 5 (the sixth): "+{overflow}" when the wall holds
          // more than 5 items; blank for walls of exactly 5 or
          // fewer. Cells 0-4 render covers (or blank when the wall
          // has fewer than 5 items).
          if (i === VISIBLE_COVERS) {
            if (showOverflow) {
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
            return (
              <div
                key={i}
                className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden"
              />
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
      {/* Compact footer — avatar + snapshot name + relative time on
          one line. Display-name label was dropped (avatar carries
          identity + aria-label for screen readers); relative time
          came back after taking it out made the footer feel empty. */}
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
        <div className="text-[10px] text-gray-500 shrink-0 tabular-nums">
          {relative}
        </div>
      </div>
    </Link>
  );
}
