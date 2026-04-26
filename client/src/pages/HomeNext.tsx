import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from '../lib/axios';
import HomeNextHero from '../components/Home/HomeNextHero';
import AlbumCard from '../components/AlbumCard';
import SnapshotCard from '../components/Home/SnapshotCard';
import { useHomeSnapshots } from '../hooks/useHomeSnapshots';
import {
  useUserReviewsFeed,
  type UserReviewFeedItem,
} from '../hooks/useUserReviewsFeed';
import CoverArt from '../components/CoverArt';
import { useDocumentHead } from '../hooks/useDocumentHead';
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

function useLatestAlbums(limit = 12) {
  return useQuery<AlbumListResponse>({
    queryKey: ['home-next', 'latest-albums', limit],
    queryFn: async () => {
      const { data } = await axios.get<AlbumListResponse>('/api/albums', {
        params: { sort: 'registered_recent', page: 1, pageSize: limit },
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

  const latest = useLatestAlbums(12);
  const snapshots = useHomeSnapshots(true, 8);
  const reviews = useUserReviewsFeed(true, 12);

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Hero (100vh) ──────────────────────────────────────────
          Painted storefront scene — wood shelves baked into the
          backdrop image, LPs from /api/home/features rendered on
          top in the same coordinate system so they sit exactly
          on the shelves. Whole scene scales with viewport height.
          Activity sections below kick in on scroll. */}
      <HomeNextHero />

      <div className="px-4 md:px-8 lg:px-12 xl:px-16 pt-20 pb-24">
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-24">
        {/* ── New arrivals: dense album grid ──────────────────────
            The /dig page's "comfortable" density (6 cols at xl)
            distilled to a single row of 12. No density switcher,
            no pagination — this is a teaser; deeper browsing
            happens on /dig via the section header link. */}
        <section>
          <SectionHeader title="새로 들어왔어요" linkLabel="전체 보기" linkTo="/dig" />
          {latest.isLoading ? (
            <SectionLoading />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-[17px]">
              {(latest.data?.albums ?? []).map((album) => (
                <AlbumCard key={album.mbid} album={album} />
              ))}
            </div>
          )}
        </section>

        {/* ── Updated 기억 (horizontal snapshot row) ───────────────
            Wall snapshots laid out as a 4-up grid (responsive) —
            each card already shows 5 covers + footer, so a row of
            4 reads as "the four most-recent published memories".
            No marquee/auto-scroll; the page is already scrolling. */}
        <section>
          <SectionHeader title="새로 남긴 기억" linkLabel={null} linkTo={null} />
          {snapshots.isLoading ? (
            <SectionLoading />
          ) : (snapshots.data?.snapshots ?? []).length === 0 ? (
            <SectionEmpty>아직 공개된 스냅샷이 없어요.</SectionEmpty>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(snapshots.data?.snapshots ?? []).slice(0, 8).map((snap) => (
                <SnapshotCard key={snap.id} snap={snap} />
              ))}
            </div>
          )}
        </section>

        {/* ── 50자 평 grid (blurred-cover backgrounds) ─────────────
            Each card = album cover behind a heavy blur with the
            user's 50자 평 floated on top. The blur turns the cover
            into a per-card colour wash so the wall reads as text-
            forward (the comment is the content) while still
            anchoring each card visually to its album. */}
        <section>
          <SectionHeader title="요즘 평" linkLabel={null} linkTo={null} />
          {reviews.isLoading ? (
            <SectionLoading />
          ) : (reviews.data?.items ?? []).length === 0 ? (
            <SectionEmpty>아직 50자 평이 없어요.</SectionEmpty>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {(reviews.data?.items ?? []).slice(0, 12).map((item) => (
                <BlurredReviewCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  linkLabel,
  linkTo,
}: {
  title: string;
  linkLabel: string | null;
  linkTo: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between mb-5">
      <h2 className="text-lg md:text-xl font-semibold text-gray-100 tracking-wide">
        {title}
      </h2>
      {linkLabel && linkTo && (
        <Link
          to={linkTo}
          className="text-xs text-gray-400 hover:text-[#e8a020] transition-colors"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="text-center py-12 text-sm text-gray-500">
      불러오는 중…
    </div>
  );
}

function SectionEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-12 text-sm text-gray-500">{children}</div>
  );
}

function BlurredReviewCard({ item }: { item: UserReviewFeedItem }) {
  return (
    <Link
      to={`/album/${item.albumSlug}`}
      className="relative block aspect-square overflow-hidden rounded-lg border border-white/5 hover:border-[#e8a020]/40 transition-colors group"
    >
      {/* Cover background — heavily blurred so it reads as a colour
          wash, not a recognisable cover. Scale-110 hides the blur's
          natural edge bleed inside the card frame. Filter is applied
          via a wrapper since CoverArt doesn't take inline styles. */}
      <div
        className="absolute inset-0 scale-110"
        style={{ filter: 'blur(14px) brightness(0.45)' }}
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
      {/* Subtle dark gradient on top of the blur so the comment text
          stays legible regardless of cover palette. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/55 group-hover:from-black/20 group-hover:to-black/45 transition-colors" />

      <div className="relative h-full flex flex-col justify-between p-3">
        {/* Quote-style 50자 평 — the body is short by definition
            (≤50 chars), so we let it sit at a comfortable reading
            size centred vertically rather than capping with -clamp. */}
        <div className="flex-1 flex items-center">
          <p className="text-sm md:text-[15px] text-gray-50 font-medium leading-snug">
            {item.emoji && (
              <span className="mr-1.5" aria-hidden>
                {item.emoji}
              </span>
            )}
            {item.body}
          </p>
        </div>
        {/* Footer: album title + artist, dim. The cover behind is
            already fingerprinting the album visually; the text is
            confirmation, not the headline. */}
        <div className="text-[11px] text-gray-300/90 truncate">
          <span className="font-medium">{item.albumTitle}</span>
          {item.albumArtist && (
            <>
              {' '}
              <span className="text-gray-400">— {item.albumArtist}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
