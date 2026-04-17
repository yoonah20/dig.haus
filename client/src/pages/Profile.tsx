import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CoverArt from '../components/CoverArt';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  useMyProfile,
  useMyReviews,
  useUpdateMyProfile,
  useUploadMyAvatar,
  useResetMyAvatar,
  useDeleteMyReview,
  useDeleteMyAccount,
} from '../hooks/useMe';
import { useMyAlbumRequests } from '../hooks/useAlbumRequests';
import { useMyCollection, useMyWantlist } from '../hooks/useOwnership';

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

// Shared grid layout for the 샀음 / 살거 sections. Mirrors the
// existing 굿굿한 앨범들 grid (4/row mobile, 5/row desktop, square
// cover tiles linking to the album page). Adds per-tile format
// badges so a collector can see at a glance which copies of an album
// they have (e.g. "🖤📼" = vinyl + cassette).
const FORMAT_BADGE_EMOJI: Record<'Vinyl' | 'CD' | 'Cassette', string> = {
  Vinyl: '🖤',
  CD: '💿',
  Cassette: '📼',
};

// Covers visible before the "더 보기" toggle expands the grid. Picked
// so desktop (8 cols) shows two full rows and mobile (4 cols) shows
// four — enough to feel substantial without dominating the page once
// a collector's library grows.
const COLLECTION_INITIAL_LIMIT = 16;

function CollectionGrid({
  title,
  emoji,
  loading,
  items,
  emptyMessage,
  accentRing,
}: {
  title: string;
  emoji: string;
  loading: boolean;
  items: Array<{
    slug: string;
    title: string;
    artist: string;
    coverArtUrl: string | null;
    coverArtFallbacks?: string[];
    formats?: Array<'Vinyl' | 'CD' | 'Cassette'>;
  }>;
  emptyMessage: string;
  /** Tailwind classname for hover ring — each grid picks a different
   *  accent so scanning back-to-back rows stays oriented. */
  accentRing: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = items.length > COLLECTION_INITIAL_LIMIT;
  const visible = expanded || !canCollapse ? items : items.slice(0, COLLECTION_INITIAL_LIMIT);
  const hiddenCount = items.length - COLLECTION_INITIAL_LIMIT;

  return (
    <section>
      <SectionHeader emoji={emoji} title={title} count={items.length} />
      {loading ? (
        <div className="text-sm text-gray-500">불러오는 중…</div>
      ) : items.length > 0 ? (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {visible.map((a) => {
              const formats = a.formats ?? [];
              return (
                <Link
                  key={a.slug}
                  to={`/album/${a.slug}`}
                  className={`relative aspect-square rounded-md overflow-hidden bg-[#1a1a1a] hover:ring-2 transition-all ${accentRing}`}
                  title={`${a.title} — ${a.artist}${formats.length > 0 ? ` (${formats.join(' · ')})` : ''}`}
                >
                  <CoverArt
                    src={a.coverArtUrl}
                    fallbacks={a.coverArtFallbacks}
                    alt={a.title}
                    className="w-full h-full object-cover"
                  />
                  {formats.length > 0 && (
                    <div
                      className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1 rounded-sm bg-black/55 text-[11px] leading-none"
                      aria-hidden
                    >
                      {formats.map((f) => (
                        <span key={f}>{FORMAT_BADGE_EMOJI[f]}</span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          {canCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-xs text-gray-500 hover:text-[#e8a020] cursor-pointer"
            >
              {expanded ? '접기' : `+${hiddenCount}개 더 보기`}
            </button>
          )}
        </>
      ) : (
        <div className="text-sm text-gray-500">{emptyMessage}</div>
      )}
    </section>
  );
}

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

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'blue' | 'red';
}) {
  const valueClass =
    accent === 'brand'
      ? 'text-[#e8a020]'
      : accent === 'blue'
        ? 'text-[#88a2bf]'
        : accent === 'red'
          ? 'text-[#c08888]'
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
        <div className="w-20 h-20 rounded-full bg-[#2a1f10] border border-white/10 shrink-0" />
      )}
      <div className="flex flex-col gap-2 items-start min-w-0">
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
          className="px-3 py-1.5 text-sm rounded-md border border-[#e8a020]/50 text-[#e8a020] hover:bg-[#e8a020] hover:text-black disabled:opacity-40 transition-colors cursor-pointer text-left"
        >
          {uploading ? '업로드 중…' : '새 아바타 올리기'}
        </button>
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
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 items-center text-sm max-w-lg">
      <label className="text-gray-400">표시 이름</label>
      <input
        type="text"
        value={name}
        maxLength={DISPLAY_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="비우면 Google 이름"
        className="w-full min-w-0 bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-[#e8a020] focus:outline-none"
      />
      <label className="text-gray-400">Instagram</label>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-gray-500 shrink-0">@</span>
        <input
          type="text"
          value={ig}
          maxLength={INSTAGRAM_MAX}
          onChange={(e) => setIg(e.target.value.replace(/^@+/, ''))}
          placeholder="yourhandle (선택)"
          className="flex-1 min-w-0 bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-[#e8a020] focus:outline-none"
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
  const myRequests = useMyAlbumRequests();
  const collection = useMyCollection();
  const wantlist = useMyWantlist();
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
  const myRequestList = myRequests.data?.requests ?? [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8 space-y-10">
      <h1 className="text-3xl font-bold text-white font-serif">🧑‍🎤 내 프로필</h1>

      {profile.isError && (
        <div className="text-red-400 text-sm">프로필을 불러오지 못했습니다.</div>
      )}

      {/* ─── Hero: identity + stats in one full-width card ─────────
          Avatar on the left, name/email/join + editable fields in
          the middle, stat pills anchored to the right. Collapses to
          a vertical stack below md so the stat row doesn't crowd
          the form on phones. */}
      {me && (
        <section className="bg-[#1a1a1a] rounded-2xl p-4 sm:p-6 border border-white/5">
          <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
            <div className="flex-1 min-w-0 space-y-5">
              <AvatarEditor
                avatarUrl={effectiveAvatar}
                isCustom={isCustomAvatar}
                onUpload={handleUpload}
                onReset={handleReset}
                uploading={upload.isPending}
                resetting={reset.isPending}
              />
              {/* flex-wrap + gap-y lets a long email drop to its own
                  line instead of pushing past the card's right edge on
                  narrow phones. break-all on the email itself is a
                  second-line defence for addresses with no natural
                  break points. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-400 min-w-0">
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

            {stats && (
              <div className="lg:w-56 lg:shrink-0 lg:border-l lg:border-white/5 lg:pl-6 grid grid-cols-3 lg:grid-cols-1 gap-2">
                <StatPill label="50자 평" value={stats.reviewCount} />
                <StatPill label="굿굿" value={stats.upvoteCount} accent="blue" />
                <StatPill label="별루" value={stats.downvoteCount} accent="red" />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Collections — 샀음 / 살거 are the page's record-crate moment.
          굿굿한 앨범 intentionally isn't a separate grid — the total
          is still surfaced in the hero stat pill; a long "I like this"
          list added noise without adding signal. */}
      <CollectionGrid
        title="샀음"
        emoji="💿"
        loading={collection.isLoading}
        items={collection.data?.items ?? []}
        emptyMessage="아직 소장 표시한 앨범이 없습니다."
        accentRing="hover:ring-[#e8a020]/55"
      />

      <CollectionGrid
        title="살거"
        emoji="🎯"
        loading={wantlist.isLoading}
        items={wantlist.data?.items ?? []}
        emptyMessage="아직 위시리스트에 추가한 앨범이 없습니다."
        accentRing="hover:ring-[#8f7cb3]/60"
      />

      {/* ─── Activity: 50자 평 + registered albums side-by-side.
          Reviews carry body text and so benefit from more width on
          the left; the register list is narrower by design. Both
          collapse to a single column on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] gap-8">
        <section>
          <SectionHeader emoji="💬" title="내 50자 평" count={myReviews.length} />
          {reviews.isLoading ? (
            <div className="text-sm text-gray-500">불러오는 중…</div>
          ) : myReviews.length > 0 ? (
            <ul className="space-y-3">
              {myReviews.map((r) => {
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
                        className="text-sm text-gray-300 hover:text-[#e8a020] transition-colors block truncate"
                        title={`${r.albumTitle} — ${r.albumArtist ?? ''}`}
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
                        <span className="ml-auto tabular-nums">
                          {r.updatedAt?.slice(0, 10)}
                        </span>
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

        <section>
          <SectionHeader emoji="📥" title="내 등록 앨범" count={myRequestList.length} />
          {myRequests.isLoading ? (
            <div className="text-sm text-gray-500">불러오는 중…</div>
          ) : myRequestList.length > 0 ? (
            <ul className="space-y-2">
              {myRequestList.map((r) => {
                const meta = REQUEST_STATUS_META[r.status];
                return (
                  <li key={r.id}>
                    <Link
                      to={`/album/${r.mbid}`}
                      className="block hover:brightness-110 transition"
                    >
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
