import { Link } from 'react-router-dom';
import CoverArt from '../CoverArt';
import { useUserReviewsFeed, type UserReviewFeedItem } from '../../hooks/useUserReviewsFeed';
import { resolveApiUrl } from '../../utils/apiUrl';

// Seconds each item is visible during one scroll pass — higher = slower.
// Tuned so a reader can finish a 50자 평 without needing to hover-pause,
// but not so slow that the motion feels dead.
const SECONDS_PER_ITEM = 5;

// Fixed width per ticker card so the CSS marquee math stays clean — the
// track's total width is predictable and translateX(-50%) lands the
// duplicate tail exactly where the head started.
const ITEM_WIDTH_PX = 320;
const ITEM_GAP_PX = 12;

const RATING_EMOJI: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = (Date.now() - d.getTime()) / 1000;
  if (diffSec < 60) return '방금';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function Avatar({
  src,
  name,
  size,
}: {
  src: string | null;
  name: string | null;
  size: number;
}) {
  const resolved = resolveApiUrl(src);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        aria-hidden
        className="rounded-full object-cover shrink-0 border border-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center shrink-0 border border-white/10 font-semibold"
      style={{ width: size, height: size, fontSize: Math.max(size * 0.5, 10) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function TickerItem({ item }: { item: UserReviewFeedItem }) {
  const ratingEmoji = item.rating ? RATING_EMOJI[item.rating] : null;
  const isAnon = item.userId == null;

  return (
    <Link
      to={`/album/${item.albumSlug}`}
      className="group shrink-0 block bg-[#1d140a] border border-[#e8a020]/15 rounded-2xl p-3 hover:border-[#e8a020]/40 hover:bg-[#221809] transition-colors cursor-pointer"
      style={{ width: ITEM_WIDTH_PX }}
      // Album identity is intentionally *not* in the visible UI — that's
      // the point of the blurred cover ("저건 어떤 앨범일까?"). But screen
      // readers and titles need it so nav isn't a black box for everyone.
      title={`${item.albumArtist ?? ''} — ${item.albumTitle} 로 이동`}
      aria-label={`${item.userName || '익명'}의 50자 평: ${item.body}. ${item.albumArtist ?? ''} — ${item.albumTitle} 로 이동`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {/* Blurred album cover — the "mystery" hook. filter: blur must
            stay on an inner element so the card's border/radius stays
            crisp. overflow-hidden clips the blur's soft edge back to the
            cover's square. */}
        <div className="shrink-0 w-14 h-14 rounded-md overflow-hidden bg-[#252525] relative">
          <div
            className="w-full h-full"
            style={{ filter: 'blur(10px) saturate(1.2)', transform: 'scale(1.15)' }}
            aria-hidden
          >
            <CoverArt
              src={item.albumCoverUrl}
              fallbacks={item.albumCoverFallbacks}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
          {/* Subtle question-mark hint in the center of the blur so
              totally-black covers still read as "something is hidden"
              rather than dead space. Not shown on hover so the visual
              grows less mysterious as you intend to click. */}
          <div
            className="absolute inset-0 flex items-center justify-center text-xl text-white/40 font-serif pointer-events-none group-hover:opacity-0 transition-opacity"
            aria-hidden
          >
            ?
          </div>
        </div>

        {/* Right column: speech bubble + user credit */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <p className="text-gray-100 text-sm leading-snug line-clamp-2 break-words">
            {item.body}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
            <Avatar src={item.userAvatar} name={item.userName} size={16} />
            <span
              className={`truncate ${isAnon ? 'italic text-gray-600' : 'text-gray-400'}`}
            >
              {isAnon ? '탈퇴한 사용자' : item.userName || '익명'}
            </span>
            <span className="text-gray-700">·</span>
            <span className="shrink-0">{formatRelativeTime(item.createdAt)}</span>
            {ratingEmoji && (
              <span className="ml-auto shrink-0" aria-hidden>
                {ratingEmoji}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function CommentTicker() {
  const { data } = useUserReviewsFeed();
  const items = data?.items ?? [];

  // Nothing to show — hide the section entirely so we don't leave a
  // hollow gap between the grid and the pagination.
  if (items.length === 0) return null;

  // Duration scales with content so a longer queue doesn't zoom past.
  // Track is doubled for the seamless-loop trick, so the real travel is
  // one copy's width — SECONDS_PER_ITEM × items.length matches that.
  const durationSec = Math.max(20, items.length * SECONDS_PER_ITEM);

  return (
    <section className="comment-ticker mt-14 relative" aria-label="최근 50자 평">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-lg md:text-xl font-serif text-white">듣고 어땠어?</h2>
        <span className="text-xs text-gray-500">
          유저들이 남긴 최근 50자 평 · 커버 맞혀 보고 눌러보세요
        </span>
      </div>

      {/* Outer wrapper owns the fade masks so content slides in/out of
          the gutters gracefully instead of appearing/vanishing at a hard
          edge. The track itself sits inside and animates freely. */}
      <div
        className="relative overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
        }}
      >
        <div
          className="comment-ticker-track flex w-max"
          style={{
            gap: `${ITEM_GAP_PX}px`,
            animationDuration: `${durationSec}s`,
          }}
        >
          {items.map((item) => (
            <TickerItem key={item.id} item={item} />
          ))}
          {/* Duplicate for the seamless loop. aria-hidden so SR users
              don't read each comment twice. */}
          {items.map((item) => (
            <div key={`dup-${item.id}`} aria-hidden>
              <TickerItem item={item} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
