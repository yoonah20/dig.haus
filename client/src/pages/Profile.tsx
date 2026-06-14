import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from '../lib/axios';
import CoverArt from '../components/CoverArt';
import { Button } from '../components/ui';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  useMyProfile,
  useMyReviews,
  useMyUpvotes,
  useMyDownvotes,
  useUpdateMyProfile,
  useUploadMyAvatar,
  useResetMyAvatar,
  useDeleteMyReview,
  useDeleteMyAccount,
  type MyVotedAlbum,
} from '../hooks/useMe';
import {
  useMyAlbumRequests,
  useDeletePendingAlbum,
} from '../hooks/useAlbumRequests';
import { useMyCrates } from '../hooks/useCrates';

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

// Shared heading — "emoji 제목 <count>" — so every section on the
// profile page reads the same way. Keeps the right margin tight so
// numbers hug the label rather than floating.
function SectionHeader({
  emoji,
  title,
  count,
}: {
  emoji?: string;
  title: string;
  count?: number;
}) {
  return (
    <h2 className="text-lg font-serif text-white mb-3 flex items-baseline gap-2">
      {emoji && (
        <span aria-hidden className="text-base">
          {emoji}
        </span>
      )}
      <span>{title}</span>
      {typeof count === 'number' && (
        <span className="text-sm text-gray-500 font-sans tabular-nums">{count}</span>
      )}
    </h2>
  );
}

// Compact album-row list shared by the 굿굿 / 별루 panels. The row
// shape matches "내 50자 평" above — same 40×40 cover, same hover-link
// title — so the page reads as one continuous activity dashboard
// instead of two competing layouts.
function VotedAlbumList({
  albums,
  emptyText,
  isLoading,
}: {
  albums: MyVotedAlbum[];
  emptyText: string;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="text-sm text-gray-500">불러오는 중…</div>;
  }
  if (albums.length === 0) {
    return <div className="text-sm text-gray-500">{emptyText}</div>;
  }
  return (
    <div className="bg-panel rounded-xl border border-white/5 overflow-hidden">
      <div className="divide-y divide-white/5 max-h-[480px] overflow-y-auto">
        {albums.map((a) => (
          <div key={a.slug} className="p-3 flex items-center gap-3">
            <Link
              to={`/album/${a.slug}`}
              className="shrink-0 w-10 h-10 rounded-md overflow-hidden bg-panel-hover"
            >
              <CoverArt
                src={a.coverArtUrl}
                fallbacks={a.coverArtFallbacks}
                alt={a.title}
                className="w-full h-full object-cover"
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link
                to={`/album/${a.slug}`}
                className="block text-sm text-white font-medium truncate hover:text-accent transition-colors"
                title={`${a.title} — ${a.artist ?? ''}`}
              >
                {a.title}
              </Link>
              <div className="text-xs text-gray-500 truncate">{a.artist}</div>
            </div>
            <span className="shrink-0 text-xs text-gray-500 tabular-nums">
              {a.votedAt?.slice(0, 10)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'blue' | 'red' | 'purple';
}) {
  const valueClass =
    accent === 'brand'
      ? 'text-accent'
      : accent === 'blue'
        ? 'text-[#88a2bf]'
        : accent === 'red'
          ? 'text-[#c08888]'
          : accent === 'purple'
            ? 'text-[#a896c9]'
            : 'text-white';
  return (
    <div className="flex flex-col items-start px-3 py-2 bg-black/30 rounded-lg border border-white/5 min-w-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <span className={`text-xl font-bold tabular-nums ${valueClass}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

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
    <div className="flex items-center gap-4 min-w-0">
      {resolvedAvatarUrl ? (
        <img
          src={resolvedAvatarUrl}
          alt=""
          className="w-20 h-20 rounded-full object-cover border border-white/10 shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-20 h-20 rounded-full bg-avatar-bg border border-white/10 shrink-0" />
      )}
      <div className="flex flex-col gap-2 items-start min-w-0">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="프로필 사진 업로드"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '업로드 중…' : '새 아바타 올리기'}
        </Button>
        {isCustom && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="text-xs text-gray-500 hover:text-white disabled:opacity-40 cursor-pointer text-left"
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
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 items-center text-sm w-full max-w-lg min-w-0">
      <label className="text-gray-400 truncate">표시 이름</label>
      <input
        type="text"
        value={name}
        maxLength={DISPLAY_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="비우면 Google 이름"
        className="w-full min-w-0 bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none"
      />
      <label className="text-gray-400 truncate">Instagram</label>
      <div className="flex items-center gap-1 w-full min-w-0">
        <span className="text-gray-500 shrink-0">@</span>
        <input
          type="text"
          value={ig}
          maxLength={INSTAGRAM_MAX}
          onChange={(e) => setIg(e.target.value.replace(/^@+/, ''))}
          placeholder="yourhandle (선택)"
          className="flex-1 min-w-0 bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <Button
          variant="ghost"
          size="md"
          disabled={!dirty || saving}
          onClick={() => onSave(name.trim(), ig.trim().replace(/^@+/, ''))}
        >
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}

// Discogs account link. The OAuth start is a top-level browser redirect
// straight to the backend (not an axios call) because the handshake
// bounces through discogs.com and back to /auth/discogs/callback, which
// sets the session and redirects here with ?discogs=<result>. We only
// ever see the resolved Discogs username — never the stored tokens.
function DiscogsLinkCard({
  discogsUsername,
  onRefresh,
}: {
  discogsUsername: string | null | undefined;
  onRefresh: () => Promise<void> | void;
}) {
  const [params, setParams] = useSearchParams();
  const [unlinking, setUnlinking] = useState(false);
  const [stats, setStats] = useState<{
    collectionCount: number;
    wantlistCount: number;
  } | null>(null);
  const result = params.get('discogs');

  // Pull live collection/wantlist counts when linked. One cheap call,
  // nothing stored — purely to populate the "컬렉션 N장" line.
  useEffect(() => {
    if (!discogsUsername) {
      setStats(null);
      return;
    }
    let cancelled = false;
    axios
      .get('/auth/discogs/stats')
      .then(({ data }) => {
        if (!cancelled && data?.linked) {
          setStats({
            collectionCount: data.collectionCount ?? 0,
            wantlistCount: data.wantlistCount ?? 0,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [discogsUsername]);

  // Clear the ?discogs=… flag once we've read it so a refresh doesn't
  // re-show the banner.
  useEffect(() => {
    if (!result) return;
    const next = new URLSearchParams(params);
    next.delete('discogs');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handleUnlink = async () => {
    if (!confirm('Discogs 연동을 해제할까요?')) return;
    setUnlinking(true);
    try {
      await axios.delete('/auth/discogs');
      await onRefresh();
    } catch {
      alert('연동 해제에 실패했습니다.');
    } finally {
      setUnlinking(false);
    }
  };

  const banner =
    result === 'failed'
      ? '연동에 실패했습니다. 다시 시도해주세요.'
      : result === 'denied'
        ? '연동이 취소되었습니다.'
        : result === 'not_configured'
          ? 'Discogs 연동이 아직 설정되지 않았습니다.'
          : null;

  return (
    <section className="bg-panel rounded-2xl p-4 sm:p-5 border border-white/5 space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500">
        Discogs 연동
      </div>
      {banner && <div className="text-red-400 text-sm">{banner}</div>}
      {discogsUsername ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-300">
              <span className="text-gray-500">연결됨 · </span>
              <a
                href={`https://www.discogs.com/user/${encodeURIComponent(discogsUsername)}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline font-medium"
              >
                {discogsUsername}
              </a>
            </span>
            <Button
              variant="ghost"
              onClick={handleUnlink}
              disabled={unlinking}
              className="text-xs"
            >
              {unlinking ? '해제 중…' : '연동 해제'}
            </Button>
          </div>
          {stats && (
            <div className="text-sm text-gray-400">
              컬렉션{' '}
              <span className="text-gray-200 font-medium">
                {stats.collectionCount.toLocaleString()}
              </span>
              장 · 위시리스트{' '}
              <span className="text-gray-200 font-medium">
                {stats.wantlistCount.toLocaleString()}
              </span>
              장
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">
            Discogs 계정을 연결하면 앨범 페이지에서 내 컬렉션 보유 여부가
            표시됩니다.
          </p>
          <a href={resolveApiUrl('/auth/discogs') ?? '/auth/discogs'}>
            <Button variant="primary" className="text-sm">
              Discogs 계정 연결
            </Button>
          </a>
        </div>
      )}
    </section>
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
  const downvotes = useMyDownvotes();
  const myRequests = useMyAlbumRequests();
  const deleteMyAlbum = useDeletePendingAlbum();
  const myCrates = useMyCrates();
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

  const myReviews = reviews.data?.reviews ?? [];
  const myUpvotes = upvotes.data?.upvotes ?? [];
  const myDownvotes = downvotes.data?.downvotes ?? [];
  const myRequestList = myRequests.data?.requests ?? [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8 space-y-10">
      <h1 className="text-3xl font-bold text-white font-serif">🧑‍🎤 내 프로필</h1>

      {profile.isError && (
        <div className="text-red-400 text-sm">프로필을 불러오지 못했습니다.</div>
      )}

      {/* ─── Hero row: identity card + activity-stats card ─────────
          Two compact cards side-by-side at md+, stacked on mobile.
          Identity stays focused on edit affordances; activity card
          surfaces all the counters (50자 평 / 굿굿 / 별루 / 샀음 /
          살거 / 등록) so the page feels like a profile dashboard
          rather than just a settings screen. */}
      {me && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Identity / settings card.
              `min-w-0` is what lets the card actually fit on a narrow
              mobile viewport — without it the grid cell sizes to the
              card's min-content (driven by long unbroken strings like
              an email address), which on a phone overflows past the
              right edge and drags the inputs off-screen with it. */}
          <div className="bg-panel rounded-2xl p-4 sm:p-5 border border-white/5 space-y-4 min-w-0">
            <AvatarEditor
              avatarUrl={effectiveAvatar}
              isCustom={isCustomAvatar}
              onUpload={handleUpload}
              onReset={handleReset}
              uploading={upload.isPending}
              resetting={reset.isPending}
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400 min-w-0">
              <span className="text-gray-200 font-medium truncate max-w-full">
                {me.name}
              </span>
              <span className="text-gray-600" aria-hidden>·</span>
              <span className="break-all">{me.email}</span>
              {me.createdAt && (
                <>
                  <span className="text-gray-600" aria-hidden>·</span>
                  <span className="whitespace-nowrap">
                    가입 {formatJoined(me.createdAt)}
                  </span>
                </>
              )}
            </div>
            <ProfileFields
              initialDisplayName={me.displayName ?? ''}
              initialInstagram={me.instagramHandle ?? ''}
              saving={update.isPending}
              onSave={handleSave}
            />
          </div>

          {/* Activity-stats card — at-a-glance counts that the
              dashboard would otherwise have to scroll to learn.
              Same `min-w-0` reason as the identity card above. */}
          {stats && (
            <div className="bg-panel rounded-2xl p-4 sm:p-5 border border-white/5 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-3">
                내 활동
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatPill label="50자 평" value={stats.reviewCount} />
                <StatPill label="굿굿" value={stats.upvoteCount} accent="blue" />
                <StatPill label="별루" value={stats.downvoteCount} accent="red" />
                <StatPill
                  label="상자"
                  value={myCrates.data?.crates.length ?? 0}
                  accent="brand"
                />
                <StatPill label="등록" value={myRequestList.length} />
              </div>
            </div>
          )}
        </section>
      )}

      <DiscogsLinkCard
        discogsUsername={user.discogsUsername}
        onRefresh={refresh}
      />

      {/* The 샀음 / 살거 grids that used to live here were replaced
          when collections + wants were absorbed into crates
          (post-Phase 3 roadmap item 2). Crates now live on the user's
          mydig page — a single click on the avatar there gets to the
          full grid + crate management surface. The crate StatPill
          above gives the count at a glance; the dedicated grid would
          be a duplicate of the mydig section once that lands. */}

      {/* ─── Activity: 50자 평 + registered albums side-by-side.
          Reviews now render as a compact scrollable panel matching
          the admin "최근 50자 평" style — keeps long histories from
          dominating the page. Register list stays as inline rows
          since it tops out at a few entries per user. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] gap-8">
        <section>
          <SectionHeader emoji="💬" title="내 50자 평" count={myReviews.length} />
          {reviews.isLoading ? (
            <div className="text-sm text-gray-500">불러오는 중…</div>
          ) : myReviews.length > 0 ? (
            <div className="bg-panel rounded-xl border border-white/5 overflow-hidden">
              <div className="divide-y divide-white/5 max-h-[480px] overflow-y-auto">
                {myReviews.map((r) => {
                  const ratingMeta = r.rating ? RATING_META[r.rating] : null;
                  return (
                    <div key={r.id} className="p-3 flex items-start gap-3">
                      <Link
                        to={`/album/${r.albumSlug}`}
                        className="shrink-0 w-10 h-10 rounded-md overflow-hidden bg-panel-hover"
                      >
                        <CoverArt
                          src={r.albumCoverUrl}
                          fallbacks={r.albumCoverFallbacks}
                          alt={r.albumTitle}
                          className="w-full h-full object-cover"
                        />
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <Link
                            to={`/album/${r.albumSlug}`}
                            className="text-sm text-white font-medium truncate hover:text-accent transition-colors"
                            title={`${r.albumTitle} — ${r.albumArtist ?? ''}`}
                          >
                            {r.albumTitle}
                          </Link>
                          {ratingMeta && (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${
                                r.rating === 'up'
                                  ? 'bg-[#3b82f6]/15 text-[#88a2bf] border-[#3b82f6]/30'
                                  : r.rating === 'down'
                                    ? 'bg-[#dc2626]/15 text-[#c08888] border-[#dc2626]/30'
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
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          <span className="truncate">{r.albumArtist}</span>
                          <span className="ml-auto tabular-nums shrink-0">
                            {r.updatedAt?.slice(0, 10)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteReview(r.id, r.body)}
                        disabled={del.isPending}
                        className="shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 cursor-pointer disabled:opacity-40 self-start"
                        title="삭제"
                        aria-label="삭제"
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">아직 작성한 50자 평이 없습니다.</div>
          )}
        </section>

        <section>
          <SectionHeader emoji="📥" title="내 등록 앨범" count={myRequestList.length} />
          {myRequests.isLoading ? (
            <div className="text-sm text-gray-500">불러오는 중…</div>
          ) : myRequestList.length > 0 ? (
            // Match the 50자 평 panel's height cap so the two columns
            // stay visually balanced once a heavy registrant racks up
            // dozens of submissions. The list scrolls independently
            // instead of stretching the whole row.
            <div className="max-h-[480px] overflow-y-auto pr-1">
              <ul className="space-y-2">
              {myRequestList.map((r) => {
                const meta = REQUEST_STATUS_META[r.status];
                return (
                  <li key={r.id}>
                    <div className="flex items-center gap-3 p-3 bg-panel rounded-xl border border-white/5 hover:brightness-110 transition">
                      <Link
                        to={`/album/${r.mbid}`}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <div className="shrink-0 w-12 h-12 bg-panel-hover rounded-md overflow-hidden">
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
                      </Link>
                      {/* Retract-own-submission shortcut, available
                          only while server's canDelete flag is true
                          (no foreign engagement yet). Hidden rather
                          than disabled when unavailable — a grayed
                          trash chip next to other people's content
                          would read as "you can no longer remove
                          this community's work", which is a louder
                          message than the case deserves. */}
                      {r.canDelete && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (deleteMyAlbum.isPending) return;
                            if (
                              !confirm(
                                `"${r.artist} — ${r.title}" 앨범 등록을 취소할까요?\n되돌릴 수 없어요.`
                              )
                            )
                              return;
                            try {
                              await deleteMyAlbum.mutateAsync(r.mbid);
                            } catch (err: any) {
                              alert(
                                err?.response?.data?.error || '삭제에 실패했어요.'
                              );
                            }
                          }}
                          disabled={deleteMyAlbum.isPending}
                          aria-label="등록 취소"
                          title="등록 취소 (리뷰·투표 등이 없을 때만 가능)"
                          className="shrink-0 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              </ul>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              아직 등록한 앨범이 없습니다. 상단 + 버튼으로 등록해보세요.
            </div>
          )}
        </section>
      </div>

      {/* ─── Vote lists — which albums fed the 굿굿 / 별루 counts.
          Equal-width 2-col on lg+ so the two histories read as a
          paired set; stacks on mobile. The activity card above
          shows totals, this row shows the actual albums those
          totals came from. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <SectionHeader emoji="👍" title="내 굿굿" count={myUpvotes.length} />
          <VotedAlbumList
            albums={myUpvotes}
            emptyText="아직 굿굿을 남긴 앨범이 없습니다."
            isLoading={upvotes.isLoading}
          />
        </section>
        <section>
          <SectionHeader emoji="👎" title="내 별루" count={myDownvotes.length} />
          <VotedAlbumList
            albums={myDownvotes}
            emptyText="아직 별루를 남긴 앨범이 없습니다."
            isLoading={downvotes.isLoading}
          />
        </section>
      </div>

      <section className="pt-6 border-t border-white/5 flex justify-end">
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
