import { useEffect, useRef, useState } from 'react';
import {
  useUpdateCrate,
  useDeleteCrate,
  type CrateSummary,
} from '../../../hooks/useCrates';

// Modal overlay for editing a crate's title + description. Opened
// from the ✏️ chip on the active crate in the bar; saves via the
// existing useUpdateCrate hook (PATCH /api/mydig/crates/:id) and
// only sends changed fields so a description-only edit doesn't
// retouch the title row in the DB.
//
// Single-purpose modal — no field beyond title/description. Visibility
// toggle (is_public) lives elsewhere; ordering happens through the
// bar's drag-reorder gesture.

interface Props {
  crate: CrateSummary;
  onClose: () => void;
}

export default function CrateEditModal({ crate, onClose }: Props) {
  const update = useUpdateCrate();
  const remove = useDeleteCrate();
  const [title, setTitle] = useState(crate.title);
  const [description, setDescription] = useState(crate.description ?? '');
  const titleRef = useRef<HTMLInputElement>(null);

  const handleDelete = async () => {
    if (
      !window.confirm(
        `'${crate.title}' 박스를 삭제할까요? 박스 안 앨범은 빠지지만 콜렉션엔 그대로 남아요.`
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync(crate.id);
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '삭제 실패');
    }
  };

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Esc closes — matches the rest of the site's modal pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    const newTitle = title.trim();
    const newDesc = description.trim();
    if (!newTitle) return;
    try {
      await update.mutateAsync({
        id: crate.id,
        title: newTitle !== crate.title ? newTitle : undefined,
        description:
          (newDesc || null) !== (crate.description ?? null)
            ? newDesc || null
            : undefined,
      });
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#1a1614',
          border: '1px solid rgba(220, 170, 80, 0.25)',
          borderRadius: 8,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 14px 36px rgba(0,0,0,0.6)',
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#d9c89a',
            margin: 0,
            marginBottom: 4,
          }}
        >
          박스 편집
        </h2>
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            }
          }}
          maxLength={60}
          placeholder="박스 이름"
          className="bg-background/60 border border-white/15 focus:border-accent/60 rounded px-3 py-2 text-[14px] text-gray-100 outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter saves so the owner doesn't have to grab
            // the mouse after typing description.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSave();
            }
          }}
          rows={3}
          maxLength={240}
          placeholder="설명 (선택)"
          className="bg-background/60 border border-white/15 focus:border-accent/60 rounded px-3 py-2 text-[13px] text-gray-200 outline-none resize-none"
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            marginTop: 4,
          }}
        >
          {/* Delete on the left, separated from cancel/save on the
              right so the destructive action doesn't sit next to
              the confirm button by accident. Default crates (굿굿
              / 별루) are server-locked from deletion (returns 403);
              hide the button on those too so the operator doesn't
              get a misleading affordance. */}
          {!crate.isDefault ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={remove.isPending || update.isPending}
              className="text-[12px] text-red-400/80 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer px-2 py-1"
            >
              🗑️ 박스 삭제
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] text-gray-400 hover:text-gray-200 cursor-pointer px-3 py-1"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={update.isPending || !title.trim()}
              className="text-[12px] text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-accent/60 rounded-full px-3 py-1"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
