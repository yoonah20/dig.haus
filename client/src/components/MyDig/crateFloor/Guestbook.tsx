import { useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useCrateComments,
  usePostCrateComment,
  useDeleteCrateComment,
  type CrateComment,
} from '../../../hooks/useCrates';
import { parseServerTimestamp } from '../../../utils/relativeTime';

// 방명록 — per-crate guestbook beneath the carpet/preview row.
// Visitors leave top-level notes; the crate owner can reply once per
// note (single-thread depth, enforced server-side). Comment author OR
// crate owner can delete. Logged-out viewers see the thread but the
// composer is replaced with a login prompt.

interface Props {
  crateId: number;
  crateTitle: string;
  // True when the current viewer is the mydig page owner, i.e. also
  // the crate owner (all crates on a /my/:u page belong to that
  // user). Drives reply affordance + delete permissions client-side;
  // server enforces the same rules independently.
  isOwner: boolean;
}

function shortTime(ts: string): string {
  try {
    const d = parseServerTimestamp(ts);
    if (!d) return '';
    const now = Date.now();
    const diffMs = now - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}일 전`;
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function Avatar({
  url,
  alt,
  isOwner,
}: {
  url: string | null;
  alt: string;
  isOwner: boolean;
}) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: '#0a0703',
        overflow: 'hidden',
        flexShrink: 0,
        border: isOwner ? '2px solid #e8a020' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: 12,
          }}
        >
          {alt[0]?.toUpperCase() ?? '?'}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  canDelete,
  canReply,
  onDelete,
  onReply,
  isReply,
  pendingReplyOpen,
  pendingReplyDraft,
  onChangeDraft,
  onCancelReply,
  onSubmitReply,
  submitting,
}: {
  comment: CrateComment;
  canDelete: boolean;
  canReply: boolean;
  onDelete: () => void;
  onReply: () => void;
  isReply: boolean;
  pendingReplyOpen: boolean;
  pendingReplyDraft: string;
  onChangeDraft: (v: string) => void;
  onCancelReply: () => void;
  onSubmitReply: () => void;
  submitting: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        paddingLeft: isReply ? 38 : 0,
        marginTop: isReply ? 6 : 0,
      }}
    >
      <Avatar
        url={comment.author.avatarUrl}
        alt={comment.author.displayName ?? '?'}
        isOwner={comment.author.isCrateOwner}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: comment.author.isCrateOwner ? '#e8a020' : '#e8e8e8',
            }}
          >
            {comment.author.displayName}
          </span>
          {comment.author.isCrateOwner && (
            <span
              style={{
                fontSize: 10,
                color: '#e8a020',
                border: '1px solid rgba(232, 160, 32, 0.5)',
                borderRadius: 3,
                padding: '0 4px',
              }}
            >
              주인
            </span>
          )}
          <span style={{ fontSize: 11, color: '#888' }}>
            {shortTime(comment.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: '#d8d8d8',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginTop: 2,
          }}
        >
          {comment.body}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 4,
          }}
        >
          {canReply && !pendingReplyOpen && (
            <button
              type="button"
              onClick={onReply}
              className="text-[11px] text-gray-500 hover:text-accent cursor-pointer"
            >
              답글
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-[11px] text-gray-500 hover:text-red-400 cursor-pointer"
            >
              삭제
            </button>
          )}
        </div>
        {pendingReplyOpen && (
          <div style={{ marginTop: 6 }}>
            <textarea
              value={pendingReplyDraft}
              onChange={(e) => onChangeDraft(e.target.value)}
              placeholder="답글을 남겨보세요"
              rows={2}
              maxLength={500}
              className="w-full bg-background/60 border border-white/10 focus:border-accent/60 rounded-md px-2 py-1.5 text-[12px] text-gray-200 outline-none resize-none"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={onSubmitReply}
                disabled={submitting || !pendingReplyDraft.trim()}
                className="text-[11px] text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                답글 달기
              </button>
              <button
                type="button"
                onClick={onCancelReply}
                className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Guestbook({ crateId, crateTitle, isOwner }: Props) {
  const { user, login } = useAuth();
  const commentsQuery = useCrateComments(crateId);
  const post = usePostCrateComment();
  const del = useDeleteCrateComment();

  const [draft, setDraft] = useState('');
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  // Group flat list into top-level + replies-by-parent. Server already
  // sends them in created_at ASC, so reply order within a parent is
  // naturally chronological.
  const grouped = useMemo(() => {
    const top: CrateComment[] = [];
    const repliesByParent = new Map<number, CrateComment[]>();
    for (const c of commentsQuery.data?.comments ?? []) {
      if (c.parentId == null) {
        top.push(c);
      } else {
        const existing = repliesByParent.get(c.parentId);
        if (existing) existing.push(c);
        else repliesByParent.set(c.parentId, [c]);
      }
    }
    return { top, repliesByParent };
  }, [commentsQuery.data]);

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await post.mutateAsync({ crateId, body });
      setDraft('');
    } catch (err: any) {
      alert(err?.response?.data?.error || '댓글 달기 실패');
    }
  };

  const handleSubmitReply = async (parentId: number) => {
    const body = replyDraft.trim();
    if (!body) return;
    try {
      await post.mutateAsync({ crateId, body, parentId });
      setReplyToId(null);
      setReplyDraft('');
    } catch (err: any) {
      alert(err?.response?.data?.error || '답글 달기 실패');
    }
  };

  const handleDelete = async (commentId: number) => {
    if (!confirm('이 댓글 삭제할까요?')) return;
    try {
      await del.mutateAsync({ crateId, commentId });
    } catch (err: any) {
      alert(err?.response?.data?.error || '삭제 실패');
    }
  };

  return (
    <section
      style={{
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#d9c89a',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        방명록
        <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
          · "{crateTitle}"에 한 마디
        </span>
      </h2>

      {/* Composer */}
      {user ? (
        <div style={{ marginBottom: 14 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isOwner
                ? '내 상자에 메모 남기기'
                : `${crateTitle}에 한 마디 남겨보세요`
            }
            rows={2}
            maxLength={500}
            className="w-full bg-background/60 border border-white/10 focus:border-accent/60 rounded-md px-3 py-2 text-[13px] text-gray-200 outline-none resize-none"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={post.isPending || !draft.trim()}
              className="text-[12px] text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-accent/40 rounded-full px-3 py-1"
            >
              남기기
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={login}
            className="text-[12px] text-accent hover:text-accent-hover cursor-pointer underline"
          >
            로그인하고 한 마디 남기기
          </button>
        </div>
      )}

      {/* List */}
      {commentsQuery.isLoading && (
        <div style={{ color: '#888', fontSize: 12 }}>불러오는 중…</div>
      )}
      {!commentsQuery.isLoading && grouped.top.length === 0 && (
        <div style={{ color: '#888', fontSize: 12 }}>
          아직 남긴 한 마디가 없어요.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {grouped.top.map((c) => {
          const replies = grouped.repliesByParent.get(c.id) ?? [];
          const myComment = user?.id === c.author.id;
          // Reply: only crate owner, and only if no reply yet (single
          // depth — UI matches the server constraint).
          const canReply = isOwner && replies.length === 0;
          return (
            <div key={c.id}>
              <CommentItem
                comment={c}
                canDelete={myComment || isOwner}
                canReply={canReply}
                onDelete={() => void handleDelete(c.id)}
                onReply={() => {
                  setReplyToId(c.id);
                  setReplyDraft('');
                }}
                isReply={false}
                pendingReplyOpen={replyToId === c.id}
                pendingReplyDraft={replyDraft}
                onChangeDraft={setReplyDraft}
                onCancelReply={() => {
                  setReplyToId(null);
                  setReplyDraft('');
                }}
                onSubmitReply={() => void handleSubmitReply(c.id)}
                submitting={post.isPending}
              />
              {replies.map((r) => {
                const myReply = user?.id === r.author.id;
                return (
                  <CommentItem
                    key={r.id}
                    comment={r}
                    canDelete={myReply || isOwner}
                    canReply={false}
                    onDelete={() => void handleDelete(r.id)}
                    onReply={() => {}}
                    isReply
                    pendingReplyOpen={false}
                    pendingReplyDraft=""
                    onChangeDraft={() => {}}
                    onCancelReply={() => {}}
                    onSubmitReply={() => {}}
                    submitting={false}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
