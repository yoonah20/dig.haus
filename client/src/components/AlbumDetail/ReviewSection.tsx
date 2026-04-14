import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import type { Review } from '../../types';
import { getScoreColor as scoreColor, getScoreBgColor as scoreBgColor } from '../../utils/score';
import { useAuth } from '../../contexts/AuthContext';

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
          placeholder="0-100 또는 -"
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

function ReviewCard({ review, onScoreSaved, onRetranslated }: { review: Review; onScoreSaved: () => void; onRetranslated: () => void }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [retranslating, setRetranslating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingExcerpt, setSavingExcerpt] = useState(false);
  const [excerptDraft, setExcerptDraft] = useState('');

  const handleRetranslate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRetranslating(true);
    try {
      await axios.post(`/api/albums/reviews/${review.id}/retranslate`);
      onRetranslated();
    } catch {}
    setRetranslating(false);
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
}

export default function ReviewSection({ reviews, koreanSummary, averageScore }: ReviewSectionProps) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const scoredCount = reviews.filter(r => r.score !== null).length;
  const hasContent = reviews.length > 0 || koreanSummary || averageScore !== null;
  const [expanded, setExpanded] = useState(false);

  const handleScoreSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
  }, [queryClient, slug]);

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
      <h2
        className="text-2xl font-bold text-white mb-6 font-serif"
      >
        리뷰
      </h2>

      {!hasContent ? (
        <p className="text-gray-500">리뷰를 찾을 수 없습니다</p>
      ) : (
        <div className="space-y-6">
          {averageScore !== null && (
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-bold ${scoreColor(averageScore)}`}>
                {Math.round(averageScore)}
              </span>
              <span className="text-gray-500 text-lg">/ 100</span>
              {scoredCount > 0 && (
                <span className="text-gray-600 text-sm ml-1">({scoredCount}개 사이트 평균)</span>
              )}
            </div>
          )}

          {koreanSummary && (
            <div className="bg-[#1a1a1a] rounded-xl p-5 border-l-4 border-[#e8a020]">
              <p className="text-gray-300 leading-relaxed">{koreanSummary}</p>
            </div>
          )}

          {sortedReviews.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleReviews.map((review) => (
                <ReviewCard key={review.id} review={review} onScoreSaved={handleScoreSaved} onRetranslated={handleScoreSaved} />
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
        </div>
      )}
    </section>
  );
}
