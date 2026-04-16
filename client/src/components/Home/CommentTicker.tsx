import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import CoverArt from '../CoverArt';
import { useUserReviewsFeed, type UserReviewFeedItem } from '../../hooks/useUserReviewsFeed';
import { resolveApiUrl } from '../../utils/apiUrl';

// Seconds each item is visible during one scroll pass — higher = slower.
// Tuned for comfortable reading: fast enough to feel alive, slow enough
// that you can finish a 50자 평 without having to hover-pause.
const SECONDS_PER_ITEM = 7;

// Fixed width per ticker card so the CSS marquee math stays clean — the
// track's total width is predictable and translateX(-50%) lands the
// duplicate tail exactly where the head started.
const ITEM_WIDTH_PX = 340;
const ITEM_GAP_PX = 16;

const RATING_EMOJI: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

// Per-rating tint for the speech bubble. Values are kept low-saturation
// so a long queue of 굿굿 cards doesn't feel like a yellow wall — the
// tint is just enough to scan the ratio at a glance.
const BUBBLE_THEME: Record<
  'up' | 'down' | 'soso' | 'none',
  { bg: string; border: string }
> = {
  up: { bg: 'rgba(232, 160, 32, 0.10)', border: 'rgba(232, 160, 32, 0.30)' },
  down: { bg: 'rgba(74, 90, 110, 0.16)', border: 'rgba(120, 140, 165, 0.28)' },
  soso: { bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.12)' },
  none: { bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.12)' },
};

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
      style={{ width: size, height: size, fontSize: Math.max(size * 0.4, 14) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function TickerItem({ item }: { item: UserReviewFeedItem }) {
  const isAnon = item.userId == null;
  const displayName = isAnon ? '탈퇴한 사용자' : item.userName || '익명';
  const themeKey = item.rating ?? 'none';
  const theme = BUBBLE_THEME[themeKey];
  const ratingEmoji = item.rating ? RATING_EMOJI[item.rating] : null;
  const feelingEmoji = item.emoji;
  const bubbleStyle = {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    // Consumed by .bubble-tail::before so the tail paints the same fill
    // as the bubble it leaks from. Using the variable (vs. a second
    // prop) keeps rating→colour logic in a single place.
    ['--tail-fill' as string]: theme.bg,
  } as CSSProperties;

  return (
    <Link
      to={`/album/${item.albumSlug}`}
      // `group` drives the hover de-blur on the cover. No `title` attr —
      // browsers would render it as a tooltip revealing the album name,
      // which defeats the "저건 어떤 앨범일까?" mystery. Album identity
      // still lives in aria-label for screen readers.
      className="group shrink-0 flex items-start gap-3"
      style={{ width: ITEM_WIDTH_PX }}
      aria-label={`${displayName}의 50자 평: ${item.body}. ${item.albumArtist ?? ''} — ${item.albumTitle} 로 이동`}
    >
      {/* Left column — avatar + 2 emojis stacked below. The whole column
          is the "speaker" anchor; the bubble's tail points at the
          avatar centre. */}
      <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
        {/* Wrapper span carries the title tooltip so only the avatar
            surfaces the username on hover (the bubble/cover do not). */}
        <span className="block" title={displayName}>
          <Avatar src={item.userAvatar} name={item.userName} size={52} />
        </span>
        {(ratingEmoji || feelingEmoji) && (
          <div className="flex items-center justify-center gap-1 leading-none" aria-hidden>
            {ratingEmoji && <span className="text-base">{ratingEmoji}</span>}
            {feelingEmoji && <span className="text-base">{feelingEmoji}</span>}
          </div>
        )}
      </div>

      {/* Speech bubble — body on the left (flex-1), blurred cover
          attached on the right inside the same bubble. Rating tint +
          tail colour come from the inline style + CSS variable. */}
      <div
        className="bubble-tail flex-1 min-w-0 flex items-center gap-3 rounded-2xl border px-3.5 py-3 min-h-[76px] group-hover:border-[#e8a020]/50 transition-colors"
        style={bubbleStyle}
      >
        <p className="flex-1 min-w-0 text-gray-100 text-sm leading-snug line-clamp-3 break-words">
          {item.body}
        </p>
        {/* Blurred cover — the mystery. Default blur is light enough
            that shape/colour are visible; hover pulls most (not all) of
            the blur off so the user can almost-but-not-quite guess.
            scale(1.12) stops the blur's soft edge from leaking past the
            card's rounded corners. */}
        <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden bg-[#252525] ring-1 ring-white/10">
          <div
            className="w-full h-full scale-[1.12] blur-[4px] saturate-[1.3] group-hover:blur-[1.5px] transition-[filter] duration-300"
            aria-hidden
          >
            <CoverArt
              src={item.albumCoverUrl}
              fallbacks={item.albumCoverFallbacks}
              alt=""
              className="w-full h-full object-cover"
            />
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
  const durationSec = Math.max(30, items.length * SECONDS_PER_ITEM);

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
