import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
      className={`bg-[#1a1a1a] rounded-xl border ${
        accent ? 'border-[#e8a020]/40' : 'border-white/5'
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
          row.accent ? 'text-[#e8a020]' : 'text-white'
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
      <div className="invisible opacity-0 group-hover/row:visible group-hover/row:opacity-100 transition-opacity absolute left-0 right-0 top-full mt-1 z-20 bg-[#1a1a1a] rounded-xl border border-white/10 shadow-xl overflow-hidden">
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
    <div className="bg-[#1a1a1a] rounded-xl border border-white/5 overflow-hidden">
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
    if (!confirm(`Claude API 사용량 기록을 모두 삭제할까요?\n(현재: $${usage.usd.toFixed(2)})\n\n되돌릴 수 없습니다.`)) return;
    reset.mutate();
  };

  return (
    <div className="bg-[#1a1a1a] rounded-xl p-5 border border-white/5 flex flex-col">
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
            className="text-[10px] text-gray-500 hover:text-[#e8a020] underline-offset-2 hover:underline cursor-pointer"
            title="최근 50건의 개별 Claude 호출을 펼쳐서 봅니다."
          >
            {showRecent ? '상세 접기' : '상세'}
          </button>
          <Link
            to="/admin/api-console"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-[#e8a020] underline-offset-2 hover:underline cursor-pointer"
            title="별도 탭에서 자동 갱신되는 실시간 콘솔"
          >
            🖥 콘솔
          </Link>
          <Link
            to="/admin/compare"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-[#e8a020] underline-offset-2 hover:underline cursor-pointer"
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
        <span className="text-2xl font-bold text-[#e8a020] tabular-nums shrink-0">
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
                  <span className="tabular-nums text-[#e8a020] text-right w-14">
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
                  <span className="tabular-nums text-[#e8a020] text-right w-14">
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
            className="text-gray-100 hover:text-[#e8a020] truncate"
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
            className="hover:text-[#e8a020]"
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

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Admin | dig.haus';
  }, []);

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

  const { data, isLoading, isError } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/stats');
      return data;
    },
    enabled: !!user?.isAdmin,
    staleTime: 30_000,
  });

  const reportsQuery = useReportedPurchaseLinks(!!user?.isAdmin);
  const dismissReport = useDismissPurchaseLinkReport();
  const adminDeleteLink = useAdminDeletePurchaseLink();

  if (loading || !user?.isAdmin) return null;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-8 font-serif">
        🛠 레코드샵 관리
      </h1>

      {isError && <div className="text-red-400 text-sm mb-4">통계를 불러오지 못했습니다.</div>}
      {isLoading && <div className="text-gray-500 text-sm">로딩 중...</div>}

      {data && (
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
                    const isNew =
                      Number.isFinite(ts) && ts > prevSeenAt;
                    return (
                      <Link
                        key={a.id}
                        to={`/album/${a.mbid}`}
                        className={`p-3 flex items-center gap-3 transition-colors ${
                          isNew
                            ? 'bg-[#e8a020]/8 hover:bg-[#e8a020]/12 border-l-2 border-[#e8a020]/60 pl-[10px]'
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
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#e8a020] align-middle">
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
                          <div className="w-10 h-10 rounded-full bg-[#e8a020]/20 text-[#e8a020] flex items-center justify-center text-sm font-bold flex-shrink-0">
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
                                    ? 'bg-[#e8a020]/15 text-[#e8a020] border-[#e8a020]/30'
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
                              className="mt-1 inline-block text-xs text-gray-500 hover:text-[#e8a020] truncate"
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
                              className="text-white font-medium hover:text-[#e8a020] truncate"
                            >
                              {pl.storeName || hostname}
                            </a>
                            {priceLabel && (
                              <span className="text-[#e8a020] text-xs font-semibold tabular-nums">
                                {priceLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">
                            <Link
                              to={`/album/${pl.albumSlug}`}
                              className="hover:text-[#e8a020]"
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

          {/* Scrape-failure log — surfaces hostnames that consistently
              fail URL scraping, so we can decide which need a
              site-specific parser vs. staying on the paste-in
              fallback. Append-only table on the server; the panel
              lets admin clear entries per hostname after addressing
              (or giving up on) a site. */}
          <section className="mt-4">
            <ScrapeFailuresPanel />
          </section>

          {/* Per-album record of every curation pipeline run (one-click
              or batch). Written by the client from
              CurationProgressContext as each album finishes — gives
              admin a permanent ledger of "how much coverage did that
              batch actually produce, and what did it cost." */}
          <section className="mt-4">
            <CurationRunsPanel />
          </section>

        </>
      )}
    </main>
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
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#e8a020]/80 bg-[#e8a020]/10 px-1.5 py-0.5 rounded">
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
                  className="block text-xs text-gray-500 hover:text-[#e8a020] truncate mt-1"
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
                    className="text-xs text-[#e8a020]/80 hover:text-[#e8a020] border border-[#e8a020]/40 hover:border-[#e8a020]/70 rounded px-2 py-0.5 cursor-pointer transition-colors"
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

function RecentUsersList({ users }: { users: AdminStats['recentUsers'] }) {
  if (users.length === 0) {
    return <div className="p-4 text-sm text-gray-500">최근 가입 유저가 없습니다.</div>;
  }
  return (
    <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
      <div className="px-4 py-2.5 text-xs uppercase tracking-wider text-gray-500 bg-[#151515]">
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
            <div className="w-8 h-8 rounded-full bg-[#e8a020]/20 text-[#e8a020] flex items-center justify-center text-xs font-bold shrink-0">
              {(u.name || u.email)[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium truncate">
              {u.name || u.email}
              {u.isAdmin && (
                <span className="ml-1.5 text-[10px] bg-[#e8a020]/20 text-[#e8a020] px-1.5 py-0.5 rounded-full">
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
    if (curation.isRunning || selected.size === 0) return;
    const albums = Array.from(selected.values()).map((a) => ({
      mbid: a.mbid,
      title: a.title,
    }));
    clearSelection();
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
              disabled={curation.isRunning}
              className="text-[11px] text-[#e8a020]/90 hover:text-[#e8a020] border border-[#e8a020]/50 hover:border-[#e8a020]/80 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1.5"
              title="선택한 앨범들에 대해 URL 검색 → 리뷰 수집 → 요약까지 배치 실행"
            >
              {curation.isRunning && (
                <span className="w-3 h-3 border-2 border-gray-500 border-t-[#e8a020] rounded-full animate-spin" />
              )}
              🔍 {selected.size}개 큐레이션
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
            <span className="text-[10px] text-[#e8a020] tabular-nums">
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
                    className="w-3 h-3 accent-[#e8a020] cursor-pointer flex-shrink-0"
                    aria-label={`${a.title} 선택`}
                  />
                  <Link
                    to={`/album/${a.mbid}`}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-[#e8a020] truncate py-0.5 flex-1 min-w-0"
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
                  className="flex items-center gap-2 text-xs text-gray-400 hover:text-[#e8a020] truncate py-0.5"
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
      className="text-xs text-[#e8a020]/80 hover:text-[#e8a020] border border-[#e8a020]/40 hover:border-[#e8a020]/70 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
          className="flex-1 bg-[#0f0f0f] border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
          maxLength={120}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim() || add.isPending || preview.isPending}
          className="px-3 py-1.5 text-xs font-medium text-[#e8a020] border border-[#e8a020]/60 rounded-md hover:bg-[#e8a020]/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#e8a020] bg-[#e8a020]/10 px-1.5 py-0.5 rounded">
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
              className="text-xs text-gray-500 hover:text-[#e8a020] disabled:opacity-40 px-1 py-0.5 cursor-pointer"
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
                        : 'text-[#e8a020]/70 bg-[#e8a020]/10'
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
                <span className="text-[#e8a020]/70">
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
                className="text-xs text-[#e8a020] hover:text-black hover:bg-[#e8a020] border border-[#e8a020]/60 rounded px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
  const query = useQuery<{ runs: CurationRunRow[] }>({
    queryKey: ['curation-runs'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/curation-runs');
      return data;
    },
    refetchInterval: 30_000,
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
                  <div className="text-[11px] text-[#e8a020] tabular-nums">
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
