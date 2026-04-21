import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useAlbumBase, useAlbumReviews, useAlbumSimilar, useAlbumNeighbors } from '../hooks/useAlbum';
import { useHomeState } from '../contexts/HomeStateContext';
import { useAuth } from '../contexts/AuthContext';
import { useCurationProgress } from '../contexts/CurationProgressContext';
import { useGenerateReviewSummary, useMarkNoReviews, useDeleteAllReviews } from '../hooks/useAlbum';
import { useInView } from '../hooks/useInView';
import { useDocumentHead } from '../hooks/useDocumentHead';
import HeaderSection from '../components/AlbumDetail/HeaderSection';
import BuySection from '../components/AlbumDetail/BuySection';
import UserReviewsSection from '../components/AlbumDetail/UserReviewsSection';
import ReviewSection from '../components/AlbumDetail/ReviewSection';
import SimilarAlbums from '../components/AlbumDetail/SimilarAlbums';
import CoverArt from '../components/CoverArt';
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
  const [searchParams] = useSearchParams();
  // Deep-link from the admin scrape-failures panel: when present,
  // ReviewSection auto-opens + 리뷰 추가 → 수동 입력 tab and pre-fills
  // the URL + derived source name so admin only has to paste the body.
  const prefillManualUrl = searchParams.get('retry-url');
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const generateSummary = useGenerateReviewSummary(slug!);
  const markNoReviews = useMarkNoReviews(slug!);
  const deleteAllReviews = useDeleteAllReviews(slug!);
  const curation = useCurationProgress();
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

  const hasPrev = !!neighbors?.prev;
  const hasNext = !!neighbors?.next;
  const showNav = hasPrev || hasNext;

  return (
    <div className="flex-1 px-4">
      <main className="max-w-[1120px] mx-auto py-8 space-y-10">
        {/* Stage 1: instant */}
        <HeaderSection album={album} streaming={base.streaming} buy={base.buy} />
        <BuySection buy={base.buy} albumId={albumId} />
        <UserReviewsSection albumId={albumId} userAlbumVote={base.album.userVote ?? null} />

        {/* Review section always renders — ReviewSection handles
            admin empty-state (+ 리뷰 추가, score/excerpt edit) and
            now accepts a pendingNotice slot for the "리뷰 수집
            대기" banner that shows under the title when
            reviews_crawled_at IS NULL. Admin gets the three-button
            action bar; guest gets a friendly wait-notice. */}
        {reviewsLoading ? (
          <SectionLoader text="리뷰를 불러오고 있습니다..." />
        ) : reviewsData ? (
          <ReviewSection
            reviews={reviewsData.reviews}
            koreanSummary={reviewsData.koreanSummary}
            averageScore={reviewsData.averageScore}
            albumTitle={album.title}
            albumArtist={album.artist}
            prefillManualUrl={prefillManualUrl}
            pendingNotice={
              base.album.reviewsCrawledAt === null
                ? isAdmin
                  ? (
                      <div className="rounded-xl border border-[#e8a020]/25 bg-[#1a1a1a]/80 px-4 sm:px-5 py-3">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {(() => {
                            // Three visual states:
                            //   idle         → "🔍 자동 큐레이션"
                            //   already queued/running/done for THIS album
                            //                → spinner + "큐레이션 중…" (disabled)
                            //   running but THIS album not queued yet
                            //                → "🔍 큐에 추가" (click appends)
                            const thisInQueue =
                              !!curation.run?.albums.some(
                                (a) => a.albumMbid === slug
                              );
                            const otherInProgress =
                              curation.isRunning && !thisInQueue;
                            const lockedOut =
                              thisInQueue ||
                              generateSummary.isPending ||
                              markNoReviews.isPending ||
                              deleteAllReviews.isPending;
                            const label = thisInQueue
                              ? '큐레이션 중…'
                              : otherInProgress
                                ? '🔍 큐에 추가'
                                : '🔍 자동 큐레이션';
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  if (lockedOut) return;
                                  curation.startRun([
                                    { mbid: slug!, title: album.title },
                                  ]);
                                }}
                                disabled={lockedOut}
                                className="text-xs font-medium text-[#e8a020] border border-[#e8a020]/60 hover:bg-[#e8a020]/15 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
                                title={
                                  otherInProgress
                                    ? '다른 앨범이 처리 중 — 클릭하면 대기열 뒤에 추가됩니다'
                                    : 'URL 자동 검색 → 리뷰 수집 → 한국어 요약까지 한 번에 실행'
                                }
                              >
                                {thisInQueue && (
                                  <span className="w-3 h-3 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
                                )}
                                {label}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={async () => {
                              if (generateSummary.isPending) return;
                              try {
                                await generateSummary.mutateAsync();
                              } catch (err: any) {
                                alert(
                                  err?.response?.data?.error ||
                                    '요약 생성에 실패했습니다. 리뷰가 2개 이상 필요합니다.'
                                );
                              }
                            }}
                            disabled={
                              generateSummary.isPending ||
                              markNoReviews.isPending ||
                              reviewsData.reviews.length < 2
                            }
                            className="text-xs font-medium text-[#e8a020] border border-[#e8a020]/50 hover:bg-[#e8a020]/10 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="이미 등록된 리뷰만으로 한국어 요약 생성 (~$0.01). 리뷰가 2개 이상 있어야 가능."
                          >
                            {generateSummary.isPending ? '생성 중…' : '📝 요약 생성'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (markNoReviews.isPending) return;
                              try {
                                await markNoReviews.mutateAsync();
                              } catch (err: any) {
                                alert(err?.response?.data?.error || '표시에 실패했습니다.');
                              }
                            }}
                            disabled={
                              generateSummary.isPending ||
                              markNoReviews.isPending
                            }
                            className="text-xs text-gray-400 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="Claude 호출 없이 크롤링 완료로만 표시 (비용 0)"
                          >
                            {markNoReviews.isPending ? '표시 중…' : '🙅 리뷰 없음'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (deleteAllReviews.isPending) return;
                              const reviewCount = reviewsData.reviews.length;
                              if (reviewCount === 0) {
                                alert('삭제할 리뷰가 없습니다.');
                                return;
                              }
                              if (
                                !confirm(
                                  `이 앨범의 리뷰 ${reviewCount}개를 전부 삭제할까요?\n한국어 요약도 함께 초기화되고 수집-대기 상태로 돌아갑니다.\n앨범 자체는 유지됩니다 (앨범 삭제는 ⚙️ 관리 메뉴).`
                                )
                              )
                                return;
                              try {
                                await deleteAllReviews.mutateAsync();
                              } catch (err: any) {
                                alert(
                                  err?.response?.data?.error ||
                                    '리뷰 삭제에 실패했습니다.'
                                );
                              }
                            }}
                            disabled={
                              generateSummary.isPending ||
                              markNoReviews.isPending ||
                              deleteAllReviews.isPending
                            }
                            className="text-xs text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="이 앨범의 수집된 리뷰 전체 삭제 (앨범은 유지됨)"
                          >
                            {deleteAllReviews.isPending ? '삭제 중…' : '🗑️ 리뷰 전체 삭제'}
                          </button>
                        </div>
                      </div>
                    )
                  : null
                : null
            }
          />
        ) : null}

        {/* Similar albums — the descriptions cost ~$0.005 per album
            (first view only, cached afterward), so this runs
            regardless of the review-crawl state now. Non-admins see
            it only when at least one pick exists; admins always
            see it (with the + add slot) per the component's own
            gate. */}
        <div ref={similarRef} className="min-h-[280px]">
          {!similarVisible ? null : similarLoading ? (
            <SectionLoader text="비슷한 앨범을 찾고 있습니다..." />
          ) : similarData ? (
            // Component gates itself: hidden for non-admins when the
            // list is empty, always rendered for admins so the "추가"
            // slot is reachable even before any pick exists.
            <SimilarAlbums
              albums={similarData.similarAlbums ?? []}
              albumId={albumId}
            />
          ) : null}
        </div>

        {/* Prev / Next album navigation */}
        {showNav && (
          <nav className="border-t border-white/5 pt-8 max-w-2xl mx-auto">
            <div className={`grid gap-4 ${hasPrev && hasNext ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {hasPrev && (
                <Link
                  to={`/album/${neighbors!.prev!.slug}`}
                  className={`group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/5 transition-colors ${!hasNext ? 'col-span-full max-w-sm mx-auto' : ''}`}
                >
                  <span className="text-gray-600 group-hover:text-[#e8a020] transition-colors text-lg shrink-0">←</span>
                  <CoverArt
                    src={neighbors!.prev!.coverArtUrl}
                    fallbacks={neighbors!.prev!.coverArtFallbacks}
                    alt={neighbors!.prev!.title}
                    className="w-12 h-12 rounded-md object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] text-gray-600 mb-0.5">이전 앨범</div>
                    <div className="text-sm text-white font-medium truncate group-hover:text-[#e8a020] transition-colors">
                      {neighbors!.prev!.title}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{neighbors!.prev!.artist}</div>
                  </div>
                </Link>
              )}
              {hasNext && (
                <Link
                  to={`/album/${neighbors!.next!.slug}`}
                  className={`group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/5 transition-colors ${hasPrev ? 'justify-end text-right' : 'col-span-full max-w-sm mx-auto'}`}
                >
                  <div className="min-w-0">
                    <div className="text-[11px] text-gray-600 mb-0.5">다음 앨범</div>
                    <div className="text-sm text-white font-medium truncate group-hover:text-[#e8a020] transition-colors">
                      {neighbors!.next!.title}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{neighbors!.next!.artist}</div>
                  </div>
                  <CoverArt
                    src={neighbors!.next!.coverArtUrl}
                    fallbacks={neighbors!.next!.coverArtFallbacks}
                    alt={neighbors!.next!.title}
                    className="w-12 h-12 rounded-md object-cover shrink-0"
                  />
                  <span className="text-gray-600 group-hover:text-[#e8a020] transition-colors text-lg shrink-0">→</span>
                </Link>
              )}
            </div>
          </nav>
        )}
      </main>
    </div>
  );
}
