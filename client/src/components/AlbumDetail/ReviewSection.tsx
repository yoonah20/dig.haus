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
import CardOverlayButton from '../CardOverlayButton';
import { SectionTitle, Field, DigmanEmpty } from '../ui';

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
    // 원문 페이지를 Jina로 다시 받아서 LLM에 전체 페이지를 다시
    // 보여주고 발췌 + 한국어 요약을 새로 추출하는 흐름. 저장된
    // excerpt만 다시 번역하던 옛 동작은 매 클릭마다 거의 같은
    // 결과를 내놓는 문제가 있어서 폐기됨.
    if (!confirm('원문 페이지를 다시 읽고 발췌 + 요약을 새로 추출할까요? (외부 API 호출됩니다)')) return;
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

  // When editing, render a plain div (no outer <a>) to keep form usable.
  const Wrapper = editing ? 'div' : (review.url ? 'a' : 'div');
  const wrapperProps = !editing && review.url
    ? { href: review.url, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper {...wrapperProps} className={`relative block bg-panel rounded-lg p-4 transition-colors duration-200 group/card ${editing ? '' : 'hover:bg-panel-hover cursor-pointer'} ${justAdded ? 'ring-2 ring-[#e8a020]/70 shadow-[0_0_24px_rgba(232,160,32,0.35)]' : ''}`}>
      {isAdmin && !editing && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
          <CardOverlayButton onClick={startEditExcerpt} title="본문 수정">
            ✎
          </CardOverlayButton>
          <CardOverlayButton
            onClick={handleRetranslate}
            disabled={retranslating}
            title="원문 다시 읽기"
          >
            {retranslating ? '…' : '↻'}
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
            className="w-full bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-y"
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

export default function ReviewSection({
  reviews,
  koreanSummary,
  averageScore,
  pendingNotice,
  albumTitle,
  albumArtist,
  prefillManualUrl,
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

  const googleSearchHref =
    albumTitle && albumArtist
      ? `https://www.google.com/search?q=${encodeURIComponent(
          `${albumTitle} ${albumArtist} album review`
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
      <SectionTitle
        variant="tape"
        meta={
          <>
            <AiSummaryBadge />
            {/* Admin-only shortcut — opens a Google search for the album
                + artist + "album review" in a new tab. Used for quickly
                finding review URLs to paste back into + 리뷰 추가.
                The "album review" phrase (rather than just "review")
                mirrors services/serper.ts so this manual shortcut and the
                automated discover flow surface the same SERP. */}
            {isAdmin && googleSearchHref && (
              <a
                href={googleSearchHref}
                target="_blank"
                rel="noopener noreferrer"
                title={`"${albumTitle} ${albumArtist} album review" 구글 검색`}
                aria-label="리뷰 URL 구글 검색"
                className="inline-flex items-center justify-center w-6 h-6 text-gray-500 hover:text-[#e8a020] transition-colors align-middle translate-y-[-2px] ml-1"
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
          </>
        }
      >
        리뷰 모음집
      </SectionTitle>

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
            <div className="relative group/summary bg-panel rounded-panel p-5 border-l-4 border-[#e8a020]">
              {isAdmin && !editingSummary && (
                <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover/summary:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
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
                    className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-y leading-relaxed"
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
                <p className="text-gray-200 leading-relaxed">
                  {koreanSummary || <span className="italic text-gray-600">요약 없음</span>}
                </p>
              )}
            </div>
          )}

          {/* Non-admin empty state — digman + WIP sign reads as
              "still being collected" rather than "this album has
              nothing". The guest path no longer distinguishes
              between "pending crawl" and "crawled but empty"
              because the distinction is an admin-operational detail
              that doesn't help visitors. Admin's own empty state is
              the "+ 리뷰 추가" slot below. */}
          {sortedReviews.length === 0 && !koreanSummary && !isAdmin && (
            <DigmanEmpty
              variant="sign"
              message="아직 리뷰를 파고 있습니다"
              hint="굴착이 끝나면 확인하실 수 있습니다"
            />
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
                          ? 'bg-panel-strong text-[#e8a020] border-t border-x border-white/10'
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
                          ? 'bg-panel-strong text-[#e8a020] border-t border-x border-white/10'
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
                          className="text-[11px] text-[#e8a020]/80 hover:text-[#e8a020] border border-[#e8a020]/40 hover:border-[#e8a020]/70 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1.5"
                          title="Serper로 구글 검색 → Haiku가 editorial 리뷰 URL 선별 (~$0.001)"
                        >
                          {discover.isPending && (
                            <span className="w-3 h-3 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
                          )}
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
                        className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 font-mono"
                      />
                      {/* URL 자동 검색 결과 체크리스트. Each row is an
                          individual URL with a checkbox — admin unticks
                          unwanted sources before saving. Header strip
                          carries a summary + "모두 선택/해제" toggle so
                          large lists stay manageable without clicking
                          each row. The whole block only renders after
                          the first discover call returns. */}
                      {discoveredUrls.length > 0 && (
                        <div className="border border-white/10 rounded-md bg-[#0a0703] overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-[#141008] border-b border-white/5">
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
                                className="text-gray-400 hover:text-[#e8a020] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                                  className="accent-[#e8a020] shrink-0 w-3.5 h-3.5 cursor-pointer"
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
                                  className="shrink-0 text-gray-500 hover:text-[#e8a020] px-1"
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
                      <button
                        onClick={saveAddReview}
                        disabled={
                          savingReview ||
                          (!addUrl.trim() &&
                            !discoveredUrls.some((d) => d.selected))
                        }
                        className="w-full py-2 text-sm font-medium text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020] hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#e8a020] transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        {savingReview && (
                          <span className="w-4 h-4 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
                        )}
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
                          className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
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
                            className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
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
                            className="w-20 bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
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
                          className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
                        />
                      </div>
                      <button
                        onClick={saveManualReview}
                        disabled={savingReview || !manualSource.trim() || manualBody.trim().length < 50}
                        className="w-full py-2 text-sm font-medium text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020] hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#e8a020] transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        {savingReview && (
                          <span className="w-4 h-4 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
                        )}
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
