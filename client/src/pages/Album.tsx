import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useAlbumBase, useAlbumReviews, useAlbumSimilar, useAlbumNeighbors } from '../hooks/useAlbum';
import { useHomeState } from '../contexts/HomeStateContext';
import { useInView } from '../hooks/useInView';
import { useDocumentHead } from '../hooks/useDocumentHead';
import HeaderSection from '../components/AlbumDetail/HeaderSection';
import BuySection from '../components/AlbumDetail/BuySection';
import UserReviewsSection from '../components/AlbumDetail/UserReviewsSection';
import ReviewSection from '../components/AlbumDetail/ReviewSection';
import Discography from '../components/AlbumDetail/Discography';
import SimilarAlbums from '../components/AlbumDetail/SimilarAlbums';
import LoadingSkeleton from '../components/LoadingSkeleton';

function SectionLoader({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-8">
      <div className="w-5 h-5 border-2 border-gray-700 border-t-[#e8a020] rounded-full animate-spin" />
      <span className="text-gray-500 text-sm">{text}</span>
    </div>
  );
}

export default function Album() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: base, isLoading: baseLoading, error: baseError } = useAlbumBase(slug!);
  const baseReady = !!base;
  const { sort } = useHomeState();
  const { data: neighbors } = useAlbumNeighbors(slug!, sort, baseReady);
  // Use slug for sub-endpoints (server resolves slug→mbid)
  const albumId = base?.album?.slug || slug!;
  const { data: reviewsData, isLoading: reviewsLoading } = useAlbumReviews(albumId, baseReady);
  // Only fetch similar albums when the section enters the viewport — avoids
  // a slow Claude+Last.fm round trip when users only skim the header.
  const { ref: similarRef, inView: similarVisible } = useInView<HTMLDivElement>();
  const { data: similarData, isLoading: similarLoading } = useAlbumSimilar(albumId, baseReady && similarVisible);

  // Merge pronunciation from reviews response into album data
  const album = base?.album
    ? {
        ...base.album,
        artistKo: base.album.artistKo || reviewsData?.artistKo || undefined,
        titleKo: base.album.titleKo || reviewsData?.titleKo || undefined,
      }
    : null;

  // Scroll to top on page entry / slug change — prevents CLS-induced mid-page landing
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  const headImage = album?.coverArtUrl?.replace(
    /^(https:\/\/coverartarchive\.org\/release(?:-group)?\/[^/]+\/front)-250(\.[a-z]+)?$/i,
    '$1-500$2'
  ) ?? album?.coverArtUrl ?? null;
  const headYear = album?.releaseDate?.slice(0, 4) || '';
  const headDescription = album
    ? [
        headYear,
        album.label,
        '리뷰, 구매처, 유사 앨범 정보',
      ].filter(Boolean).join(' · ')
    : undefined;

  useDocumentHead({
    title: album ? `${album.title} by ${album.artist} | dig.haus` : 'Loading... | dig.haus',
    description: headDescription,
    image: headImage,
    url: album ? `https://dig.haus/album/${albumId}` : undefined,
    type: 'music.album',
  });

  // Replace URL with slug if we arrived via mbid/discogs-id
  useEffect(() => {
    if (base?.album?.slug && slug !== base.album.slug) {
      navigate(`/album/${base.album.slug}`, { replace: true });
    }
  }, [base?.album?.slug, slug, navigate]);

  useEffect(() => {
    if (album) {
      const stored = localStorage.getItem('recentAlbums');
      let recent = stored ? JSON.parse(stored) : [];
      // Remove duplicates: match by slug, mbid, or title+artist
      const key = album.slug || album.mbid;
      const titleLower = album.title.toLowerCase();
      const artistLower = album.artist.toLowerCase();
      recent = recent.filter((a: any) =>
        a.mbid !== key &&
        a.mbid !== album.mbid &&
        a.mbid !== album.slug &&
        !(a.title?.toLowerCase() === titleLower && a.artist?.toLowerCase() === artistLower)
      );
      recent.unshift({
        mbid: key,
        title: album.title,
        artist: album.artist,
        year: album.releaseDate?.substring(0, 4) || null,
        label: album.label,
        coverArtUrl: album.coverArtUrl,
        coverArtFallbacks: album.coverArtFallbacks || [],
      });
      localStorage.setItem('recentAlbums', JSON.stringify(recent.slice(0, 20)));
    }
  }, [album]);

  // Update average score in localStorage when reviews load
  useEffect(() => {
    if (album && reviewsData?.averageScore != null) {
      const stored = localStorage.getItem('recentAlbums');
      if (stored) {
        const recent = JSON.parse(stored);
        const key = album.slug || album.mbid;
        const idx = recent.findIndex((a: any) => a.mbid === key);
        if (idx >= 0 && recent[idx].averageScore !== reviewsData.averageScore) {
          recent[idx].averageScore = Math.round(reviewsData.averageScore);
          localStorage.setItem('recentAlbums', JSON.stringify(recent));
        }
      }
    }
  }, [album, reviewsData?.averageScore]);

  if (baseLoading) return <LoadingSkeleton />;

  if (baseError || !base || !album) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg">앨범 정보를 불러올 수 없습니다</p>
          <Link to="/" className="text-[#e8a020] mt-4 inline-block hover:underline">
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {/* Prev/Next album navigation arrows */}
      {neighbors?.prev && (
        <Link
          to={`/album/${neighbors.prev.slug}`}
          className="hidden lg:flex fixed left-2 xl:left-4 top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-2 opacity-0 hover:opacity-100 transition-opacity duration-200 group/nav"
          title={`${neighbors.prev.artist} — ${neighbors.prev.title}`}
        >
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-400 group-hover/nav:text-[#e8a020] group-hover/nav:border-[#e8a020]/40 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </div>
          {neighbors.prev.coverArtUrl && (
            <img
              src={neighbors.prev.coverArtUrl}
              alt=""
              className="w-12 h-12 rounded-md object-cover opacity-0 group-hover/nav:opacity-100 transition-opacity shadow-lg"
            />
          )}
        </Link>
      )}
      {neighbors?.next && (
        <Link
          to={`/album/${neighbors.next.slug}`}
          className="hidden lg:flex fixed right-2 xl:right-4 top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-2 opacity-0 hover:opacity-100 transition-opacity duration-200 group/nav"
          title={`${neighbors.next.artist} — ${neighbors.next.title}`}
        >
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-400 group-hover/nav:text-[#e8a020] group-hover/nav:border-[#e8a020]/40 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
          {neighbors.next.coverArtUrl && (
            <img
              src={neighbors.next.coverArtUrl}
              alt=""
              className="w-12 h-12 rounded-md object-cover opacity-0 group-hover/nav:opacity-100 transition-opacity shadow-lg"
            />
          )}
        </Link>
      )}

      <main className="max-w-4xl xl:max-w-5xl 2xl:max-w-[1080px] mx-auto px-4 py-8 space-y-10">
        {/* Stage 1: instant */}
        <HeaderSection album={album} streaming={base.streaming} buy={base.buy} />
        <BuySection buy={base.buy} albumId={albumId} />
        <UserReviewsSection albumId={albumId} userAlbumVote={base.album.userVote ?? null} />

        {/* Stage 2: reviews (slow) */}
        {reviewsLoading ? (
          <SectionLoader text="리뷰를 수집하고 있습니다..." />
        ) : reviewsData ? (
          <ReviewSection
            reviews={reviewsData.reviews}
            koreanSummary={reviewsData.koreanSummary}
            averageScore={reviewsData.averageScore}
          />
        ) : null}

        {/* Stage 2: similar albums (slow, lazy) — reserve height to avoid layout shift */}
        <div ref={similarRef} className="min-h-[280px]">
          {!similarVisible ? null : similarLoading ? (
            <SectionLoader text="비슷한 앨범을 찾고 있습니다..." />
          ) : similarData?.similarAlbums && similarData.similarAlbums.length > 0 ? (
            <SimilarAlbums albums={similarData.similarAlbums} albumId={albumId} />
          ) : null}
        </div>

        {/* Stage 1: discography (fast) */}
        {base.discography && base.discography.length > 0 && (
          <Discography
            items={base.discography}
            currentMbid={album.mbid}
            artistName={album.artist}
          />
        )}
      </main>
    </div>
  );
}
