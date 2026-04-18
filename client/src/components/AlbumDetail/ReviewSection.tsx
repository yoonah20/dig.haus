import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import axios from '../../lib/axios';
import type { Review } from '../../types';
import { getScoreColor as scoreColor, getScoreBgColor as scoreBgColor } from '../../utils/score';
import { useAuth } from '../../contexts/AuthContext';
import { AiSummaryBadge } from './SimilarAlbums';
import { useGenerateReviewSummary } from '../../hooks/useAlbum';
import { MIN_SCORED_FOR_AVG } from '../../lib/reviewThresholds';

function ScoreBadge({ review, onSaved }: { review: Review; onSaved: () => void }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    // "-" = clear the manual score (send null). Empty input aborts.
    let scoreToSend: number | null;
    if (trimmed === '-') {
      scoreToSend = null;
    } else if (trimmed === '') {
      setEditing(false);
      return;
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 0 || num > 100) {
        setEditing(false);
        return;
      }
      scoreToSend = num;
    }
    try {
      await axios.post(`/api/albums/reviews/${review.id}/score`, { score: scoreToSend });
      onSaved();
    } catch {}
    setEditing(false);
  }, [value, review.id, onSaved]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <span
        className="shrink-0 flex items-center gap-1"
        onClick={(e) => e.preventDefault()}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          title="0-100 숫자 또는 - (점수 없음)"
          className="w-12 bg-gray-800 border border-gray-600 rounded-md text-xs text-white text-center px-1 py-0.5"
        />
        <span className="text-gray-500 text-xs">/100</span>
      </span>
    );
  }

  const startEditing = (e: React.MouseEvent) => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    setValue(review.score !== null ? String(review.score) : '');
    setEditing(true);
  };

  if (review.score !== null) {
    return (
      <span
        onClick={startEditing}
        className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${isAdmin ? 'cursor-pointer' : ''} ${scoreBgColor(
          review.scoreMax ? (review.score / review.scoreMax) * 100 : review.score
        )}`}
      >
        {review.score}{review.scoreMax ? `/${review.scoreMax}` : ''}
      </span>
    );
  }

  if (!isAdmin) return null;

  return (
    <span
      onClick={startEditing}
      className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-400 cursor-pointer hover:bg-gray-600/50 transition-colors"
    >
      -/100
    </span>
  );
}

function ReviewCard({ review, onScoreSaved, onRetranslated, onDeleted }: { review: Review; onScoreSaved: () => void; onRetranslated: () => void; onDeleted: () => void }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [retranslating, setRetranslating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingExcerpt, setSavingExcerpt] = useState(false);
  const [excerptDraft, setExcerptDraft] = useState('');

  const handleRetranslate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Each retranslate burns a fresh Claude call — guard against
    // accidental double-clicks and casual exploration.
    if (!confirm('이 리뷰 발췌를 다시 번역할까요? (Claude API 호출됩니다)')) return;
    setRetranslating(true);
    try {
      await axios.post(`/api/albums/reviews/${review.id}/retranslate`);
      onRetranslated();
    } catch {}
    setRetranslating(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('이 리뷰를 삭제할까요?')) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/reviews/${review.id}`);
      onDeleted();
    } catch (err) {
      console.error('Delete review error:', err);
      alert('삭제에 실패했습니다.');
      setDeleting(false);
    }
  };

  const startEditExcerpt = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExcerptDraft(review.excerptKo || review.excerpt || '');
    setEditing(true);
  };

  const cancelEditExcerpt = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (savingExcerpt) return;
    setEditing(false);
  };

  const saveEditExcerpt = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSavingExcerpt(true);
    try {
      await axios.patch(`/api/albums/reviews/${review.id}/excerpt`, {
        excerpt_ko: excerptDraft,
      });
      onRetranslated();
      setEditing(false);
    } catch (err) {
      console.error('Save excerpt error:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSavingExcerpt(false);
    }
  };

  // When editing, render a plain div (no outer <a>) to keep form usable.
  const Wrapper = editing ? 'div' : (review.url ? 'a' : 'div');
  const wrapperProps = !editing && review.url
    ? { href: review.url, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper {...wrapperProps} className={`relative block bg-[#1a1a1a] rounded-lg p-4 transition-colors duration-200 group/card ${editing ? '' : 'hover:bg-[#252525] cursor-pointer'}`}>
      {isAdmin && !editing && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-60 hover:!opacity-100 transition-opacity">
          <button
            onClick={startEditExcerpt}
            className="text-xs text-gray-400 hover:text-white"
            title="본문 수정"
            aria-label="본문 수정"
          >
            ✏️
          </button>
          <button
            onClick={handleRetranslate}
            disabled={retranslating}
            className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
            title="재번역"
            aria-label="재번역"
          >
            {retranslating ? '...' : '🔄'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-40"
            title="리뷰 삭제"
            aria-label="리뷰 삭제"
          >
            {deleting ? '...' : '🗑️'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <span className="text-white font-semibold text-sm truncate">{review.source}</span>
        <ScoreBadge review={review} onSaved={onScoreSaved} />
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={excerptDraft}
            onChange={(e) => setExcerptDraft(e.target.value)}
            disabled={savingExcerpt}
            rows={4}
            autoFocus
            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={cancelEditExcerpt}
              disabled={savingExcerpt}
              className="px-2 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
              aria-label="취소"
            >
              ✕
            </button>
            <button
              onClick={saveEditExcerpt}
              disabled={savingExcerpt}
              className="px-2 py-0.5 text-xs text-[#e8a020] hover:text-white disabled:opacity-40 cursor-pointer"
              aria-label="저장"
            >
              {savingExcerpt ? '...' : '✓'}
            </button>
          </div>
        </div>
      ) : (
        (review.excerptKo || review.excerpt) && (
          <p className="text-gray-400 text-sm leading-relaxed">
            {retranslating ? '번역 중...' : (review.excerptKo || review.excerpt)}
          </p>
        )
      )}
    </Wrapper>
  );
}

const INITIAL_COUNT = 5;

interface ReviewSectionProps {
  reviews: Review[];
  koreanSummary: string | null;
  averageScore: number | null;
  /** Optional card rendered between the section title and the review
   *  body. Used by the Album page to show either the admin action bar
   *  (리뷰 모아오기 / 요약 생성 / 삭제) or the guest "리뷰 수집은
   *  관리자 확인 후…" notice when reviews_crawled_at IS NULL. Keeps
   *  the pending UX inside the review section instead of floating
   *  above it as a separate card. */
  pendingNotice?: React.ReactNode;
  /** Album title + artist — used by the admin-only Google search
   *  affordance in the section title. Both optional so the section
   *  still renders if the parent hasn't threaded them through yet. */
  albumTitle?: string;
  albumArtist?: string;
}

export default function ReviewSection({
  reviews,
  koreanSummary,
  averageScore,
  pendingNotice,
  albumTitle,
  albumArtist,
}: ReviewSectionProps) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const scoredCount = reviews.filter(r => r.score !== null).length;
  const regenSummary = useGenerateReviewSummary(slug ?? '');
  const [expanded, setExpanded] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [addingReview, setAddingReview] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  const startAddReview = () => {
    setAddUrl('');
    setAddingReview(true);
  };

  const cancelAddReview = () => {
    if (savingReview) return;
    setAddingReview(false);
    setAddUrl('');
  };

  const saveAddReview = async () => {
    if (!slug) return;
    const trimmed = addUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      alert('http:// 또는 https:// 로 시작하는 URL을 입력해주세요.');
      return;
    }
    setSavingReview(true);
    try {
      await axios.post(`/api/albums/${slug}/reviews/add-url`, { url: trimmed });
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
      setAddingReview(false);
      setAddUrl('');
    } catch (err: any) {
      console.error('Add review URL error:', err);
      const msg = err?.response?.data?.error || '리뷰 추가에 실패했습니다.';
      alert(msg);
    } finally {
      setSavingReview(false);
    }
  };

  // Edits here change the album's averageScore, which the home page album
  // cards display. Refetch the home list in the background ('all' covers the
  // inactive case while user is on the album page) so a back-nav lands on
  // fresh data without a manual reload.
  const handleScoreSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
    queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
  }, [queryClient, slug]);

  const handleDeleted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
    queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
  }, [queryClient, slug]);

  const startEditSummary = () => {
    setSummaryDraft(koreanSummary || '');
    setEditingSummary(true);
  };

  // Regenerate 한국어 summary from whatever reviews are currently
  // cached. Idempotent + cheap (~$0.01), no confirm — admin uses
  // this often after editing/deleting individual reviews, so any
  // extra click is just friction.
  const handleRegenerateSummary = async () => {
    if (regenSummary.isPending) return;
    try {
      await regenSummary.mutateAsync();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          '요약 재생성에 실패했습니다. 리뷰가 2개 이상 필요합니다.'
      );
    }
  };

  const googleSearchHref =
    albumTitle && albumArtist
      ? `https://www.google.com/search?q=${encodeURIComponent(
          `${albumTitle} ${albumArtist} review`
        )}`
      : null;

  const cancelEditSummary = () => {
    if (savingSummary) return;
    setEditingSummary(false);
  };

  const saveEditSummary = async () => {
    if (!slug) return;
    setSavingSummary(true);
    try {
      await axios.patch(`/api/albums/${slug}/korean-summary`, {
        korean_summary: summaryDraft,
      });
      await queryClient.invalidateQueries({ queryKey: ['album', slug] });
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
      setEditingSummary(false);
    } catch (err) {
      console.error('Save korean summary error:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSavingSummary(false);
    }
  };

  const sortedReviews = [...reviews].sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });

  const needsExpand = sortedReviews.length > INITIAL_COUNT;
  const visibleReviews = expanded ? sortedReviews : sortedReviews.slice(0, INITIAL_COUNT);
  const hiddenCount = sortedReviews.length - INITIAL_COUNT;

  return (
    <section>
      <h2 className="text-2xl font-bold text-white mb-6 font-serif flex items-baseline gap-2">
        <span>리뷰 모음집</span>
        <AiSummaryBadge />
        {/* Admin-only shortcut — opens a Google search for the album
            + artist + "review" in a new tab. Used for quickly
            finding review URLs to paste back into + 리뷰 추가. */}
        {isAdmin && googleSearchHref && (
          <a
            href={googleSearchHref}
            target="_blank"
            rel="noopener noreferrer"
            title={`"${albumTitle} ${albumArtist} review" 구글 검색`}
            aria-label="리뷰 URL 구글 검색"
            className="inline-flex items-center justify-center w-6 h-6 text-gray-500 hover:text-[#e8a020] transition-colors align-middle translate-y-[-2px]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-[14px] h-[14px]"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </a>
        )}
      </h2>

      <div className="space-y-6">
        {pendingNotice}

        {/* Average hidden when fewer than MIN_SCORED_FOR_AVG scored
            reviews — with 1 or 2, the "average" is really just one
            opinion and the big headline number misleads. Individual
            review scores still show in their cards below. */}
        {averageScore !== null && scoredCount >= MIN_SCORED_FOR_AVG && (
          <div className="flex items-baseline gap-2">
            <span className={`text-5xl font-bold ${scoreColor(averageScore)}`}>
              {Math.round(averageScore)}
            </span>
            <span className="text-gray-500 text-lg">/ 100</span>
            <span className="text-gray-600 text-sm ml-1">({scoredCount}개 사이트 평균)</span>
          </div>
        )}

        {(koreanSummary || isAdmin) && (
            <div className="bg-[#1a1a1a] rounded-xl p-5 border-l-4 border-[#e8a020]">
              {editingSummary ? (
                <div className="space-y-2">
                  <textarea
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    disabled={savingSummary}
                    rows={Math.max(3, Math.ceil(summaryDraft.length / 60))}
                    autoFocus
                    className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-y leading-relaxed"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEditSummary}
                      disabled={savingSummary}
                      className="px-2 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
                      aria-label="취소"
                    >
                      ✕
                    </button>
                    <button
                      onClick={saveEditSummary}
                      disabled={savingSummary}
                      className="px-2 py-0.5 text-xs text-[#e8a020] hover:text-white disabled:opacity-40 cursor-pointer"
                      aria-label="저장"
                    >
                      {savingSummary ? '...' : '✓'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-300 leading-relaxed">
                  {koreanSummary || <span className="italic text-gray-600">요약 없음</span>}
                  {isAdmin && (
                    <>
                      <button
                        onClick={startEditSummary}
                        className="ml-2 text-xs text-gray-600 hover:text-[#e8a020] transition-colors cursor-pointer align-middle"
                        title="요약 수정"
                        aria-label="요약 수정"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={handleRegenerateSummary}
                        disabled={regenSummary.isPending}
                        className="ml-1 text-xs text-gray-600 hover:text-[#e8a020] transition-colors cursor-pointer align-middle disabled:opacity-50 disabled:cursor-wait"
                        title="요약 재생성 (캐시된 리뷰로 다시 Sonnet 호출, ~$0.01)"
                        aria-label="요약 재생성"
                      >
                        {regenSummary.isPending ? '...' : '🔄'}
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {sortedReviews.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleReviews.map((review) => (
                <ReviewCard key={review.id} review={review} onScoreSaved={handleScoreSaved} onRetranslated={handleScoreSaved} onDeleted={handleDeleted} />
              ))}

              {needsExpand && !expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="flex flex-col items-center justify-center gap-2 bg-[#151515] hover:bg-[#1e1e1e] border border-dashed border-gray-700 hover:border-gray-500 rounded-lg p-4 transition-all duration-200 cursor-pointer min-h-[100px]"
                >
                  <span className="text-[#e8a020] text-2xl font-bold">+{hiddenCount}</span>
                  <span className="text-gray-400 text-sm">{hiddenCount}개 리뷰 더 보기</span>
                </button>
              )}
            </div>
          )}

          {needsExpand && expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              접기
            </button>
          )}

          {isAdmin && (
            <div>
              {addingReview ? (
                <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-2 border border-white/10">
                  <label className="block text-xs text-gray-400">리뷰 URL</label>
                  <input
                    type="url"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !savingReview) {
                        e.preventDefault();
                        saveAddReview();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelAddReview();
                      }
                    }}
                    disabled={savingReview}
                    placeholder="https://angrymetalguy.com/..."
                    autoFocus
                    className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex items-center justify-end gap-2">
                    {savingReview && (
                      <span className="text-xs text-gray-500 mr-auto animate-pulse">
                        페이지 분석 중...
                      </span>
                    )}
                    <button
                      onClick={cancelAddReview}
                      disabled={savingReview}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      onClick={saveAddReview}
                      disabled={savingReview || !addUrl.trim()}
                      className="px-3 py-1 text-sm text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020] hover:text-black disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {savingReview ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startAddReview}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[#e8a020] border border-[#e8a020]/50 hover:bg-[#e8a020]/10 rounded-md px-3 py-2 transition-colors cursor-pointer"
                >
                  <span className="text-base leading-none" aria-hidden>+</span>
                  리뷰 추가
                </button>
              )}
            </div>
          )}
      </div>
    </section>
  );
}
