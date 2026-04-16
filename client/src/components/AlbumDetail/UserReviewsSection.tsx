import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useUserReviews,
  useUpsertUserReview,
  useDeleteUserReview,
  type UserReview,
} from '../../hooks/useUserReviews';

const MAX_CHARS = 50;
const MIN_CHARS = 5;
const ROTATE_INTERVAL_MS = 6000;
const REVIEWS_PER_PAGE = 3;

// All-face emotion palette arranged as a gradient from most positive on
// the left to meltdown on the right, with 쏘쏘 (neutral) in the middle.
//   row 1 (positive → mild):  🥰 😂 😎 😊 😌 🙂
//   row 2 (neutral → meltdown): 😐 🥲 🥹 😭 🤯 🫠
const EMOJI_PALETTE = [
  '🥰', '😂', '😎', '😊', '😌', '🙂',
  '😐', '🥲', '🥹', '😭', '🤯', '🫠',
];

function countNonWhitespace(s: string): number {
  return s.replace(/\s/g, '').length;
}

function flattenBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function Avatar({ src, name, size = 52 }: { src: string | null; name: string | null; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name || ''}
        className="rounded-full object-cover shrink-0 border border-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center shrink-0 border border-white/10 font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}

const RATING_META: Record<'up' | 'down' | 'soso', { emoji: string; label: string }> = {
  up: { emoji: '👍', label: '굿굿' },
  down: { emoji: '👎', label: '별루' },
  soso: { emoji: '🤷', label: '쏘쏘' },
};
const RATING_ORDER: Array<'up' | 'soso' | 'down'> = ['up', 'soso', 'down'];

function SpeechBubble({
  review,
  canAdminDelete,
  canOwnerEdit,
  onEdit,
  onDelete,
}: {
  review: UserReview;
  canAdminDelete: boolean;
  canOwnerEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ratingMeta = review.rating ? RATING_META[review.rating] : null;
  const hasBadges = !!(ratingMeta || review.emoji);
  return (
    <div className="relative group h-full">
      {/* Floating badges at the top-right: rating (굿굿/쏘쏘/별루) on the
          left, feeling emoji on the right. Sit above the card's top edge. */}
      {hasBadges && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1.5 pointer-events-none select-none">
          {ratingMeta && (
            <span
              className="text-lg leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
              title={ratingMeta.label}
              aria-label={ratingMeta.label}
            >
              {ratingMeta.emoji}
            </span>
          )}
          {review.emoji && (
            <span
              className="text-xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
              aria-hidden="true"
            >
              {review.emoji}
            </span>
          )}
        </div>
      )}

      <div className="bg-[#1d140a] border border-[#e8a020]/15 rounded-2xl px-4 py-3.5 h-full flex flex-col min-w-0">
        {/* body — expands to fill the card so the footer stays pinned */}
        <p className="text-gray-100 text-[15px] leading-relaxed break-words flex-1">
          {review.body}
        </p>

        {/* footer — avatar + name anchored to the bottom so cards in a row
            visually align even with uneven body lengths */}
        <div className="flex items-center gap-2.5 min-w-0 mt-3 pt-2.5 border-t border-white/5">
          <Avatar src={review.userAvatar} name={review.userName} size={36} />
          <span className="text-sm text-gray-300 truncate">
            {review.userName || '익명'}
          </span>
        </div>

        {(canOwnerEdit || canAdminDelete) && (
          <div className="absolute bottom-1.5 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canOwnerEdit && (
              <button
                onClick={onEdit}
                title="수정"
                aria-label="수정"
                className="text-xs text-gray-500 hover:text-[#e8a020] px-1 cursor-pointer"
              >
                ✏️
              </button>
            )}
            <button
              onClick={onDelete}
              title="삭제"
              aria-label="삭제"
              className="text-xs text-gray-500 hover:text-red-400 px-1 cursor-pointer"
            >
              🗑️
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddReviewCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-2 bg-[#1d140a]/30 hover:bg-[#1d140a]/70 border border-dashed border-[#e8a020]/40 hover:border-[#e8a020]/80 rounded-2xl p-4 h-full min-h-[140px] transition-all cursor-pointer"
    >
      <span className="text-3xl group-hover:scale-110 transition-transform" aria-hidden>✍️</span>
      <span className="text-sm font-medium text-[#e8a020] group-hover:text-[#f0b040]">
        50자 평 남기기
      </span>
    </button>
  );
}

type EditorStep = 'rating' | 'text' | 'emoji';
const STEP_ORDER: EditorStep[] = ['rating', 'text', 'emoji'];

function Editor({
  initialBody,
  initialEmoji,
  initialRating,
  saving,
  onCancel,
  onSave,
}: {
  initialBody: string;
  initialEmoji: string | null;
  initialRating: 'up' | 'down' | 'soso' | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: string, emoji: string | null, rating: 'up' | 'down' | 'soso') => void;
}) {
  const [rating, setRating] = useState<'up' | 'down' | 'soso' | null>(initialRating);
  const [body, setBody] = useState(initialBody);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);
  const [step, setStep] = useState<EditorStep>('rating');

  const count = countNonWhitespace(body);
  const over = count > MAX_CHARS;
  const tooShort = count < MIN_CHARS;

  const selectRating = (r: 'up' | 'down' | 'soso') => {
    if (saving) return;
    setRating(r);
    setStep('text');
  };

  const goToEmoji = () => {
    if (saving || tooShort || over || !rating) return;
    setStep('emoji');
  };

  const selectEmoji = (chosen: string) => {
    if (saving || !rating || tooShort || over) return;
    setEmoji(chosen);
    onSave(flattenBody(body), chosen, rating);
  };

  const goBack = () => {
    if (saving) return;
    setStep(step === 'emoji' ? 'text' : 'rating');
  };

  // Summary pills for steps already answered — shown in the header so the
  // user keeps context as they progress.
  const ratingPill = rating && step !== 'rating' && (
    <button
      type="button"
      onClick={() => !saving && setStep('rating')}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] cursor-pointer transition-colors ${
        rating === 'up'
          ? 'bg-[#e8a020]/15 text-[#e8a020] border border-[#e8a020]/30 hover:bg-[#e8a020]/25'
          : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10'
      }`}
      title="수정하려면 클릭"
    >
      <span aria-hidden>{RATING_META[rating].emoji}</span>
      <span>{RATING_META[rating].label}</span>
    </button>
  );

  const bodyPill = body && step === 'emoji' && (
    <button
      type="button"
      onClick={() => !saving && setStep('text')}
      className="text-[10px] text-gray-300 bg-white/5 border border-white/10 rounded-full px-1.5 py-0.5 max-w-[140px] truncate cursor-pointer hover:bg-white/10"
      title="수정하려면 클릭"
    >
      “{body}”
    </button>
  );

  const progress = (
    <div className="flex items-center gap-1 shrink-0" aria-hidden>
      {STEP_ORDER.map((s) => {
        const current = s === step;
        const passed = STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(s);
        return (
          <span
            key={s}
            className={`h-1 rounded-full transition-all ${
              current ? 'w-3 bg-[#e8a020]' : passed ? 'w-1.5 bg-[#e8a020]/50' : 'w-1.5 bg-white/15'
            }`}
          />
        );
      })}
    </div>
  );

  const cancelButton = (
    <button
      onClick={onCancel}
      disabled={saving}
      className="text-[10px] text-gray-500 hover:text-white px-1.5 py-1 disabled:opacity-40 cursor-pointer"
    >
      취소
    </button>
  );

  return (
    <div className="bg-[#1d140a] border border-[#e8a020]/40 rounded-2xl p-3 h-full flex flex-col gap-2 min-h-[180px]">
      {/* Header: summary on left, progress on right */}
      <div className="flex items-center justify-between gap-2 min-h-[16px]">
        <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
          {ratingPill}
          {bodyPill}
        </div>
        {progress}
      </div>

      {/* Step content — key forces a remount so the reveal feels fresh */}
      <div key={step} className="animate-[fadeInUp_200ms_ease-out] flex-1 flex flex-col gap-2">
        {step === 'rating' && (
          <>
            <div className="font-serif italic text-sm text-gray-100 leading-snug text-center pt-1">
              “이 앨범 어땠어요?”
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {RATING_ORDER.map((r) => {
                const selected = rating === r;
                const selectedStyle =
                  r === 'up'
                    ? 'bg-[#e8a020]/20 border-[#e8a020]/60 text-[#e8a020]'
                    : r === 'down'
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-white/10 border-white/25 text-gray-100';
                const { emoji: rEmoji, label } = RATING_META[r];
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => selectRating(r)}
                    disabled={saving}
                    aria-pressed={selected}
                    aria-label={label}
                    className={`aspect-square w-full flex flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border ${
                      selected
                        ? selectedStyle
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <span className="text-2xl md:text-3xl leading-none" aria-hidden>
                      {rEmoji}
                    </span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-auto">{cancelButton}</div>
          </>
        )}

        {step === 'text' && (
          <>
            <div className="font-serif italic text-sm text-gray-100 leading-snug text-center pt-1">
              “하고 싶은 말?”
            </div>
            <textarea
              autoFocus
              value={body}
              onChange={(e) => {
                const next = e.target.value;
                if (countNonWhitespace(next) > MAX_CHARS) return;
                setBody(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !tooShort && !over && !saving) {
                  e.preventDefault();
                  goToEmoji();
                }
              }}
              placeholder={`공백 제외 ${MIN_CHARS}~${MAX_CHARS}자`}
              rows={3}
              disabled={saving}
              className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-100 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
            />
            <div className="flex items-center justify-between gap-1 text-[10px] mt-auto">
              <span
                className={`tabular-nums shrink-0 ${
                  over ? 'text-red-400' : tooShort ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {count}/{MAX_CHARS}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                {cancelButton}
                <button
                  onClick={goBack}
                  disabled={saving}
                  className="text-gray-400 hover:text-white px-1.5 py-1 disabled:opacity-40 cursor-pointer"
                  title="뒤로"
                >
                  ←
                </button>
                <button
                  onClick={goToEmoji}
                  disabled={saving || tooShort || over}
                  title={tooShort ? `최소 ${MIN_CHARS}자 이상 써주세요` : undefined}
                  className="bg-[#e8a020] text-black hover:bg-[#f0b040] rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'emoji' && (
          <>
            <div className="font-serif italic text-sm text-gray-100 leading-snug text-center pt-1">
              “들었을 때 기분!”
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {EMOJI_PALETTE.map((e) => {
                const selected = emoji === e;
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => selectEmoji(e)}
                    disabled={saving}
                    aria-pressed={selected}
                    aria-label={e}
                    className={`aspect-square w-full rounded-lg flex items-center justify-center text-xl md:text-2xl leading-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 scale-110'
                        : 'bg-white/5 border border-transparent hover:bg-white/10 hover:scale-110'
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-0.5 text-[10px] mt-auto">
              {saving && <span className="text-gray-500 mr-auto">등록 중…</span>}
              {cancelButton}
              <button
                onClick={goBack}
                disabled={saving}
                className="text-gray-400 hover:text-white px-1.5 py-1 disabled:opacity-40 cursor-pointer"
                title="뒤로"
              >
                ←
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type GridItem =
  | { kind: 'review'; review: UserReview }
  | { kind: 'add' }
  | { kind: 'editor' };

export default function UserReviewsSection({
  albumId,
  userAlbumVote,
}: {
  albumId: string;
  userAlbumVote?: 'up' | 'down' | null;
}) {
  const { user } = useAuth();
  const { data } = useUserReviews(albumId);
  const upsert = useUpsertUserReview(albumId);
  const del = useDeleteUserReview(albumId);

  const reviews = useMemo(() => data?.userReviews || [], [data]);
  const myReview = useMemo(
    () => (user ? reviews.find((r) => r.userId === user.id) : undefined),
    [reviews, user]
  );

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);

  // Compose the grid items. The "add" card or inline editor is treated as
  // an additional virtual item so paging accounts for it naturally.
  const items = useMemo<GridItem[]>(() => {
    const list: GridItem[] = reviews.map((r) => ({ kind: 'review' as const, review: r }));
    if (editing) {
      if (myReview) {
        const idx = list.findIndex((i) => i.kind === 'review' && i.review.id === myReview.id);
        if (idx >= 0) list[idx] = { kind: 'editor' };
        else list.push({ kind: 'editor' });
      } else {
        list.push({ kind: 'editor' });
      }
    } else if (user && !myReview) {
      list.push({ kind: 'add' });
    }
    return list;
  }, [reviews, myReview, editing, user]);

  const pageCount = Math.max(1, Math.ceil(items.length / REVIEWS_PER_PAGE));

  useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [pageCount, page]);

  useEffect(() => {
    if (pageCount < 2 || paused || editing) return;
    const t = setInterval(() => {
      setPage((p) => (p + 1) % pageCount);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [pageCount, paused, editing]);

  // When the editor opens, jump to whichever page contains it so the user
  // doesn't have to hunt for it across paged carousels.
  useEffect(() => {
    if (!editing) return;
    if (myReview) {
      const idx = reviews.findIndex((r) => r.id === myReview.id);
      if (idx >= 0) setPage(Math.floor(idx / REVIEWS_PER_PAGE));
    } else {
      setPage(Math.floor(reviews.length / REVIEWS_PER_PAGE));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const visibleItems = items.slice(page * REVIEWS_PER_PAGE, (page + 1) * REVIEWS_PER_PAGE);

  const handleSave = async (body: string, emoji: string | null, rating: 'up' | 'down' | 'soso') => {
    if (!body) return;
    try {
      await upsert.mutateAsync({ body, emoji, rating });
      setEditing(false);
    } catch (err: any) {
      const detail = err?.response?.data?.error;
      alert(detail || '저장에 실패했습니다.');
    }
  };

  const handleDelete = async (review: UserReview) => {
    if (!confirm('이 50자 평을 삭제할까요?')) return;
    try {
      await del.mutateAsync(review.id);
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const heading = (
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="text-xl md:text-2xl font-serif text-white">
        고객 50자 평
        {reviews.length > 0 && (
          <span className="ml-2 text-sm text-gray-500 font-sans">{reviews.length}</span>
        )}
      </h2>
    </div>
  );

  // Empty + not-logged-in: keep the simple prompt to log in.
  if (items.length === 0) {
    return (
      <section>
        {heading}
        <div className="bg-[#1d140a]/60 border border-dashed border-[#e8a020]/20 rounded-2xl px-5 py-8 text-center text-gray-500 text-sm">
          로그인 후 50자 평을 남길 수 있습니다.
        </div>
      </section>
    );
  }

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {heading}
      {/* Up to 3 cards per row (stacks on mobile). The trailing slot holds
          either the "add review" card or the inline editor. */}
      <div
        key={page}
        className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch animate-[fadeInUp_200ms_ease-out]"
      >
        {visibleItems.map((item, i) => {
          if (item.kind === 'review') {
            const r = item.review;
            const isMine = user?.id === r.userId;
            return (
              <SpeechBubble
                key={`r-${r.id}`}
                review={r}
                canAdminDelete={!!user?.isAdmin && !isMine}
                canOwnerEdit={isMine}
                onEdit={() => setEditing(true)}
                onDelete={() => handleDelete(r)}
              />
            );
          }
          if (item.kind === 'add') {
            return <AddReviewCard key="add" onClick={() => setEditing(true)} />;
          }
          return (
            <Editor
              key={`editor-${i}`}
              initialBody={myReview?.body || ''}
              initialEmoji={myReview?.emoji || null}
              // Prefer the rating stored on the review; otherwise fall back
              // to the user's existing album vote so writing a review
              // pre-selects what they already picked via the 굿굿/별루 buttons.
              initialRating={myReview?.rating || userAlbumVote || null}
              saving={upsert.isPending}
              onCancel={() => setEditing(false)}
              onSave={handleSave}
            />
          );
        })}
      </div>
      {pageCount > 1 && (
        <div className="flex justify-center gap-1.5 mt-4">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`${i + 1}번째 페이지로 이동`}
              className={`w-1.5 h-1.5 rounded-full transition-colors cursor-pointer ${
                i === page ? 'bg-[#e8a020]' : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
