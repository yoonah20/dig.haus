import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  useAlbumRequests,
  useApproveAlbumRequest,
  useDeletePendingAlbum,
  type AlbumRequest,
} from '../hooks/useAlbumRequests';
import {
  useReportedPurchaseLinks,
  useDismissPurchaseLinkReport,
  useAdminDeletePurchaseLink,
  type ReportedLink,
} from '../hooks/usePurchaseLinks';
import { formatRelativeKo, parseServerTimestamp } from '../utils/relativeTime';

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
  children,
}: {
  title: string;
  icon?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="bg-[#1a1a1a] rounded-xl border border-white/5 overflow-hidden">
      <div className="px-4 py-3.5 border-b border-white/5 flex items-center gap-2">
        {icon && <span aria-hidden className="text-base">{icon}</span>}
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {typeof count === 'number' && count > 0 && (
          <span className="ml-auto text-sm text-gray-500 tabular-nums">{count}</span>
        )}
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

// Compact pending-review row for the admin dashboard. The album row
// already exists in the DB — "승인" runs the deferred Claude review-
// crawl (sets reviews_crawled_at and fires warm-up); "삭제" removes
// the album entirely via the existing admin delete route and the FK
// cascade wipes any user-contributed 50자 평 / purchase links with it.
function RequestRow({ request }: { request: AlbumRequest }) {
  const approve = useApproveAlbumRequest();
  const del = useDeletePendingAlbum();
  const busy = approve.isPending || del.isPending;

  const handleApprove = async () => {
    if (busy) return;
    try {
      await approve.mutateAsync(request.mbid);
    } catch (err: any) {
      alert(err?.response?.data?.error || '승인에 실패했습니다.');
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    if (
      !confirm(
        `"${request.artist} — ${request.title}" 앨범을 삭제할까요?\n이 앨범에 달린 50자 평·구매처 등록도 함께 사라집니다.`
      )
    )
      return;
    try {
      await del.mutateAsync(request.mbid);
    } catch (err: any) {
      alert(err?.response?.data?.error || '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="p-3 flex items-start gap-3">
      <Link
        to={`/album/${request.mbid}`}
        className="shrink-0 w-12 h-12 bg-[#252525] rounded-md overflow-hidden"
      >
        {request.coverArtUrl ? (
          <img
            src={request.coverArtUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </Link>
      <div className="flex-1 min-w-0">
        <Link
          to={`/album/${request.mbid}`}
          className="text-base text-white font-medium hover:text-[#e8a020] truncate block"
        >
          {request.title}
        </Link>
        <p className="text-sm text-gray-400 truncate">
          {request.artist}
          {request.year && ` · ${request.year}`}
        </p>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {request.requester?.userName || '알 수 없음'}
          <span className="text-gray-600 mx-1.5">·</span>
          {formatRelativeKo(request.createdAt)}
        </p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={handleApprove}
          disabled={busy}
          className="text-xs font-medium text-black bg-[#e8a020] hover:bg-[#f0b040] rounded-md px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {approve.isPending ? '…' : '승인'}
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="text-xs text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40 rounded-md px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {del.isPending ? '…' : '삭제'}
        </button>
      </div>
    </div>
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
}: {
  usage: AdminStats['claudeUsage']['month'];
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
                  className="py-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-baseline"
                >
                  <span className="text-gray-300 truncate">
                    {OPERATION_LABEL(c.operation)}
                    {c.webSearchCount > 0 && (
                      <span className="ml-1 text-gray-500">· {c.webSearchCount}검색</span>
                    )}
                  </span>
                  <span className="text-gray-500 text-[10px] tabular-nums whitespace-nowrap">
                    {c.createdAt.replace('T', ' ').slice(5, 16)}
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

  const { data, isLoading, isError } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/stats');
      return data;
    },
    enabled: !!user?.isAdmin,
    staleTime: 30_000,
  });

  // Pending album requests live in their own query so approve/discard
  // mutations can surgically invalidate just this feed (invalidating
  // the big stats bundle would refetch everything).
  const requestsQuery = useAlbumRequests(!!user?.isAdmin);
  const reportsQuery = useReportedPurchaseLinks(!!user?.isAdmin);
  const dismissReport = useDismissPurchaseLinkReport();
  const adminDeleteLink = useAdminDeletePurchaseLink();

  if (loading || !user?.isAdmin) return null;

  const pendingRequests = requestsQuery.data?.requests ?? [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-8 font-serif">
        🛠 레코드샵 관리
      </h1>

      {isError && <div className="text-red-400 text-sm mb-4">통계를 불러오지 못했습니다.</div>}
      {isLoading && <div className="text-gray-500 text-sm">로딩 중...</div>}

      {data && (
        <>
          {/* Top stats — two grouped panels (전체 / 오늘) plus the two-row
              API-usage tile. "전체" collects cumulative counters, "오늘"
              collects 24h activity; the API tile sits beside them as a
              dashboard-level cost signal. */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
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
                  hoverContent: <RecentAlbumsList albums={data.recentAlbums} />,
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
              <ClaudeUsageCard usage={data.claudeUsage.month} />
            </div>
          </section>

          {/* 3-column dashboard grid. lg+: 3 columns, md: 2, below: 1.
              Each column is a stack of panels (gap-4 between). */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* ── Column 1: 등록요청 / 신고된 구매처 / 미완 앨범 ────────── */}
            <div className="flex flex-col gap-4">
              <Panel
                title="리뷰 수집 대기"
                icon="📥"
                count={pendingRequests.length}
              >
                {requestsQuery.isLoading ? (
                  <EmptyRow>불러오는 중…</EmptyRow>
                ) : pendingRequests.length === 0 ? (
                  <EmptyRow>리뷰 수집을 기다리는 앨범이 없습니다.</EmptyRow>
                ) : (
                  pendingRequests.map((req) => (
                    <RequestRow key={req.mbid} request={req} />
                  ))
                )}
              </Panel>

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

              <Panel title="데이터 미완 앨범" icon="⚠️">
                <IncompleteSubsection
                  label="리뷰 없음"
                  bucket={data.incompleteAlbums.noReviews}
                />
                <IncompleteSubsection
                  label="한국어 요약 없음"
                  bucket={data.incompleteAlbums.noSummary}
                />
                <IncompleteSubsection
                  label="커버 없음"
                  bucket={data.incompleteAlbums.noCover}
                />
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
        </>
      )}
    </main>
  );
}

// Compact list that lives inside the "오늘 추가 앨범" StatCard hover.
// Replaces the dedicated Column-3 panel that used to host this list —
// kept deliberately light (no delete action) since hover popovers are
// for scanning, not management; delete still lives on the album page
// itself for admins.
function RecentAlbumsList({ albums }: { albums: AdminStats['recentAlbums'] }) {
  if (albums.length === 0) {
    return <div className="p-4 text-sm text-gray-500">최근 등록된 앨범이 없습니다.</div>;
  }
  return (
    <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
      <div className="px-4 py-2.5 text-xs uppercase tracking-wider text-gray-500 bg-[#151515]">
        최근 등록 앨범
      </div>
      {albums.map((a) => (
        <Link
          key={a.id}
          to={`/album/${a.mbid}`}
          className="p-3 flex items-center gap-3 hover:bg-white/5"
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
            </div>
            <div className="text-xs text-gray-500 truncate">
              {a.artist}
              <span className="text-gray-600 mx-1.5">·</span>
              {formatRelativeKo(a.createdAt)}
            </div>
          </div>
        </Link>
      ))}
    </div>
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

function IncompleteSubsection({
  label,
  bucket,
}: {
  label: string;
  bucket: { count: number; samples: IncompleteAlbumSample[] };
}) {
  if (bucket.count === 0) {
    return (
      <div className="px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="text-emerald-400/80 text-xs">없음 ✓</span>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-xs text-gray-500 tabular-nums">
          {bucket.count}
        </span>
      </div>
      <ul className="space-y-1.5">
        {bucket.samples.map((a) => (
          <li key={a.id}>
            <Link
              to={`/album/${a.mbid}`}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-[#e8a020] truncate"
            >
              <CoverArt
                src={a.coverArtUrl}
                fallbacks={a.coverArtFallbacks}
                alt={a.title}
                className="w-7 h-7 rounded object-cover flex-shrink-0"
              />
              <span className="truncate">
                <span className="text-gray-200">{a.title}</span>
                <span className="text-gray-600"> — {a.artist}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
