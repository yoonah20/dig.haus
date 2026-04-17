import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  useMyProfile,
  useMyReviews,
  useMyUpvotes,
  useUpdateMyProfile,
  useUploadMyAvatar,
  useResetMyAvatar,
  useDeleteMyReview,
  useDeleteMyAccount,
} from '../hooks/useMe';
import { useMyAlbumRequests } from '../hooks/useAlbumRequests';

const REQUEST_STATUS_META: Record<
  'pending' | 'approved',
  { label: string; className: string }
> = {
  pending: {
    label: '리뷰 수집 대기',
    className: 'bg-white/5 text-gray-400 border border-white/10',
  },
  approved: {
    label: '등록됨',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  },
};

const RATING_META: Record<'up' | 'down' | 'soso', { emoji: string; label: string }> = {
  up: { emoji: '👍', label: '굿굿' },
  down: { emoji: '👎', label: '별루' },
  soso: { emoji: '🤷', label: '쏘쏘' },
};

function formatJoined(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function AvatarEditor({
  avatarUrl,
  isCustom,
  onUpload,
  onReset,
  uploading,
  resetting,
}: {
  avatarUrl: string | null;
  isCustom: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
  uploading: boolean;
  resetting: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Uploaded avatars are stored on the backend as "/api/avatars/…" site-
  // relative URLs. When the client runs on a different origin than the API
  // (VITE_API_URL is set), a bare <img src> resolves against the wrong host
  // and never loads — resolveApiUrl prefixes the API origin so the image
  // actually appears after upload.
  const resolvedAvatarUrl = resolveApiUrl(avatarUrl);
  return (
    <div className="flex items-center gap-4">
      {resolvedAvatarUrl ? (
        <img
          src={resolvedAvatarUrl}
          alt=""
          className="w-20 h-20 rounded-full object-cover border border-white/10"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-20 h-20 rounded-full bg-[#2a1f10] border border-white/10" />
      )}
      <div className="flex flex-col gap-2 items-start">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 text-sm rounded-md border border-[#e8a020]/50 text-[#e8a020] hover:bg-[#e8a020] hover:text-black disabled:opacity-40 transition-colors cursor-pointer"
        >
          {uploading ? '업로드 중…' : '새 아바타 올리기'}
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="text-xs text-gray-500 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            {resetting ? '복귀 중…' : '기본 아바타로 돌아가기 (Google)'}
          </button>
        )}
      </div>
    </div>
  );
}

const DISPLAY_NAME_MAX = 20;
const INSTAGRAM_MAX = 30;

function ProfileFields({
  initialDisplayName,
  initialInstagram,
  saving,
  onSave,
}: {
  initialDisplayName: string;
  initialInstagram: string;
  saving: boolean;
  onSave: (displayName: string, instagram: string) => void;
}) {
  const [name, setName] = useState(initialDisplayName);
  const [ig, setIg] = useState(initialInstagram);

  useEffect(() => {
    setName(initialDisplayName);
  }, [initialDisplayName]);
  useEffect(() => {
    setIg(initialInstagram);
  }, [initialInstagram]);

  const dirty = name !== initialDisplayName || ig !== initialInstagram;

  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 items-center text-sm max-w-lg">
      <label className="text-gray-400">표시 이름</label>
      <input
        type="text"
        value={name}
        maxLength={DISPLAY_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="비우면 Google 이름"
        className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-[#e8a020] focus:outline-none"
      />
      <label className="text-gray-400">Instagram</label>
      <div className="flex items-center gap-1">
        <span className="text-gray-500">@</span>
        <input
          type="text"
          value={ig}
          maxLength={INSTAGRAM_MAX}
          onChange={(e) => setIg(e.target.value.replace(/^@+/, ''))}
          placeholder="yourhandle (선택)"
          className="flex-1 bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-[#e8a020] focus:outline-none"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => onSave(name.trim(), ig.trim().replace(/^@+/, ''))}
          className="px-3 py-1.5 text-sm rounded-md border border-[#e8a020]/50 text-[#e8a020] hover:bg-[#e8a020] hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = '내 프로필 | dig.haus';
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const profile = useMyProfile();
  const reviews = useMyReviews();
  const upvotes = useMyUpvotes();
  const myRequests = useMyAlbumRequests();
  const update = useUpdateMyProfile();
  const upload = useUploadMyAvatar();
  const reset = useResetMyAvatar();
  const del = useDeleteMyReview();
  const delAccount = useDeleteMyAccount();

  if (loading || !user) return null;

  const me = profile.data?.user;
  const stats = profile.data?.stats;
  const effectiveAvatar = me?.avatarUrl || null;
  const isCustomAvatar = !!me?.customAvatarUrl;

  const handleSave = async (displayName: string, instagram: string) => {
    try {
      await update.mutateAsync({
        displayName: displayName || null,
        instagramHandle: instagram || null,
      });
      // AuthContext hydrates from /auth/me into its own useState — not
      // React Query — so we need to re-pull to refresh the nav avatar/name.
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장에 실패했습니다.');
    }
  };

  const handleUpload = async (file: File) => {
    try {
      await upload.mutateAsync(file);
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || '아바타 업로드에 실패했습니다.');
    }
  };

  const handleReset = async () => {
    if (!confirm('Google 아바타로 되돌릴까요?')) return;
    try {
      await reset.mutateAsync();
      await refresh();
    } catch {
      alert('복귀에 실패했습니다.');
    }
  };

  const handleDeleteReview = async (id: number, body: string) => {
    if (!confirm(`이 50자 평을 삭제할까요?\n\n"${body.slice(0, 40)}${body.length > 40 ? '…' : ''}"`)) return;
    try {
      await del.mutateAsync(id);
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const handleDeleteAccount = async () => {
    const first = confirm(
      '정말로 계정을 탈퇴할까요?\n\n' +
        '· 내 위시리스트와 컬렉션은 삭제됩니다.\n' +
        '· 내가 남긴 50자 평과 굿굿/별루 투표, 구매처 링크는 "탈퇴한 사용자"로 익명 처리되어 남습니다.\n' +
        '· 되돌릴 수 없습니다.'
    );
    if (!first) return;
    const second = prompt('확인을 위해 "탈퇴"를 입력해주세요.');
    if (second !== '탈퇴') {
      alert('탈퇴가 취소되었습니다.');
      return;
    }
    try {
      await delAccount.mutateAsync();
      await refresh();
      navigate('/', { replace: true });
    } catch {
      alert('탈퇴에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-8 font-serif">🧑‍🎤 내 프로필</h1>

      {profile.isError && (
        <div className="text-red-400 text-sm mb-4">프로필을 불러오지 못했습니다.</div>
      )}

      {/* 2-column layout: left = identity + account stuff
                           right = "내가 남긴 기록"
          Below md the grid collapses to a single column and sections
          stack in reading order (identity first, records after). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ─── LEFT ─────────────────────────────────────────────── */}
        <div className="space-y-8">
          {me && (
            <section className="bg-[#1a1a1a] rounded-2xl p-6 border border-white/5 space-y-6">
              <AvatarEditor
                avatarUrl={effectiveAvatar}
                isCustom={isCustomAvatar}
                onUpload={handleUpload}
                onReset={handleReset}
                uploading={upload.isPending}
                resetting={reset.isPending}
              />
              <div className="text-sm text-gray-400">
                <span className="text-gray-300">{me.name}</span>
                <span className="text-gray-600 mx-2">·</span>
                <span>{me.email}</span>
                {me.createdAt && (
                  <>
                    <span className="text-gray-600 mx-2">·</span>
                    <span>가입 {formatJoined(me.createdAt)}</span>
                  </>
                )}
              </div>
              <ProfileFields
                initialDisplayName={me.displayName ?? ''}
                initialInstagram={me.instagramHandle ?? ''}
                saving={update.isPending}
                onSave={handleSave}
              />
              {stats && (
                <div className="flex flex-wrap gap-4 text-sm text-gray-400 pt-2 border-t border-white/5">
                  <span>
                    50자 평{' '}
                    <span className="text-gray-200 font-semibold">{stats.reviewCount}</span>
                  </span>
                  <span>
                    굿굿 <span className="text-[#e8a020] font-semibold">{stats.upvoteCount}</span>
                  </span>
                  <span>
                    별루{' '}
                    <span className="text-gray-200 font-semibold">{stats.downvoteCount}</span>
                  </span>
                </div>
              )}
            </section>
          )}

          {/* My submitted albums. "리뷰 수집 대기" = admin hasn't run
              the Claude review-crawl yet; "등록됨" = done. Both are
              clickable — the album page works either way. */}
          <section>
            <h2 className="text-xl font-serif text-white mb-4">
              내 등록 앨범
              {myRequests.data && (
                <span className="ml-2 text-sm text-gray-500 font-sans">
                  {myRequests.data.requests.length}
                </span>
              )}
            </h2>
            {myRequests.isLoading ? (
              <div className="text-sm text-gray-500">불러오는 중…</div>
            ) : myRequests.data && myRequests.data.requests.length > 0 ? (
              <ul className="space-y-2">
                {myRequests.data.requests.map((r) => {
                  const meta = REQUEST_STATUS_META[r.status];
                  const body = (
                    <div className="flex items-center gap-3 p-3 bg-[#1a1a1a] rounded-xl border border-white/5">
                      <div className="shrink-0 w-12 h-12 bg-[#252525] rounded-md overflow-hidden">
                        {r.coverArtUrl ? (
                          <img
                            src={r.coverArtUrl}
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
                        <p className="text-sm font-medium text-gray-100 truncate">
                          {r.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {r.artist}
                          {r.year && ` · ${r.year}`}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                  );
                  return (
                    <li key={r.id}>
                      {/* Every row now links to the album page — the
                          album exists from the moment of submission,
                          even if the review crawl is still waiting on
                          admin approval. */}
                      <Link
                        to={`/album/${r.mbid}`}
                        className="block hover:brightness-110 transition"
                      >
                        {body}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-sm text-gray-500">
                아직 등록한 앨범이 없습니다. 상단 + 버튼으로 등록해보세요.
              </div>
            )}
          </section>
        </div>

        {/* ─── RIGHT ────────────────────────────────────────────── */}
        <div className="space-y-8">
          {/* My 50자 평 */}
          <section>
        <h2 className="text-xl font-serif text-white mb-4">
          내 50자 평
          {reviews.data && (
            <span className="ml-2 text-sm text-gray-500 font-sans">{reviews.data.reviews.length}</span>
          )}
        </h2>
        {reviews.isLoading ? (
          <div className="text-sm text-gray-500">불러오는 중…</div>
        ) : reviews.data && reviews.data.reviews.length > 0 ? (
          <ul className="space-y-3">
            {reviews.data.reviews.map((r) => {
              const ratingMeta = r.rating ? RATING_META[r.rating] : null;
              return (
                <li
                  key={r.id}
                  className="bg-[#1a1a1a] rounded-xl p-4 border border-white/5 flex gap-4 items-start"
                >
                  <Link
                    to={`/album/${r.albumSlug}`}
                    className="shrink-0 w-14 h-14 rounded-md overflow-hidden bg-[#252525]"
                  >
                    <CoverArt
                      src={r.albumCoverUrl}
                      fallbacks={r.albumCoverFallbacks}
                      alt={r.albumTitle}
                      className="w-full h-full object-cover"
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/album/${r.albumSlug}`}
                      className="text-sm text-gray-300 hover:text-[#e8a020] transition-colors"
                    >
                      <span className="font-medium">{r.albumTitle}</span>
                      <span className="text-gray-600 mx-1.5">·</span>
                      <span className="text-gray-500">{r.albumArtist}</span>
                    </Link>
                    <div className="text-sm text-gray-100 mt-1 leading-relaxed break-words">
                      {r.body}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                      {ratingMeta && (
                        <span title={ratingMeta.label}>
                          {ratingMeta.emoji} {ratingMeta.label}
                        </span>
                      )}
                      {r.emoji && <span>{r.emoji}</span>}
                      <span className="ml-auto tabular-nums">{r.updatedAt?.slice(0, 10)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteReview(r.id, r.body)}
                    disabled={del.isPending}
                    className="shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 cursor-pointer disabled:opacity-40"
                    title="삭제"
                    aria-label="삭제"
                  >
                    🗑️
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-sm text-gray-500">아직 작성한 50자 평이 없습니다.</div>
        )}
      </section>

      {/* Upvoted albums grid — 10/row desktop, 5/row mobile ──────── */}
      <section className="mb-10">
        <h2 className="text-xl font-serif text-white mb-4">
          굿굿한 앨범들
          {upvotes.data && (
            <span className="ml-2 text-sm text-gray-500 font-sans">{upvotes.data.upvotes.length}</span>
          )}
        </h2>
        {upvotes.isLoading ? (
          <div className="text-sm text-gray-500">불러오는 중…</div>
        ) : upvotes.data && upvotes.data.upvotes.length > 0 ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {upvotes.data.upvotes.map((a) => (
              <Link
                key={a.slug}
                to={`/album/${a.slug}`}
                className="aspect-square rounded-md overflow-hidden bg-[#1a1a1a] hover:ring-2 hover:ring-[#e8a020]/50 transition-all"
                title={`${a.title} — ${a.artist}`}
              >
                <CoverArt
                  src={a.coverArtUrl}
                  fallbacks={a.coverArtFallbacks}
                  alt={a.title}
                  className="w-full h-full object-cover"
                />
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">아직 굿굿한 앨범이 없습니다.</div>
        )}
          </section>
        </div>
      </div>

      {/* Danger zone — account deletion ────────────────────────────── */}
      <section className="mt-16 pt-6 border-t border-white/5 flex justify-end">
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={delAccount.isPending}
          className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 cursor-pointer"
        >
          {delAccount.isPending ? '탈퇴 처리 중…' : '계정 탈퇴'}
        </button>
      </section>
    </main>
  );
}
