import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useUserReviews,
  useUpsertUserReview,
  useDeleteUserReview,
  type UserReview,
} from '../../hooks/useUserReviews';
import { resolveApiUrl } from '../../utils/apiUrl';
import UserHoverCard from '../UserHoverCard';
import CardOverlayButton from '../CardOverlayButton';
import { SectionTitle, Button } from '../ui';

const MAX_CHARS = 50;
const MIN_CHARS = 5;
const ROTATE_INTERVAL_MS = 6000;
const REVIEWS_PER_PAGE = 3;

// All-face emotion palette arranged as a gradient from most positive on
// Feeling palette. Row 1 positive → neutral-mild, row 2 bored →
// disgusted. 6 per row keeps the grid even on any width the strip
// needs to fit.
//   row 1 (positive → mild):   😇 😍 😚 😋 ☺️ 😐
//   row 2 (flat → meltdown):   😴 😞 🤐 🫠 😡 🤮
const EMOJI_PALETTE = [
  '😇', '😍', '😚', '😋', '☺️', '😐',
  '😴', '😞', '🤐', '🫠', '😡', '🤮',
];

function countNonWhitespace(s: string): number {
  return s.replace(/\s/g, '').length;
}

function flattenBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function Avatar({ src, name, size = 52 }: { src: string | null; name: string | null; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const resolved = resolveApiUrl(src);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name || ''}
        className="rounded-full object-cover shrink-0 border border-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="rounded-full bg-[#2a1f10] text-accent flex items-center justify-center shrink-0 border border-white/10 font-semibold"
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
  const displayName = review.userName || '익명';
  const hasStats =
    review.userId != null &&
    (review.userUpvoteCount > 0 || review.userDownvoteCount > 0);
  // 굿굿 share of the commenter's lifetime vote split — surfaces
  // their general positivity/critical tendency next to the raw
  // counts so a reader can frame the comment ("90% 굿굿 사람이
  // 이 앨범엔 별루를 줬다" reads very differently from "30% 굿굿
  // 사람이 별루를 줬다"). Hidden under 3 total votes since the
  // ratio reads as noise (e.g. "100%" off a single 굿굿).
  const totalVotes = review.userUpvoteCount + review.userDownvoteCount;
  const showVoteRatio = hasStats && totalVotes >= 3;
  const upPct = showVoteRatio
    ? Math.round((review.userUpvoteCount / totalVotes) * 100)
    : null;

  // Speaker trigger: avatar + (name stacked above 굿굿/별루 counts),
  // grouped as one hover target so moving the mouse between the avatar,
  // name, and counts doesn't open/close the popover. Deleted accounts
  // skip the hover wrapper since there's no profile to link to.
  const speakerInner = (
    <>
      <Avatar src={review.userAvatar} name={review.userName} size={36} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span
          className={`text-sm truncate ${
            review.userId == null ? 'text-gray-500 italic' : 'text-gray-300'
          }`}
        >
          {review.userId == null ? '탈퇴한 사용자' : displayName}
        </span>
        {hasStats && (
          <span className="flex items-center gap-2 text-[11px] text-gray-500 tabular-nums mt-0.5">
            <span>
              <span aria-hidden>👍</span> {review.userUpvoteCount}
            </span>
            <span>
              <span aria-hidden>👎</span> {review.userDownvoteCount}
            </span>
            {upPct != null && (
              <span className="text-gray-400">(굿굿 {upPct}%)</span>
            )}
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="relative group h-full">
      {/* Height is dynamic: the grid's items-stretch aligns cards in a
          row, so sibling reviews (and the 180px editor when it's open)
          pull shorter cards up to match. When the row is all-display
          (no editor), short reviews stay compact instead of carrying
          the old fixed 180px of dead whitespace. */}
      {(canOwnerEdit || canAdminDelete) && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
          {canOwnerEdit && (
            <CardOverlayButton onClick={onEdit} title="수정">
              ✎
            </CardOverlayButton>
          )}
          <CardOverlayButton variant="danger" onClick={onDelete} title="삭제">
            ×
          </CardOverlayButton>
        </div>
      )}
      <div className="bg-panel border border-accent/15 rounded-2xl px-4 py-3.5 flex flex-col min-w-0 h-full">
        {/* Body + emoji stamps. The rating/feeling emojis ride at the
            end of the text (separated by a single space) rather than
            floating as overhanging badges or sitting in the footer — so
            they read as the natural punctuation of the comment. The
            trailing span is whitespace-nowrap so the two emojis never
            split across lines and never detach from the preceding space.
            line-clamp-4 remains a safety net for runaway bodies. */}
        <p className="text-gray-100 text-[15px] leading-relaxed break-words flex-1 line-clamp-4">
          {review.body}
          {hasBadges && (
            <span className="whitespace-nowrap">
              {' '}
              {ratingMeta && (
                <span
                  className="leading-none"
                  title={ratingMeta.label}
                  aria-label={ratingMeta.label}
                >
                  {ratingMeta.emoji}
                </span>
              )}
              {review.emoji && (
                <span className="leading-none" aria-hidden="true">
                  {review.emoji}
                </span>
              )}
            </span>
          )}
        </p>

        {/* Footer row — avatar + (name / 굿굿+별루 counts) stacked on
            the right, actions on the far right. gap-3 (not the old
            gap-2.5) between avatar and name column because the gap
            previously failed to propagate through UserHoverCard, making
            the pair read cramped. */}
        <div className="flex items-center gap-3 min-w-0 mt-3 pt-2.5 border-t border-white/5">
          {review.userId != null ? (
            <UserHoverCard
              userId={review.userId}
              className="gap-3 flex-1 min-w-0"
            >
              {speakerInner}
            </UserHoverCard>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {speakerInner}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddReviewCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-2 bg-panel/30 hover:bg-panel/70 border border-dashed border-accent/40 hover:border-accent/80 rounded-2xl p-4 py-6 md:py-4 transition-all cursor-pointer w-full h-full"
    >
      <span className="text-3xl group-hover:scale-110 transition-transform" aria-hidden>✍️</span>
      <span className="text-sm font-medium text-accent group-hover:text-accent-hover">
        50자 평 남기기
      </span>
    </button>
  );
}

function LoginPromptCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-2 bg-panel/20 hover:bg-panel/50 border border-dashed border-white/15 hover:border-accent/40 rounded-2xl p-4 py-6 md:py-4 transition-all cursor-pointer text-center w-full h-full"
    >
      <span
        className="text-2xl opacity-70 group-hover:opacity-100 transition-opacity"
        aria-hidden
      >
        🔑
      </span>
      <span className="text-xs md:text-sm text-gray-400 group-hover:text-accent leading-relaxed">
        로그인하면
        <br />
        50자 평을 남길 수 있어요
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
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] cursor-pointer transition-colors ${
        rating === 'up'
          ? 'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25'
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
      className="text-[11px] text-gray-300 bg-white/5 border border-white/10 rounded-full px-1.5 py-0.5 max-w-[140px] truncate cursor-pointer hover:bg-white/10"
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
              current ? 'w-3 bg-accent' : passed ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-white/15'
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
      className="text-[11px] text-gray-500 hover:text-white px-1.5 py-1 disabled:opacity-40 cursor-pointer"
    >
      취소
    </button>
  );

  return (
    <div className="bg-panel border border-accent/40 rounded-2xl pt-1.5 px-3 pb-3 h-[180px] flex flex-col gap-1">
      {/* Header: summary on left, progress on right. No min-height — when
          no pills are present the row collapses to the progress-dot height
          so the prompt sits close to the card's top edge. */}
      <div className="flex items-center justify-between gap-2">
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
            {/* Prompt + rating buttons live together inside a flex-1
                wrapper so they can centre-justify vertically. Without
                this, the content sat at the top of the step-content
                area with a big gap above the cancel button. Cancel
                stays as a sibling at the bottom, no mt-auto needed —
                the wrapper's flex-1 eats the remaining space. */}
            <div className="flex-1 flex flex-col justify-center gap-2">
              <div className="font-serif italic text-sm text-gray-100 leading-snug text-center">
                “이 앨범 어땠어요?”
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {RATING_ORDER.map((r) => {
                  const selected = rating === r;
                  const selectedStyle =
                    r === 'up'
                      ? 'bg-accent/20 border-accent/60 text-accent'
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
                      className={`h-14 w-full flex flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border ${
                        selected
                          ? selectedStyle
                          : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20'
                      }`}
                    >
                      <span className="text-xl leading-none" aria-hidden>
                        {rEmoji}
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end">{cancelButton}</div>
          </>
        )}

        {step === 'text' && (
          <>
            <div className="font-serif italic text-sm text-gray-100 leading-snug text-center">
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
              className="w-full bg-panel-strong border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none disabled:opacity-60 resize-none"
            />
            <div className="flex items-center justify-between gap-1 text-[11px] mt-auto">
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={goToEmoji}
                  disabled={saving || tooShort || over}
                  title={tooShort ? `최소 ${MIN_CHARS}자 이상 써주세요` : undefined}
                >
                  다음
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'emoji' && (
          <>
            <div className="font-serif italic text-sm text-gray-100 leading-snug text-center">
              “들었을 때 기분!”
            </div>
            <div className="grid grid-cols-6 gap-1.5">
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
                    // Emoji sized to nearly fill the button: text-2xl
                    // on mobile (24px in 32px button) and text-3xl on
                    // desktop (30px in 36px button). Smaller sizes
                    // left a lot of dead space inside each button; the
                    // grid now reads as "emoji palette" rather than
                    // "buttons with emojis inside".
                    className={`h-8 md:h-9 w-full rounded-lg flex items-center justify-center text-2xl md:text-3xl leading-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-accent/20 border border-accent/60 scale-110'
                        : 'bg-white/5 border border-transparent hover:bg-white/10 hover:scale-110'
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-0.5 text-[11px] mt-auto">
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
  | { kind: 'editor' }
  | { kind: 'login' };

export default function UserReviewsSection({
  albumId,
  userAlbumVote,
}: {
  albumId: string;
  userAlbumVote?: 'up' | 'down' | null;
}) {
  const { user, login } = useAuth();
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
    } else if (!user) {
      // Signed-out visitors get a compact login-prompt card at the tail
      // so it matches the width of existing comment cards instead of a
      // wide banner-style empty state.
      list.push({ kind: 'login' });
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
    <SectionTitle variant="tape" meta={reviews.length > 0 ? reviews.length : undefined}>
      고객 50자 평
    </SectionTitle>
  );

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
          if (item.kind === 'login') {
            return <LoginPromptCard key="login" onClick={login} />;
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
                i === page ? 'bg-accent' : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
