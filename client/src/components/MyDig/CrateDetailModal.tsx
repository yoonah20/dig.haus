import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCrateDetail,
  useDeleteCrate,
  useRemoveFromCrate,
  useUpdateCrate,
} from '../../hooks/useCrates';
import CoverArt from '../CoverArt';
import { DigmanEmpty } from '../ui';

// Detail view for a single crate. Owner sees full management surface
// (rename / describe / public toggle / delete crate / remove items);
// visitor sees a read-only cover grid. v1 lives entirely as a modal —
// dedicated /my/:username/crate/:slug pages are deferred until the
// shop-feel visual pass (post-Phase 3 roadmap item 3) lands so the
// page chrome doesn't get rebuilt twice.

interface Props {
  crateId: number;
  onClose: () => void;
}

export default function CrateDetailModal({ crateId, onClose }: Props) {
  const detail = useCrateDetail(crateId);
  const update = useUpdateCrate();
  const remove = useDeleteCrate();
  const removeItem = useRemoveFromCrate();

  // Inline rename / describe state. Both pre-fill from the loaded
  // crate when it lands so the inputs reflect the current value, and
  // editing is "save on blur / Enter" rather than a separate save
  // button — this is a low-stakes surface and a button row would
  // crowd the modal head.
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [descDirty, setDescDirty] = useState(false);

  useEffect(() => {
    if (detail.data && !titleDirty) {
      setTitle(detail.data.crate.title);
    }
    if (detail.data && !descDirty) {
      setDescription(detail.data.crate.description ?? '');
    }
  }, [detail.data, titleDirty, descDirty]);

  if (!detail.data) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        onClick={onClose}
      >
        <div className="text-sm text-gray-400">불러오는 중…</div>
      </div>
    );
  }

  const { crate, isOwner, items } = detail.data;

  const commitTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === crate.title) {
      setTitleDirty(false);
      setTitle(crate.title);
      return;
    }
    try {
      await update.mutateAsync({ id: crate.id, title: trimmed });
    } catch (err: any) {
      alert(err?.response?.data?.error || '제목 변경 실패');
      setTitle(crate.title);
    } finally {
      setTitleDirty(false);
    }
  };

  const commitDescription = async () => {
    const trimmed = description.trim();
    if (trimmed === (crate.description ?? '')) {
      setDescDirty(false);
      return;
    }
    try {
      await update.mutateAsync({
        id: crate.id,
        description: trimmed.length > 0 ? trimmed : null,
      });
    } catch (err: any) {
      alert(err?.response?.data?.error || '설명 변경 실패');
      setDescription(crate.description ?? '');
    } finally {
      setDescDirty(false);
    }
  };

  const togglePublic = async () => {
    try {
      await update.mutateAsync({ id: crate.id, isPublic: !crate.isPublic });
    } catch (err: any) {
      alert(err?.response?.data?.error || '공개 설정 변경 실패');
    }
  };

  const handleDeleteCrate = async () => {
    if (!confirm(`"${crate.title}" 상자를 삭제할까요? 안에 담긴 ${crate.itemCount}장도 함께 사라집니다.`)) {
      return;
    }
    try {
      await remove.mutateAsync(crate.id);
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.error || '삭제 실패');
    }
  };

  const handleRemoveItem = async (albumId: number) => {
    try {
      await removeItem.mutateAsync({ crateId: crate.id, albumId });
    } catch (err: any) {
      alert(err?.response?.data?.error || '제거 실패');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#141008] border border-white/10 rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — title (editable for owner) + meta + close */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/5">
          <div className="flex-1 min-w-0">
            {isOwner ? (
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleDirty(true);
                }}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                maxLength={60}
                className="w-full bg-transparent text-xl font-serif italic text-white border-b border-transparent hover:border-white/15 focus:border-[#e8a020] focus:outline-none"
              />
            ) : (
              <h2 className="text-xl font-serif italic text-white">
                {crate.title}
              </h2>
            )}
            <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
              <span>{crate.itemCount}장</span>
              {isOwner && (
                <button
                  type="button"
                  onClick={togglePublic}
                  disabled={update.isPending}
                  className="cursor-pointer hover:text-[#e8a020] transition-colors"
                  title="공개 / 비공개 토글"
                >
                  {crate.isPublic ? '🌐 공개' : '🔒 비공개'}
                </button>
              )}
              {!isOwner && crate.isPublic && (
                <span className="text-gray-600">🌐 공개</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-gray-500 hover:text-white text-xl leading-none cursor-pointer transition-colors"
          >
            ×
          </button>
        </div>

        {/* Description — editable for owner, read-only otherwise */}
        {(isOwner || crate.description) && (
          <div className="px-5 pt-3">
            {isOwner ? (
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescDirty(true);
                }}
                onBlur={commitDescription}
                placeholder="이 상자가 어떤 모음인지 짧게 적어보세요. (선택)"
                maxLength={240}
                rows={2}
                className="w-full bg-[#0a0703] border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none placeholder-gray-600 resize-none"
              />
            ) : (
              <p className="text-sm text-gray-300 leading-relaxed">
                {crate.description}
              </p>
            )}
          </div>
        )}

        {/* Cover grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <DigmanEmpty variant="sleep" message="아직 담긴 앨범이 없어요." />
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  className="relative group aspect-square rounded-md overflow-hidden bg-[#1a1a1a]"
                >
                  <Link
                    to={`/album/${it.slug || it.mbid}`}
                    className="absolute inset-0 hover:ring-2 hover:ring-[#e8a020]/40 transition-all"
                    title={`${it.title} — ${it.artist}`}
                  >
                    <CoverArt
                      src={it.coverArtUrl}
                      fallbacks={it.coverArtFallbacks}
                      alt={it.title}
                      className="w-full h-full object-cover"
                    />
                  </Link>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveItem(it.id)}
                      disabled={removeItem.isPending}
                      aria-label="이 앨범 빼기"
                      title="이 앨범 빼기"
                      className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-opacity text-[13px] leading-none cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — owner-only delete crate */}
        {isOwner && (
          <div className="px-5 py-3 border-t border-white/5 flex justify-end">
            <button
              type="button"
              onClick={() => void handleDeleteCrate()}
              disabled={remove.isPending}
              className="text-sm text-red-400 hover:text-red-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              상자 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
