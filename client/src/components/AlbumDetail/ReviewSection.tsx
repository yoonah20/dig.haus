import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import axios from '../../lib/axios';
import type { Review } from '../../types';
import { getScoreColor as scoreColor, getScoreBgColor as scoreBgColor } from '../../utils/score';
import { useAuth } from '../../contexts/AuthContext';
import { AiSummaryBadge } from './SimilarAlbums';
import { useGenerateReviewSummary, useDiscoverReviewUrls } from '../../hooks/useAlbum';
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

function ReviewCard({ review, onScoreSaved, onRetranslated, onDeleted, justAdded }: { review: Review; onScoreSaved: () => void; onRetranslated: () => void; onDeleted: () => void; justAdded?: boolean }) {
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
    <Wrapper {...wrapperProps} className={`relative block bg-[#1a1a1a] rounded-lg p-4 transition-colors duration-200 group/card ${editing ? '' : 'hover:bg-[#252525] cursor-pointer'} ${justAdded ? 'ring-2 ring-[#e8a020]/70 shadow-[0_0_24px_rgba(232,160,32,0.35)]' : ''}`}>
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
  const discover = useDiscoverReviewUrls(slug ?? '');
  const [expanded, setExpanded] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [addingReview, setAddingReview] = useState(false);
  const [addMode, setAddMode] = useState<'url' | 'manual'>('url');
  const [addUrl, setAddUrl] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  // Ring-glow marker for reviews added during this session — helps
  // admin spot a freshly-ingested card (especially when Claude
  // misscored it) before the grid reshuffles on the next sort. State
  // is in-memory only; a page refresh clears it, which is fine.
  const [justAddedIds, setJustAddedIds] = useState<Set<number>>(new Set());

  // Manual-entry fields (for sites that block crawling).
  // AllMusic is the default source because it's the one admin
  // pastes from most often in practice; pre-filling it turns the
  // three-required-fields flow into two in the common case.
  const [manualSource, setManualSource] = useState('AllMusic');
  const [manualUrl, setManualUrl] = useState('');
  const [manualScore, setManualScore] = useState('');
  const [manualBody, setManualBody] = useState('');

  const startAddReview = () => {
    setAddUrl('');
    setManualSource('AllMusic');
    setManualUrl('');
    setManualScore('');
    setManualBody('');
    setAddMode('url');
    setAddingReview(true);
  };

  const cancelAddReview = () => {
    if (savingReview) return;
    setAddingReview(false);
    setAddUrl('');
    setManualSource('AllMusic');
    setManualUrl('');
    setManualScore('');
    setManualBody('');
    setBatchProgress(null);
  };

  const saveAddReview = async () => {
    if (!slug) return;
    // Split on any newline, trim, drop empties. Lets admin paste a
    // list of URLs (one per line) or a single URL interchangeably.
    const urls = addUrl
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length === 0) {
      alert('URL을 최소 한 개 입력해주세요.');
      return;
    }
    const invalid = urls.find((u) => !/^https?:\/\//i.test(u));
    if (invalid) {
      alert(`http:// 또는 https:// 로 시작해야 합니다:\n${invalid}`);
      return;
    }

    setSavingReview(true);
    let added = 0;
    let duplicate = 0;
    const failures: Array<{ url: string; msg: string }> = [];
    const newIds: number[] = [];
    try {
      for (let i = 0; i < urls.length; i++) {
        setBatchProgress({ current: i + 1, total: urls.length });
        try {
          const resp = await axios.post(`/api/albums/${slug}/reviews/add-url`, { url: urls[i] });
          if (resp.data?.duplicate) duplicate++;
          else {
            added++;
            if (typeof resp.data?.review?.id === 'number') newIds.push(resp.data.review.id);
          }
        } catch (err: any) {
          const msg = err?.response?.data?.error || '알 수 없는 오류';
          failures.push({ url: urls[i], msg });
        }
      }
      if (newIds.length > 0) {
        setJustAddedIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.add(id));
          return next;
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });

      if (failures.length === 0 && urls.length === 1) {
        // Single-URL success path stays quiet, matching the pre-batch UX.
        setAddingReview(false);
        setAddUrl('');
      } else {
        const summary = [
          `추가: ${added}`,
          duplicate > 0 ? `중복: ${duplicate}` : null,
          failures.length > 0 ? `실패: ${failures.length}` : null,
        ]
          .filter(Boolean)
          .join(' / ');
        const detail = failures.length
          ? '\n\n실패한 URL:\n' + failures.map((f) => `• ${f.url}\n  → ${f.msg}`).join('\n')
          : '';
        alert(summary + detail);
        setAddingReview(false);
        setAddUrl('');
      }
    } finally {
      setSavingReview(false);
      setBatchProgress(null);
    }
  };

  const saveManualReview = async () => {
    if (!slug) return;
    const source = manualSource.trim();
    const body = manualBody.trim();
    if (!source) {
      alert('사이트 이름을 입력해주세요.');
      return;
    }
    if (body.length < 50) {
      alert('본문 텍스트가 너무 짧습니다 (최소 50자).');
      return;
    }
    const url = manualUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      alert('URL은 http:// 또는 https:// 로 시작해야 합니다.');
      return;
    }
    let scoreNum: number | null = null;
    const scoreStr = manualScore.trim();
    if (scoreStr) {
      const n = parseFloat(scoreStr);
      if (isNaN(n) || n < 0 || n > 100) {
        alert('점수는 0-100 사이의 숫자여야 합니다.');
        return;
      }
      scoreNum = n;
    }

    setSavingReview(true);
    try {
      const resp = await axios.post(`/api/albums/${slug}/reviews/manual`, {
        sourceName: source,
        url: url || undefined,
        score: scoreNum,
        body,
      });
      if (typeof resp.data?.review?.id === 'number') {
        const newId = resp.data.review.id as number;
        setJustAddedIds((prev) => new Set(prev).add(newId));
      }
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
      setAddingReview(false);
      setManualSource('AllMusic');
      setManualUrl('');
      setManualScore('');
      setManualBody('');
    } catch (err: any) {
      console.error('Manual review error:', err);
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

  // Admin sees every review up front — the "+N 더 보기" card
  // otherwise ends up next to the + 리뷰 추가 slot and makes the
  // grid feel crowded for whoever's doing the registration work.
  // Visitors still see the truncation so the section doesn't scroll
  // forever on heavily-reviewed albums.
  const needsExpand = !isAdmin && sortedReviews.length > INITIAL_COUNT;
  const visibleReviews =
    isAdmin || expanded ? sortedReviews : sortedReviews.slice(0, INITIAL_COUNT);
  const hiddenCount = sortedReviews.length - INITIAL_COUNT;

  return (
    <section>
      <h2 className="text-2xl font-bold text-white mb-6 font-serif flex items-baseline gap-2 flex-wrap">
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

        {koreanSummary && (
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

          {/* Non-admin empty state — rendered as a single review-card
              sized cell so the review section doesn't collapse into
              an empty gap. Shown whenever there are no cached
              reviews, regardless of crawl state; the guest path no
              longer distinguishes between "pending crawl" and
              "crawled but empty" because the distinction is an
              admin-operational detail that doesn't help visitors.
              Admin's own empty state is the "+ 리뷰 추가" slot below. */}
          {sortedReviews.length === 0 && !koreanSummary && !isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="flex items-center justify-center bg-[#151515] border border-white/5 rounded-lg p-4 min-h-[100px] text-sm text-gray-500">
                등록된 리뷰가 없습니다
              </div>
            </div>
          )}

          {(sortedReviews.length > 0 || isAdmin) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleReviews.map((review) => (
                <ReviewCard key={review.id} review={review} onScoreSaved={handleScoreSaved} onRetranslated={handleScoreSaved} onDeleted={handleDeleted} justAdded={justAddedIds.has(review.id)} />
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

              {/* + 리뷰 추가 as the last cell of the reviews grid —
                  same dashed-card style as the "+N 더 보기" slot so
                  the visual language stays consistent. When clicked,
                  the cell itself expands into the form panel below
                  (col-span-full) so the input appears right at the
                  click location instead of jumping to the top of
                  the section. */}
              {isAdmin && !addingReview && (
                <button
                  type="button"
                  onClick={startAddReview}
                  className="flex flex-col items-center justify-center gap-1 bg-[#151515] hover:bg-[#1e1e1e] border border-dashed border-[#e8a020]/40 hover:border-[#e8a020]/70 text-[#e8a020] rounded-lg p-4 transition-all duration-200 cursor-pointer min-h-[100px]"
                >
                  <span className="text-2xl leading-none font-bold" aria-hidden>+</span>
                  <span className="text-sm font-medium">리뷰 추가</span>
                </button>
              )}

              {isAdmin && addingReview && (
                <div className="col-span-full bg-[#1a1a1a] rounded-lg p-4 space-y-3 border border-white/10 max-w-xl relative">
                  {/* Close chip top-right, window-style. Mouse travel
                      from the textarea save to a corner × is short,
                      and the primary 저장 button sits directly under
                      the input so the paste → save path is one
                      downward move. */}
                  <button
                    type="button"
                    onClick={cancelAddReview}
                    disabled={savingReview}
                    aria-label="닫기"
                    title="닫기 (Esc)"
                    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ✕
                  </button>

                  <div className="flex gap-1 border-b border-white/10 pr-8">
                    <button
                      type="button"
                      onClick={() => setAddMode('url')}
                      disabled={savingReview}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer ${
                        addMode === 'url'
                          ? 'bg-[#0f0f0f] text-[#e8a020] border-t border-x border-white/10'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddMode('manual')}
                      disabled={savingReview}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer ${
                        addMode === 'manual'
                          ? 'bg-[#0f0f0f] text-[#e8a020] border-t border-x border-white/10'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      수동 입력
                    </button>
                  </div>

                  {addMode === 'url' ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <label className="block text-xs text-gray-400">
                          리뷰 URL <span className="text-gray-600">(여러 개는 한 줄에 하나씩)</span>
                        </label>
                        <button
                          type="button"
                          onClick={async () => {
                            if (discover.isPending || savingReview) return;
                            try {
                              const result = await discover.mutateAsync();
                              const found = result.urls ?? [];
                              if (found.length === 0) {
                                alert(result.message || '후보 URL을 찾지 못했어요.');
                                return;
                              }
                              // Filter out URLs already registered as
                              // reviews for this album — otherwise the
                              // batch scrape's dup-detect wastes a
                              // Claude call per known URL.
                              const existing = new Set(
                                reviews.map((r) => r.url).filter((u): u is string => !!u)
                              );
                              const fresh = found.filter((u) => !existing.has(u));
                              if (fresh.length === 0) {
                                alert('찾은 후보가 모두 이미 등록된 리뷰예요.');
                                return;
                              }
                              // Append, preserving anything admin already typed.
                              setAddUrl((prev) => {
                                const current = prev.trim();
                                return [current, ...fresh]
                                  .filter((s) => s.length > 0)
                                  .join('\n');
                              });
                            } catch (err: any) {
                              alert(
                                err?.response?.data?.error ||
                                  'URL 검색에 실패했어요.'
                              );
                            }
                          }}
                          disabled={discover.isPending || savingReview}
                          className="text-[11px] text-[#e8a020]/80 hover:text-[#e8a020] border border-[#e8a020]/40 hover:border-[#e8a020]/70 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          title="Serper로 구글 검색 → Haiku가 editorial 리뷰 URL 선별 (~$0.001)"
                        >
                          {discover.isPending ? '검색 중…' : '🔎 URL 자동 검색'}
                        </button>
                      </div>
                      <textarea
                        value={addUrl}
                        onChange={(e) => setAddUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelAddReview();
                          }
                        }}
                        disabled={savingReview}
                        placeholder={'https://angrymetalguy.com/...\nhttps://pitchfork.com/...'}
                        autoFocus
                        rows={4}
                        className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 font-mono"
                      />
                      <button
                        onClick={saveAddReview}
                        disabled={savingReview || !addUrl.trim()}
                        className="w-full py-2 text-sm font-medium text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020] hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#e8a020] transition-colors cursor-pointer"
                      >
                        {savingReview
                          ? batchProgress
                            ? `페이지 분석 중... ${batchProgress.current}/${batchProgress.total}`
                            : '페이지 분석 중...'
                          : '저장'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* URL comes first — admin opens the target page,
                          paste its URL before anything else so the rest
                          of the form (source name, score, body) flows
                          from what's already on screen. Fine to leave
                          blank for paywalled / login-walled articles
                          where no shareable URL exists. */}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          원문 URL <span className="text-gray-600">(선택)</span>
                        </label>
                        <input
                          type="url"
                          value={manualUrl}
                          onChange={(e) => setManualUrl(e.target.value)}
                          disabled={savingReview}
                          placeholder="https://..."
                          className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            사이트 이름 <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="text"
                            value={manualSource}
                            onChange={(e) => setManualSource(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            disabled={savingReview}
                            placeholder="AllMusic 등"
                            maxLength={100}
                            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            점수 <span className="text-gray-600">(선택)</span>
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={manualScore}
                            onChange={(e) => setManualScore(e.target.value)}
                            disabled={savingReview}
                            placeholder="0-100"
                            maxLength={3}
                            className="w-20 bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          본문 텍스트 <span className="text-red-400">*</span>{' '}
                          <span className="text-gray-600">(복사한 원문, 최소 50자)</span>
                        </label>
                        <textarea
                          value={manualBody}
                          onChange={(e) => setManualBody(e.target.value)}
                          disabled={savingReview}
                          rows={8}
                          placeholder="기사 본문을 붙여넣으세요..."
                          className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                        />
                      </div>
                      <button
                        onClick={saveManualReview}
                        disabled={savingReview || !manualSource.trim() || manualBody.trim().length < 50}
                        className="w-full py-2 text-sm font-medium text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020] hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#e8a020] transition-colors cursor-pointer"
                      >
                        {savingReview ? '본문 분석 중...' : '저장'}
                      </button>
                    </>
                  )}
                </div>
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

      </div>
    </section>
  );
}
