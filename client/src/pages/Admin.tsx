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
                  className="py-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-baseline"
                >
                  <span className="text-gray-300 truncate">
                    {OPERATION_LABEL(c.operation)}
                    {c.webSearchCount > 0 && (
                      <span className="ml-1 text-gray-500">· {c.webSearchCount}검색</span>
                    )}
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

  const hosts = data?.hosts ?? [];

  return (
    <Panel title="스크래핑 실패 로그 (30일)" icon="⚠️" count={hosts.length}>
      {isLoading ? (
        <EmptyRow>로딩 중...</EmptyRow>
      ) : isError ? (
        <EmptyRow>불러오지 못했습니다.</EmptyRow>
      ) : hosts.length === 0 ? (
        <EmptyRow>실패한 스크래핑 없음 ✓</EmptyRow>
      ) : (
        hosts.map((h) => (
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
              {h.last_error && (
                <div
                  className="text-xs text-gray-600 truncate mt-1 font-mono"
                  title={h.last_error}
                >
                  {h.last_error}
                </div>
              )}
            </div>
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
              className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 px-2 py-1 cursor-pointer shrink-0"
              aria-label={`${h.hostname} 실패 로그 삭제`}
              title="실패 로그 삭제"
            >
              🗑️
            </button>
          </div>
        ))
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
function IncompleteSubsection({
  label,
  bucket,
}: {
  label: string;
  bucket: { count: number; samples: IncompleteAlbumSample[] };
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
        </span>
        <span className="text-xs text-gray-500 tabular-nums">
          {bucket.count.toLocaleString()}
        </span>
      </button>
      {expanded && (
        <ul className="px-4 pb-2.5 space-y-1">
          {bucket.samples.map((a) => (
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
          ))}
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
