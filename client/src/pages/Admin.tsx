import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';

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
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`bg-[#1a1a1a] rounded-xl p-5 border ${accent ? 'border-[#e8a020]/40' : 'border-white/5'}`}>
      <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{label}</div>
      <div className={`text-3xl font-bold tabular-nums ${accent ? 'text-[#e8a020]' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
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

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-8 font-serif">
        🛠 레코드샵 관리
      </h1>

      {isError && <div className="text-red-400 text-sm mb-4">통계를 불러오지 못했습니다.</div>}
      {isLoading && <div className="text-gray-500 text-sm">로딩 중...</div>}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <StatCard label="전체 앨범" value={data.totalAlbums.toLocaleString()} />
            <StatCard label="오늘 추가 앨범" value={data.albumsToday} accent={data.albumsToday > 0} />
            <StatCard label="전체 유저" value={data.totalUsers.toLocaleString()} />
            <StatCard
              label="오늘 투표"
              value={`▲${data.votesToday.up} / ▼${data.votesToday.down}`}
            />
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-white mb-4">최근 추가 앨범</h2>
            <div className="bg-[#1a1a1a] rounded-xl divide-y divide-white/5">
              {data.recentAlbums.length === 0 && (
                <div className="p-6 text-sm text-gray-500">없음</div>
              )}
              {data.recentAlbums.map((a) => (
                <div key={a.id} className="flex items-center gap-4 p-4">
                  <CoverArt
                    src={a.coverArtUrl}
                    fallbacks={a.coverArtFallbacks}
                    alt={a.title}
                    className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/album/${a.mbid}`}
                      className="text-white text-sm font-medium hover:text-[#e8a020] truncate block"
                    >
                      {a.title}
                    </Link>
                    <div className="text-gray-500 text-xs truncate">
                      {a.artist} · {new Date(a.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(a.mbid)}
                    className="text-red-700 hover:text-red-400 text-sm cursor-pointer px-3 py-1"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-white mb-4">
              최근 50자 평
              {data.recentReviews.length > 0 && (
                <span className="ml-2 text-sm text-gray-500 font-normal">
                  {data.recentReviews.length}
                </span>
              )}
            </h2>
            <div className="bg-[#1a1a1a] rounded-xl divide-y divide-white/5">
              {data.recentReviews.length === 0 && (
                <div className="p-6 text-sm text-gray-500">없음</div>
              )}
              {data.recentReviews.map((r) => {
                const ratingMeta =
                  r.rating === 'up'
                    ? { emoji: '👍', label: '굿굿', accent: true }
                    : r.rating === 'down'
                      ? { emoji: '👎', label: '별루', accent: false }
                      : r.rating === 'soso'
                        ? { emoji: '🤷', label: '쏘쏘', accent: false }
                        : null;
                return (
                  <div key={r.id} className="flex items-start gap-4 p-4">
                    {r.userAvatar ? (
                      <img
                        src={r.userAvatar}
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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-white text-sm font-medium truncate">
                          {r.userName || r.userEmail || '익명'}
                        </span>
                        {ratingMeta && (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                              ratingMeta.accent
                                ? 'bg-[#e8a020]/15 text-[#e8a020] border-[#e8a020]/30'
                                : 'bg-white/5 text-gray-300 border-white/10'
                            }`}
                          >
                            <span aria-hidden>{ratingMeta.emoji}</span>
                            <span>{ratingMeta.label}</span>
                          </span>
                        )}
                        <span className="text-gray-500 text-xs">
                          {new Date(r.updatedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-gray-100 text-sm leading-relaxed break-words">
                        {r.emoji && (
                          <span className="mr-1.5" aria-hidden>
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
              })}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">최근 가입 유저</h2>
            <div className="bg-[#1a1a1a] rounded-xl divide-y divide-white/5">
              {data.recentUsers.length === 0 && (
                <div className="p-6 text-sm text-gray-500">없음</div>
              )}
              {data.recentUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-4 p-4">
                  {u.avatarUrl ? (
                    <img
                      src={u.avatarUrl}
                      alt=""
                      aria-hidden
                      className="w-10 h-10 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#e8a020]/20 text-[#e8a020] flex items-center justify-center text-sm font-bold">
                      {(u.name || u.email)[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {u.name || u.email}
                      {u.isAdmin && (
                        <span className="ml-2 text-[10px] bg-[#e8a020]/20 text-[#e8a020] px-2 py-0.5 rounded-full">
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs truncate">
                      {u.email} · {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
