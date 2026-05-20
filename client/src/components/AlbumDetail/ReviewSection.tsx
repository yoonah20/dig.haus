import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import axios from '../../lib/axios';
import type { Review } from '../../types';
import { getScoreColor as scoreColor, getScoreBgColor as scoreBgColor } from '../../utils/score';
import { useAuth } from '../../contexts/AuthContext';
import {
  useGenerateReviewSummary,
  useDiscoverReviewUrls,
  type DiscoveryEngine,
} from '../../hooks/useAlbum';
import { MIN_SCORED_FOR_AVG } from '../../lib/reviewThresholds';
import CardOverlayButton from '../CardOverlayButton';
import { Field, DigmanEmpty, Button, Popover } from '../ui';
import { useReportReview, type ReviewReportReason } from '../../hooks/useAlbum';

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

const REVIEW_REPORT_REASONS: ReadonlyArray<{
  value: ReviewReportReason;
  label: string;
}> = [
  { value: 'wrong-album', label: '이 앨범 리뷰가 아니에요' },
  { value: 'bad-translation', label: '번역이 이상해요' },
  { value: 'not-a-review', label: '링크에 다른 내용이 있어요' },
];

// Non-admin review-card flag. Mirrors PurchaseLinksPanel.ReportPopover —
// radio-selected reason, single submit, closes on outside click or
// Escape. Submitting is idempotent server-side, so we close the popover
// even on the "이미 신고한" 409 path so the user doesn't get stuck
// poking the button.
function ReviewReportPopover({
  reviewId,
  onClose,
}: {
  reviewId: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReviewReportReason>('wrong-album');
  const [err, setErr] = useState<string | null>(null);
  const report = useReportReview();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    // Same rationale as the purchase-link popover — `click` (not
    // `pointerdown`) avoids the trigger's own click event also being
    // treated as an outside-click.
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  const submit = async () => {
    setErr(null);
    try {
      await report.mutateAsync({ reviewId, reason });
      onClose();
    } catch (e: any) {
      const status = e?.response?.status;
      // 409 = UNIQUE collision (already reported). From the user's
      // perspective the report exists, so treat it as success.
      if (status === 409) {
        onClose();
        return;
      }
      setErr(e?.response?.data?.error ?? '신고에 실패했습니다.');
    }
  };

  return (
    <Popover
      ref={rootRef}
      role="dialog"
      aria-label="리뷰 신고"
      strong={false}
      radius="lg"
      pad="sm"
      shadow="xl"
      className="absolute top-full right-0 mt-2 z-30 w-56 text-xs"
      onClick={(e: React.MouseEvent) => {
        // Stop the parent <a> from navigating when the popover is
        // clicked — stopPropagation alone is enough; preventDefault
        // here would block the radio inputs' native toggle behaviour.
        e.stopPropagation();
      }}
    >
      <div className="text-gray-400 text-[11px] uppercase tracking-wider mb-1.5">
        신고 사유
      </div>
      <div className="flex flex-col gap-0.5">
        {REVIEW_REPORT_REASONS.map((r) => (
          <label
            key={r.value}
            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer text-gray-200"
          >
            <input
              type="radio"
              name={`review-report-${reviewId}`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="accent-accent"
            />
            {r.label}
          </label>
        ))}
      </div>
      {err && (
        <div className="text-red-400 text-[11px] mt-1.5 px-1">{err}</div>
      )}
      <div className="flex items-center justify-end gap-1.5 mt-2">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
          className="text-gray-500 hover:text-gray-300 px-2 py-1 cursor-pointer"
        >
          취소
        </button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={report.isPending}
        >
          {report.isPending ? '…' : '신고'}
        </Button>
      </div>
    </Popover>
  );
}

function ReviewCard({ review, onScoreSaved, onRetranslated, onDeleted, justAdded }: { review: Review; onScoreSaved: () => void; onRetranslated: () => void; onDeleted: () => void; justAdded?: boolean }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const loggedIn = !!user;
  const [retranslating, setRetranslating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingExcerpt, setSavingExcerpt] = useState(false);
  const [excerptDraft, setExcerptDraft] = useState('');
  const [reporting, setReporting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteDraft, setPasteDraft] = useState('');
  const [extracting, setExtracting] = useState(false);
  const formActive = editing || pasting;

  const handleRetranslate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 원문 페이지를 Jina로 다시 받아서 LLM에 전체 페이지를 다시
    // 보여주고 발쳐 + 한국어 요약을 새로 추출하는 흐름. 저장된
    // excerpt만 다시 번역하던 옷 동작은 매 클릭마다 거의 같은
    // 결과를 내놓는 문제가 있어서 폐기됨.
    if (!confirm('원문 페이지를 다시 읽고 발쳐 + 요약을 새로 추출할까요? (외부 API 호출됩니다)')) return;
    setRetranslating(true);
    try {
      await axios.post(`/api/albums/reviews/${review.id}/rescrape`);
      onRetranslated();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error;
      alert(apiMessage || '원문 다시 읽기에 실패했어요.');
    }
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

  const startPaste = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPasteDraft('');
    setPasting(true);
  };

  const cancelPaste = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (extracting) return;
    setPasting(false);
  };

  // Companion to ↻ (Jina re-fetch) for cases where Jina keeps returning
  // the wrong page (paywall stub, cookie banner, JS-only nav). Admin
  // pastes the real article body from the browser and we re-run the
  // same LLM extraction the + 리뷰 추가 / 수동 입력 tab uses, so we
  // get score + 2-sentence excerpt + Korean summary without touching
  // Jina at all.
  const submitPaste = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pasteDraft.trim().length < 50) {
      alert('본문이 너무 짧아요. 최소 50자 이상 붙여넣어 주세요.');
      return;
    }
    setExtracting(true);
    try {
      await axios.post(`/api/albums/reviews/${review.id}/rescrape-paste`, {
        body: pasteDraft,
      });
      onRetranslated();
      setPasting(false);
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error;
      alert(apiMessage || '본문 추출에 실패했어요.');
    } finally {
      setExtracting(false);
    }
  };

  // When editing or pasting, render a plain div (no outer <a>) to keep
  // the inline form usable.
  const Wrapper = formActive ? 'div' : (review.url ? 'a' : 'div');
  const wrapperProps = !formActive && review.url
    ? { href: review.url, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper {...wrapperProps} className={`relative block bg-panel rounded-lg p-4 transition-colors duration-200 group/card ${formActive ? '' : 'hover:bg-panel-hover cursor-pointer'} ${justAdded ? 'ring-2 ring-accent/70 shadow-[0_0_24px_rgba(232,160,32,0.35)]' : ''}`}>
      {loggedIn && !isAdmin && !formActive && (
        // Non-admin can't delete/rescrape/edit, but they can flag a
        // card that came in wrong. ⚑ matches the purchase-link report
        // affordance so the gesture transfers. Popover sits below the
        // button (top-full) instead of replacing the overlay; the
        // overlay button retains its raised-pill style for visual
        // consistency with admin's row.
        <div className="absolute -top-3 right-2 z-20 flex items-center gap-1 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
          <CardOverlayButton
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setReporting((v) => !v);
            }}
            title="잘못된 리뷰 신고"
          >
            ⚑
          </CardOverlayButton>
          {reporting && (
            <ReviewReportPopover
              reviewId={review.id}
              onClose={() => setReporting(false)}
            />
          )}
        </div>
      )}
      {isAdmin && !formActive && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
          <CardOverlayButton onClick={startEditExcerpt} title="본문 수정">
            ✎
          </CardOverlayButton>
          <CardOverlayButton
            onClick={handleRetranslate}
            disabled={retranslating}
            title="원문 다시 읽기 (Jina로 재추출)"
          >
            {retranslating ? '…' : '↻'}
          </CardOverlayButton>
          <CardOverlayButton
            onClick={startPaste}
            title="원문 직접 붙여넣기 다시 추출 (Jina가 잘못된 페이지를 가져올 때)"
          >
            📋
          </CardOverlayButton>
          <CardOverlayButton
            variant="danger"
            onClick={handleDelete}
            disabled={deleting}
            title="리뷰 삭제"
          >
            ×
          </CardOverlayButton>
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-white font-semibold text-sm truncate">{review.source}</span>
          {review.verified && (
            <span
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#1DB954] flex-shrink-0"
              title="검증된 매체"
              aria-label="검증된 매체"
            >
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" aria-hidden="true">
                <path d="M2.5 6.2 L5 8.5 L9.5 3.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </div>
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
            className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60 resize-y"
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
              className="px-2 py-0.5 text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
              aria-label="저장"
            >
              {savingExcerpt ? '...' : '✓'}
            </button>
          </div>
        </div>
      ) : pasting ? (
        <div className="space-y-2">
          <textarea
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            disabled={extracting}
            rows={10}
            autoFocus
            placeholder="원문 페이지에서 리뷰 본문을 복사해 붙여넣으세요. score / 발쳐 / 한국어 요약을 다시 추출합니다."
            className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-sm text-gray-200 placeholder:text-gray-500 focus:border-accent focus:outline-none disabled:opacity-60 resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">
              {extracting ? '추출 중...' : `${pasteDraft.trim().length}자 (최소 50자)`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={cancelPaste}
                disabled={extracting}
                className="px-2 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
                aria-label="취소"
              >
                ✕
              </button>
              <button
                onClick={submitPaste}
                disabled={extracting || pasteDraft.trim().length < 50}
                className="px-2 py-0.5 text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
                aria-label="추출"
              >
                {extracting ? '...' : '↻'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        (review.excerptKo || review.excerpt) && (
          <p className="text-gray-300 text-sm leading-normal tracking-tight">
            {retranslating ? '원문 다시 읽는 중...' : (review.excerptKo || review.excerpt)}
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
  /** When set (admin arrived from the scrape-failure panel's retry
   *  link), auto-open the + 리뷰 추가 form on the 수동 입력 tab with
   *  URL + derived source name pre-filled. */
  prefillManualUrl?: string | null;
  /** Live progress for a user-triggered auto-curation, polled by the
   *  parent page. Non-null only while a run is in flight for this
   *  album; we swap the static "pending" digman for the digging
   *  variant with N/15 counters so the user sees the pipeline working
   *  instead of guessing. */
  autoCurationProgress?: import('../../hooks/useAlbum').AutoCurationProgress | null;
}

// localStorage keyed store of (hostname → source name) pairs admin has
// used during past manual entries. Drives the datalist suggestions on
// the 사이트 이름 input so repeat sites don't need re-typing, and
// provides the auto-fill default when we derive from a URL's hostname.
const MANUAL_SOURCE_HISTORY_KEY = 'manual-review-source-history';
const MANUAL_SOURCE_HISTORY_LIMIT = 50;

function loadSourceHistory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MANUAL_SOURCE_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function rememberSource(hostname: string, sourceName: string): void {
  if (!hostname || !sourceName) return;
  try {
    const history = loadSourceHistory();
    history[hostname] = sourceName;
    // Cap the dictionary size so it can't grow unbounded.
    const entries = Object.entries(history);
    if (entries.length > MANUAL_SOURCE_HISTORY_LIMIT) {
      // Drop oldest-inserted; Object iteration preserves insertion order.
      const trimmed = Object.fromEntries(entries.slice(-MANUAL_SOURCE_HISTORY_LIMIT));
      localStorage.setItem(MANUAL_SOURCE_HISTORY_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(MANUAL_SOURCE_HISTORY_KEY, JSON.stringify(history));
    }
  } catch {
    /* localStorage quota / privacy mode / etc — fail silently */
  }
}

// Title-cased fallback when hostname isn't in history yet. Strips
// www., drops the TLD, and capitalises. metalstorm.net → MetalStorm,
// theprogspace.com → Theprogspace (admin can edit).
function guessSourceFromHostname(hostname: string): string {
  const clean = hostname.replace(/^www\./i, '');
  const core = clean.split('.')[0] || clean;
  if (!core) return '';
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

// Phase → user-facing copy for the digging-state digman. The text
// updates as the run advances through queued → discovering → scraping
// (with N/15 counter) → summarizing. Kept short so the digman + label
// pair stays compact in the section's empty slot.
function curationPhaseLabel(
  p: import('../../hooks/useAlbum').AutoCurationProgress
): string {
  switch (p.phase) {
    case 'queued':
      return '리뷰 수집 대기 중';
    case 'discovering':
      return '리뷰 출처 검색 중';
    case 'scraping':
      return p.urlsFound > 0
        ? `리뷰 발굴 중 ${p.urlsSaved}/${Math.min(p.urlsFound, 15)}`
        : '리뷰 발굴 중';
    case 'summarizing':
      return '한국어 요약 생성 중';
  }
}

function curationPhaseHint(
  p: import('../../hooks/useAlbum').AutoCurationProgress
): string {
  switch (p.phase) {
    case 'queued':
      return '곧 시작합니다';
    case 'discovering':
      return '구글에서 리뷰 페이지를 찾고 있어요';
    case 'scraping':
      return '리뷰 본문을 읽고 한국어로 옮기는 중이에요';
    case 'summarizing':
      return '거의 다 됐어요';
  }
}

export default function ReviewSection({
  reviews,
  koreanSummary,
  averageScore,
  pendingNotice,
  albumTitle,
  albumArtist,
  prefillManualUrl,
  autoCurationProgress,
}: ReviewSectionProps) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const scoredCount = reviews.filter(r => r.score !== null).length;
  const regenSummary = useGenerateReviewSummary(slug ?? '');
  const discover = useDiscoverReviewUrls(slug ?? '');
  // Engine selector for the 🔎 URL 자동 검색 button. localStorage
  // persists across album navigations so admin doesn't re-pick
  // every time. Initialised lazily so SSR-rendered first paint
  // doesn't touch window.localStorage; falls back to serper if the
  // stored value is missing or corrupt.
  const [discoverEngine, setDiscoverEngine] = useState<DiscoveryEngine>(
    () => {
      if (typeof window === 'undefined') return 'serper';
      const saved = window.localStorage.getItem('admin:discoverEngine');
      return saved === 'tavily' || saved === 'brave' ? saved : 'serper';
    }
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('admin:discoverEngine', discoverEngine);
  }, [discoverEngine]);
  const [expanded, setExpanded] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [addingReview, setAddingReview] = useState(false);
  const [addMode, setAddMode] = useState<'url' | 'manual'>('url');
  const [addUrl, setAddUrl] = useState('');
  // URL 자동 검색 results surface as a checklist below the textarea:
  // each returned URL gets a checkbox (default on). Admin can uncheck
  // ones they don't want scraped. Saved = textarea lines + ticked
  // discovered URLs, de-duped before POST. Separate from addUrl so the
  // admin can still paste manual URLs without clobbering the list.
  const [discoveredUrls, setDiscoveredUrls] = useState<
    Array<{ url: string; selected: boolean }>
  >([]);
  const [savingReview, setSavingReview] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  // Ring-glow marker for reviews added during this session — helps
  // admin spot a freshly-ingested card (especially when Claude
  // misscored it) before the grid reshuffles on the next sort. State
  // is in-memory only; a page refresh clears it, which is fine.
  const [justAddedIds, setJustAddedIds] = useState<Set<number>>(new Set());

  // Manual-entry fields (for sites that block crawling). Default
  // source is derived from localStorage history — the most recent
  // entry admin registered, or 'AllMusic' on first use. When admin
  // arrives via a retry-url deep link, the source gets re-derived
  // from the URL's hostname inside the effect below.
  const [sourceHistory] = useState<Record<string, string>>(() => loadSourceHistory());
  const initialSource =
    Object.values(sourceHistory).slice(-1)[0] || 'AllMusic';
  const [manualSource, setManualSource] = useState(initialSource);
  const [manualUrl, setManualUrl] = useState('');
  const [manualScore, setManualScore] = useState('');
  const [manualBody, setManualBody] = useState('');

  // Deep-link handler: when ?retry-url=... is on the Album page URL,
  // open the + 리뷰 추가 form on the 수동 입력 tab with URL + source
  // pre-filled. Fires once on mount (and once if prefillManualUrl
  // changes, e.g. admin clicks a different retry link without a full
  // navigation).
  useEffect(() => {
    if (!prefillManualUrl) return;
    const host = parseHostname(prefillManualUrl);
    const remembered = host ? sourceHistory[host] : null;
    const source = remembered || guessSourceFromHostname(host) || 'AllMusic';
    setManualUrl(prefillManualUrl);
    setManualSource(source);
    setAddMode('manual');
    setAddingReview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillManualUrl]);

  // Falls back to AllMusic on first use, then to whatever admin used
  // most recently. Keeps the 사이트 이름 input "smart" without
  // reaching for the history dict every time.
  const defaultManualSource = () =>
    Object.values(sourceHistory).slice(-1)[0] || 'AllMusic';

  const startAddReview = async () => {
    setAddUrl('');
    setDiscoveredUrls([]);
    setManualSource(defaultManualSource());
    setManualUrl('');
    setManualScore('');
    setManualBody('');
    setAddMode('url');
    setAddingReview(true);

    // Common case: admin copied a review URL from another tab and
    // came here to paste it. Pre-fill the textarea from the
    // clipboard so the gesture is one click instead of click → ⌘V.
    // Silently no-ops if the clipboard API is unavailable, permission
    // is denied, or the contents aren't URL-shaped — falls back to
    // the empty textarea the admin sees today.
    //
    // Multi-URL clipboards (one URL per line) flow through unchanged:
    // the existing add-URL parser splits on newlines, so a list of
    // URLs lands as a list, not a single concatenated string.
    try {
      if (!navigator.clipboard?.readText) return;
      const text = await navigator.clipboard.readText();
      if (text && /^https?:\/\//i.test(text.trim())) {
        setAddUrl(text.trim());
      }
    } catch {
      // ignore — denied / unavailable / not URL-shaped
    }
  };

  const cancelAddReview = () => {
    if (savingReview) return;
    setAddingReview(false);
    setAddUrl('');
    setDiscoveredUrls([]);
    setManualSource(defaultManualSource());
    setManualUrl('');
    setManualScore('');
    setManualBody('');
    setBatchProgress(null);
  };

  const saveAddReview = async () => {
    if (!slug) return;
    // Combine two sources: textarea (manually pasted URLs, one per
    // line) and the discoveredUrls checklist (ticked entries only).
    // De-dupe in case admin both pasted and discovered the same URL
    // — scraping the same URL twice burns a Claude call for nothing.
    const pastedUrls = addUrl
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    const tickedDiscovered = discoveredUrls
      .filter((d) => d.selected)
      .map((d) => d.url);
    const urls = Array.from(new Set([...pastedUrls, ...tickedDiscovered]));
    if (urls.length === 0) {
      alert('URL을 최소 한 개 입력하거나 자동 검색 결과에서 선택해주세요.');
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
    // Concurrent chunks instead of strict sequential processing. Each
    // add-url call takes 5-10s (Jina fetch + DeepSeek extract + Korean
    // translate). Matches CurationProgressContext's chunk size (8)
    // so the manual + batch flows share the same parallelism profile
    // — previously manual was at 5 and ran noticeably slower than
    // auto-curation on the same album. DeepSeek free-tier rate
    // allowance and Jina Reader both handle 8 concurrent comfortably.
    const CHUNK_SIZE = 8;
    let completed = 0;
    try {
      for (let start = 0; start < urls.length; start += CHUNK_SIZE) {
        const chunk = urls.slice(start, start + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (url) => {
            try {
              const resp = await axios.post(`/api/albums/${slug}/reviews/add-url`, { url });
              if (resp.data?.duplicate) duplicate++;
              else {
                added++;
                if (typeof resp.data?.review?.id === 'number') newIds.push(resp.data.review.id);
              }
            } catch (err: any) {
              const msg = err?.response?.data?.error || '알 수 없는 오류';
              failures.push({ url, msg });
            } finally {
              completed++;
              setBatchProgress({ current: completed, total: urls.length });
            }
          })
        );
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
        setDiscoveredUrls([]);
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
        setDiscoveredUrls([]);
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
      // Remember this (hostname → source) pair so the next manual entry
      // from the same site auto-fills the correct source name.
      const host = url ? parseHostname(url) : '';
      if (host) rememberSource(host, source);
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
      setAddingReview(false);
      // Keep the last-used source as the default for the next entry —
      // admin often pastes multiple reviews from the same site back-to-back.
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

  const handleDeleteSummary = async () => {
    if (!slug) return;
    if (!confirm('요약을 삭제할까요? 리뷰는 그대로 남아 있으며, 재생성 버튼으로 다시 만들 수 있습니다.')) return;
    setSavingSummary(true);
    try {
      await axios.patch(`/api/albums/${slug}/korean-summary`, {
        korean_summary: null,
      });
      await queryClient.invalidateQueries({ queryKey: ['album', slug] });
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', slug] });
    } catch (err) {
      console.error('Delete korean summary error:', err);
      alert('요약 삭제에 실패했습니다.');
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
      <div className="space-y-6">
        {pendingNotice}

        {/* Score + Korean summary share one card. Average hidden when
            fewer than MIN_SCORED_FOR_AVG scored reviews — with 1 or 2,
            the "average" is really just one opinion and the big
            headline number misleads. Card still renders for the
            summary alone when the score doesn't qualify. */}
        {(koreanSummary || (averageScore !== null && scoredCount >= MIN_SCORED_FOR_AVG)) && (
            <div className="relative group/summary bg-panel rounded-panel p-5 border-l-4 border-accent">
              {isAdmin && !editingSummary && koreanSummary && (
                <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover/summary:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
                  {albumTitle && albumArtist && (
                    <CardOverlayButton
                      onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(`${albumArtist} ${albumTitle} review`)}`, '_blank', 'noopener,noreferrer')}
                      title={`"${albumArtist} ${albumTitle} review" 구글 검색`}
                    >
                      🔍
                    </CardOverlayButton>
                  )}
                  <CardOverlayButton onClick={startEditSummary} title="요약 수정">
                    ✎
                  </CardOverlayButton>
                  <CardOverlayButton
                    onClick={handleRegenerateSummary}
                    disabled={regenSummary.isPending}
                    title="요약 재생성 (리뷰 2개 이상 필요, ~$0.01)"
                  >
                    {regenSummary.isPending ? '…' : '↻'}
                  </CardOverlayButton>
                  <CardOverlayButton
                    variant="danger"
                    onClick={handleDeleteSummary}
                    disabled={savingSummary}
                    title="요약 삭제"
                  >
                    ×
                  </CardOverlayButton>
                </div>
              )}
              {editingSummary ? (
                <div className="space-y-2">
                  <textarea
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    disabled={savingSummary}
                    rows={Math.max(3, Math.ceil(summaryDraft.length / 60))}
                    autoFocus
                    className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60 resize-y leading-relaxed"
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
                      className="px-2 py-0.5 text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
                      aria-label="저장"
                    >
                      {savingSummary ? '...' : '✓'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden">
                  {averageScore !== null && scoredCount >= MIN_SCORED_FOR_AVG && (
                    // sm:text-7xl sizes the float box to ~100px so the first 5 lines of the summary (leading-relaxed text-sm = 22.75px/line) wrap right of the score and line 6 falls below at full width.
                    <div className="float-left mr-4 mb-1 text-center">
                      <div className="flex items-baseline gap-1 justify-center">
                        <span className={`text-6xl sm:text-7xl font-bold leading-none ${scoreColor(averageScore)}`}>
                          {Math.round(averageScore)}
                        </span>
                        <span className="text-gray-500 text-lg">/100</span>
                      </div>
                      <div className="text-gray-600 text-[11px] mt-1.5">({scoredCount}개 사이트 평균)</div>
                    </div>
                  )}
                  {koreanSummary && (
                    <p className="text-gray-300 text-sm leading-relaxed">
                      {koreanSummary}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Non-admin empty state — splits two ways based on whether
              auto-curation is actively running for this album:
                - In flight (autoCurationProgress non-null): digging
                  variant with phase-specific message + N/15 counter
                  during the scrape step. Page auto-refreshes on
                  completion via useAutoCurationStatus, no reload.
                - Idle (null): static signpost reading "곧 도착" — the
                  same WIP state as before for albums admin registered
                  or whose curation already finished empty.
              Admin's own empty state is the "+ 리뷰 추가" slot below
              regardless. */}
          {sortedReviews.length === 0 && !koreanSummary && !isAdmin && (
            autoCurationProgress ? (
              <DigmanEmpty
                variant="digging"
                message={curationPhaseLabel(autoCurationProgress)}
                hint={curationPhaseHint(autoCurationProgress)}
              />
            ) : (
              <DigmanEmpty
                variant="sign"
                message="아직 리뷰를 파고 있습니다"
                hint="굴착이 끝나면 확인하실 수 있습니다"
              />
            )
          )}

          {(sortedReviews.length > 0 || isAdmin) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visibleReviews.map((review) => (
                <ReviewCard key={review.id} review={review} onScoreSaved={handleScoreSaved} onRetranslated={handleScoreSaved} onDeleted={handleDeleted} justAdded={justAddedIds.has(review.id)} />
              ))}

              {needsExpand && !expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="flex flex-col items-center justify-center gap-2 bg-panel-strong hover:bg-[#1e1e1e] border border-dashed border-gray-700 hover:border-gray-500 rounded-lg p-4 transition-all duration-200 cursor-pointer min-h-[100px]"
                >
                  <span className="text-accent text-2xl font-bold">+{hiddenCount}</span>
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
                  className="flex flex-col items-center justify-center gap-1 bg-panel-strong hover:bg-[#1e1e1e] border border-dashed border-accent/40 hover:border-accent/70 text-accent rounded-lg p-4 transition-all duration-200 cursor-pointer min-h-[100px]"
                >
                  <span className="text-2xl leading-none font-bold" aria-hidden>+</span>
                  <span className="text-sm font-medium">리뷰 추가</span>
                </button>
              )}

              {isAdmin && addingReview && (
                <div className="col-span-full bg-panel rounded-lg p-4 space-y-3 border border-white/10 max-w-xl relative">
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
                          ? 'bg-panel-strong text-accent border-t border-x border-white/10'
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
                          ? 'bg-panel-strong text-accent border-t border-x border-white/10'
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
                        <div className="flex items-center gap-1.5">
                          <select
                            value={discoverEngine}
                            onChange={(e) =>
                              setDiscoverEngine(e.target.value as DiscoveryEngine)
                            }
                            disabled={discover.isPending || savingReview}
                            className="text-[11px] bg-panel-strong border border-white/15 hover:border-white/30 rounded-md px-1.5 py-0.5 text-gray-300 outline-none focus:border-accent/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title="검색 엔진 선택"
                          >
                            <option value="serper">Serper</option>
                            <option value="tavily">Tavily</option>
                            <option value="brave">Brave</option>
                          </select>
                          <button
                          type="button"
                          onClick={async () => {
                            if (discover.isPending || savingReview) return;
                            try {
                              const result = await discover.mutateAsync({
                                engine: discoverEngine,
                              });
                              const found = result.urls ?? [];
                              const alreadySaved = result.alreadySavedCount ?? 0;
                              // Dedup note gets appended to any admin-
                              // facing alert below so admin can tell
                              // the server-side "already on file" filter
                              // from a genuine "no usable candidates"
                              // case. Without it, a run that finds 20
                              // URLs but happens to have 20 of them
                              // already saved would look identical to a
                              // Haiku-rejected-everything run.
                              const dedupNote =
                                alreadySaved > 0
                                  ? ` (이미 저장된 ${alreadySaved}개 제외)`
                                  : '';
                              if (found.length === 0) {
                                alert((result.message || '후보 URL을 찾지 못했어요.') + dedupNote);
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
                                alert('찾은 후보가 모두 이미 등록된 리뷰예요.' + dedupNote);
                                return;
                              }
                              // Merge into the checklist — keep any
                              // existing entries (and their checked
                              // state) so repeated clicks layer new
                              // results on top without wiping admin's
                              // prior selections.
                              setDiscoveredUrls((prev) => {
                                const seen = new Set(prev.map((p) => p.url));
                                const additions = fresh
                                  .filter((u) => !seen.has(u))
                                  .map((u) => ({ url: u, selected: true }));
                                return [...prev, ...additions];
                              });
                            } catch (err: any) {
                              alert(
                                err?.response?.data?.error ||
                                  'URL 검색에 실패했어요.'
                              );
                            }
                          }}
                          disabled={discover.isPending || savingReview}
                          className="text-[11px] text-accent/80 hover:text-accent border border-accent/40 hover:border-accent/70 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1.5"
                          title={`${discoverEngine}로 검색 → Haiku가 editorial 리뷰 URL 선별 (~$0.001)`}
                        >
                          {discover.isPending && (
                            <span className="w-3 h-3 border-2 border-gray-500 border-t-accent rounded-full animate-spin" />
                          )}
                          {discover.isPending ? '검색 중…' : '🔎 URL 자동 검색'}
                        </button>
                        </div>
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
                        className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60 font-mono"
                      />
                      {/* URL 자동 검색 결과 체크리스트. Each row is an
                          individual URL with a checkbox — admin unticks
                          unwanted sources before saving. Header strip
                          carries a summary + "모두 선택/해제" toggle so
                          large lists stay manageable without clicking
                          each row. The whole block only renders after
                          the first discover call returns. */}
                      {discoveredUrls.length > 0 && (
                        <div className="border border-white/10 rounded-md bg-panel-strong overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-panel-strong border-b border-white/5">
                            <span className="text-[11px] text-gray-400">
                              자동 검색 결과{' '}
                              <span className="text-gray-500">
                                ({discoveredUrls.filter((d) => d.selected).length} / {discoveredUrls.length})
                              </span>
                            </span>
                            <div className="flex items-center gap-2 text-[11px]">
                              <button
                                type="button"
                                onClick={() =>
                                  setDiscoveredUrls((prev) => {
                                    const allSelected = prev.every((d) => d.selected);
                                    return prev.map((d) => ({
                                      ...d,
                                      selected: !allSelected,
                                    }));
                                  })
                                }
                                disabled={savingReview}
                                className="text-gray-400 hover:text-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {discoveredUrls.every((d) => d.selected) ? '전체 해제' : '전체 선택'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDiscoveredUrls([])}
                                disabled={savingReview}
                                className="text-gray-500 hover:text-red-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title="검색 결과 지우기"
                              >
                                지우기
                              </button>
                            </div>
                          </div>
                          <ul className="max-h-52 overflow-y-auto divide-y divide-white/5">
                            {discoveredUrls.map((item, idx) => (
                              <li
                                key={item.url}
                                className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-white/5"
                              >
                                <input
                                  type="checkbox"
                                  id={`discovered-${idx}`}
                                  checked={item.selected}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setDiscoveredUrls((prev) =>
                                      prev.map((d, i) =>
                                        i === idx ? { ...d, selected: next } : d
                                      )
                                    );
                                  }}
                                  disabled={savingReview}
                                  className="accent-accent shrink-0 w-3.5 h-3.5 cursor-pointer"
                                />
                                <label
                                  htmlFor={`discovered-${idx}`}
                                  className={`flex-1 min-w-0 truncate font-mono cursor-pointer ${
                                    item.selected ? 'text-gray-200' : 'text-gray-500 line-through'
                                  }`}
                                  title={item.url}
                                >
                                  {item.url}
                                </label>
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-gray-500 hover:text-accent px-1"
                                  title="새 탭에서 열기"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={saveAddReview}
                        disabled={
                          savingReview ||
                          (!addUrl.trim() &&
                            !discoveredUrls.some((d) => d.selected))
                        }
                        className="w-full gap-2 font-medium"
                      >
                        {savingReview && (
                          <span className="w-4 h-4 border-2 border-gray-500 border-t-accent rounded-full animate-spin" />
                        )}
                        {savingReview
                          ? batchProgress
                            ? `페이지 분석 중... ${batchProgress.current}/${batchProgress.total}`
                            : '페이지 분석 중...'
                          : '저장'}
                      </Button>
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
                          onChange={(e) => {
                            const next = e.target.value;
                            setManualUrl(next);
                            // Auto-fill the source field from URL hostname.
                            // Only rewrites manualSource when it's still the
                            // default (empty or carrying the most-recent
                            // history entry as a placeholder) so admin's
                            // manual edits aren't clobbered mid-type.
                            const host = parseHostname(next);
                            if (!host) return;
                            const derived =
                              sourceHistory[host] || guessSourceFromHostname(host);
                            if (!derived) return;
                            const defaults = new Set(
                              ['AllMusic', '', defaultManualSource()].filter(Boolean)
                            );
                            if (defaults.has(manualSource.trim())) {
                              setManualSource(derived);
                            }
                          }}
                          disabled={savingReview}
                          placeholder="https://... (사이트명은 URL로 자동 입력됨)"
                          className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
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
                            list="manual-source-history"
                            className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
                          />
                          {/* Browser-native autocomplete dropdown backed
                              by localStorage history — every site admin
                              has saved a manual review from shows up as
                              a suggestion. Click or arrow-down to pick. */}
                          <datalist id="manual-source-history">
                            {Array.from(new Set(Object.values(sourceHistory))).map(
                              (name) => (
                                <option key={name} value={name} />
                              )
                            )}
                          </datalist>
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
                            className="w-20 bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
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
                          className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={saveManualReview}
                        disabled={savingReview || !manualSource.trim() || manualBody.trim().length < 50}
                        className="w-full gap-2 font-medium"
                      >
                        {savingReview && (
                          <span className="w-4 h-4 border-2 border-gray-500 border-t-accent rounded-full animate-spin" />
                        )}
                        {savingReview ? '본문 분석 중...' : '저장'}
                      </Button>
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
