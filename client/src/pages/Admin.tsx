import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  useAlbumRequests,
  useApproveAlbumRequest,
  useDiscardAlbumRequest,
  type AlbumRequest,
} from '../hooks/useAlbumRequests';

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
    last7d: {
      inputTokens: number;
      outputTokens: number;
      webSearchCount: number;
      usd: number;
      byOperation: Array<{
        operation: string;
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

function StatCard({
  label,
  value,
  accent,
  hoverContent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  hoverContent?: ReactNode;
}) {
  const card = (
    <div
      className={`bg-[#1a1a1a] rounded-xl p-5 border ${accent ? 'border-[#e8a020]/40' : 'border-white/5'} ${hoverContent ? 'cursor-default' : ''}`}
    >
      <div className="text-sm uppercase tracking-wider text-gray-500 mb-2">{label}</div>
      <div className={`text-3xl font-bold tabular-nums ${accent ? 'text-[#e8a020]' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
  if (!hoverContent) return card;
  return (
    <div className="relative group">
      {card}
      <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 right-0 top-full mt-2 z-20 bg-[#1a1a1a] rounded-xl border border-white/10 shadow-xl overflow-hidden">
        {hoverContent}
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
      <div className="divide-y divide-white/5 max-h-[520px] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="p-4 text-sm text-gray-500">{children}</div>;
}

// Compact pending-request row for the admin dashboard. Replaces the
// old full-card AlbumRequestCard (used when the feature hijacked the
// homepage sort dropdown). Here we just need a scannable list entry
// with the two action buttons inline.
function RequestRow({ request }: { request: AlbumRequest }) {
  const approve = useApproveAlbumRequest();
  const discard = useDiscardAlbumRequest();
  const busy = approve.isPending || discard.isPending;

  const handleApprove = async () => {
    if (busy) return;
    if (
      !confirm(
        `"${request.artist} — ${request.title}" 을(를) 등록할까요?\n\nClaude 파이프라인(리뷰/음차/유사작) 이 즉시 실행됩니다.`
      )
    )
      return;
    try {
      await approve.mutateAsync(request.mbid);
    } catch (err: any) {
      alert(err?.response?.data?.error || '등록에 실패했습니다.');
    }
  };

  const handleDiscard = async () => {
    if (busy) return;
    if (!confirm(`"${request.artist} — ${request.title}" 요청을 무시할까요?`)) return;
    try {
      await discard.mutateAsync(request.mbid);
    } catch (err: any) {
      alert(err?.response?.data?.error || '무시 처리에 실패했습니다.');
    }
  };

  // First note (if any) to surface inline under the artist/title; the
  // admin gets social context without us rendering a full stack.
  const firstNote = request.requesters.find((r) => r.notes && r.notes.trim())?.notes ?? null;
  const firstRequester = request.requesters[0];

  return (
    <div className="p-3 flex items-start gap-3">
      <div className="shrink-0 w-12 h-12 bg-[#252525] rounded-md overflow-hidden">
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
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base text-white font-medium truncate">{request.title}</p>
        <p className="text-sm text-gray-400 truncate">
          {request.artist}
          {request.year && ` · ${request.year}`}
        </p>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {firstRequester?.userName || '익명'}
          {request.requestCount > 1 && ` 외 ${request.requestCount - 1}명`}
          {firstNote && <> · “{firstNote}”</>}
        </p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={handleApprove}
          disabled={busy}
          className="text-xs font-medium text-black bg-[#e8a020] hover:bg-[#f0b040] rounded-md px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {approve.isPending ? '…' : '등록'}
        </button>
        <button
          onClick={handleDiscard}
          disabled={busy}
          className="text-xs text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {discard.isPending ? '…' : '무시'}
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
  const qc = useQueryClient();

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

  if (loading || !user?.isAdmin) return null;

  const handleDelete = async (mbid: string) => {
    if (!confirm('이 앨범을 삭제할까요?')) return;
    try {
      await axios.delete(`/api/albums/${mbid}`);
      qc.removeQueries({ queryKey: ['album', mbid] });
      qc.removeQueries({ queryKey: ['album-reviews', mbid] });
      qc.removeQueries({ queryKey: ['album-similar', mbid] });
      qc.removeQueries({ queryKey: ['purchase-links', mbid] });
      await qc.invalidateQueries({ queryKey: ['album-list'] });
      await qc.invalidateQueries({ queryKey: ['admin-stats'] });
    } catch {
      alert('삭제 실패');
    }
  };

  const pendingRequests = requestsQuery.data?.requests ?? [];

  return (
    <main className="max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-8 font-serif">
        🛠 레코드샵 관리
      </h1>

      {isError && <div className="text-red-400 text-sm mb-4">통계를 불러오지 못했습니다.</div>}
      {isLoading && <div className="text-gray-500 text-sm">로딩 중...</div>}

      {data && (
        <>
          {/* Top stat cards — at-a-glance totals. "전체 유저" reveals the
              recent-signup list on hover (replaces the dedicated panel). */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="전체 앨범" value={data.totalAlbums.toLocaleString()} />
            <StatCard label="오늘 추가 앨범" value={data.albumsToday} accent={data.albumsToday > 0} />
            <StatCard
              label="전체 유저"
              value={data.totalUsers.toLocaleString()}
              hoverContent={
                <RecentUsersList users={data.recentUsers} />
              }
            />
            <StatCard
              label="오늘 투표"
              value={`▲${data.votesToday.up} / ▼${data.votesToday.down}`}
            />
          </section>

          {/* 3-column dashboard grid. lg+: 3 columns, md: 2, below: 1.
              Each column is a stack of panels (gap-4 between). */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* ── Column 1: 등록요청 / API 사용량 / 미완 앨범 ────────── */}
            <div className="flex flex-col gap-4">
              <Panel
                title="등록 요청 앨범"
                icon="📥"
                count={pendingRequests.length}
              >
                {requestsQuery.isLoading ? (
                  <EmptyRow>불러오는 중…</EmptyRow>
                ) : pendingRequests.length === 0 ? (
                  <EmptyRow>대기 중인 요청이 없습니다.</EmptyRow>
                ) : (
                  pendingRequests.map((req) => (
                    <RequestRow key={req.mbid} request={req} />
                  ))
                )}
              </Panel>

              <Panel title="Claude API 사용량 (지난 7일)" icon="🪙">
                {data.claudeUsage.last7d.webSearchCount === 0 &&
                data.claudeUsage.last7d.inputTokens === 0 ? (
                  <EmptyRow>기록된 호출이 없습니다.</EmptyRow>
                ) : (
                  <div className="p-4 space-y-3">
                    {/* Summary row — big numbers */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-gray-500">
                          예상 비용
                        </div>
                        <div className="text-xl font-bold text-[#e8a020] tabular-nums">
                          ${data.claudeUsage.last7d.usd.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-gray-500">
                          웹 검색
                        </div>
                        <div className="text-xl font-bold text-white tabular-nums">
                          {data.claudeUsage.last7d.webSearchCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-gray-500">
                          입력 토큰
                        </div>
                        <div className="text-base text-gray-200 tabular-nums">
                          {formatTokens(data.claudeUsage.last7d.inputTokens)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-gray-500">
                          출력 토큰
                        </div>
                        <div className="text-base text-gray-200 tabular-nums">
                          {formatTokens(data.claudeUsage.last7d.outputTokens)}
                        </div>
                      </div>
                    </div>

                    {/* Per-operation breakdown */}
                    {data.claudeUsage.last7d.byOperation.length > 0 && (
                      <div className="pt-3 border-t border-white/5 space-y-2">
                        {data.claudeUsage.last7d.byOperation.map((op) => (
                          <div
                            key={op.operation}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="text-gray-300 truncate">
                              {OPERATION_LABEL(op.operation)}
                            </span>
                            <span className="tabular-nums text-gray-500 shrink-0 text-xs">
                              {formatTokens(op.tokens)}
                              {op.searches > 0 && ` · ${op.searches} 검색`}
                            </span>
                            <span className="tabular-nums text-[#e8a020] shrink-0 w-16 text-right">
                              ${op.usd.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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

            {/* ── Column 3: 최근 등록 앨범 ─────────────────────────── */}
            <div className="flex flex-col gap-4">
              <Panel
                title="최근 등록 앨범"
                icon="💿"
                count={data.recentAlbums.length}
              >
                {data.recentAlbums.length === 0 ? (
                  <EmptyRow>없음</EmptyRow>
                ) : (
                  data.recentAlbums.map((a) => (
                    <div key={a.id} className="p-3 flex items-center gap-3">
                      <CoverArt
                        src={a.coverArtUrl}
                        fallbacks={a.coverArtFallbacks}
                        alt={a.title}
                        className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/album/${a.mbid}`}
                          className="text-base text-white font-medium hover:text-[#e8a020] truncate block"
                        >
                          {a.title}
                        </Link>
                        <div className="text-xs text-gray-500 truncate">
                          {a.artist} · {new Date(a.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(a.mbid)}
                        className="text-xs text-red-700 hover:text-red-400 cursor-pointer px-2 py-1 shrink-0"
                      >
                        삭제
                      </button>
                    </div>
                  ))
                )}
              </Panel>
            </div>
          </section>
        </>
      )}
    </main>
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
              {u.email} · {new Date(u.createdAt).toLocaleDateString()}
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
