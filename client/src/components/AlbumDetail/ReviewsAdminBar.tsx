import { useCurationProgress } from '../../contexts/CurationProgressContext';
import {
  useGenerateReviewSummary,
  useMarkNoReviews,
  useDeleteAllReviews,
} from '../../hooks/useAlbum';

// Admin-only action cluster shown above the review section while
// `reviews_crawled_at IS NULL`. Used to be a 130-line inline block
// inside Album.tsx — extracted here so the page-level file reads
// as the four reader-facing sections (header / buy / 50자 평 /
// reviews / similar) it actually composes, with the admin chrome
// scoped behind a single component import.
//
// Holds its own hook calls (curation context + the three review
// mutation hooks) so the page level only needs to forward slug +
// album title + review count. If a future surface needs the same
// cluster (e.g. the admin scrape-failures panel deep-linking into
// this view), the bar moves with it without untangling page-level
// state.

type Props = {
  slug: string;
  albumTitle: string;
  reviewCount: number;
};

const BUTTON_BASE =
  'text-xs font-medium rounded-input px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5';
const BUTTON_AMBER = `${BUTTON_BASE} text-accent border border-accent/60 hover:bg-accent/15`;
const BUTTON_NEUTRAL = `${BUTTON_BASE} text-gray-400 bg-white/5 hover:bg-white/10 border border-white/10`;
const BUTTON_DANGER = `${BUTTON_BASE} text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40`;

export default function ReviewsAdminBar({ slug, albumTitle, reviewCount }: Props) {
  const curation = useCurationProgress();
  const generateSummary = useGenerateReviewSummary(slug);
  const markNoReviews = useMarkNoReviews(slug);
  const deleteAllReviews = useDeleteAllReviews(slug);

  // Three visual states for the curation button:
  //   idle                                   → "🔍 자동 큐레이션"
  //   already queued / running / done here   → spinner + "큐레이션 중…" (disabled)
  //   curation running for ANOTHER album     → "🔍 큐에 추가" (click appends)
  const thisInQueue = !!curation.run?.albums.some(
    (a) => a.albumMbid === slug
  );
  const otherInProgress = curation.isRunning && !thisInQueue;
  const lockedOut =
    thisInQueue ||
    generateSummary.isPending ||
    markNoReviews.isPending ||
    deleteAllReviews.isPending;
  const curationLabel = thisInQueue
    ? '큐레이션 중…'
    : otherInProgress
      ? '🔍 큐에 추가'
      : '🔍 자동 큐레이션';

  const handleStartCuration = () => {
    if (lockedOut) return;
    curation.startRun([{ mbid: slug, title: albumTitle }]);
  };

  const handleGenerate = async () => {
    if (generateSummary.isPending) return;
    try {
      await generateSummary.mutateAsync();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          '요약 생성에 실패했습니다. 리뷰가 2개 이상 필요합니다.'
      );
    }
  };

  const handleMarkNoReviews = async () => {
    if (markNoReviews.isPending) return;
    try {
      await markNoReviews.mutateAsync();
    } catch (err: any) {
      alert(err?.response?.data?.error || '표시에 실패했습니다.');
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllReviews.isPending) return;
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
      alert(err?.response?.data?.error || '리뷰 삭제에 실패했습니다.');
    }
  };

  return (
    <div className="rounded-panel border border-accent/25 bg-panel/80 px-4 sm:px-5 py-3">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleStartCuration}
          disabled={lockedOut}
          className={BUTTON_AMBER}
          title={
            otherInProgress
              ? '다른 앨범이 처리 중 — 클릭하면 대기열 뒤에 추가됩니다'
              : 'URL 자동 검색 → 리뷰 수집 → 한국어 요약까지 한 번에 실행'
          }
        >
          {thisInQueue && (
            <span className="w-3 h-3 border-2 border-gray-500 border-t-accent rounded-full animate-spin" />
          )}
          {curationLabel}
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={
            generateSummary.isPending ||
            markNoReviews.isPending ||
            reviewCount < 2
          }
          className={BUTTON_AMBER}
          title="이미 등록된 리뷰만으로 한국어 요약 생성 (~$0.01). 리뷰가 2개 이상 있어야 가능."
        >
          {generateSummary.isPending ? '생성 중…' : '📝 요약 생성'}
        </button>
        <button
          type="button"
          onClick={handleMarkNoReviews}
          disabled={generateSummary.isPending || markNoReviews.isPending}
          className={BUTTON_NEUTRAL}
          title="외부 API 호출 없이 크롤링 완료로만 표시 (비용 0)"
        >
          {markNoReviews.isPending ? '표시 중…' : '🙅 리뷰 없음'}
        </button>
        <button
          type="button"
          onClick={handleDeleteAll}
          disabled={
            generateSummary.isPending ||
            markNoReviews.isPending ||
            deleteAllReviews.isPending
          }
          className={BUTTON_DANGER}
          title="이 앨범의 수집된 리뷰 전체 삭제 (앨범은 유지됨)"
        >
          {deleteAllReviews.isPending ? '삭제 중…' : '🗑️ 리뷰 전체 삭제'}
        </button>
      </div>
    </div>
  );
}
