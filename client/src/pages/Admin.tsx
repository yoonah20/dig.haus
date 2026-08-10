import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
// Embedded on /admin/api only. Lazy so /admin (dashboard) and
// /admin/curation don't ship the api-console + llm-compare bundles
// — both are independently route-lazy in App.tsx already, but the
// static imports here defeated that for any visit to /admin.
const ApiConsole = lazy(() => import('./ApiConsole'));
const LlmCompare = lazy(() => import('./LlmCompare'));
const AdminTags = lazy(() => import('./AdminTags'));
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';
import { resolveApiUrl } from '../utils/apiUrl';
// useAlbumRequests is no longer referenced here — the pending-queue
// panel was dropped in favour of a 최근 등록 앨범 feed after every
// registration started landing pending (admin + user). The approve /
// delete hooks live on the album page now (inside the pending notice
// slot inside ReviewSection).
import {
  useReportedPurchaseLinks,
  useDismissPurchaseLinkReport,
  useAdminDeletePurchaseLink,
  type ReportedLink,
} from '../hooks/usePurchaseLinks';
import {
  useReviewReports,
  useDismissReviewReport,
  type ReportedReview,
  type ReviewReportReason,
} from '../hooks/useAlbum';
import {
  formatRelativeKo,
  formatShortKstDateTime,
  parseServerTimestamp,
} from '../utils/relativeTime';
import { markPendingSeen, readPendingSeen } from '../lib/adminSeen';
import {
  useTrackedLabels,
  useLabelFeed,
  usePreviewLabel,
  useAddTrackedLabel,
  useToggleTrackedLabel,
  useDeleteTrackedLabel,
  usePollTrackedLabel,
  usePollAllTrackedLabels,
  useDismissLabelFeedItem,
  useRegisterLabelFeedItem,
} from '../hooks/useLabelFeed';
import { useCurationProgress } from '../contexts/CurationProgressContext';

interface IncompleteAlbumSample {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
}

interface AdminStats {
  totalAlbums: number;
  albumsToday: number;
  totalUsers: number;
  usersToday: number;
  totalReviews: number;
  reviewsToday: number;
  totalPurchaseLinks: number;
  purchaseLinksToday: number;
  votesToday: { up: number; down: number };
  recentAlbums: Array<{
    id: number;
    mbid: string;
    title: string;
    artist: string;
    createdAt: string;
    coverArtUrl: string | null;
    coverArtFallbacks?: string[];
    registeredByAdmin: boolean;
  }>;
  recentPurchaseLinks: Array<{
    id: number;
    url: string;
    storeName: string | null;
    storeFaviconUrl: string | null;
    price: number | null;
    currency: string | null;
    createdAt: string;
    albumSlug: string;
    albumTitle: string;
    albumArtist: string | null;
    userId: number | null;
    userName: string | null;
  }>;
  recentUsers: Array<{
    id: number;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    createdAt: string;
  }>;
  recentReviews: Array<{
    id: number;
    body: string;
    emoji: string | null;
    rating: 'up' | 'down' | 'soso' | null;
    createdAt: string;
    updatedAt: string;
    albumSlug: string | null;
    albumTitle: string | null;
    albumArtist: string | null;
    userId: number | null;
    userName: string | null;
    userEmail: string | null;
    userAvatar: string | null;
  }>;
  claudeUsage: {
    month: {
      label: string; // YYYY-MM
      inputTokens: number;
      outputTokens: number;
      webSearchCount: number;
      usd: number;
      byOperation: Array<{
        operation: string;
        calls: number;
        tokens: number;
        searches: number;
        usd: number;
      }>;
    };
    rolling24h: {
      usd: number;
      capUsd: number;
    };
  };
  incompleteAlbums: {
    noReviews: { count: number; samples: IncompleteAlbumSample[] };
    noSummary: { count: number; samples: IncompleteAlbumSample[] };
    noCover: { count: number; samples: IncompleteAlbumSample[] };
  };
}

interface StatRow {
  label: string;
  value: string | number;
  accent?: boolean;
  hoverContent?: ReactNode;
}

// Grouped stat panel — one header (전체 / 오늘) over a vertical stack
// of labelled numbers. Each row can still reveal a hover popover
// (e.g. "오늘 추가 앨범" opens the recent-albums list) without
// fighting the panel's bounds; the popover is anchored to the row.
function StatGroupCard({
  title,
  accent,
  rows,
}: {
  title: string;
  accent?: boolean;
  rows: StatRow[];
}) {
  return (
    <div
      className={`bg-panel rounded-xl border ${
        accent ? 'border-accent/40' : 'border-white/5'
      }`}
    >
      <div className="px-5 pt-4 pb-2 text-xs uppercase tracking-wider text-gray-500">
        {title}
      </div>
      <div className="px-5 pb-4 space-y-2">
        {rows.map((row) => (
          <StatRowView key={row.label} row={row} />
        ))}
      </div>
    </div>
  );
}

function StatRowView({ row }: { row: StatRow }) {
  const line = (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-gray-400 truncate">{row.label}</span>
      <span
        className={`text-xl font-bold tabular-nums shrink-0 ${
          row.accent ? 'text-accent' : 'text-white'
        }`}
      >
        {row.value}
      </span>
    </div>
  );
  if (!row.hoverContent) return line;
  return (
    <div className="relative group/row">
      <div className="cursor-default">{line}</div>
      <div className="invisible opacity-0 group-hover/row:visible group-hover/row:opacity-100 transition-opacity absolute left-0 right-0 top-full mt-1 z-20 bg-panel rounded-xl border border-white/10 shadow-xl overflow-hidden">
        {row.hoverContent}
      </div>
    </div>
  );
}

// Reusable dashboard section — a titled card with a scrollable body.
// Used for every sub-section inside the 3-column grid.
function Panel({
  title,
  icon,
  count,
  headerAction,
  children,
}: {
  title: string;
  icon?: string;
  count?: number;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-panel rounded-xl border border-white/5 overflow-hidden">
      <div className="px-4 py-3.5 border-b border-white/5 flex items-center gap-2">
        {icon && <span aria-hidden className="text-base">{icon}</span>}
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {typeof count === 'number' && count > 0 && (
          <span className="text-sm text-gray-500 tabular-nums">{count}</span>
        )}
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>
      <div className="divide-y divide-white/5 max-h-[calc(100vh-280px)] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="p-4 text-sm text-gray-500">{children}</div>;
}

// Lightweight section header for grouping panels inside an admin
// tab. Used in the curation tab to split "내가 만든 룰" surfaces
// (Sources / TagBlacklist / TermReplacements) from "운영 로그"
// surfaces (ScrapeFailures / CurationRuns) so the tab reads as
// two distinct concerns rather than five panels stacked into one
// long scroll.
function SubSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-3 flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
          {title}
        </h2>
        {hint && (
          <span className="text-[11px] text-gray-600">{hint}</span>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

// Compact search input pattern used by the curation panels (tag
// blacklist, term replacements). Renders inside Panel's
// headerAction slot. Lives here as a primitive so the search
// styling stays consistent across panels — same width, same
// muted-amber focus, same placeholder treatment.
function PanelSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-40 sm:w-52 bg-panel-strong border border-white/10 focus:border-accent/60 rounded px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 outline-none"
    />
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface ClaudeUsageCall {
  id: number;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearchCount: number;
  usd: number;
  createdAt: string;
}

// Stat tile that sits beside the album/user counters. Layout splits
// into two columns at sm+: left = month-to-date totals (cost +
// tokens), right = per-operation breakdown. On narrow viewports the
// columns stack so nothing scrolls horizontally. Reset wipes the
// usage log via DELETE /api/admin/claude-usage; natural reset still
// happens at the start of each calendar month. A "상세" toggle
// reveals the last 50 individual Claude calls for forensic "why is
// this so high" inspection.
function ClaudeUsageCard({
  usage,
  rolling24h,
}: {
  usage: AdminStats['claudeUsage']['month'];
  rolling24h: AdminStats['claudeUsage']['rolling24h'];
}) {
  const qc = useQueryClient();
  const [showRecent, setShowRecent] = useState(false);
  const reset = useMutation({
    mutationFn: async () => axios.delete('/api/admin/claude-usage'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['claude-usage-recent'] });
    },
  });
  const recent = useQuery<{ calls: ClaudeUsageCall[] }>({
    queryKey: ['claude-usage-recent'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/claude-usage/recent', {
        params: { limit: 50 },
      });
      return data;
    },
    enabled: showRecent,
    staleTime: 10_000,
  });
  const empty = usage.webSearchCount === 0 && usage.inputTokens === 0;
  const monthDisplay = (() => {
    const [y, m] = usage.label.split('-');
    return y && m ? `${y}년 ${parseInt(m, 10)}월` : usage.label;
  })();

  const handleReset = () => {
    if (reset.isPending) return;
    if (!confirm(`API 사용량 기록을 모두 삭제할까요?\n(현재: $${usage.usd.toFixed(2)})\n\n되돌릴 수 없습니다.`)) return;
    reset.mutate();
  };

  return (
    <div className="bg-panel rounded-xl p-5 border border-white/5 flex flex-col">
      {/* Header: title + reset on the left of the row, big USD figure
          on the right. Reset is a small text button so it doesn't
          fight the dollar number for attention. */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <span className="text-sm uppercase tracking-wider text-gray-500 truncate">
            🪙 API 사용량 ({monthDisplay})
          </span>
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            className="text-[10px] text-gray-500 hover:text-accent underline-offset-2 hover:underline cursor-pointer"
            title="최근 50건의 개별 LLM 호출을 펼쳐서 봅니다."
          >
            {showRecent ? '상세 접기' : '상세'}
          </button>
          <Link
            to="/admin/api-console"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-accent underline-offset-2 hover:underline cursor-pointer"
            title="별도 탭에서 자동 갱신되는 실시간 콘솔"
          >
            🖥 콘솔
          </Link>
          <Link
            to="/admin/compare"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-accent underline-offset-2 hover:underline cursor-pointer"
            title="LLM 섀도우 비교: Haiku/Sonnet vs DeepSeek (LLM_COMPARE=1 필요)"
          >
            🔀 비교
          </Link>
          <button
            type="button"
            onClick={handleReset}
            disabled={reset.isPending || empty}
            className="text-[10px] text-gray-500 hover:text-red-400 underline-offset-2 hover:underline disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="사용량 기록 삭제 (월간 자동 리셋과 별개로 지금 바로 비우기)"
          >
            {reset.isPending ? '리셋 중…' : '리셋'}
          </button>
        </div>
        <span className="text-2xl font-bold text-accent tabular-nums shrink-0">
          ${usage.usd.toFixed(2)}
        </span>
      </div>

      {/* Rolling-24h spend. Gated server-side at capUsd — once crossed,
          🔍 리뷰 모아오기 starts returning 429. Shown in orange only
          when we're ≥80% of the cap so the panel stays calm under
          normal operation. */}
      {(() => {
        const pct = rolling24h.capUsd > 0 ? rolling24h.usd / rolling24h.capUsd : 0;
        const warning = pct >= 0.8;
        return (
          <div className="flex items-baseline gap-2 mb-3 -mt-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              24h 지출
            </span>
            <span
              className={`text-xs tabular-nums ${
                warning ? 'text-orange-400 font-semibold' : 'text-gray-300'
              }`}
              title={
                pct >= 1
                  ? '24시간 한도 도달 — 🔍 리뷰 모아오기가 일시적으로 거부됩니다.'
                  : undefined
              }
            >
              ${rolling24h.usd.toFixed(2)} / ${rolling24h.capUsd.toFixed(2)}
            </span>
          </div>
        );
      })()}

      {empty ? (
        <div className="text-sm text-gray-500">이번 달 기록된 호출이 없습니다.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left column — totals */}
          <div className="grid grid-cols-3 sm:grid-cols-1 gap-2 text-xs">
            <div>
              <div className="text-gray-500 uppercase tracking-wider">검색</div>
              <div className="text-gray-200 tabular-nums text-sm">
                {usage.webSearchCount}
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider">입력 토큰</div>
              <div className="text-gray-200 tabular-nums text-sm">
                {formatTokens(usage.inputTokens)}
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider">출력 토큰</div>
              <div className="text-gray-200 tabular-nums text-sm">
                {formatTokens(usage.outputTokens)}
              </div>
            </div>
          </div>

          {/* Right column — per-operation breakdown, now with call
              count so it's obvious when one op was re-fired. */}
          {usage.byOperation.length > 0 && (
            <div className="space-y-1 text-xs sm:border-l sm:border-white/5 sm:pl-4">
              {usage.byOperation.map((op) => (
                <div
                  key={op.operation}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"
                >
                  <span className="text-gray-400 truncate">
                    {OPERATION_LABEL(op.operation)}
                  </span>
                  <span className="tabular-nums text-gray-500 text-[10px]">
                    {op.calls}회
                    {op.searches > 0 && ` · ${op.searches}검색`}
                  </span>
                  <span className="tabular-nums text-accent text-right w-14">
                    ${op.usd.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRecent && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            최근 개별 호출 (최신순, 최대 50건)
          </div>
          {recent.isLoading ? (
            <div className="text-xs text-gray-500">불러오는 중…</div>
          ) : !recent.data || recent.data.calls.length === 0 ? (
            <div className="text-xs text-gray-500">기록 없음</div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto divide-y divide-white/5 text-xs">
              {recent.data.calls.map((c) => (
                <div
                  key={c.id}
                  className="py-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 items-baseline"
                >
                  <span className="text-gray-300 truncate">
                    {OPERATION_LABEL(c.operation)}
                    {c.webSearchCount > 0 && (
                      <span className="ml-1 text-gray-500">· {c.webSearchCount}검색</span>
                    )}
                  </span>
                  <span className="text-gray-500 text-[10px] whitespace-nowrap">
                    {MODEL_LABEL(c.model)}
                  </span>
                  <span className="text-gray-500 text-[10px] tabular-nums whitespace-nowrap">
                    {formatShortKstDateTime(c.createdAt)}
                  </span>
                  <span className="tabular-nums text-accent text-right w-14">
                    ${c.usd.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const REPORT_REASON_LABEL: Record<ReportedLink['reason'], string> = {
  soldout: '품절 됨',
  price: '가격 다름',
  expired: '링크 만료',
};

const REVIEW_REPORT_REASON_LABEL: Record<ReviewReportReason, string> = {
  'wrong-album': '다른 앨범 리뷰',
  'bad-translation': '번역 이상',
  'not-a-review': '다른 내용',
};

// One row per submitted report. Multiple reports on the same link show
// as multiple rows so the admin can see who complained about what and
// decide action per-report (dismiss this one) or wholesale (delete the
// link, which cascade-wipes any sibling reports via FK).
function ReportRow({
  report,
  onDismiss,
  onDeleteLink,
}: {
  report: ReportedLink;
  onDismiss: () => void;
  onDeleteLink: () => void;
}) {
  const hostname = (() => {
    try {
      return new URL(report.linkUrl).hostname.replace(/^www\./, '');
    } catch {
      return report.linkStore || report.linkUrl;
    }
  })();

  return (
    <div className="p-3 flex items-start gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">
            {REPORT_REASON_LABEL[report.reason]}
          </span>
          <Link
            to={`/album/${report.albumSlug}`}
            className="text-gray-100 hover:text-accent truncate"
          >
            {report.albumArtist ? `${report.albumArtist} — ` : ''}
            {report.albumTitle}
          </Link>
        </div>
        <div className="mt-1 text-xs text-gray-400 truncate">
          <a
            href={report.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent"
          >
            {report.linkStore || hostname}
          </a>
          <span className="text-gray-600 mx-1.5">·</span>
          등록: {report.linkUserName || '알 수 없음'}
          <span className="text-gray-600 mx-1.5">·</span>
          신고: {report.reporterName || '알 수 없음'}
          <span className="text-gray-600 mx-1.5">·</span>
          {formatRelativeKo(report.createdAt)}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 cursor-pointer"
          title="이 신고만 정리"
        >
          무시
        </button>
        <button
          type="button"
          onClick={onDeleteLink}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 cursor-pointer"
          title="구매처 링크 삭제"
        >
          링크 삭제
        </button>
      </div>
    </div>
  );
}

// One row per submitted review report. The actions row is intentionally
// thinner than the purchase-link version — admin needs to look at the
// review itself to decide rescrape vs edit vs delete, so we link to the
// album page rather than offering shortcut buttons here. The 무시 button
// covers the "report was unjustified" path that doesn't need a follow-up
// trip to the album page.
function ReviewReportRow({
  report,
  onDismiss,
}: {
  report: ReportedReview;
  onDismiss: () => void;
}) {
  const albumHref = `/album/${report.albumSlug ?? report.albumMbid}`;
  const excerpt = (report.reviewExcerpt ?? '').slice(0, 200);
  return (
    <div className="p-3 flex items-start gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">
            {REVIEW_REPORT_REASON_LABEL[report.reason]}
          </span>
          <Link
            to={albumHref}
            className="text-gray-100 hover:text-accent truncate"
          >
            {report.albumArtist ? `${report.albumArtist} — ` : ''}
            {report.albumTitle}
          </Link>
          <span className="text-gray-500 text-xs">· {report.reviewSource}</span>
        </div>
        {excerpt && (
          <div className="mt-1.5 text-xs text-gray-400 line-clamp-2 leading-relaxed">
            {excerpt}
            {(report.reviewExcerpt?.length ?? 0) > 200 ? '…' : ''}
          </div>
        )}
        <div className="mt-1 text-xs text-gray-500 truncate">
          <a
            href={report.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent"
          >
            원문 보기
          </a>
          <span className="text-gray-600 mx-1.5">·</span>
          신고: {report.reporterName || '알 수 없음'}
          <span className="text-gray-600 mx-1.5">·</span>
          {formatRelativeKo(report.createdAt)}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 cursor-pointer"
          title="이 신고만 정리"
        >
          무시
        </button>
        <Link
          to={albumHref}
          className="text-xs text-accent hover:text-white px-2 py-1 cursor-pointer"
          title="앨범 페이지에서 처리"
        >
          앨범으로
        </Link>
      </div>
    </div>
  );
}

function OPERATION_LABEL(op: string): string {
  switch (op) {
    case 'reviews_search':
      return '리뷰 검색';
    case 'reviews_structure':
      return '리뷰 구조화';
    case 'reviews_summary':
      return '한국어 요약';
    case 'pronunciation':
      return '음차/의미';
    case 'similar_descriptions':
      return '비슷한 앨범';
    case 'scrape_review':
      return '리뷰 스크랩 (admin)';
    case 'summary_fallback':
      return '요약 폴백';
    default:
      return op;
  }
}

// The raw model field is "claude-haiku-4-5-20251001" / "claude-sonnet-
// 4-5" / "deepseek-chat" etc. Way too long for the per-call row. Pull
// out the distinctive word and a short version tag so the viewer can
// tell at a glance which provider/size handled the call.
function MODEL_LABEL(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku 4.5';
  if (m.includes('sonnet')) return 'sonnet 4.5';
  if (m.includes('opus')) return 'opus';
  if (m.startsWith('deepseek')) return 'deepseek';
  return model;
}

// Admin routes: /admin (dashboard), /admin/curation, /admin/api. All
// three render the same Admin component; the component reads the
// pathname to decide which tab's sections to show. A single layout +
// tab bar keeps the chrome consistent across tabs and lets admin
// deep-link straight to the relevant workflow. Legacy standalone
// routes /admin/api-console and /admin/compare still exist (see
// App.tsx) for pinned-tab use; their content is also embedded in the
// API tab.
type AdminTab = 'dashboard' | 'curation' | 'api' | 'maintenance' | 'tags';

function deriveTabFromPath(pathname: string): AdminTab {
  if (pathname.startsWith('/admin/curation')) return 'curation';
  if (pathname.startsWith('/admin/api')) return 'api';
  if (pathname.startsWith('/admin/maintenance')) return 'maintenance';
  if (pathname.startsWith('/admin/tags')) return 'tags';
  return 'dashboard';
}

function AdminTabBar({ active }: { active: AdminTab }) {
  const tabs: Array<{ id: AdminTab; to: string; label: string; icon: string }> = [
    { id: 'dashboard', to: '/admin', label: '대시보드', icon: '📊' },
    { id: 'curation', to: '/admin/curation', label: '리뷰 큐레이션', icon: '🔖' },
    { id: 'api', to: '/admin/api', label: 'API & LLM', icon: '🪙' },
    { id: 'maintenance', to: '/admin/maintenance', label: '정리', icon: '🧹' },
    { id: 'tags', to: '/admin/tags', label: '태그', icon: '🏷' },
  ];
  return (
    <nav
      aria-label="관리자 섹션"
      className="mb-6 border-b border-white/10 flex flex-wrap gap-1"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            to={t.to}
            className={`px-4 py-2 text-sm rounded-t-md -mb-px border-b-2 transition-colors ${
              isActive
                ? 'text-accent border-accent font-semibold'
                : 'text-gray-400 border-transparent hover:text-white hover:border-white/20'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span aria-hidden className="mr-1.5">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = deriveTabFromPath(location.pathname);

  useEffect(() => {
    const tabLabel =
      activeTab === 'curation'
        ? '리뷰 큐레이션 · '
        : activeTab === 'api'
          ? 'API & LLM · '
          : activeTab === 'tags'
            ? '태그 · '
            : '';
    document.title = `${tabLabel}Admin | dig.haus`;
  }, [activeTab]);

  useEffect(() => {
    if (loading) return;
    if (!user || !user.isAdmin) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  // Snapshot the admin's previous "seen" timestamp synchronously on
  // first render via useState's lazy initialiser — a ref would set
  // only after the first paint, so NEW highlights rendered with the
  // initial fallback (0) and lit up every album. useState captures
  // the value before anything renders, then the effect below writes
  // the current moment back so the nav badge + next visit know the
  // admin has seen this feed.
  const [prevSeenAt] = useState<number>(() => {
    const prev = readPendingSeen();
    return prev ? parseServerTimestamp(prev).getTime() : 0;
  });
  useEffect(() => {
    if (user?.isAdmin) markPendingSeen();
  }, [user?.isAdmin]);

  // Dashboard-only data. Gated on activeTab so switching to Curation
  // or API tabs doesn't fire these unused fetches — the payloads are
  // large (stats includes recent-album samples + incomplete-album
  // samples) and the renderers are already conditional on
  // activeTab === 'dashboard', so enabling the fetch on other tabs
  // was pure waste.
  const dashboardActive = activeTab === 'dashboard';
  const { data, isLoading, isError } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/stats');
      return data;
    },
    enabled: !!user?.isAdmin && dashboardActive,
    staleTime: 30_000,
  });

  const reportsQuery = useReportedPurchaseLinks(!!user?.isAdmin && dashboardActive);
  const dismissReport = useDismissPurchaseLinkReport();
  const adminDeleteLink = useAdminDeletePurchaseLink();

  // Review-report queue — same surface as the purchase-link reports
  // above, just for the 리뷰 신고 flow. Independent query so a flaky
  // user can't slow down the link reports panel.
  const reviewReportsQuery = useReviewReports();
  const dismissReviewReport = useDismissReviewReport();

  if (loading || !user?.isAdmin) return null;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8 overflow-x-hidden">
      <h1 className="text-3xl font-bold text-white mb-4 font-serif">
        🛠 레코드샵 관리
      </h1>

      <AdminTabBar active={activeTab} />

      {/* Stats-dependent error/loading only applies to the dashboard
          tab. Curation and API tabs work without /api/admin/stats. */}
      {activeTab === 'dashboard' && isError && (
        <div className="text-red-400 text-sm mb-4">통계를 불러오지 못했습니다.</div>
      )}
      {activeTab === 'dashboard' && isLoading && (
        <div className="text-gray-500 text-sm">로딩 중...</div>
      )}

      {activeTab === 'dashboard' && data && (
        <>
          {/* Top area — split in two rows.
              Row A: 전체 / 오늘 counters + API 사용량 tile (cost signal).
              Row B: 신고된 구매처 (flag queue) + 데이터 미완 앨범 (backlog).
              These are "must-look-at-today" moderation signals so they
              belong above the fold rather than buried in a column with
              recent-activity feeds.

              Below the hero: three equal feed columns that all read as
              "최근 ~" — 최근 등록 앨범 (new), 최근 50자 평, 최근 등록
              구매처. */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <StatGroupCard
              title="전체"
              rows={[
                { label: '앨범', value: data.totalAlbums.toLocaleString() },
                {
                  label: '유저',
                  value: data.totalUsers.toLocaleString(),
                  hoverContent: <RecentUsersList users={data.recentUsers} />,
                },
                { label: '50자 평', value: data.totalReviews.toLocaleString() },
                { label: '구매처', value: data.totalPurchaseLinks.toLocaleString() },
              ]}
            />
            <StatGroupCard
              title="오늘 (24시간)"
              accent={data.albumsToday > 0 || data.usersToday > 0}
              rows={[
                {
                  label: '추가 앨범',
                  value: data.albumsToday,
                  accent: data.albumsToday > 0,
                },
                {
                  label: '가입 유저',
                  value: data.usersToday,
                  accent: data.usersToday > 0,
                },
                { label: '50자 평', value: data.reviewsToday },
                {
                  label: '투표',
                  value: `▲${data.votesToday.up} / ▼${data.votesToday.down}`,
                },
              ]}
            />
            <div className="md:col-span-2">
              <ClaudeUsageCard
                usage={data.claudeUsage.month}
                rolling24h={data.claudeUsage.rolling24h}
              />
            </div>
          </section>

          {/* Label-tracking panels hidden in the UI while the feature
              is on ice — backend (tables, cron, routes, hooks) stays
              live so we can flip the section back on without a
              redeploy. Unhide by restoring the <TrackedLabelsPanel />
              + <LabelFeedPanel /> block below. The two panel
              components + the useLabelFeed hooks are still in this
              file / tree, just not rendered. */}
          {/*
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <TrackedLabelsPanel />
            <LabelFeedPanel />
          </section>
          */}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Panel
              title="신고된 구매처"
              icon="🚩"
              count={reportsQuery.data?.reports.length ?? 0}
            >
              {reportsQuery.isLoading ? (
                <EmptyRow>불러오는 중…</EmptyRow>
              ) : !reportsQuery.data || reportsQuery.data.reports.length === 0 ? (
                <EmptyRow>신고된 구매처가 없습니다.</EmptyRow>
              ) : (
                reportsQuery.data.reports.map((r) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    onDismiss={() => dismissReport.mutate(r.id)}
                    onDeleteLink={() => {
                      if (!confirm('이 구매처 링크를 삭제할까요? 같은 링크의 다른 신고도 모두 정리됩니다.')) return;
                      adminDeleteLink.mutate(r.linkId);
                    }}
                  />
                ))
              )}
            </Panel>

            <IncompletePanel incompleteAlbums={data.incompleteAlbums} />
          </section>

          {/* Review reports panel — paired with the purchase-link
              reports above as the other half of the user-facing flag
              queue. Kept on its own row (not adjacent to the link
              reports) because each row tends to be wider — the review
              excerpt preview needs horizontal room to read clearly. */}
          <section className="grid grid-cols-1 gap-4 mb-8">
            <Panel
              title="신고된 리뷰"
              icon="🚩"
              count={reviewReportsQuery.data?.reports.length ?? 0}
            >
              {reviewReportsQuery.isLoading ? (
                <EmptyRow>불러오는 중…</EmptyRow>
              ) : !reviewReportsQuery.data ||
                reviewReportsQuery.data.reports.length === 0 ? (
                <EmptyRow>신고된 리뷰가 없습니다.</EmptyRow>
              ) : (
                reviewReportsQuery.data.reports.map((r) => (
                  <ReviewReportRow
                    key={r.id}
                    report={r}
                    onDismiss={() => dismissReviewReport.mutate(r.id)}
                  />
                ))
              )}
            </Panel>
          </section>

          {/* 3-column feed grid — all "최근 ~" columns. */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* ── Column 1: 최근 등록 앨범 ─────────────────────────
                Replaces the old "리뷰 수집 대기" panel: now that
                every registration lands pending (admin + user), the
                queue would otherwise be every album in the last
                week. This feed is more useful — shows what was
                added, who added it, and links to each album page
                where admin can trigger 리뷰 모아오기 or 요약 생성
                if they want. */}
            <div className="flex flex-col gap-4">
              <Panel
                title="최근 등록 앨범"
                icon="📥"
                count={data.recentAlbums.length}
              >
                {data.recentAlbums.length === 0 ? (
                  <EmptyRow>최근 등록된 앨범이 없습니다.</EmptyRow>
                ) : (
                  data.recentAlbums.map((a) => {
                    const ts = parseServerTimestamp(a.createdAt).getTime();
                    // Skip NEW for admin self-registrations — the highlight
                    // is meant to flag user-submitted rows the admin
                    // hasn't seen, not the admin's own work.
                    const isNew =
                      !a.registeredByAdmin &&
                      Number.isFinite(ts) &&
                      ts > prevSeenAt;
                    return (
                      <Link
                        key={a.id}
                        to={`/album/${a.mbid}`}
                        className={`p-3 flex items-center gap-3 transition-colors ${
                          isNew
                            ? 'bg-accent/8 hover:bg-accent/12 border-l-2 border-accent/60 pl-[10px]'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <CoverArt
                          src={a.coverArtUrl}
                          fallbacks={a.coverArtFallbacks}
                          alt={a.title}
                          className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium truncate">
                            {a.title}
                            {isNew && (
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-accent align-middle">
                                NEW
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {a.artist}
                            <span className="text-gray-600 mx-1.5">·</span>
                            {formatRelativeKo(a.createdAt)}
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </Panel>
            </div>

            {/* ── Column 2: 최근 50자 평 ──────────────────────────── */}
            <div className="flex flex-col gap-4">
              <Panel
                title="최근 50자 평"
                icon="💬"
                count={data.recentReviews.length}
              >
                {data.recentReviews.length === 0 ? (
                  <EmptyRow>없음</EmptyRow>
                ) : (
                  data.recentReviews.map((r) => {
                    const ratingMeta =
                      r.rating === 'up'
                        ? { emoji: '👍', label: '굿굿', accent: true }
                        : r.rating === 'down'
                          ? { emoji: '👎', label: '별루', accent: false }
                          : r.rating === 'soso'
                            ? { emoji: '🤷', label: '쏘쏘', accent: false }
                            : null;
                    return (
                      <div key={r.id} className="p-3 flex items-start gap-3">
                        {r.userAvatar ? (
                          <img
                            src={resolveApiUrl(r.userAvatar) ?? undefined}
                            alt=""
                            aria-hidden
                            className="w-10 h-10 rounded-full flex-shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {(r.userName || r.userEmail || '?')[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className="text-sm text-white font-medium truncate">
                              {r.userName || r.userEmail || '익명'}
                            </span>
                            {ratingMeta && (
                              <span
                                className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${
                                  ratingMeta.accent
                                    ? 'bg-accent/15 text-accent border-accent/30'
                                    : 'bg-white/5 text-gray-300 border-white/10'
                                }`}
                              >
                                <span aria-hidden>{ratingMeta.emoji}</span>
                                <span>{ratingMeta.label}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-100 leading-relaxed break-words line-clamp-2">
                            {r.emoji && (
                              <span className="mr-1" aria-hidden>
                                {r.emoji}
                              </span>
                            )}
                            {r.body}
                          </div>
                          {r.albumSlug && (
                            <Link
                              to={`/album/${r.albumSlug}`}
                              className="mt-1 inline-block text-xs text-gray-500 hover:text-accent truncate"
                            >
                              {r.albumArtist ? `${r.albumArtist} — ` : ''}
                              {r.albumTitle || r.albumSlug}
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </Panel>
            </div>

            {/* ── Column 3: 최근 등록 구매처 ─────────────────────────
                The album list moved to the "오늘 추가 앨범" StatCard
                hover so this column could surface a newer signal —
                which albums are getting store-link contributions and
                who's contributing them. */}
            <div className="flex flex-col gap-4">
              <Panel
                title="최근 등록 구매처"
                icon="🛒"
                count={data.recentPurchaseLinks.length}
              >
                {data.recentPurchaseLinks.length === 0 ? (
                  <EmptyRow>없음</EmptyRow>
                ) : (
                  data.recentPurchaseLinks.map((pl) => {
                    const hostname = (() => {
                      try {
                        return new URL(pl.url).hostname.replace(/^www\./, '');
                      } catch {
                        return pl.storeName || '';
                      }
                    })();
                    const priceLabel =
                      pl.price != null && pl.currency
                        ? `${pl.currency} ${pl.currency === 'JPY' || pl.currency === 'KRW' ? Math.round(pl.price).toLocaleString() : pl.price.toFixed(2)}`
                        : null;
                    return (
                      <div key={pl.id} className="p-3 flex items-start gap-3 text-sm">
                        {pl.storeFaviconUrl ? (
                          <img
                            src={pl.storeFaviconUrl}
                            alt=""
                            aria-hidden
                            className="w-6 h-6 rounded-sm flex-shrink-0 mt-0.5"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-sm bg-white/10 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={pl.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-white font-medium hover:text-accent truncate"
                            >
                              {pl.storeName || hostname}
                            </a>
                            {priceLabel && (
                              <span className="text-accent text-xs font-semibold tabular-nums">
                                {priceLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">
                            <Link
                              to={`/album/${pl.albumSlug}`}
                              className="hover:text-accent"
                            >
                              {pl.albumArtist ? `${pl.albumArtist} — ` : ''}
                              {pl.albumTitle}
                            </Link>
                            <span className="text-gray-600 mx-1.5">·</span>
                            {pl.userName || '알 수 없음'}
                            <span className="text-gray-600 mx-1.5">·</span>
                            {formatRelativeKo(pl.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </Panel>
            </div>
          </section>

          {/* Signup gate — pending Google-OAuth attempts by un-invited
              emails land here. Sits below the moderation queues
              because it's a low-volume surface (admin acts on each
              request once); the headerAction toggle reveals the full
              invited-emails list when needed for revoke / audit. */}
          <section className="mt-4">
            <SignupGatePanel />
          </section>

        </>
      )}

      {activeTab === 'curation' && (
        <>
          {/* Two SubSections separate the tab's two concerns
              (curated rules vs. operational logs). Within each, the
              panels arrange into a desktop grid so the tab no
              longer reads as one long vertical scroll on a
              wide monitor:
                - SourcesPanel stays full-width — it already runs
                  its own 4-col internal layout (success / failure
                  / whitelist / blacklist) that needs the room.
                - TermReplacements is a list-style "rules I curated"
                  panel. (The tag blacklist used to sit beside it here;
                  it moved to the 태그 tab so all tag work lives in one
                  place.)
                - ScrapeFailures + CurationRuns also pair at lg+
                  for the same reason — two telemetry tables. */}
          <SubSection
            title="큐레이션 룰"
            hint="내가 만든 차단/치환 규칙 — 신규 import 부터 적용됨"
          >
            <SourcesPanel />
            <TermReplacementsPanel />
          </SubSection>

          <SubSection
            title="운영 로그"
            hint="자동 수집된 텔레메트리 — 큐레이션 결과 / 실패 추적용"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ScrapeFailuresPanel />
              <CurationRunsPanel />
            </div>
          </SubSection>
        </>
      )}

      {activeTab === 'api' && (
        <Suspense fallback={<div className="text-sm text-gray-400">로딩 중…</div>}>
          {/* Blanket LLM model selector — the one knob that fixes an
              outage like the deepseek-chat rename without a redeploy —
              plus the default review-discovery engine right below it. */}
          <section className="mb-6 space-y-3">
            <LlmModelPanel />
            <DiscoveryEnginePanel />
            <CompatProviderPanel />
            <ReleaseSyncPanel />
          </section>

          {/* Live usage console (polls /api/admin/api-console every
              15s). Same view as /admin/api-console; the standalone
              route stays available for pinned-tab workflows. */}
          <section>
            <ApiConsole embedded />
          </section>

          {/* LLM shadow-comparison grid (Haiku/Sonnet vs DeepSeek).
              Same content as /admin/compare; embedded inline here so
              the cost panel and the quality comparison live in one
              scroll context. */}
          <section className="mt-6">
            <LlmCompare embedded />
          </section>
        </Suspense>
      )}

      {activeTab === 'maintenance' && <DuplicatesPanel />}

      {activeTab === 'tags' && (
        <Suspense fallback={<div className="text-sm text-gray-400">로딩 중…</div>}>
          <div className="space-y-8">
            <AdminTags />
            {/* Blacklist viewer lives here too so all tag work is in one
                tab. AdminTags' blacklist action invalidates the
                'admin-tag-blacklist' query, so this panel refreshes when
                tags are banned from the workspace above. */}
            <TagBlacklistPanel />
          </div>
        </Suspense>
      )}
    </main>
  );
}

// Blanket primary-LLM model selector. Reads/writes the app_settings
// 'llm_primary_model' key via /api/admin/llm-model. The one control that
// lets the operator swap the DeepSeek tier (or a future renamed model id)
// without a redeploy — added after DeepSeek retired the `deepseek-chat`
// alias and every LLM feature 400'd at once.
interface LlmModelResp {
  configured: string | null;
  envOverride: string | null;
  codeDefault: string;
  options: string[];
}

function LlmModelPanel() {
  const qc = useQueryClient();
  const [custom, setCustom] = useState('');
  const { data, isLoading, isError } = useQuery<LlmModelResp>({
    queryKey: ['admin', 'llm-model'],
    queryFn: async () => (await axios.get('/api/admin/llm-model')).data,
  });

  const save = useMutation({
    mutationFn: async (model: string) =>
      (await axios.post('/api/admin/llm-model', { model })).data,
    onSuccess: () => {
      setCustom('');
      qc.invalidateQueries({ queryKey: ['admin', 'llm-model'] });
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error ?? '모델 변경에 실패했습니다.');
    },
  });

  if (isLoading) return <div className="text-sm text-gray-400">모델 정보 로딩 중…</div>;
  if (isError || !data)
    return <div className="text-sm text-red-400">모델 정보를 불러오지 못했습니다.</div>;

  // The env override, when present, wins over the DB setting in
  // resolvePrimaryModel — reflect that so the dropdown doesn't look
  // authoritative when it isn't.
  const effective = data.envOverride ?? data.configured ?? data.codeDefault;
  const selectValue = data.configured ?? data.codeDefault;
  const envLocked = !!data.envOverride;
  // Include a custom-configured value in the dropdown so it shows as
  // selected even when it isn't one of the suggested quick-picks.
  const selectOptions = Array.from(new Set([...data.options, selectValue]));

  return (
    <div className="rounded-xl border border-white/10 bg-[#111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">메인 LLM 모델</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            리뷰 큐레이션 · 요약 · 스크랩 등 모든 기본 LLM 작업이 쓰는 모델.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-accent">
          {effective}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={selectValue}
          disabled={envLocked || save.isPending}
          onChange={(e) => save.mutate(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
        >
          {selectOptions.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === data.codeDefault ? ' (기본)' : ''}
            </option>
          ))}
        </select>
        {save.isPending && <span className="text-xs text-gray-400">저장 중…</span>}
        {data.configured && !envLocked && (
          <button
            onClick={() => save.mutate('')}
            disabled={save.isPending}
            className="text-xs text-gray-500 hover:text-accent"
            title="DB 설정을 지우고 코드 기본값으로 되돌립니다."
          >
            기본값으로 초기화
          </button>
        )}
      </div>

      {/* Free-text entry for a model id not in the quick-picks, so a future
          model can be adopted without a code change. */}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) save.mutate(custom.trim());
          }}
          placeholder="직접 입력 (예: deepseek-v5, claude-opus-4-8)"
          disabled={envLocked || save.isPending}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-gray-200 disabled:opacity-50"
        />
        <button
          onClick={() => custom.trim() && save.mutate(custom.trim())}
          disabled={envLocked || save.isPending || !custom.trim()}
          className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          적용
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-600">
        라우팅: <code>deepseek-*</code> → DeepSeek, <code>compat:&lt;model&gt;</code> → 아래 OpenAI 호환
        제공자, 그 외 → Anthropic (각 키 필요).
      </p>

      {envLocked && (
        <p className="mt-2 text-xs text-amber-400/80">
          환경변수 LLM_PRIMARY_MODEL={data.envOverride} 이(가) 설정돼 있어 이 값이
          우선합니다. 드롭다운으로 바꾸려면 Railway에서 해당 변수를 먼저 지워주세요.
        </p>
      )}
    </div>
  );
}

// Default discovery engine selector (review-URL search). Reads/writes the
// app_settings 'discovery_engine' key via /api/admin/discovery-engine.
// Fixed option set — each engine maps to a wired implementation, so unlike
// the model field there is no free-text entry.
interface DiscoveryEngineResp {
  configured: string | null;
  envOverride: string | null;
  codeDefault: string;
  options: string[];
}

function DiscoveryEnginePanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<DiscoveryEngineResp>({
    queryKey: ['admin', 'discovery-engine'],
    queryFn: async () => (await axios.get('/api/admin/discovery-engine')).data,
  });

  const save = useMutation({
    mutationFn: async (engine: string) =>
      (await axios.post('/api/admin/discovery-engine', { engine })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'discovery-engine'] });
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error ?? '엔진 변경에 실패했습니다.');
    },
  });

  if (isLoading) return <div className="text-sm text-gray-400">엔진 정보 로딩 중…</div>;
  if (isError || !data)
    return <div className="text-sm text-red-400">엔진 정보를 불러오지 못했습니다.</div>;

  const effective = data.envOverride ?? data.configured ?? data.codeDefault;
  const selectValue = data.configured ?? data.codeDefault;
  const envLocked = !!data.envOverride;

  return (
    <div className="rounded-xl border border-white/10 bg-[#111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">리뷰 검색 엔진 (Discovery)</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            자동 큐레이션 배치와 🔎 자동 검색의 기본 엔진.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-accent">
          {effective}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={selectValue}
          disabled={envLocked || save.isPending}
          onChange={(e) => save.mutate(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
        >
          {data.options.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === data.codeDefault ? ' (기본)' : ''}
            </option>
          ))}
        </select>
        {save.isPending && <span className="text-xs text-gray-400">저장 중…</span>}
        {data.configured && !envLocked && (
          <button
            onClick={() => save.mutate('')}
            disabled={save.isPending}
            className="text-xs text-gray-500 hover:text-accent"
            title="DB 설정을 지우고 코드 기본값(tavily)으로 되돌립니다."
          >
            기본값으로 초기화
          </button>
        )}
      </div>

      {envLocked && (
        <p className="mt-2 text-xs text-amber-400/80">
          환경변수 DISCOVERY_ENGINE={data.envOverride} 이(가) 설정돼 있어 이 값이
          우선합니다. 드롭다운으로 바꾸려면 Railway에서 해당 변수를 먼저 지워주세요.
        </p>
      )}
    </div>
  );
}

// OpenAI-compatible provider config for `compat:<model>` primary models.
// Base URL is admin-editable (app_settings 'llm_compat_base_url'); the API
// key stays in the LLM_COMPAT_API_KEY env var and is never shown — the GET
// only reports whether it is set.
interface CompatResp {
  baseUrl: string | null;
  envBaseUrl: string | null;
  apiKeySet: boolean;
}

function CompatProviderPanel() {
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<CompatResp>({
    queryKey: ['admin', 'llm-compat'],
    queryFn: async () => (await axios.get('/api/admin/llm-compat')).data,
  });

  const save = useMutation({
    mutationFn: async (baseUrl: string) =>
      (await axios.post('/api/admin/llm-compat', { baseUrl })).data,
    onSuccess: () => {
      setUrl(null);
      qc.invalidateQueries({ queryKey: ['admin', 'llm-compat'] });
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error ?? 'base URL 저장에 실패했습니다.');
    },
  });

  if (isLoading) return <div className="text-sm text-gray-400">제공자 정보 로딩 중…</div>;
  if (isError || !data)
    return <div className="text-sm text-red-400">제공자 정보를 불러오지 못했습니다.</div>;

  const envLocked = !!data.envBaseUrl;
  const effectiveUrl = data.envBaseUrl ?? data.baseUrl ?? '(미설정)';
  // `url` is the in-progress edit; fall back to the saved value for display.
  const inputValue = url ?? data.baseUrl ?? '';

  return (
    <div className="rounded-xl border border-white/10 bg-[#111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">OpenAI 호환 제공자</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <code>compat:&lt;model&gt;</code> 모델이 쓸 base URL. OpenAI · Groq · OpenRouter ·
            Together · 로컬 등.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-xs ${
            data.apiKeySet ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
          }`}
          title="LLM_COMPAT_API_KEY 환경변수"
        >
          API 키 {data.apiKeySet ? '설정됨' : '없음'}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save.mutate((url ?? '').trim());
          }}
          placeholder="https://openrouter.ai/api/v1"
          disabled={envLocked || save.isPending}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-gray-200 disabled:opacity-50"
        />
        <button
          onClick={() => save.mutate((url ?? data.baseUrl ?? '').trim())}
          disabled={envLocked || save.isPending || url === null}
          className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          저장
        </button>
        {data.baseUrl && !envLocked && (
          <button
            onClick={() => save.mutate('')}
            disabled={save.isPending}
            className="text-xs text-gray-500 hover:text-accent"
            title="base URL 설정을 지웁니다."
          >
            지우기
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-600">
        현재: <span className="font-mono text-gray-400">{effectiveUrl}</span>
        {'  '}· 키는 Railway 환경변수 <code>LLM_COMPAT_API_KEY</code>로 설정하세요 (여기 노출 안 됨).
      </p>

      {envLocked && (
        <p className="mt-2 text-xs text-amber-400/80">
          환경변수 LLM_COMPAT_BASE_URL 이(가) 설정돼 있어 이 값이 우선합니다.
        </p>
      )}
    </div>
  );
}

// Manual trigger for the daily 04:00 KST release-sync job. The scheduled
// tick has no boot catch-up, so a redeploy landing on 04:00 skips the day;
// this recovers it (and picks up albums registered after 04:00 on their
// release day, which the exact-day review gate would otherwise miss).
function ReleaseSyncPanel() {
  const [result, setResult] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => (await axios.post('/api/admin/run-release-sync')).data,
    onSuccess: (d: any) => {
      setResult(
        `완료 — 링크 후보 ${d.linkCandidates}개 중 Discogs ${d.discogsRefreshed} · Spotify ${d.spotifyRefreshed} 갱신, 리뷰 ${d.reviewsQueued}건 수집 시작.`
      );
    },
    onError: (err: any) => {
      setResult(err?.response?.data?.error ?? '실행에 실패했습니다.');
    },
  });

  return (
    <div className="rounded-xl border border-white/10 bg-[#111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">릴리스 싱크 수동 실행</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            최근 7일(KST) 발매 앨범 링크 재해석 + 오늘 발매 앨범 리뷰 수집. 매일 04:00 KST
            자동 실행분을 지금 즉시 돌립니다.
          </p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {run.isPending ? '실행 중…' : '지금 실행'}
        </button>
      </div>
      {result && <p className="mt-2 text-xs text-gray-400">{result}</p>}
    </div>
  );
}

// Duplicate-album cleanup. A duplicate is a `base-N` (N>=2) slug whose base
// is another album's slug — the counter suffix generateSlug adds when the
// same record is registered twice under different mbids. See
// server/src/services/albumDedupe.ts for the detection + delete gate.
interface DuplicateEntry {
  id: number;
  slug: string;
  mbid: string;
  artist: string | null;
  title: string | null;
  year: number | null;
  cover: string | null;
  canonicalId: number;
  canonicalSlug: string;
  canonicalMbid: string;
  canonicalArtist: string | null;
  canonicalTitle: string | null;
  canonicalCover: string | null;
  status: 'deletable' | 'has_data' | 'suspicious';
  blocking: { table: string; count: number }[];
  similarCount: number;
}

function DupCover({ src, label }: { src: string | null; label: string }) {
  return (
    <CoverArt
      src={src}
      alt={label}
      className="w-12 h-12 rounded object-cover flex-shrink-0 bg-panel-strong"
    />
  );
}

function DuplicatesPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data, isLoading, isError } = useQuery<{ duplicates: DuplicateEntry[] }>({
    queryKey: ['admin-duplicates'],
    queryFn: async () => (await axios.get('/api/admin/duplicates')).data,
  });

  const del = useMutation({
    mutationFn: async (ids: number[]) =>
      (await axios.post('/api/admin/duplicates/delete', { ids })).data as {
        deleted: number[];
        refused: { id: number; reason: string }[];
      },
    onSuccess: (result) => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['admin-duplicates'] });
      if (result.refused.length > 0) {
        alert(
          `${result.deleted.length}개 삭제됨. ${result.refused.length}개는 삭제되지 않음 (데이터가 붙어 있거나 이미 처리됨).`
        );
      }
    },
  });

  const merge = useMutation({
    mutationFn: async (ids: number[]) =>
      (await axios.post('/api/admin/duplicates/merge', { ids })).data as {
        merged: number[];
        results: {
          id: number;
          ok: boolean;
          reason?: string;
          reviewsMoved?: number;
          reviewsDropped?: number;
          canonicalReviewTotal?: number;
        }[];
        summaries: { mbid: string; regenerated: boolean }[];
      },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin-duplicates'] });
      // The reviews moved server-side; mark the album pages stale so a
      // visit to the canonical refetches the combined review set instead
      // of a cached pre-merge response.
      qc.invalidateQueries({ queryKey: ['album'] });
      qc.invalidateQueries({ queryKey: ['album-reviews'] });
      const ok = result.results.filter((r) => r.ok);
      const failed = result.results.filter((r) => !r.ok);
      const moved = ok.reduce((s, r) => s + (r.reviewsMoved ?? 0), 0);
      const dropped = ok.reduce((s, r) => s + (r.reviewsDropped ?? 0), 0);
      const lines: string[] = [];
      if (ok.length > 0) {
        lines.push(
          `${ok.length}개 병합됨 · 리뷰 ${moved}개 이동` +
            (dropped > 0 ? `, 같은 매체 중복 ${dropped}개 제외` : '')
        );
      }
      if (failed.length > 0) {
        lines.push(
          `${failed.length}개 실패: ${failed
            .map((f) => `#${f.id}(${f.reason})`)
            .join(', ')}`
        );
      }
      if (lines.length > 0) alert(lines.join('\n'));
    },
  });

  const dups = data?.duplicates ?? [];
  const deletable = dups.filter((d) => d.status === 'deletable');
  const hasData = dups.filter((d) => d.status === 'has_data');
  const suspicious = dups.filter((d) => d.status === 'suspicious');

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected =
    deletable.length > 0 && deletable.every((d) => selected.has(d.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(deletable.map((d) => d.id)));

  const runDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `선택한 중복 앨범 ${ids.length}개를 삭제합니다. 되돌릴 수 없습니다. 진행할까요?`
      )
    )
      return;
    del.mutate(ids);
  };

  const runMerge = (d: DuplicateEntry) => {
    if (
      !window.confirm(
        `"${d.artist} — ${d.title}"의 데이터를 원본(${d.canonicalSlug})으로 병합합니다.\n` +
          `리뷰는 합쳐지고(같은 매체는 먼저 만들어진 쪽만 남김), 리뷰 요약은 다시 생성됩니다. ` +
          `중복 앨범은 삭제됩니다. 되돌릴 수 없습니다. 진행할까요?`
      )
    )
      return;
    merge.mutate([d.id]);
  };

  return (
    <div className="max-w-4xl">
      <SubSection
        title="중복 앨범 정리"
        hint="같은 앨범이 서로 다른 mbid로 두 번 등록되어 slug 끝에 -2, -3 가 붙은 경우"
      >
        {isError && (
          <EmptyRow>중복 목록을 불러오지 못했습니다.</EmptyRow>
        )}
        {isLoading && <EmptyRow>불러오는 중…</EmptyRow>}

        {data && dups.length === 0 && (
          <EmptyRow>중복으로 검출된 앨범이 없습니다.</EmptyRow>
        )}

        {deletable.length > 0 && (
          <Panel
            title="삭제 가능 (붙은 데이터 없음)"
            icon="✅"
            count={deletable.length}
            headerAction={
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAll}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1"
                >
                  {allSelected ? '전체 해제' : '전체 선택'}
                </button>
                <button
                  onClick={runDelete}
                  disabled={selected.size === 0 || del.isPending}
                  className="text-xs font-semibold px-3 py-1 rounded bg-red-500/90 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {del.isPending
                    ? '삭제 중…'
                    : `선택 삭제 (${selected.size})`}
                </button>
              </div>
            }
          >
            {deletable.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => toggle(d.id)}
                  className="flex-shrink-0"
                />
                <DupCover src={d.cover} label={d.slug} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">
                    {d.artist} — {d.title}
                    {d.year ? ` (${d.year})` : ''}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    삭제: <span className="text-red-400">{d.slug}</span>
                    {d.similarCount > 0 &&
                      ` · similar ${d.similarCount}개도 함께 정리`}
                  </div>
                </div>
                <div className="text-gray-600 text-lg flex-shrink-0">→</div>
                <DupCover src={d.canonicalCover} label={d.canonicalSlug} />
                <div className="min-w-0 hidden sm:block w-40">
                  <div className="text-[11px] text-gray-500">유지</div>
                  <Link
                    to={`/album/${d.canonicalSlug}`}
                    className="text-[11px] text-gray-400 hover:text-accent truncate block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {d.canonicalSlug}
                  </Link>
                </div>
              </label>
            ))}
          </Panel>
        )}

        {hasData.length > 0 && (
          <Panel
            title="데이터가 붙어 있음 (병합)"
            icon="⚠️"
            count={hasData.length}
          >
            {hasData.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3">
                <DupCover src={d.cover} label={d.slug} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">
                    {d.artist} — {d.title}
                    {d.year ? ` (${d.year})` : ''}
                  </div>
                  <Link
                    to={`/album/${d.slug}`}
                    className="text-[11px] text-gray-500 hover:text-accent truncate block"
                  >
                    {d.slug}
                  </Link>
                  <div className="text-[11px] text-amber-400/90 mt-0.5">
                    {d.blocking
                      .map((b) => `${b.table} ${b.count}`)
                      .join(' · ')}
                  </div>
                </div>
                <div className="min-w-0 hidden sm:block w-32">
                  <div className="text-[11px] text-gray-500">병합 대상</div>
                  <Link
                    to={`/album/${d.canonicalSlug}`}
                    className="text-[11px] text-gray-400 hover:text-accent truncate block"
                  >
                    {d.canonicalSlug}
                  </Link>
                </div>
                <button
                  onClick={() => runMerge(d)}
                  disabled={merge.isPending}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-accent/90 hover:bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {merge.isPending ? '병합 중…' : '병합'}
                </button>
              </div>
            ))}
          </Panel>
        )}

        {suspicious.length > 0 && (
          <Panel
            title="슬러그만 닮음 (실제 다른 앨범일 수 있음)"
            icon="❓"
            count={suspicious.length}
          >
            {suspicious.map((d) => (
              <div key={d.id} className="p-3 text-[12px]">
                <div className="text-gray-300">
                  <span className="text-gray-500">이 앨범:</span> {d.artist} —{' '}
                  {d.title}{' '}
                  <Link
                    to={`/album/${d.slug}`}
                    className="text-gray-500 hover:text-accent"
                  >
                    ({d.slug})
                  </Link>
                </div>
                <div className="text-gray-400 mt-0.5">
                  <span className="text-gray-500">원본 후보:</span>{' '}
                  {d.canonicalArtist} — {d.canonicalTitle}{' '}
                  <Link
                    to={`/album/${d.canonicalSlug}`}
                    className="text-gray-500 hover:text-accent"
                  >
                    ({d.canonicalSlug})
                  </Link>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </SubSection>
    </div>
  );
}

interface ScrapeFailureHost {
  hostname: string;
  attempts: number;
  last_failed_at: string;
  last_reason: string;
  last_error: string | null;
  last_url: string;
  last_album_mbid: string | null;
  last_album_slug: string | null;
  last_album_title: string | null;
  last_album_artist: string | null;
}

function ScrapeFailuresPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{
    windowDays: number;
    hosts: ScrapeFailureHost[];
  }>({
    queryKey: ['admin-scrape-failures'],
    queryFn: async () => {
      const resp = await axios.get('/api/admin/scrape-failures?days=30');
      return resp.data;
    },
    staleTime: 30_000,
  });

  const del = useMutation({
    mutationFn: async (hostname: string) => {
      await axios.delete(
        `/api/admin/scrape-failures/${encodeURIComponent(hostname)}`
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-scrape-failures'] });
    },
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      await axios.delete('/api/admin/scrape-failures');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-scrape-failures'] });
    },
  });

  const hosts = data?.hosts ?? [];

  const headerAction = hosts.length > 0 ? (
    <button
      type="button"
      onClick={() => {
        if (clearAll.isPending) return;
        if (
          !confirm(
            '실패 로그 전체를 삭제할까요? (새 실패가 발생하면 자동으로 다시 쌓임)'
          )
        )
          return;
        clearAll.mutate();
      }}
      disabled={clearAll.isPending}
      className="text-xs text-gray-500 hover:text-red-400 border border-white/10 hover:border-red-500/40 rounded-md px-2 py-0.5 disabled:opacity-40 cursor-pointer transition-colors"
    >
      {clearAll.isPending ? '삭제 중…' : '전체 삭제'}
    </button>
  ) : null;

  return (
    <Panel
      title="스크래핑 실패 로그 (30일)"
      icon="⚠️"
      count={hosts.length}
      headerAction={headerAction}
    >
      {isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : isError ? (
        <EmptyRow>불러오지 못했습니다.</EmptyRow>
      ) : hosts.length === 0 ? (
        <EmptyRow>실패한 스크래핑 없음 ✓</EmptyRow>
      ) : (
        hosts.map((h) => {
          // Deep-link into the album page's manual-entry form with URL
          // pre-filled, so admin doesn't have to paste it themselves.
          // Uses last_album_slug when available (better URL); falls
          // back to mbid. Missing album (album was deleted after the
          // failure was logged) → no retry link.
          const retryHref =
            (h.last_album_slug || h.last_album_mbid) && h.last_url
              ? `/album/${h.last_album_slug || h.last_album_mbid}?retry-url=${encodeURIComponent(h.last_url)}`
              : null;
          return (
            <div key={h.hostname} className="p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-white font-medium truncate">
                    {h.hostname}
                  </span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    ×{h.attempts}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
                    {h.last_reason}
                  </span>
                  <span className="text-xs text-gray-600">
                    {formatRelativeKo(h.last_failed_at)}
                  </span>
                </div>
                <a
                  href={h.last_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-gray-500 hover:text-accent truncate mt-1"
                  title={h.last_url}
                >
                  {h.last_url}
                </a>
                {h.last_album_title && (
                  <div className="text-[11px] text-gray-600 truncate mt-0.5">
                    → {h.last_album_artist} — {h.last_album_title}
                  </div>
                )}
                {h.last_error && (
                  <div
                    className="text-xs text-gray-600 truncate mt-1 font-mono"
                    title={h.last_error}
                  >
                    {h.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {retryHref && (
                  <Link
                    to={retryHref}
                    className="text-xs text-accent/80 hover:text-accent border border-accent/40 hover:border-accent/70 rounded px-2 py-0.5 cursor-pointer transition-colors"
                    title="이 앨범의 수동 입력 폼 열기 (URL/사이트 자동 프리필)"
                  >
                    ✏️ 수동 등록
                  </Link>
                )}
                <button
                  onClick={() => {
                    if (del.isPending) return;
                    if (
                      !confirm(
                        `${h.hostname} 의 실패 로그 ${h.attempts}개를 삭제할까요? (다시 실패하면 자동으로 다시 쌓임)`
                      )
                    )
                      return;
                    del.mutate(h.hostname);
                  }}
                  disabled={del.isPending}
                  className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 px-2 py-1 cursor-pointer"
                  aria-label={`${h.hostname} 실패 로그 삭제`}
                  title="실패 로그 삭제"
                >
                  🗑️
                </button>
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}

// ─── Source trust panel ────────────────────────────────────────────────
//
// Four cumulative columns — successHosts / failureHosts / whitelist /
// blacklist — rendered side by side so admin can promote proven hosts
// from the derived lists into the curated ones with one click. The
// whitelist is a ranking hint (whitelisted hosts bubble to the top of
// /reviews/discover results, non-whitelisted ones still appear
// beneath) and the blacklist is a hard-fail at scrape time, same
// effect as the hardcoded EXCLUDED_URL_DOMAINS in reviews.ts.

interface SourcesResp {
  successHosts: Array<{
    host: string;
    hits: number;
    lastUrl: string;
    verified: boolean;
    threshold: number;
  }>;
  failureHosts: Array<{ host: string; hits: number; lastFailedAt: string }>;
  whitelist: Array<{ host: string; addedAt: string; note: string | null }>;
  blacklist: Array<{ host: string; addedAt: string; reason: string | null }>;
}

function SourcesPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<SourcesResp>({
    queryKey: ['admin-sources'],
    queryFn: async () => (await axios.get('/api/admin/sources')).data,
    staleTime: 30_000,
  });

  const addWhitelist = useMutation({
    mutationFn: async ({ host, note }: { host: string; note?: string | null }) => {
      await axios.post('/api/admin/sources/whitelist', { host, note: note ?? null });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sources'] }),
  });
  const removeWhitelist = useMutation({
    mutationFn: async (host: string) => {
      await axios.delete(`/api/admin/sources/whitelist/${encodeURIComponent(host)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sources'] }),
  });
  const addBlacklist = useMutation({
    mutationFn: async ({ host, reason }: { host: string; reason?: string | null }) => {
      await axios.post('/api/admin/sources/blacklist', { host, reason: reason ?? null });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sources'] }),
  });
  const removeBlacklist = useMutation({
    mutationFn: async (host: string) => {
      await axios.delete(`/api/admin/sources/blacklist/${encodeURIComponent(host)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sources'] }),
  });

  const whitelistSet = useMemo(
    () => new Set((data?.whitelist ?? []).map((w) => w.host)),
    [data]
  );
  const blacklistSet = useMemo(
    () => new Set((data?.blacklist ?? []).map((b) => b.host)),
    [data]
  );
  // Per-host lookup of accumulated review counts + verified status,
  // shared by the whitelist + blacklist columns so an already-curated
  // host still shows its progress. Operator workflow context: many
  // bot-blocked hosts get added to the blacklist (to stop the
  // scraper trying) but are still actively contributing reviews via
  // manual paste. Hiding their counts inside the blacklist column
  // made those silent — surfacing the badge here lets the operator
  // see verified progress at a glance regardless of curation state.
  const successByHost = useMemo(() => {
    const map = new Map<
      string,
      { hits: number; verified: boolean; threshold: number }
    >();
    for (const h of data?.successHosts ?? []) {
      map.set(h.host, {
        hits: h.hits,
        verified: h.verified,
        threshold: h.threshold,
      });
    }
    return map;
  }, [data]);
  const totalCount = (data?.whitelist.length ?? 0) + (data?.blacklist.length ?? 0);

  return (
    <Panel title="리뷰 소스 트러스트 리스트" icon="🔖" count={totalCount}>
      {isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : isError ? (
        <EmptyRow>불러오지 못했습니다.</EmptyRow>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/5">
          {/* Success accumulation — hosts that have landed at least one
              saved review. Primary discovery path: admin scans the top
              count, clicks 화이트로 for ones they trust. Entries that
              have already been promoted to the whitelist OR the
              blacklist are filtered out so the column only surfaces
              hosts that still need a curation decision. */}
          <HostList
            header="✓ 성공 누적"
            subheader="저장된 리뷰 기준 (미등록만)"
            emptyText="아직 없음"
            items={(data?.successHosts ?? [])
              .filter((h) => !whitelistSet.has(h.host) && !blacklistSet.has(h.host))
              .map((h) => ({
                host: h.host,
                badge: h.verified ? `×${h.hits} ✓` : `×${h.hits}`,
                // Progress note — "verified" once accumulated past
                // threshold, otherwise count remaining. Helps the
                // operator see which hosts are close to graduating
                // and which need an explicit whitelist promotion.
                sub: h.verified
                  ? 'verified'
                  : `verified까지 ${Math.max(0, h.threshold - h.hits)}개`,
                title: h.lastUrl,
              }))}
            renderAction={(host) => (
              <button
                type="button"
                onClick={() => addWhitelist.mutate({ host })}
                disabled={addWhitelist.isPending}
                className="text-[11px] text-emerald-400/70 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-400/60 rounded px-1.5 py-0.5 disabled:opacity-40 cursor-pointer transition-colors"
                title="화이트리스트 추가"
              >
                + 화이트
              </button>
            )}
          />

          {/* Failure accumulation — hosts the scraper has given up on.
              Promote to blacklist with one click so the hardcoded list
              stays lean (DB-driven entries carry a reason field).
              Already-curated hosts filtered out for the same reason as
              the success column. */}
          <HostList
            header="✗ 실패 누적"
            subheader="scrape_failures 전체 기간 (미등록만)"
            emptyText="실패 기록 없음"
            items={(data?.failureHosts ?? [])
              .filter((h) => !whitelistSet.has(h.host) && !blacklistSet.has(h.host))
              .map((h) => ({
                host: h.host,
                badge: `×${h.hits}`,
                sub: formatRelativeKo(h.lastFailedAt),
                title: h.lastFailedAt,
              }))}
            renderAction={(host) => (
              <button
                type="button"
                onClick={() => addBlacklist.mutate({ host })}
                disabled={addBlacklist.isPending}
                className="text-[11px] text-red-400/70 hover:text-red-300 border border-red-500/30 hover:border-red-400/60 rounded px-1.5 py-0.5 disabled:opacity-40 cursor-pointer transition-colors"
                title="블랙리스트 추가"
              >
                + 블랙
              </button>
            )}
          />

          {/* Whitelist — curated trust list. Re-ranks /reviews/discover
              results so these hosts surface at the top. */}
          <ManagedHostList
            header="🏅 화이트리스트"
            subheader="discover 결과에서 우선 정렬"
            emptyText="비어 있음"
            placeholder="예: pitchfork.com"
            items={(data?.whitelist ?? []).map((w) => {
              const s = successByHost.get(w.host);
              return {
                host: w.host,
                badge: s ? (s.verified ? `×${s.hits} ✓` : `×${s.hits}`) : undefined,
                sub: w.note || null,
                title: w.addedAt,
              };
            })}
            onAdd={(host) => addWhitelist.mutate({ host })}
            onRemove={(host) => removeWhitelist.mutate(host)}
            isBusy={addWhitelist.isPending || removeWhitelist.isPending}
            accent="emerald"
          />

          {/* Blacklist — curated refusal list. Same runtime effect as
              EXCLUDED_URL_DOMAINS (hard fail at scrape time) but
              editable without a deploy. Many entries here are bot-
              blocked publications the operator still contributes to
              via manual paste, so showing accumulated review counts
              + verified status is the same workflow signal the
              success column gives — just for hosts that already
              made a curation decision. */}
          <ManagedHostList
            header="🚫 블랙리스트"
            subheader="스크랩 단계에서 거부"
            emptyText="비어 있음"
            placeholder="예: somebadsite.com"
            items={(data?.blacklist ?? []).map((b) => {
              const s = successByHost.get(b.host);
              return {
                host: b.host,
                badge: s ? (s.verified ? `×${s.hits} ✓` : `×${s.hits}`) : undefined,
                sub:
                  b.reason ||
                  (s && !s.verified
                    ? `verified까지 ${Math.max(0, s.threshold - s.hits)}개`
                    : null),
                title: b.addedAt,
              };
            })}
            onAdd={(host) => addBlacklist.mutate({ host })}
            onRemove={(host) => removeBlacklist.mutate(host)}
            isBusy={addBlacklist.isPending || removeBlacklist.isPending}
            accent="red"
          />
        </div>
      )}
    </Panel>
  );
}

// ─── Tag blacklist panel ───────────────────────────────────────────────
//
// Genre strings auto-banned from re-import. Populated implicitly when
// admin × a tag in TagEditor on an album page. Listed most-recent-first
// so an accidental click is easy to spot at the top and undo with one
// more click. Removing an entry deletes the row + invalidates the
// in-memory cleanGenres filter cache, so the next album fetch can
// re-import the tag freely. Does NOT auto-restore the tag to the
// albums it was previously stripped from — that history isn't kept,
// so admin re-adds via the TagEditor input on the relevant album.

interface TagBlacklistEntry {
  tag: string;
  addedAt: string;
  addedByEmail: string | null;
}

function TagBlacklistPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{ tags: TagBlacklistEntry[] }>({
    queryKey: ['admin-tag-blacklist'],
    queryFn: async () => (await axios.get('/api/admin/tag-blacklist')).data,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: async (tag: string) => {
      await axios.delete(`/api/admin/tag-blacklist/${encodeURIComponent(tag)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-tag-blacklist'] }),
  });

  const [query, setQuery] = useState('');
  const tags = data?.tags ?? [];
  const q = query.trim().toLowerCase();
  const filteredTags = q
    ? tags.filter((t) => t.tag.toLowerCase().includes(q))
    : tags;

  return (
    <Panel
      title="태그 블랙리스트"
      icon="🏷️"
      count={tags.length}
      headerAction={
        tags.length > 0 ? (
          <PanelSearchInput
            value={query}
            onChange={setQuery}
            placeholder="태그 검색..."
          />
        ) : null
      }
    >
      {isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : isError ? (
        <EmptyRow>불러오지 못했습니다.</EmptyRow>
      ) : tags.length === 0 ? (
        <EmptyRow>비어 있음</EmptyRow>
      ) : filteredTags.length === 0 ? (
        <EmptyRow>"{query}" 검색 결과 없음</EmptyRow>
      ) : (
        <div className="divide-y divide-white/5">
          {filteredTags.map((t) => (
            <div
              key={t.tag}
              className="px-4 py-2.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate" title={t.tag}>
                  {t.tag}
                </div>
                <div
                  className="text-[10px] text-gray-500 mt-0.5"
                  title={t.addedAt}
                >
                  {formatRelativeKo(t.addedAt)}
                  {t.addedByEmail && ` · ${t.addedByEmail}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(t.tag)}
                disabled={remove.isPending}
                className="text-[11px] text-gray-400 hover:text-red-300 border border-white/10 hover:border-red-400/60 rounded px-2 py-0.5 disabled:opacity-40 cursor-pointer transition-colors"
                title={`"${t.tag}" 블랙리스트에서 제거 (앨범에 다시 등장 가능)`}
              >
                해제
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// Korean term replacement rules. Server: term_replacements table +
// /api/admin/term-replacements CRUD. Applied during normaliseKoreanTerms
// — single source of truth, replaces the formerly-hardcoded array.
// is_regex distinguishes plain-string rules (most operator additions)
// from regex rules (most migrated system rules with alternation /
// capture groups). note is a short Korean explanation on system
// rules so the curator can read what each migrated rule does
// without parsing regex by hand.
interface TermReplacementRule {
  id: number;
  pattern: string;
  replacement: string;
  is_regex: number;
  note: string | null;
  created_at: string;
}

function TermReplacementsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{ rules: TermReplacementRule[] }>({
    queryKey: ['admin-term-replacements'],
    queryFn: async () => (await axios.get('/api/admin/term-replacements')).data,
    staleTime: 30_000,
  });

  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [note, setNote] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const create = useMutation({
    mutationFn: async (body: {
      pattern: string;
      replacement: string;
      note: string | null;
      isRegex: boolean;
    }) => {
      await axios.post('/api/admin/term-replacements', body);
    },
    onSuccess: () => {
      setPattern('');
      setReplacement('');
      setNote('');
      setIsRegex(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['admin-term-replacements'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || '등록 실패');
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/admin/term-replacements/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-term-replacements'] }),
  });

  const rules = data?.rules ?? [];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = pattern.trim();
    const r = replacement.trim();
    if (!p || !r) {
      setError('pattern과 replacement 둘 다 필요해요');
      return;
    }
    if (!isRegex && p === r) {
      setError('pattern과 replacement이 같습니다');
      return;
    }
    if (isRegex) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(p, 'g');
      } catch (err) {
        setError(`정규식이 잘못됐어요: ${(err as Error).message}`);
        return;
      }
    }
    create.mutate({
      pattern: p,
      replacement: r,
      note: note.trim() || null,
      isRegex,
    });
  };

  const q = query.trim().toLowerCase();
  const filteredRules = q
    ? rules.filter((r) =>
        [r.pattern, r.replacement, r.note ?? ''].some((s) =>
          s.toLowerCase().includes(q)
        )
      )
    : rules;

  return (
    <Panel
      title="한국어 용어 치환"
      icon="🔁"
      count={rules.length}
      headerAction={
        rules.length > 0 ? (
          <PanelSearchInput
            value={query}
            onChange={setQuery}
            placeholder="패턴/메모 검색..."
          />
        ) : null
      }
    >
      <form
        onSubmit={submit}
        className="px-4 py-3 border-b border-white/5 flex flex-col gap-2"
      >
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={
              isRegex
                ? '정규식 (예: 죽음의?\\s*금속)'
                : '찾을 단어 (예: 금속 사운드)'
            }
            className="flex-1 min-w-0 bg-panel-strong border border-white/10 focus:border-accent/60 rounded px-2.5 py-1.5 text-sm text-gray-100 outline-none font-mono"
            maxLength={500}
          />
          <span className="text-gray-500 text-sm shrink-0 px-1">→</span>
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={
              isRegex ? '치환문 (capture group: $1)' : '바꿀 단어 (예: 메탈 사운드)'
            }
            className="flex-1 min-w-0 bg-panel-strong border border-white/10 focus:border-accent/60 rounded px-2.5 py-1.5 text-sm text-gray-100 outline-none font-mono"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="shrink-0 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-panel-strong font-medium px-3 py-1.5 rounded cursor-pointer transition-colors"
          >
            {create.isPending ? '...' : '추가'}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <label className="flex items-center gap-1.5 text-[12px] text-gray-400 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
              className="cursor-pointer"
            />
            정규식 사용
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (선택, 예: '금속'이 metal로 직역됨)"
            className="flex-1 min-w-0 bg-panel-strong border border-white/10 focus:border-accent/60 rounded px-2.5 py-1 text-[12px] text-gray-300 outline-none"
            maxLength={200}
          />
        </div>
      </form>
      {error && (
        <div className="px-4 py-2 text-[12px] text-red-400 border-b border-white/5">
          {error}
        </div>
      )}
      {isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : isError ? (
        <EmptyRow>불러오지 못했습니다.</EmptyRow>
      ) : rules.length === 0 ? (
        <EmptyRow>아직 등록된 치환 룰이 없어요. (예: 금속 사운드 → 메탈 사운드)</EmptyRow>
      ) : filteredRules.length === 0 ? (
        <EmptyRow>"{query}" 검색 결과 없음</EmptyRow>
      ) : (
        <div className="divide-y divide-white/5">
          {filteredRules.map((r) => (
            <div key={r.id} className="px-4 py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[13px] text-white">
                  {r.is_regex ? (
                    <span
                      className="shrink-0 px-1 py-0 text-[9px] font-bold tracking-wider rounded bg-accent/15 text-accent border border-accent/30"
                      title="정규식 룰"
                    >
                      RE
                    </span>
                  ) : null}
                  <span className="truncate font-mono" title={r.pattern}>
                    {r.pattern}
                  </span>
                  <span className="text-gray-500 shrink-0">→</span>
                  <span
                    className="truncate font-mono text-accent"
                    title={r.replacement}
                  >
                    {r.replacement}
                  </span>
                </div>
                {r.note && (
                  <div
                    className="text-[11px] text-gray-500 mt-0.5 truncate"
                    title={r.note}
                  >
                    {r.note}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`"${r.pattern}" 룰 삭제할까요?`)) remove.mutate(r.id);
                }}
                disabled={remove.isPending}
                className="shrink-0 text-[11px] text-gray-400 hover:text-red-300 border border-white/10 hover:border-red-400/60 rounded px-2 py-0.5 disabled:opacity-40 cursor-pointer transition-colors"
                title="이 치환 룰 삭제"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

interface HostListItem {
  host: string;
  badge?: string;
  sub?: string | null;
  title?: string;
}

function HostList({
  header,
  subheader,
  emptyText,
  items,
  renderAction,
}: {
  header: string;
  subheader: string;
  emptyText: string;
  items: HostListItem[];
  renderAction: (host: string) => ReactNode;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <div className="px-3 py-2 bg-panel-strong border-b border-white/5">
        <div className="text-xs font-semibold text-white">{header}</div>
        <div className="text-[10px] text-gray-500">{subheader}</div>
      </div>
      <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-3 text-xs text-gray-600">{emptyText}</div>
        ) : (
          items.map((it) => (
            <div key={it.host} className="px-3 py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a
                    href={`https://${it.host}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white truncate hover:text-accent transition-colors"
                    title={it.title ?? `${it.host} 열기`}
                  >
                    {it.host}
                  </a>
                  {it.badge && (
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      {it.badge}
                    </span>
                  )}
                </div>
                {it.sub && (
                  <div className="text-[10px] text-gray-600 truncate mt-0.5">
                    {it.sub}
                  </div>
                )}
              </div>
              <div className="shrink-0">{renderAction(it.host)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ManagedHostList({
  header,
  subheader,
  emptyText,
  placeholder,
  items,
  onAdd,
  onRemove,
  isBusy,
  accent,
}: {
  header: string;
  subheader: string;
  emptyText: string;
  placeholder: string;
  items: HostListItem[];
  onAdd: (host: string) => void;
  onRemove: (host: string) => void;
  isBusy: boolean;
  accent: 'emerald' | 'red';
}) {
  const [input, setInput] = useState('');
  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInput('');
  };
  const accentClasses =
    accent === 'emerald'
      ? 'border-emerald-500/30 focus:border-emerald-400/60 placeholder:text-emerald-400/30'
      : 'border-red-500/30 focus:border-red-400/60 placeholder:text-red-400/30';
  return (
    <div className="flex flex-col min-w-0">
      <div className="px-3 py-2 bg-panel-strong border-b border-white/5">
        <div className="text-xs font-semibold text-white">{header}</div>
        <div className="text-[10px] text-gray-500">{subheader}</div>
      </div>
      <div className="px-3 py-2 border-b border-white/5 flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className={`flex-1 min-w-0 bg-panel-strong text-xs text-white px-2 py-1 rounded border outline-none transition-colors ${accentClasses}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isBusy || !input.trim()}
          className="text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/30 rounded px-2 py-1 disabled:opacity-40 cursor-pointer transition-colors"
        >
          +
        </button>
      </div>
      <div className="divide-y divide-white/5 max-h-[380px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-3 text-xs text-gray-600">{emptyText}</div>
        ) : (
          items.map((it) => (
            <div key={it.host} className="px-3 py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a
                    href={`https://${it.host}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white truncate hover:text-accent transition-colors"
                    title={it.title ?? `${it.host} 열기`}
                  >
                    {it.host}
                  </a>
                  {it.badge && (
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      {it.badge}
                    </span>
                  )}
                </div>
                {it.sub && (
                  <div className="text-[10px] text-gray-600 truncate mt-0.5">
                    {it.sub}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(it.host)}
                disabled={isBusy}
                className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 px-1 cursor-pointer shrink-0"
                aria-label={`${it.host} 제거`}
                title="제거"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RecentUsersList({ users }: { users: AdminStats['recentUsers'] }) {
  if (users.length === 0) {
    return <div className="p-4 text-sm text-gray-500">최근 가입 유저가 없습니다.</div>;
  }
  return (
    <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
      <div className="px-4 py-2.5 text-xs uppercase tracking-wider text-gray-500 bg-panel-strong">
        최근 가입 유저
      </div>
      {users.map((u) => (
        <div key={u.id} className="p-3 flex items-center gap-3">
          {u.avatarUrl ? (
            <img
              src={resolveApiUrl(u.avatarUrl) ?? undefined}
              alt=""
              aria-hidden
              className="w-8 h-8 rounded-full shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0">
              {(u.name || u.email)[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium truncate">
              {u.name || u.email}
              {u.isAdmin && (
                <span className="ml-1.5 text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
                  ADMIN
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {u.email} · {parseServerTimestamp(u.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Collapsed-by-default accordion row. The samples array is useful
// (it's what admin actually clicks through to fix each backlog
// item), but rendering 3 × 5 sample rows with cover thumbnails made
// the whole Panel taller than its neighbour, stretching the
// surrounding grid row. Default state is a single label · count
// line; clicking expands to the sample list inline without
// leaving the admin page.
// Wraps the three 데이터 미완 buckets and owns selection state across
// the two curation-eligible ones (리뷰 없음 + 한국어 요약 없음). The
// 커버 없음 bucket doesn't get checkboxes — the curation pipeline
// doesn't add covers, so selecting a cover-missing album is just
// noise. Batch button fires a single CurationProgressContext run
// containing every selected album; the floating panel takes over
// from there.
function IncompletePanel({
  incompleteAlbums,
}: {
  incompleteAlbums: AdminStats['incompleteAlbums'];
}) {
  const curation = useCurationProgress();
  // Map<mbid, sample> so the "선택 N개 큐레이션" button can pass
  // title along to startRun without re-lookup, and so toggling is O(1).
  const [selected, setSelected] = useState<Map<string, IncompleteAlbumSample>>(
    () => new Map()
  );

  const toggleSelected = (a: IncompleteAlbumSample) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(a.mbid)) next.delete(a.mbid);
      else next.set(a.mbid, a);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Map());

  const startBatch = () => {
    if (selected.size === 0) return;
    const albums = Array.from(selected.values()).map((a) => ({
      mbid: a.mbid,
      title: a.title,
    }));
    clearSelection();
    // startRun auto-appends to the active run's queue when one is
    // already in flight (CurationProgressContext), so no guard on
    // isRunning needed here — admin can queue further batches while
    // an earlier one is still processing.
    curation.startRun(albums);
  };

  const hasSelection = selected.size > 0;

  return (
    <Panel
      title="데이터 미완 앨범"
      icon="⚠️"
      headerAction={
        hasSelection ? (
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="text-[11px] text-gray-500 hover:text-white px-2 py-0.5 cursor-pointer"
              title="선택 해제"
            >
              해제
            </button>
            <button
              onClick={startBatch}
              className="text-[11px] text-accent/90 hover:text-accent border border-accent/50 hover:border-accent/80 rounded-md px-2 py-0.5 cursor-pointer transition-colors inline-flex items-center gap-1.5"
              title={
                curation.isRunning
                  ? '현재 큐레이션 실행 중 — 클릭하면 대기열 뒤에 추가됩니다'
                  : '선택한 앨범들에 대해 URL 검색 → 리뷰 수집 → 요약까지 배치 실행'
              }
            >
              🔍 {selected.size}개 {curation.isRunning ? '큐에 추가' : '큐레이션'}
            </button>
          </div>
        ) : null
      }
    >
      <IncompleteSubsection
        label="리뷰 없음"
        bucket={incompleteAlbums.noReviews}
        selectable
        selected={selected}
        onToggle={toggleSelected}
      />
      <IncompleteSubsection
        label="한국어 요약 없음"
        bucket={incompleteAlbums.noSummary}
        selectable
        selected={selected}
        onToggle={toggleSelected}
      />
      <IncompleteSubsection
        label="커버 없음"
        bucket={incompleteAlbums.noCover}
      />
    </Panel>
  );
}

function IncompleteSubsection({
  label,
  bucket,
  selectable = false,
  selected,
  onToggle,
}: {
  label: string;
  bucket: { count: number; samples: IncompleteAlbumSample[] };
  selectable?: boolean;
  selected?: Map<string, IncompleteAlbumSample>;
  onToggle?: (a: IncompleteAlbumSample) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (bucket.count === 0) {
    return (
      <div className="px-4 py-2.5 flex items-center justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="text-emerald-400/80 text-xs">없음 ✓</span>
      </div>
    );
  }
  // Count of this bucket's samples currently selected — shown next
  // to the bucket count so admin sees how much of the visible slice
  // they've picked. Only meaningful when `selectable`.
  const selectedInBucket = selectable && selected
    ? bucket.samples.reduce((n, a) => n + (selected.has(a.mbid) ? 1 : 0), 0)
    : 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-white/5 transition-colors cursor-pointer text-left"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`text-gray-600 text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ▶
          </span>
          <span className="text-gray-300">{label}</span>
          {selectedInBucket > 0 && (
            <span className="text-[10px] text-accent tabular-nums">
              ({selectedInBucket} 선택)
            </span>
          )}
        </span>
        <span className="text-xs text-gray-500 tabular-nums">
          {bucket.count.toLocaleString()}
        </span>
      </button>
      {expanded && (
        <ul className="px-4 pb-2.5 space-y-1">
          {bucket.samples.map((a) => {
            const isChecked = !!selected?.has(a.mbid);
            if (selectable && onToggle) {
              return (
                <li key={a.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggle(a)}
                    className="w-3 h-3 accent-accent cursor-pointer flex-shrink-0"
                    aria-label={`${a.title} 선택`}
                  />
                  <Link
                    to={`/album/${a.mbid}`}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-accent truncate py-0.5 flex-1 min-w-0"
                  >
                    <CoverArt
                      src={a.coverArtUrl}
                      fallbacks={a.coverArtFallbacks}
                      alt={a.title}
                      className="w-5 h-5 rounded object-cover flex-shrink-0"
                    />
                    <span className="truncate">
                      <span className="text-gray-200">{a.title}</span>
                      <span className="text-gray-600"> — {a.artist}</span>
                    </span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={a.id}>
                <Link
                  to={`/album/${a.mbid}`}
                  className="flex items-center gap-2 text-xs text-gray-400 hover:text-accent truncate py-0.5"
                >
                  <CoverArt
                    src={a.coverArtUrl}
                    fallbacks={a.coverArtFallbacks}
                    alt={a.title}
                    className="w-5 h-5 rounded object-cover flex-shrink-0"
                  />
                  <span className="truncate">
                    <span className="text-gray-200">{a.title}</span>
                    <span className="text-gray-600"> — {a.artist}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {bucket.count > bucket.samples.length && (
            <li className="text-[11px] text-gray-600 pl-7 pt-0.5">
              외 {(bucket.count - bucket.samples.length).toLocaleString()}개 더
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Admin subscribes to Spotify label names. A daily cron polls
// `label:"X" tag:new` and fills the feed below.
function TrackedLabelsPanel() {
  const list = useTrackedLabels(true);
  const preview = usePreviewLabel();
  const add = useAddTrackedLabel();
  const toggle = useToggleTrackedLabel();
  const del = useDeleteTrackedLabel();
  const poll = usePollTrackedLabel();
  const pollAll = usePollAllTrackedLabels();
  const [name, setName] = useState('');

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const p = await preview.mutateAsync(trimmed);
      if (p.count === 0) {
        if (
          !confirm(
            `"${trimmed}" 라벨 검색 결과가 0건입니다 (최근 2주). 그래도 추가할까요?\n(오타일 수 있음)`
          )
        ) {
          return;
        }
      } else {
        const sample = p.samples
          .map((s) => `• ${s.artist} — ${s.title} (${s.releaseDate})`)
          .join('\n');
        if (!confirm(`최근 2주 신보 ${p.count}건:\n\n${sample}\n\n추가할까요?`)) {
          return;
        }
      }
      const result = await add.mutateAsync({ name: trimmed });
      setName('');
      // Surface the initial poll result so admin sees whether Spotify
      // actually returned anything. After the filter unification
      // (singles dropped + 30-day window inside searchAlbumsByLabel),
      // `found` and `inserted` are always equal on a first add, so we
      // just need two branches.
      if (result.initialPoll) {
        const { inserted } = result.initialPoll;
        if (inserted > 0) {
          alert(`피드에 ${inserted}개 신보 추가됨 (30일 이내, 앨범 타입만).`);
        } else {
          alert(
            '최근 30일 내 발매된 앨범이 없어요.\n' +
              '- 레이블 이름 변형 ("Records" 유무) 시도\n' +
              '- 최근엔 싱글만 있는 레이블일 수도\n' +
              '- 추적은 시작됐으니 새 발매 나오면 자동 인덱싱됨'
          );
        }
      }
    } catch (err: any) {
      alert(err?.response?.data?.error || '추가 실패');
    }
  };

  const labels = list.data?.labels ?? [];

  const refreshAllButton = labels.length > 0 ? (
    <button
      type="button"
      onClick={async () => {
        if (pollAll.isPending) return;
        try {
          const result = await pollAll.mutateAsync();
          console.log(
            `[label-feed] poll-all: ${result.totalInserted}/${result.totalFound} new across ${result.labelCount} labels`
          );
        } catch (err: any) {
          alert(err?.response?.data?.error || '전체 새로고침 실패');
        }
      }}
      disabled={pollAll.isPending}
      className="text-xs text-accent/80 hover:text-accent border border-accent/40 hover:border-accent/70 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      title="모든 활성 레이블의 최근 2년 신보 다시 긁어오기"
    >
      {pollAll.isPending ? '새로고침 중…' : '🔄 전체 새로고침'}
    </button>
  ) : null;

  return (
    <Panel
      title="추적 중인 레이블"
      icon="📡"
      count={labels.length}
      headerAction={refreshAllButton}
    >
      <div className="p-3 flex items-center gap-2 border-b border-white/5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Spotify 레이블명 (예: Profound Lore Records)"
          disabled={add.isPending || preview.isPending}
          className="flex-1 bg-panel-strong border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
          maxLength={120}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim() || add.isPending || preview.isPending}
          className="px-3 py-1.5 text-xs font-medium text-accent border border-accent/60 rounded-md hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {preview.isPending ? '미리보기…' : add.isPending ? '추가 중…' : '추가'}
        </button>
      </div>
      {list.isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : labels.length === 0 ? (
        <EmptyRow>추적 중인 레이블이 없습니다.</EmptyRow>
      ) : (
        labels.map((l) => (
          <div key={l.id} className="p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-medium truncate ${
                    l.is_active ? 'text-white' : 'text-gray-500 line-through'
                  }`}
                >
                  {l.spotify_label_name}
                </span>
                {l.pending_count > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    +{l.pending_count}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                마지막 폴링:{' '}
                {l.last_polled_at
                  ? formatRelativeKo(l.last_polled_at)
                  : '아직 없음'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (poll.isPending) return;
                poll.mutate(l.id);
              }}
              disabled={poll.isPending}
              className="text-xs text-gray-500 hover:text-accent disabled:opacity-40 px-1 py-0.5 cursor-pointer"
              title="지금 폴링"
              aria-label="지금 폴링"
            >
              🔄
            </button>
            <button
              type="button"
              onClick={() => toggle.mutate({ id: l.id, isActive: !l.is_active })}
              className="text-xs text-gray-500 hover:text-white px-1 py-0.5 cursor-pointer"
              title={l.is_active ? '비활성' : '활성'}
              aria-label={l.is_active ? '비활성화' : '활성화'}
            >
              {l.is_active ? '⏸️' : '▶️'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm(`"${l.spotify_label_name}" 추적을 삭제할까요?\n피드 항목도 함께 삭제됩니다.`)) {
                  return;
                }
                del.mutate(l.id);
              }}
              className="text-xs text-gray-500 hover:text-red-400 px-1 py-0.5 cursor-pointer"
              title="삭제"
              aria-label="삭제"
            >
              🗑️
            </button>
          </div>
        ))
      )}
    </Panel>
  );
}

// The feed — items from tracked labels that admin hasn't picked or
// dismissed yet. "➕ 등록" triggers server-side MB match + synthetic
// fallback; "🗑️ 무시" stamps dismissed_at so the row vanishes.
function LabelFeedPanel() {
  const feed = useLabelFeed(true);
  const register = useRegisterLabelFeedItem();
  const dismiss = useDismissLabelFeedItem();

  const items = feed.data?.items ?? [];

  return (
    <Panel title="레이블 피드 (최근 신보)" icon="📦" count={items.length}>
      {feed.isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>새 항목 없음. 레이블을 추가해보세요.</EmptyRow>
      ) : (
        items.map((item) => (
          <div key={item.id} className="p-3 flex items-center gap-3">
            <CoverArt
              src={item.cover_art_url}
              alt={item.album_name}
              className="w-12 h-12 rounded-md object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-medium truncate flex items-center gap-1.5">
                <span className="truncate">{item.album_name}</span>
                {item.album_type && item.album_type !== 'album' && (
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded shrink-0 ${
                      item.album_type === 'single'
                        ? 'text-gray-500 bg-gray-500/10'
                        : 'text-accent/70 bg-accent/10'
                    }`}
                  >
                    {item.album_type}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {item.artist_name}
                <span className="text-gray-600 mx-1.5">·</span>
                {item.release_date || '—'}
                <span className="text-gray-600 mx-1.5">·</span>
                <span className="text-accent/70">
                  {item.display_name || item.spotify_label_name}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {item.spotify_url && (
                <a
                  href={item.spotify_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-[#1DB954] px-1 py-0.5"
                  title="Spotify에서 보기"
                  aria-label="Spotify에서 보기"
                >
                  ↗
                </a>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (register.isPending) return;
                  try {
                    const result = await register.mutateAsync(item.id);
                    console.log(
                      `[label-feed] registered ${item.album_name} (${result.matched})`
                    );
                  } catch (err: any) {
                    alert(err?.response?.data?.error || '등록 실패');
                  }
                }}
                disabled={register.isPending || dismiss.isPending}
                className="text-xs text-accent hover:text-black hover:bg-accent border border-accent/60 rounded px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                title="메인 DB에 등록 (MB 매칭 자동 시도, 없으면 sp-* 임시 mbid)"
              >
                ➕ 등록
              </button>
              <button
                type="button"
                onClick={() => {
                  if (dismiss.isPending) return;
                  dismiss.mutate(item.id);
                }}
                disabled={register.isPending || dismiss.isPending}
                className="text-xs text-gray-500 hover:text-red-400 px-1 py-0.5 disabled:opacity-40 cursor-pointer"
                title="무시"
                aria-label="무시"
              >
                🗑️
              </button>
            </div>
          </div>
        ))
      )}
    </Panel>
  );
}

// ─── Curation ledger ─────────────────────────────────────────────────

interface CurationRunRow {
  id: number;
  run_id: string;
  album_mbid: string;
  album_title: string;
  trigger_kind: string;
  urls_found: number;
  urls_saved: number;
  duplicates: number;
  failures: number;
  summary_generated: number;
  cost_usd: number;
  status: string;
  started_at: string;
  finished_at: string;
  album_slug: string | null;
  cover_art_url: string | null;
  cover_art_fallbacks: string | null;
  artist_name: string | null;
}

function CurationRunsPanel() {
  // CurationProgressContext already invalidates this query as each
  // album in a run finishes (see its onSuccess on the /curation-runs
  // POST), so the panel stays live without a short poll. The
  // remaining reason for any interval at all is a second admin
  // session on another tab — lengthen to 2 min so we catch that
  // edge case without burning a request every 30s while the panel
  // sits open.
  const query = useQuery<{ runs: CurationRunRow[] }>({
    queryKey: ['curation-runs'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/curation-runs');
      return data;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const runs = query.data?.runs ?? [];

  return (
    <Panel title="큐레이션 이력" icon="📋" count={runs.length}>
      {query.isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : runs.length === 0 ? (
        <EmptyRow>아직 큐레이션 기록이 없어요.</EmptyRow>
      ) : (
        <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
          {runs.map((r) => {
            const href = r.album_slug
              ? `/album/${r.album_slug}`
              : `/album/${r.album_mbid}`;
            const fallbacks = (() => {
              try {
                const parsed = r.cover_art_fallbacks
                  ? JSON.parse(r.cover_art_fallbacks)
                  : [];
                return Array.isArray(parsed) ? parsed : [];
              } catch {
                return [];
              }
            })();
            return (
              <Link
                key={r.id}
                to={href}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
              >
                <CoverArt
                  src={r.cover_art_url}
                  fallbacks={fallbacks}
                  alt={r.album_title}
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate">
                    {r.album_title}
                    {r.artist_name && (
                      <span className="text-gray-600"> — {r.artist_name}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2">
                    <span className="uppercase tracking-wider">
                      {r.trigger_kind === 'batch' ? '배치' : '원클릭'}
                    </span>
                    <span className="text-gray-600">·</span>
                    <span className="tabular-nums">
                      리뷰 {r.urls_saved}/{r.urls_found}
                      {r.duplicates > 0 && (
                        <span className="text-gray-600"> (중복 {r.duplicates})</span>
                      )}
                      {r.failures > 0 && (
                        <span className="text-red-400"> · 실패 {r.failures}</span>
                      )}
                    </span>
                    {r.summary_generated ? (
                      <span className="text-green-400">· 요약 ✓</span>
                    ) : (
                      <span className="text-gray-600">· 요약 —</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[11px] text-accent tabular-nums">
                    ${r.cost_usd.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-gray-500 tabular-nums">
                    {formatShortKstDateTime(r.finished_at)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Signup gate ──────────────────────────────────────────────
// invited_emails + pending_signups admin surface. Pending requests
// land here when an un-invited Google email tries to log in (server
// side: PendingApprovalError → /?auth=pending → user sees the modal).
// Admin's two main actions are "초대" (promote → invited_emails) and
// "거절" (drop the pending row); a manual invite form lets the admin
// allowlist an email before the person ever tries.
interface PendingSignup {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  firstAttemptAt: string;
  lastAttemptAt: string;
  attemptCount: number;
  notifiedAt: string | null;
  invited: boolean;
}
interface InvitedEmail {
  email: string;
  invitedAt: string;
  note: string | null;
  user: { id: number; name: string | null; avatarUrl: string | null } | null;
}

function SignupGatePanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{
    pending: PendingSignup[];
    invited: InvitedEmail[];
  }>({
    queryKey: ['admin-signups'],
    queryFn: async () => {
      const resp = await axios.get('/api/admin/signups');
      return resp.data;
    },
    staleTime: 30_000,
  });

  const invite = useMutation({
    mutationFn: async (vars: { email: string; note?: string }) => {
      await axios.post('/api/admin/signups/invite', vars);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-signups'] }),
  });

  const revoke = useMutation({
    mutationFn: async (email: string) => {
      await axios.delete(
        `/api/admin/signups/invite/${encodeURIComponent(email)}`
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-signups'] }),
  });

  const discard = useMutation({
    mutationFn: async (email: string) => {
      await axios.delete(
        `/api/admin/signups/pending/${encodeURIComponent(email)}`
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-signups'] }),
  });

  const [inviteInput, setInviteInput] = useState('');
  const [showInvited, setShowInvited] = useState(false);

  const pending = data?.pending ?? [];
  const invited = data?.invited ?? [];
  const pendingActive = pending.filter((p) => !p.invited);

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteInput.trim().toLowerCase();
    if (!email) return;
    invite.mutate(
      { email },
      {
        onSuccess: () => setInviteInput(''),
      }
    );
  }

  return (
    <Panel
      title="가입 신청"
      icon="✉️"
      count={pendingActive.length}
      headerAction={
        <button
          type="button"
          onClick={() => setShowInvited((v) => !v)}
          className="text-xs text-gray-400 hover:text-accent transition-colors"
        >
          {showInvited ? '신청만 보기' : `초대 목록 (${invited.length})`}
        </button>
      }
    >
      <div className="p-4 border-b border-white/5">
        <form onSubmit={handleInviteSubmit} className="flex items-center gap-2">
          <input
            type="email"
            inputMode="email"
            placeholder="email@example.com"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            className="flex-1 bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none placeholder-gray-600"
          />
          <button
            type="submit"
            disabled={invite.isPending || !inviteInput.trim()}
            className="px-3 py-2 rounded-md bg-accent text-panel-strong text-xs font-bold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            초대
          </button>
        </form>
        {invite.isError && (
          <div className="mt-2 text-[11px] text-red-400">
            {(invite.error as any)?.response?.data?.error ??
              '초대 처리에 실패했어요.'}
          </div>
        )}
      </div>

      {isLoading && <EmptyRow>불러오는 중…</EmptyRow>}
      {isError && <EmptyRow>가입 신청 목록을 가져오지 못했어요.</EmptyRow>}

      {!isLoading && !isError && !showInvited && (
        <>
          {pendingActive.length === 0 ? (
            <EmptyRow>대기 중인 신청이 없어요.</EmptyRow>
          ) : (
            pendingActive.map((p) => (
              <div
                key={p.email}
                className="p-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-panel-hover flex-shrink-0">
                  {p.avatarUrl && (
                    <img
                      src={p.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-200 truncate">
                    {p.name || p.email}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {p.email}
                    {p.attemptCount > 1 && (
                      <span className="text-gray-600">
                        {' '}
                        · {p.attemptCount}회 시도
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => invite.mutate({ email: p.email })}
                    disabled={invite.isPending}
                    title="초대 (가입 허용)"
                    className="px-2.5 py-1 rounded-md bg-accent/15 border border-accent/40 text-accent text-xs font-semibold hover:bg-accent hover:text-panel-strong transition-colors cursor-pointer disabled:opacity-40"
                  >
                    초대
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `${p.email}의 가입 신청을 거절하고 목록에서 제거할까요?`
                        )
                      )
                        discard.mutate(p.email);
                    }}
                    disabled={discard.isPending}
                    title="거절 (목록에서 제거)"
                    className="px-2 py-1 rounded-md text-gray-500 text-xs hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    거절
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {!isLoading && !isError && showInvited && (
        <>
          {invited.length === 0 ? (
            <EmptyRow>초대된 이메일이 없어요.</EmptyRow>
          ) : (
            invited.map((i) => (
              <div
                key={i.email}
                className="p-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-panel-hover flex-shrink-0">
                  {i.user?.avatarUrl && (
                    <img
                      src={i.user.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-200 truncate">
                    {i.user?.name || i.email}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {i.email}
                    {!i.user && (
                      <span className="text-gray-600"> · 미가입</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `${i.email}의 초대를 취소할까요? (이미 가입한 사용자에게는 영향 없어요)`
                      )
                    )
                      revoke.mutate(i.email);
                  }}
                  disabled={revoke.isPending}
                  title="초대 취소"
                  className="px-2 py-1 rounded-md text-gray-500 text-xs hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                >
                  취소
                </button>
              </div>
            ))
          )}
        </>
      )}
    </Panel>
  );
}

