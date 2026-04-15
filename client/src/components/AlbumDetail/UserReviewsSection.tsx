import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useUserReviews,
  useUpsertUserReview,
  useDeleteUserReview,
  type UserReview,
} from '../../hooks/useUserReviews';

const MAX_CHARS = 50;
const ROTATE_INTERVAL_MS = 6000;

// All-face emotion palette — spans laughter → love → chill → warmth →
// content → bittersweet → touched → sob → shock → overwhelm.
const EMOJI_PALETTE = [
  '😂', '🥰', '😎', '😊', '😌',
  '🥲', '🥹', '😭', '🤯', '🫠',
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
  const isUp = review.rating === 'up';
  const hasRating = review.rating === 'up' || review.rating === 'down';
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0 w-[108px]">
        <Avatar src={review.userAvatar} name={review.userName} />
        <span className="text-[11px] text-gray-400 text-center max-w-full truncate">
          {review.userName || '익명'}
        </span>
      </div>
      <div className="relative group flex-1 min-w-0 pt-3">
        {/* w-fit makes the bubble hug its content; max-w-full caps at available space */}
        <div className="relative inline-block w-fit max-w-full bg-[#1d140a] border border-[#e8a020]/15 rounded-2xl rounded-tl-sm px-4 py-3 md:px-5 md:py-3.5">
          {/* tail */}
          <span className="absolute left-[-8px] top-5 w-0 h-0 border-y-[8px] border-y-transparent border-r-[8px] border-r-[#1d140a]" />

          {/* Floating badges at the top-right of the bubble: rating (굿굿/별루)
              on the left, emoji on the right. */}
          {(hasRating || review.emoji) && (
            <div className="absolute -top-3 -right-2 flex items-center gap-1.5 pointer-events-none select-none">
              {hasRating && (
                <span
                  className={`text-xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)] ${
                    isUp ? '' : 'opacity-90'
                  }`}
                  title={isUp ? '굿굿' : '별루'}
                  aria-label={isUp ? '굿굿' : '별루'}
                >
                  {isUp ? '👍' : '👎'}
                </span>
              )}
              {review.emoji && (
                <span
                  className="text-2xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
                  aria-hidden="true"
                >
                  {review.emoji}
                </span>
              )}
            </div>
          )}

          <p className="text-gray-100 text-[15px] leading-relaxed break-words">
            {review.body}
          </p>

          {/* hover action row, bottom-right so it doesn't collide with badges */}
          {(canOwnerEdit || canAdminDelete) && (
            <div className="absolute bottom-1 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
    </div>
  );
}

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
  initialRating: 'up' | 'down' | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: string, emoji: string | null, rating: 'up' | 'down') => void;
}) {
  const [value, setValue] = useState(initialBody);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);
  const [rating, setRating] = useState<'up' | 'down' | null>(initialRating);
  const count = countNonWhitespace(value);
  const over = count > MAX_CHARS;
  const empty = value.trim().length === 0;

  const missing = !rating
    ? '굿굿/별루'
    : empty
      ? '한 줄 감상'
      : !emoji
        ? '감정 이모지'
        : null;
  const canSave = !saving && !over && !missing;

  const thumbButton = (target: 'up' | 'down') => {
    const selected = rating === target;
    const isUp = target === 'up';
    return (
      <button
        type="button"
        onClick={() => setRating(target)}
        disabled={saving}
        aria-pressed={selected}
        aria-label={isUp ? '굿굿' : '별루'}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          selected
            ? isUp
              ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 text-[#e8a020]'
              : 'bg-white/10 border border-white/30 text-white'
            : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10 hover:text-gray-200'
        }`}
      >
        <span aria-hidden>{isUp ? '👍' : '👎'}</span>
        <span>{isUp ? '굿굿' : '별루'}</span>
      </button>
    );
  };

  return (
    <div className="bg-[#1d140a] border border-[#e8a020]/20 rounded-2xl p-4 md:p-5 space-y-3">
      {/* Rating row — inline label + compact pill toggles */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-400 shrink-0">이 앨범 어땠어요?</span>
        <div className="flex gap-1.5">
          {thumbButton('up')}
          {thumbButton('down')}
        </div>
      </div>

      {/* Main input — the focus of the card */}
      <textarea
        autoFocus
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          // Hard-stop at MAX_CHARS non-whitespace — don't let the user type
          // past the limit at all. Deletes stay free because they never grow
          // the count.
          if (countNonWhitespace(next) > MAX_CHARS) return;
          setValue(next);
        }}
        placeholder="한 줄 감상을 적어주세요"
        rows={2}
        disabled={saving}
        className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-3 py-2.5 text-[15px] text-gray-100 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
      />

      {/* Emoji row — inline mini-label + compact chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 shrink-0">기분</span>
        <div className="flex flex-wrap gap-1">
          {EMOJI_PALETTE.map((e) => {
            const selected = emoji === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(selected ? null : e)}
                disabled={saving}
                aria-pressed={selected}
                aria-label={e}
                className={`w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-xl leading-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  selected
                    ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 scale-110'
                    : 'bg-white/5 border border-transparent hover:bg-white/10'
                }`}
              >
                {e}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer — counter + hint + actions, all in one row */}
      <div className="flex items-center justify-between gap-3 pt-1 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`tabular-nums shrink-0 ${over ? 'text-red-400' : 'text-gray-500'}`}>
            {count}/{MAX_CHARS}
          </span>
          {missing && (
            <span className="text-gray-500 truncate">{missing} 선택해주세요</span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-gray-400 hover:text-white px-3 py-1 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={() => rating && emoji && onSave(flattenBody(value), emoji, rating)}
            disabled={!canSave}
            title={missing ? `${missing} 선택해주세요` : undefined}
            className="bg-[#e8a020] text-black hover:bg-[#f0b040] rounded-md px-4 py-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (reviews.length === 0) setIndex(0);
    else if (index >= reviews.length) setIndex(0);
  }, [reviews.length, index]);

  useEffect(() => {
    if (reviews.length < 2 || paused || editing) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % reviews.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [reviews.length, paused, editing]);

  const handleSave = async (body: string, emoji: string | null, rating: 'up' | 'down') => {
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
      {user && !editing && !myReview && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs md:text-sm text-[#e8a020] hover:text-white border border-[#e8a020]/40 hover:border-white/40 rounded-full px-3 py-1 transition-colors cursor-pointer"
        >
          50자 평 남기기
        </button>
      )}
    </div>
  );

  if (editing) {
    return (
      <section>
        {heading}
        <Editor
          initialBody={myReview?.body || ''}
          initialEmoji={myReview?.emoji || null}
          // Prefer the rating stored on the review; otherwise fall back to the
          // user's existing album vote so writing a review pre-selects what
          // they already picked via the 굿굿/별루 buttons.
          initialRating={myReview?.rating || userAlbumVote || null}
          saving={upsert.isPending}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
        />
      </section>
    );
  }

  if (reviews.length === 0) {
    return (
      <section>
        {heading}
        <div className="bg-[#1d140a]/60 border border-dashed border-[#e8a020]/20 rounded-2xl px-5 py-8 text-center text-gray-500 text-sm">
          {user ? (
            <>첫 번째 50자 평을 남겨보세요.</>
          ) : (
            <>로그인 후 50자 평을 남길 수 있습니다.</>
          )}
        </div>
      </section>
    );
  }

  const current = reviews[Math.min(index, reviews.length - 1)];
  const isMine = user?.id === current.userId;

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {heading}
      <SpeechBubble
        review={current}
        canAdminDelete={!!user?.isAdmin && !isMine}
        canOwnerEdit={isMine}
        onEdit={() => setEditing(true)}
        onDelete={() => handleDelete(current)}
      />
      {reviews.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-4">
          {reviews.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setIndex(i)}
              aria-label={`${i + 1}번째 평으로 이동`}
              className={`w-1.5 h-1.5 rounded-full transition-colors cursor-pointer ${
                i === index ? 'bg-[#e8a020]' : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
