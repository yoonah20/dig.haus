import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import CoverArt from '../CoverArt';
import { useUserReviewsFeed, type UserReviewFeedItem } from '../../hooks/useUserReviewsFeed';
import { resolveApiUrl } from '../../utils/apiUrl';

// Seconds each item is visible during one scroll pass — higher = slower.
const SECONDS_PER_ITEM = 7;

// Fixed width per ticker card so the CSS marquee math stays clean — the
// track's total width is predictable and translateX(-50%) lands the
// duplicate tail exactly where the head started.
const ITEM_WIDTH_PX = 320;
const ITEM_GAP_PX = 16;

const RATING_EMOJI: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

// Per-rating tint for the speech bubble. Values are kept low-saturation
// so a long queue of 굿굿 cards doesn't feel like a yellow wall — the
// tint is just enough to scan the ratio at a glance. Border colours
// also drive the tail outline via --tail-border so the tail matches the
// bubble as the rating cycles.
const BUBBLE_THEME: Record<
  'up' | 'down' | 'soso' | 'none',
  { bg: string; border: string }
> = {
  up: { bg: 'rgba(232, 160, 32, 0.10)', border: 'rgba(232, 160, 32, 0.35)' },
  down: { bg: 'rgba(74, 90, 110, 0.16)', border: 'rgba(120, 140, 165, 0.35)' },
  soso: { bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.18)' },
  none: { bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.18)' },
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

// Any CJK char (Hangul / Kana / Han) in the display name — used to pick
// a narrower max-width for CJK names (since each glyph is ~em-wide)
// and a looser one for Latin names (much narrower per-glyph, so 8–10
// chars still fit on one line without forcing weird 4-char wraps).
const CJK_RE = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

function TickerItem({ item }: { item: UserReviewFeedItem }) {
  const isAnon = item.userId == null;
  const displayName = isAnon ? '탈퇴한 사용자' : item.userName || '익명';
  const isCjk = CJK_RE.test(displayName);
  const themeKey = item.rating ?? 'none';
  const theme = BUBBLE_THEME[themeKey];
  const ratingEmoji = item.rating ? RATING_EMOJI[item.rating] : null;
  const feelingEmoji = item.emoji;
  const hasBadges = !!(ratingEmoji || feelingEmoji);

  const bubbleStyle = {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    // Consumed by .bubble-tail::before/::after so the tail picks up the
    // same fill and outline as the bubble it leaks from.
    ['--tail-fill' as string]: theme.bg,
    ['--tail-border' as string]: theme.border,
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
      {/* Left column — avatar + display name. pt-1 puts the avatar
          centre at the same y as the bubble's tail (tail centre is
          hard-coded at y≈30 in index.css, which matches a 52px avatar
          with pt-1). Column width is locked to the avatar's footprint
          (52 + 2px padding each side) so the avatar's right edge sits
          flush against the gap, leaving the bubble tail tip flush
          against the avatar. Names longer than ~5 Korean chars wrap to
          2 lines before ellipsis. */}
      <div className="flex flex-col items-center gap-1.5 shrink-0 pt-1 w-[56px]">
        <Avatar src={item.userAvatar} name={item.userName} size={52} />
        <span
          // max-width is conditional: CJK glyphs are ~em-wide, so
          // 44px caps each line at ~4 chars (파이어리/핑크페퍼). Latin
          // glyphs at the same font size are ~half that, so 64px still
          // fits 8–10 letters on a single line (keeps 'dethrock' intact
          // instead of chopping the trailing 'k' to a new line).
          // break-all on both so long CJK wraps at glyph boundaries and
          // long Latin wraps mid-word rather than pushing into the
          // bubble. The span happily overflows the 56px column by a
          // few pixels — the overlap lands in the gutter between
          // column and bubble (below the tail's vertical band) so
          // nothing is hit.
          className={`text-[11px] text-center leading-tight line-clamp-2 break-all ${
            isCjk ? 'max-w-[44px]' : 'max-w-[64px]'
          } ${isAnon ? 'italic text-gray-600' : 'text-gray-400'}`}
        >
          {displayName}
        </span>
      </div>

      {/* Speech bubble — body on the left (flex-1), blurred cover
          attached on the right inside the same bubble. Padding is
          tighter now that the emoji badges sit above the bubble. */}
      <div
        className="bubble-tail flex-1 min-w-0 flex items-center gap-3 rounded-2xl border px-3 py-2.5 min-h-[64px] group-hover:border-[#e8a020]/50 transition-colors"
        style={bubbleStyle}
      >
        {/* Emoji badges — overlap the bubble's top-right edge, same
            pattern as the 50자 평 cards on the album detail page so
            the two surfaces feel like they're speaking the same
            visual language. */}
        {hasBadges && (
          <div
            // right-1 pulls the second badge almost flush with the
            // card's top-right corner — the "peeking over the edge"
            // look the user wanted vs. right-3 which sat well inside
            // the padding.
            className="absolute -top-3 right-1 z-10 flex items-center gap-1 pointer-events-none select-none"
            aria-hidden
          >
            {ratingEmoji && (
              <span className="text-lg leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]">
                {ratingEmoji}
              </span>
            )}
            {feelingEmoji && (
              <span className="text-xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]">
                {feelingEmoji}
              </span>
            )}
          </div>
        )}

        <p className="flex-1 min-w-0 text-gray-100 text-[13px] leading-snug line-clamp-3 break-words">
          {item.body}
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
    // No visible heading — the ticker speaks for itself below the
    // pagination nav. aria-label keeps it announced for SR users.
    // pt-8 to visually separate from the pagination; pb-2 keeps the
    // emoji overhang from touching the next section.
    <section className="comment-ticker relative pt-8 pb-2" aria-label="최근 50자 평">
      {/* Outer wrapper owns the fade masks so content slides in/out of
          the gutters gracefully instead of appearing/vanishing at a hard
          edge. Padding top leaves room for emoji badges that overlap
          the bubble's top edge. */}
      <div
        className="relative overflow-hidden pt-3"
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
