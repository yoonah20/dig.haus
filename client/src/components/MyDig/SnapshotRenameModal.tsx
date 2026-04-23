import { useState } from 'react';
import { useUpdateVinylWallSnapshot } from '../../hooks/useMyDig';

// Small modal for editing a snapshot's name + public flag from the
// snapshot detail page. Mirrors MyDig.tsx's ThemeEditModal shape
// so the two owner-facing edit surfaces read as siblings.
export default function SnapshotRenameModal({
  username,
  snapshotId,
  initialName,
  initialIsPublic,
  onClose,
}: {
  username: string;
  snapshotId: number;
  initialName: string;
  initialIsPublic: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const update = useUpdateVinylWallSnapshot(username);

  const trimmed = name.trim();
  const canSave =
    trimmed.length > 0 &&
    (trimmed !== initialName || isPublic !== initialIsPublic);

  const handleSave = async () => {
    if (update.isPending || !canSave) return;
    try {
      await update.mutateAsync({
        id: snapshotId,
        // Only send fields that actually changed — the server's
        // patch handler treats missing fields as "don't touch".
        ...(trimmed !== initialName ? { name: trimmed } : {}),
        ...(isPublic !== initialIsPublic ? { isPublic } : {}),
      });
      onClose();
    } catch (err) {
      console.error('[mydig/snapshots] rename failed:', err);
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
          스냅샷 정보 수정
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          이름과 공개 여부만 바꿉니다. 포함된 앨범은 편집 버튼으로 따로 수정해요.
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSave();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />

        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#e8a020] cursor-pointer"
          />
          <span className="text-xs text-gray-300">
            공개 (방문자도 볼 수 있어요)
          </span>
        </label>

        {update.isError && (
          <p className="text-xs text-red-400 mt-3">
            저장 실패: {(update.error as any)?.response?.data?.error
              ?? (update.error as any)?.message
              ?? '알 수 없는 오류'}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 cursor-pointer disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={update.isPending || !canSave}
            className="text-xs text-[#e8a020] hover:text-[#f5b040] border border-[#e8a020]/50 hover:border-[#e8a020] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {update.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
