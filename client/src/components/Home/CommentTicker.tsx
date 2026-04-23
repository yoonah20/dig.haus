import { Link } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';
import CoverArt from '../CoverArt';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../../hooks/useUserReviewsFeed';
import { resolveApiUrl } from '../../utils/apiUrl';
import { parseServerTimestamp } from '../../utils/relativeTime';

const DAY_MS = 24 * 60 * 60 * 1000;

function isFresh(createdAt: string): boolean {
  const ts = parseServerTimestamp(createdAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < DAY_MS;
}

// Seconds each item is visible during one scroll pass — higher = slower.
const SECONDS_PER_ITEM = 5.5;

// Upper bound on a ticker card's width. Cards size to content (body
// wraps to fit), but we cap the maximum so a long 50자 평 wraps to 2–3
// lines rather than sprawling in a single very wide row. Mobile
// (fullWidth) ignores this cap and uses the viewport width instead.
const MAX_ITEM_WIDTH_PX = 370;
const ITEM_GAP_PX = 16;

const RATING_EMOJI: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

// All bubbles share one neutral theme regardless of the rating — the
// per-rating 👍 / 🤷 / 👎 badge in the top-right is already doing the
// work of flagging sentiment. Tinting the background per rating on
// top of that read as visually busy (esp. the amber 'up' against the
// page's amber accents). Kept as named CSS vars so the tail picks up
// the same fill / outline the bubble uses.
const BUBBLE_BG = 'rgba(255, 255, 255, 0.04)';
const BUBBLE_BORDER = 'rgba(255, 255, 255, 0.18)';
const BUBBLE_STYLE = {
  backgroundColor: BUBBLE_BG,
  borderColor: BUBBLE_BORDER,
  ['--tail-fill' as string]: BUBBLE_BG,
  ['--tail-border' as string]: BUBBLE_BORDER,
} as CSSProperties;

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
  // Runtime fallback: if the <img> 404s (e.g. a custom avatar whose file
  // was lost from the volume but whose URL still lives in the DB), swap
  // to the initial-letter placeholder instead of showing the broken-image
  // icon. Reset on src change so a successful re-upload can recover.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (resolved && !failed) {
    return (
      <img
        src={resolved}
        alt=""
        aria-hidden
        className="rounded-full object-cover shrink-0 border border-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
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


export function TickerItem({
  item,
  fullWidth = false,
  orientation = 'left',
}: {
  item: UserReviewFeedItem;
  fullWidth?: boolean;
  /** 'left' (default) = avatar on the left, tail points left.
   *  'right' = mirrored: avatar on the right, tail points right.
   *  Used in the mobile feed to alternate rows for visual rhythm. */
  orientation?: 'left' | 'right';
}) {
  const isAnon = item.userId == null;
  const displayName = isAnon ? '탈퇴한 사용자' : item.userName || '익명';
  const ratingEmoji = item.rating ? RATING_EMOJI[item.rating] : null;
  const feelingEmoji = item.emoji;
  const hasBadges = !!(ratingEmoji || feelingEmoji);
  const reversed = orientation === 'right';
  const fresh = isFresh(item.createdAt);

  return (
    <Link
      to={`/album/${item.albumSlug}`}
      // `group` drives the hover de-blur on the cover. No `title` attr —
      // browsers would render it as a tooltip revealing the album name,
      // which defeats the "저건 어떤 앨범일까?" mystery. Album identity
      // still lives in aria-label for screen readers.
      // fullWidth mode (mobile feed) drops the fixed 320px width so the
      // card stretches edge-to-edge; the scrolling marquee keeps its
      // fixed width for seamless-loop math.
      className={`group flex items-start gap-3 ${fullWidth ? '' : 'shrink-0'} ${reversed ? 'flex-row-reverse' : ''}`}
      style={fullWidth ? undefined : { maxWidth: MAX_ITEM_WIDTH_PX }}
      aria-label={`${displayName}의 50자 평: ${item.body}. ${item.albumArtist ?? ''} — ${item.albumTitle} 로 이동`}
    >
      {/* Left column — just the avatar. The display-name label
          underneath used to sit here too, but once the home page
          gained a dense grid + activity rail the extra text per
          ticker card read as noise. Identity still comes through
          the avatar image; aria-label keeps the name available to
          screen readers. Column width stays 56px so the bubble
          tail's hard-coded y≈30 (index.css) still aligns with the
          avatar's vertical center. */}
      <div className="flex flex-col items-center shrink-0 pt-1 w-[56px]">
        <Avatar src={item.userAvatar} name={item.userName} size={52} />
      </div>

      {/* Speech bubble — body on the left (flex-1), blurred cover
          attached on the right inside the same bubble. When reversed,
          inner order flips too so the cover hugs the bubble edge
          opposite the avatar. `.bubble-fresh` kicks in for 50자 평
          posted within the last 24h so the glow draws the eye. */}
      <div
        className={`${reversed ? 'bubble-tail-right flex-row-reverse' : 'bubble-tail'} ${
          fresh ? 'bubble-fresh' : ''
        } flex-1 min-w-0 flex items-center gap-1.5 rounded-2xl border px-3 py-2.5 min-h-[64px] group-hover:border-[#e8a020]/50 transition-colors`}
        style={BUBBLE_STYLE}
      >
        {/* Body with trailing rating + feeling emojis — the 50자 cap
            combined with the card's max-width means the text wraps to
            ≤3 lines naturally, so no line-clamp is needed and nothing
            gets truncated. The emojis sit at the end of the text
            (whitespace-nowrap keeps them glued to the final word and
            to each other) so they read as punctuation rather than a
            separate badge. */}
        <p className="flex-1 min-w-0 text-gray-100 text-[13px] leading-snug break-words">
          {item.body}
          {hasBadges && (
            <span className="whitespace-nowrap" aria-hidden>
              {' '}
              {ratingEmoji && <span className="leading-none">{ratingEmoji}</span>}
              {feelingEmoji && <span className="leading-none">{feelingEmoji}</span>}
            </span>
          )}
        </p>
        {/* Blurred cover — the mystery. Default blur shows shape and
            palette but no detail; hover lifts most of the blur so the
            viewer can almost-but-not-quite guess. scale(1.12) keeps the
            blur's soft edge from leaking past the card's rounded
            corners. */}
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
  // hollow gap in the page flow.
  if (items.length === 0) return null;

  // Duration scales with content so a longer queue doesn't zoom past.
  // Track is doubled for the seamless-loop trick, so the real travel is
  // one copy's width — SECONDS_PER_ITEM × items.length matches that.
  const durationSec = Math.max(30, items.length * SECONDS_PER_ITEM);

  return (
    // Below the album grid. aria-label keeps it announced for SR users.
    // pt-12 for visual separation from the pagination above; the
    // marquee itself handles its own horizontal fade.
    <section className="comment-ticker relative pt-12" aria-label="최근 50자 평">
      {/* Outer wrapper owns the fade masks so content slides in/out of
          the gutters gracefully instead of appearing/vanishing at a
          hard edge. */}
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
