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
          <p className="text-gray-100 text-[15px] leading-relaxed break-words">
            {review.body}
          </p>
          {/* emoji badge, overlapping top-right */}
          {review.emoji && (
            <span
              className="absolute -top-3 -right-2 text-2xl select-none pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
              aria-hidden="true"
            >
              {review.emoji}
            </span>
          )}
          {/* hover action row, bottom-right so it doesn't collide with emoji badge */}
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

function EmojiPalette({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {EMOJI_PALETTE.map((emoji) => {
        const selected = value === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(selected ? null : emoji)}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${emoji} ${selected ? '선택 해제' : '선택'}`}
            className={`w-11 h-11 rounded-xl flex items-center justify-center text-[26px] leading-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              selected
                ? 'bg-[#e8a020]/20 border border-[#e8a020]/60 scale-110'
                : 'bg-white/5 border border-transparent hover:bg-white/10 hover:scale-105'
            }`}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

function Editor({
  initialBody,
  initialEmoji,
  saving,
  onCancel,
  onSave,
}: {
  initialBody: string;
  initialEmoji: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: string, emoji: string | null) => void;
}) {
  const [value, setValue] = useState(initialBody);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);
  const count = countNonWhitespace(value);
  const over = count > MAX_CHARS;
  const empty = value.trim().length === 0;

  return (
    <div className="bg-[#1d140a] border border-[#e8a020]/20 rounded-2xl p-3 md:p-4 space-y-3">
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
        placeholder="이 앨범에 대한 한 줄 감상 (공백 제외 50자)"
        rows={2}
        disabled={saving}
        className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
      />
      <div>
        <div className="text-xs text-gray-400 mb-2">들으면 어떤 기분이에요?</div>
        <EmojiPalette value={emoji} onChange={setEmoji} disabled={saving} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={over ? 'text-red-400' : 'text-gray-500'}>
          {count} / {MAX_CHARS} 공백 제외
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-gray-400 hover:text-white px-2 py-1 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={() => onSave(flattenBody(value), emoji)}
            disabled={saving || over || empty || !emoji}
            title={!emoji ? '감정 이모지를 하나 선택해주세요' : undefined}
            className="bg-[#e8a020] text-black hover:bg-[#f0b040] rounded-md px-3 py-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserReviewsSection({ albumId }: { albumId: string }) {
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

  const handleSave = async (body: string, emoji: string | null) => {
    if (!body) return;
    try {
      await upsert.mutateAsync({ body, emoji });
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
