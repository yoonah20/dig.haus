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
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(todayDateLabel());
  const [isPublic, setIsPublic] = useState(false);
  const create = useCreateVinylWallSnapshot(username);

  const handleSave = async () => {
    if (create.isPending) return;
    try {
      await create.mutateAsync({
        name: name.trim() || undefined,
        isPublic,
      });
      onClose();
    } catch {
      /* error state surfaces in create.isError below */
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
          벽을 스냅샷으로 저장
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          지금 걸린 10장을 그대로 보관합니다. 편집해도 이 기록은 남아요.
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
          <p className="text-xs text-red-400 mt-3">저장에 실패했어요.</p>
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
