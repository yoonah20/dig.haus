import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useUserReviews,
  useUpsertUserReview,
  useDeleteUserReview,
  type UserReview,
} from '../../hooks/useUserReviews';

const MAX_CHARS = 100;
const ROTATE_INTERVAL_MS = 6000;

function countNonWhitespace(s: string): number {
  return s.replace(/\s/g, '').length;
}

function flattenBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function Avatar({ src, name, size = 56 }: { src: string | null; name: string | null; size?: number }) {
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
    <div className="flex items-start gap-3 md:gap-4">
      <div className="flex flex-col items-center gap-1 pt-1 w-14 md:w-16">
        <Avatar src={review.userAvatar} name={review.userName} />
        <span className="text-[11px] text-gray-400 truncate max-w-[72px] text-center">
          {review.userName || '익명'}
        </span>
      </div>
      <div className="relative flex-1 min-w-0 group">
        {/* tail */}
        <span className="absolute left-[-8px] top-5 w-0 h-0 border-y-[8px] border-y-transparent border-r-[8px] border-r-[#1d140a]" />
        <div className="bg-[#1d140a] border border-[#e8a020]/15 rounded-2xl rounded-tl-sm px-4 py-3 md:px-5 md:py-4">
          <p className="text-gray-100 text-[15px] leading-relaxed break-words">
            {review.body}
          </p>
        </div>
        {(canOwnerEdit || canAdminDelete) && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            {(canOwnerEdit || canAdminDelete) && (
              <button
                onClick={onDelete}
                title="삭제"
                aria-label="삭제"
                className="text-xs text-gray-500 hover:text-red-400 px-1 cursor-pointer"
              >
                🗑️
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Editor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const count = countNonWhitespace(value);
  const over = count > MAX_CHARS;
  const empty = value.trim().length === 0;

  return (
    <div className="bg-[#1d140a] border border-[#e8a020]/20 rounded-2xl p-3 md:p-4">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="이 앨범에 대한 한 줄 감상 (공백 제외 100자)"
        rows={3}
        disabled={saving}
        className="w-full bg-[#0f0a05] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
      />
      <div className="mt-2 flex items-center justify-between text-xs">
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
            onClick={() => onSave(flattenBody(value))}
            disabled={saving || over || empty}
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

  // Keep index in bounds as the list changes
  useEffect(() => {
    if (reviews.length === 0) setIndex(0);
    else if (index >= reviews.length) setIndex(0);
  }, [reviews.length, index]);

  // Auto-rotate when 2+
  useEffect(() => {
    if (reviews.length < 2 || paused || editing) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % reviews.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [reviews.length, paused, editing]);

  const handleSave = async (body: string) => {
    if (!body) return;
    try {
      await upsert.mutateAsync(body);
      setEditing(false);
    } catch (err: any) {
      const detail = err?.response?.data?.error;
      alert(detail || '저장에 실패했습니다.');
    }
  };

  const handleDelete = async (review: UserReview) => {
    if (!confirm('이 100자 평을 삭제할까요?')) return;
    try {
      await del.mutateAsync(review.id);
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const heading = (
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="text-xl md:text-2xl font-serif text-white">
        고객 100자 평
        {reviews.length > 0 && (
          <span className="ml-2 text-sm text-gray-500 font-sans">{reviews.length}</span>
        )}
      </h2>
      {user && !editing && !myReview && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs md:text-sm text-[#e8a020] hover:text-white border border-[#e8a020]/40 hover:border-white/40 rounded-full px-3 py-1 transition-colors cursor-pointer"
        >
          100자 평 남기기
        </button>
      )}
      {user && !editing && myReview && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs md:text-sm text-gray-400 hover:text-[#e8a020] cursor-pointer"
        >
          내 평 수정
        </button>
      )}
    </div>
  );

  if (editing) {
    return (
      <section>
        {heading}
        <Editor
          initial={myReview?.body || ''}
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
            <>첫 번째 100자 평을 남겨보세요.</>
          ) : (
            <>로그인 후 100자 평을 남길 수 있습니다.</>
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
