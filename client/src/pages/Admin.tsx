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
