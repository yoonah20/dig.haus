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
  initialRating: 'up' | 'down' | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: string, emoji: string | null, rating: 'up' | 'down') => void;
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(initialRating);
  const [body, setBody] = useState(initialBody);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);
  const [step, setStep] = useState<EditorStep>('rating');

  const count = countNonWhitespace(body);
  const over = count > MAX_CHARS;
  const empty = body.trim().length === 0;

  const selectRating = (r: 'up' | 'down') => {
    if (saving) return;
    setRating(r);
    setStep('text');
  };

  const goToEmoji = () => {
    if (saving || empty || over || !rating) return;
    setStep('emoji');
  };

  const selectEmoji = (chosen: string) => {
    if (saving || !rating || empty || over) return;
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer transition-colors ${
        rating === 'up'
          ? 'bg-[#e8a020]/15 text-[#e8a020] border border-[#e8a020]/30 hover:bg-[#e8a020]/25'
          : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10'
      }`}
      title="수정하려면 클릭"
    >
      <span aria-hidden>{rating === 'up' ? '👍' : '👎'}</span>
      <span>{rating === 'up' ? '굿굿' : '별루'}</span>
    </button>
  );

  const bodyPill = body && step === 'emoji' && (
    <button
      type="button"
      onClick={() => !saving && setStep('text')}
      className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded-full px-2 py-0.5 max-w-[220px] truncate cursor-pointer hover:bg-white/10"
      title="수정하려면 클릭"
    >
      “{body}”
    </button>
  );

  const progress = (
    <div className="flex items-center gap-1.5" aria-hidden>
      {STEP_ORDER.map((s) => {
        const current = s === step;
        const passed = STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(s);
        return (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all ${
              current ? 'w-6 bg-[#e8a020]' : passed ? 'w-3 bg-[#e8a020]/50' : 'w-3 bg-white/15'
            }`}
          />
        );
      })}
    </div>
  );

  return (
    <div className="bg-[#1d140a] border border-[#e8a020]/20 rounded-2xl p-4 md:p-5 space-y-4">
      {/* Header: summary on left, progress on right */}
      <div className="flex items-center justify-between gap-3 min-h-[24px]">
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          {ratingPill}
          {bodyPill}
        </div>
        {progress}
      </div>

      {/* Step content — key forces a remount so the reveal feels fresh */}
      <div key={step} className="animate-[fadeInUp_220ms_ease-out]">
        {step === 'rating' && (
          <div className="space-y-4">
            <div className="text-base md:text-lg text-gray-100 font-medium">
              이 앨범 어땠어요?
            </div>
            <div className="flex gap-2">
              {(['up', 'down'] as const).map((r) => {
                const isUp = r === 'up';
                const selected = rating === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => selectRating(r)}
                    disabled={saving}
                    aria-pressed={selected}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? isUp
                          ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 text-[#e8a020]'
                          : 'bg-white/10 border border-white/30 text-white'
                        : 'bg-white/5 border border-transparent text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="text-2xl leading-none" aria-hidden>
                      {isUp ? '👍' : '👎'}
                    </span>
                    <span>{isUp ? '굿굿' : '별루'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'text' && (
          <div className="space-y-3">
            <div className="text-base md:text-lg text-gray-100 font-medium">
              한 줄로 들려주세요
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
                if (e.key === 'Enter' && !e.shiftKey && !empty && !over && !saving) {
                  e.preventDefault();
                  goToEmoji();
                }
              }}
              placeholder="공백 제외 50자까지"
              rows={3}
              disabled={saving}
              className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-3 py-2.5 text-[15px] text-gray-100 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
            />
            <div className="flex items-center justify-between text-xs">
              <span className={`tabular-nums ${over ? 'text-red-400' : 'text-gray-500'}`}>
                {count}/{MAX_CHARS}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={goBack}
                  disabled={saving}
                  className="text-gray-400 hover:text-white px-3 py-1 disabled:opacity-40 cursor-pointer"
                >
                  ← 뒤로
                </button>
                <button
                  onClick={goToEmoji}
                  disabled={saving || empty || over}
                  className="bg-[#e8a020] text-black hover:bg-[#f0b040] rounded-md px-4 py-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'emoji' && (
          <div className="space-y-3">
            <div>
              <div className="text-base md:text-lg text-gray-100 font-medium">
                들으면 어떤 기분이에요?
              </div>
              <div className="text-xs text-gray-500 mt-1">
                이모지를 고르면 바로 등록돼요
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
                    className={`w-11 h-11 rounded-xl flex items-center justify-center text-[26px] leading-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 scale-110'
                        : 'bg-white/5 border border-transparent hover:bg-white/10 hover:scale-105'
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">
                {saving ? '등록 중…' : '\u00a0'}
              </span>
              <button
                onClick={goBack}
                disabled={saving}
                className="text-gray-400 hover:text-white px-3 py-1 disabled:opacity-40 cursor-pointer"
              >
                ← 뒤로
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel — subtle, always reachable */}
      <div className="flex justify-end pt-1">
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-xs text-gray-500 hover:text-white px-2 py-1 disabled:opacity-40 cursor-pointer"
        >
          취소
        </button>
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
