import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useAlbumBase, useAlbumReviews, useAlbumSimilar } from '../hooks/useAlbum';
import { useInView } from '../hooks/useInView';
import HeaderSection from '../components/AlbumDetail/HeaderSection';
import BuySection from '../components/AlbumDetail/BuySection';
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

  // Browser tab title
  useEffect(() => {
    if (base?.album) {
      document.title = `${base.album.title} by ${base.album.artist} | dig.haus`;
    } else {
      document.title = 'Loading... | dig.haus';
    }
  }, [base?.album]);

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
    <div className="flex-1">
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {/* Stage 1: instant */}
        <HeaderSection album={album} streaming={base.streaming} buy={base.buy} />
        <BuySection buy={base.buy} albumId={albumId} />

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
