import { useEffect, useRef, useState } from 'react';
import { useUpdateCrate, type CrateSummary } from '../../../hooks/useCrates';

// Small strip between the floor and the crate bar that surfaces the
// active crate's title + description. Owner gets an inline edit
// mode (✏️) for both fields; the + chip create flow stays title-only,
// so this is the only place description gets added/changed for now.
//
// View mode: description in muted italic underneath the title (or
// "설명 추가" link when empty + owner). Visitors with no description
// see nothing — strip collapses.

interface Props {
  crate: CrateSummary;
  isOwner: boolean;
}

export default function CrateMeta({ crate, isOwner }: Props) {
  const update = useUpdateCrate();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(crate.title);
  const [draftDesc, setDraftDesc] = useState(crate.description ?? '');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset draft when the active crate changes — otherwise switching
  // crates mid-edit would silently retain the previous draft.
  useEffect(() => {
    setEditing(false);
    setDraftTitle(crate.title);
    setDraftDesc(crate.description ?? '');
  }, [crate.id, crate.title, crate.description]);

  // Auto-focus the title input when entering edit mode so the owner
  // can start typing right away.
  useEffect(() => {
    if (editing) titleInputRef.current?.focus();
  }, [editing]);

  const handleSave = async () => {
    const newTitle = draftTitle.trim();
    const newDesc = draftDesc.trim();
    if (!newTitle) return;
    try {
      await update.mutateAsync({
        id: crate.id,
        title: newTitle !== crate.title ? newTitle : undefined,
        description:
          (newDesc || null) !== (crate.description ?? null) ? newDesc || null : undefined,
      });
      setEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const handleCancel = () => {
    setDraftTitle(crate.title);
    setDraftDesc(crate.description ?? '');
    setEditing(false);
  };

  // Visitor with no description: render nothing — keeps the carpet
  // → bar transition flush.
  if (!isOwner && !crate.description) return null;

  return (
    <div
      style={{
        padding: '10px 16px 8px',
        background: 'rgba(0,0,0,0.20)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            ref={titleInputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
              }
            }}
            maxLength={60}
            placeholder="상자 이름"
            className="bg-background/60 border border-white/15 focus:border-accent/60 rounded px-2 py-1 text-[13px] text-gray-100 outline-none"
          />
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
              }
              // Cmd/Ctrl+Enter = save while in textarea (plain Enter
              // inserts a newline so the description can wrap.)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSave();
              }
            }}
            rows={2}
            maxLength={240}
            placeholder="설명 (선택)"
            className="bg-background/60 border border-white/15 focus:border-accent/60 rounded px-2 py-1 text-[12px] text-gray-200 outline-none resize-none"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={handleCancel}
              className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={update.isPending || !draftTitle.trim()}
              className="text-[11px] text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-accent/40 rounded-full px-2.5 py-0.5"
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {crate.description ? (
              <div
                style={{
                  fontSize: 12,
                  color: '#c8b89a',
                  fontStyle: 'italic',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'keep-all',
                  lineHeight: 1.45,
                }}
              >
                {crate.description}
              </div>
            ) : isOwner ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[12px] text-gray-500 hover:text-accent cursor-pointer italic"
              >
                + 설명 추가
              </button>
            ) : null}
          </div>
          {isOwner && (crate.description ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="상자 정보 편집"
              title="상자 정보 편집"
              className="text-[11px] text-gray-500 hover:text-accent cursor-pointer flex-shrink-0"
            >
              ✏️
            </button>
          ) : null)}
        </div>
      )}
    </div>
  );
}
