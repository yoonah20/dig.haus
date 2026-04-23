import { useState } from 'react';
import { useCreateVinylWallSnapshot } from '../../hooks/useMyDig';

// Save-snapshot modal. Owner triggers it from the /my/:username
// header. Form captures two fields:
//   - name (default = today's date, editable; server also falls
//     back to the date if we send blank)
//   - isPublic (default false). Public snapshots show up in the
//     user's snapshot list to visitors; private snapshots are
//     owner-only.
// No preview of the saved state at this wireframe stage — the
// server copies whatever the wall currently holds the moment the
// save fires, and the snapshot list refreshes with the new entry
// immediately.
function todayDateLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function SnapshotSaveModal({
  username,
  items,
  onClose,
  onSaved,
}: {
  username: string;
  /** Optional explicit item list — when supplied, the snapshot
   *  captures this arrangement instead of the owner's live wall.
   *  Editor's "scratch" flow passes the current draft here so the
   *  in-flight wall can be archived without first committing to
   *  vinyl_wall_items. */
  items?: Array<{ position: number; albumId: number }>;
  onClose: () => void;
  /** Fires after a successful save. Editor uses it to step into
   *  the "revert or keep" prompt. */
  onSaved?: () => void;
}) {
  const [name, setName] = useState(todayDateLabel());
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const create = useCreateVinylWallSnapshot(username);

  const handleSave = async () => {
    if (create.isPending) return;
    try {
      await create.mutateAsync({
        name: name.trim() || undefined,
        description: description.trim() || null,
        isPublic,
        items,
      });
      if (onSaved) onSaved();
      else onClose();
    } catch (err) {
      // Red banner below renders the server error via create.error;
      // log it here too so devtools show the full response.
      console.error('[mydig/snapshots] save failed:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#141008] border border-white/10 rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg text-white font-serif italic mb-1">
          현재 구성을 '기억'하기
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          지금 걸린 15장을 그대로 기억합니다. 언제든지 수정, 삭제 할 수 있어요.
        </p>

        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
          이름
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          className="w-full bg-[#0a0503] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e8a020] focus:outline-none"
          placeholder={todayDateLabel()}
        />
        <p className="text-[10px] text-gray-600 mt-1">
          비워두면 오늘 날짜가 들어가요.
        </p>

        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mt-4 mb-1">
          설명 (선택)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={240}
          rows={2}
          placeholder="이 스냅샷이 어떤 이야기인지 짧게 남겨보세요."
          className="w-full bg-[#0a0503] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-[#e8a020] focus:outline-none placeholder-gray-600 resize-none leading-snug"
        />
        <p className="text-[10px] text-gray-600 mt-1 text-right">
          {description.length}/240
        </p>

        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#e8a020] cursor-pointer"
          />
          <span className="text-xs text-gray-300">
            공개로 저장 (방문자도 볼 수 있어요)
          </span>
        </label>

        {create.isError && (
          <p className="text-xs text-red-400 mt-3">
            저장 실패: {(create.error as any)?.response?.data?.error
              ?? (create.error as any)?.message
              ?? '알 수 없는 오류'}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 cursor-pointer disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/50 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 transition-colors"
          >
            {create.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
