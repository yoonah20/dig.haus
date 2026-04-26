import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import HomeNextHero from '../components/Home/HomeNextHero';
import AlbumCard from '../components/AlbumCard';
import {
  useHomeSnapshots,
  type HomeSnapshot,
} from '../hooks/useHomeSnapshots';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import CoverArt from '../components/CoverArt';
import { useDocumentHead } from '../hooks/useDocumentHead';
import { resolveApiUrl } from '../utils/apiUrl';
import type { AlbumSearchResult } from '../types';

// HomeNext is a scratch composition for the next iteration of /. The
// live home is a single-viewport storefront wall — visually settled
// but functionally thin (no new-release feed, no activity surfaces).
// This page stitches the storefront wall to the rest of the store so
// scrolling reveals "what's just landed" + "what people remember" +
// "what people are saying" beneath the hero. Once the proportions
// and section transitions feel right, this layout replaces Home.tsx
// and the temp route comes off.

interface AlbumListResponse {
  albums: AlbumSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 30-day window matches the NEW! sticker's recent-release rule on
// AlbumCard. Anything outside the window or with a future
// releaseDate (D-XX pre-orders) gets filtered out client-side
// after the server returns its release_date_desc-sorted page.
const RECENT_DAYS = 30;

function isWithinRecentWindow(
  releaseDate: string | null | undefined
): boolean {
  if (!releaseDate) return false;
  const match = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const ts = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  if (Number.isNaN(ts)) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= RECENT_DAYS;
}

// Fetch a generous slice from the server so the 30-day client
// filter doesn't starve the 21-target render even if the latest
// release_date_desc page is mostly older / future-dated stock.
function useRecentReleases(fetchLimit = 60) {
  return useQuery<AlbumListResponse>({
    queryKey: ['home-next', 'recent-releases', fetchLimit],
    queryFn: async () => {
      const { data } = await axios.get<AlbumListResponse>('/api/albums', {
        params: {
          sort: 'release_date_desc',
          page: 1,
          pageSize: fetchLimit,
        },
      });
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export default function HomeNext() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 신보 + 기억 + 50자 평',
    type: 'website',
  });

  const releases = useRecentReleases(60);
  const snapshots = useHomeSnapshots(true, 14);
  const reviews = useUserReviewsFeed(true, 21);

  // Filter to released-and-recent only; cap at 21 (7 cols × 3 rows)
  // matching the unified grid below. Memoised so we don't re-run
  // the filter on every render — the server response is stable
  // across renders most of the time.
  const recentReleased = useMemo(() => {
    const all = releases.data?.albums ?? [];
    return all.filter((a) => isWithinRecentWindow(a.releaseDate)).slice(0, 21);
  }, [releases.data]);

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Hero ───────────────────────────────────────────────────
          Painted storefront scene — wood shelves baked into the
          backdrop image, LPs from /api/home/features rendered on
          top in the same coordinate system so they sit exactly
          on the shelves. Activity sections kick in on scroll. */}
      <HomeNextHero />

      <div className="px-4 md:px-8 lg:px-12 xl:px-16 pt-12 pb-8">
        {/* Unified 6-col flow — three card types stacked back-to-
            back with no headings, only their ring colour to
            distinguish:
              · 최신 발매작 → sky (#5aa9e6 family — matches the NEW
                sticker)
              · 요즘 평 → amber (#e8a020 — the brand accent)
              · 새로 남긴 기억 → violet (#b48cdc — added for this
                surface; keeps memories distinct from active
                comment chatter)
            All three grids share the same column count and gap so
            the rows queue up as one continuous "6 across, scrolling
            forever" sheet. Cap counts are tuned so the band of
            each type takes 1–3 rows: releases get the most space
            (3 rows = 18), reviews medium (2 rows = 12), snapshots
            compact (1 row = 6). */}
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-3">
          {/* ── 최신 발매작 (sky ring) ─────────────────────────── */}
          {!releases.isLoading && recentReleased.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
              {recentReleased.map((album) => (
                <div
                  key={album.mbid}
                  className="rounded-xl ring-1 ring-sky-400/25 hover:ring-sky-400/60 transition-[box-shadow]"
                >
                  <AlbumCard album={album} hideNewSticker />
                </div>
              ))}
            </div>
          )}

          {/* ── 요즘 평 (amber ring) ──────────────────────────── */}
          {!reviews.isLoading && (reviews.data?.items ?? []).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
              {(reviews.data?.items ?? []).slice(0, 14).map((item) => (
                <BlurredReviewCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* ── 새로 남긴 기억 (violet ring) ──────────────────── */}
          {!snapshots.isLoading &&
            (snapshots.data?.snapshots ?? []).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {(snapshots.data?.snapshots ?? [])
                  .slice(0, 7)
                  .map((snap) => (
                    <SnapshotMiniCard key={snap.id} snap={snap} />
                  ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// Compact avatar shared between the review and snapshot mini
// cards. 18px keeps it readable at the smaller card size without
// dominating the footer line. Falls back to initial-letter when
// no avatar URL is on file or the image 404s.
function MiniAvatar({
  src,
  name,
  size = 18,
}: {
  src: string | null;
  name: string | null;
  size?: number;
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
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

// 굿굿 / 별루 / so-so → thumb glyph mirroring CommentTicker's
// rating badge. Kept inline rather than imported from CommentTicker
// because that component is internal and the dependency would be
// brittle.
const RATING_THUMB: Record<'up' | 'down' | 'soso', string> = {
  up: '👍',
  down: '👎',
  soso: '🤷',
};

function BlurredReviewCard({ item }: { item: UserReviewFeedItem }) {
  const isAnon = item.userId == null;
  const displayName = isAnon ? '탈퇴한 사용자' : item.userName || '익명';
  const ratingThumb = item.rating ? RATING_THUMB[item.rating] : null;
  const feelingEmoji = item.emoji;
  const hasBadges = !!(ratingThumb || feelingEmoji);

  return (
    <Link
      to={`/album/${item.albumSlug}`}
      // Amber ring is the brand accent and the visual cue that
      // tells these "요즘 평" cards apart from the violet
      // snapshot cards stacked next to them in the unified grid.
      className="group relative block aspect-square overflow-hidden rounded-lg border border-[#e8a020]/25 hover:border-[#e8a020]/60 transition-colors"
    >
      {/* Blurred cover — same de-blur-on-hover gesture as the
          comment ticker. blur-[14px] at rest is heavy enough that
          you can't quite identify the cover; group-hover drops to
          [4px] which gives a teasing reveal without giving the
          album name away. */}
      <div
        className="absolute inset-0 scale-110 blur-[14px] saturate-[1.1] brightness-[0.5] group-hover:blur-[4px] group-hover:brightness-[0.7] transition-[filter] duration-300"
        aria-hidden
      >
        {item.albumCoverUrl ? (
          <CoverArt
            src={item.albumCoverUrl}
            fallbacks={item.albumCoverFallbacks}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-[#1a1208]" />
        )}
      </div>
      {/* Dark scrim — gentle gradient so the comment text stays
          legible regardless of cover palette, lightens slightly
          on hover so the cover-reveal isn't fighting the scrim. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/55 group-hover:from-black/15 group-hover:to-black/40 transition-colors" />

      <div className="relative h-full flex flex-col justify-between p-2.5">
        {/* Body — comment text with the thumb (rating) and feeling
            emojis trailing. Mirrors CommentTicker's "emojis as
            punctuation" treatment so the same review reads
            consistently across surfaces. */}
        <div className="flex-1 flex items-center">
          <p className="text-[12px] md:text-[13px] text-gray-50 font-medium leading-snug line-clamp-4">
            {item.body}
            {hasBadges && (
              <span className="whitespace-nowrap" aria-hidden>
                {' '}
                {ratingThumb && (
                  <span className="leading-none">{ratingThumb}</span>
                )}
                {feelingEmoji && (
                  <span className="leading-none">{feelingEmoji}</span>
                )}
              </span>
            )}
          </p>
        </div>
        {/* Footer — author identity replaces the previous album
            title/artist line. The cover (de-blurred on hover) is
            already pointing at the album; what's missing without
            this footer is *who* wrote the comment. */}
        <div className="flex items-center gap-1.5 min-w-0">
          <MiniAvatar src={item.userAvatar} name={item.userName} size={18} />
          <span className="text-[11px] text-gray-100 font-medium truncate">
            {displayName}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SnapshotMiniCard({ snap }: { snap: HomeSnapshot }) {
  const filledItems = snap.items.filter((it) => it.album != null);
  const total = filledItems.length;
  const visible = filledItems.slice(0, 5);
  const overflow = total - 5;
  const showOverflow = overflow > 0;
  const displayName = snap.user.displayName || snap.user.username;

  // Card is locked to aspect-square via the outer Link. The
  // 3×2 cover grid (each cell aspect-square) naturally takes
  // the top 2/3 of the card's height; flex-1 footer absorbs
  // the remaining 1/3 so the whole composition fills the
  // square with no leftover gap. The avatar is sized off the
  // footer height (h-full) so it scales with the card, which
  // keeps the footer feeling balanced regardless of breakpoint.
  return (
    <Link
      to={`/my/${snap.user.username}/snap/${snap.slug}`}
      // Violet ring distinguishes "memory" cards from the warm
      // amber 50자 평 cards above. Bg stays the same dark plate
      // because the cards still need to sit on their own
      // canvas — only the chrome shifts hue.
      className="group flex flex-col aspect-square rounded-lg border border-violet-400/30 bg-[#110b04]/60 p-2 hover:border-violet-400/60 transition-colors"
    >
      <div className="grid grid-cols-3 gap-0.5">
        {Array.from({ length: 6 }, (_, i) => {
          if (i < 5) {
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
          }
          if (showOverflow) {
            return (
              <div
                key={i}
                className="aspect-square bg-[#0a0604] rounded-[2px] overflow-hidden flex items-center justify-center text-[12px] font-medium text-[#c9a060] tabular-nums"
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
        })}
      </div>
      <div className="flex-1 min-h-0 mt-1.5 flex items-center gap-2">
        <div className="flex-1 min-w-0 text-[12px] text-gray-100 font-medium leading-tight line-clamp-2 group-hover:text-[#e8a020] transition-colors">
          {snap.name}
        </div>
        {/* aspect-square + h-full sizes the avatar off the
            footer's measured height — at typical card sizes
            this lands ~30-44px which fills the right edge of
            the footer cleanly. */}
        <div className="h-full aspect-square shrink-0">
          <MiniAvatarFill src={snap.user.avatarUrl} name={displayName} />
        </div>
      </div>
    </Link>
  );
}

// Variant of MiniAvatar that fills its parent's bounds instead
// of taking a fixed pixel size. Used in the snapshot mini card
// where the avatar size is determined by the card's footer
// height (which itself scales with card width).
function MiniAvatarFill({
  src,
  name,
}: {
  src: string | null;
  name: string | null;
}) {
  const resolved = resolveApiUrl(src);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        aria-hidden
        className="w-full h-full rounded-full object-cover border border-white/10"
        referrerPolicy="no-referrer"
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="w-full h-full rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center border border-white/10 font-semibold text-base"
      aria-hidden
    >
      {initial}
    </div>
  );
}
