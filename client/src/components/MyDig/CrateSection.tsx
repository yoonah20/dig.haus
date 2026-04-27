import { useState } from 'react';
import { useCreateCrate, useUserCrates } from '../../hooks/useCrates';
import CoverArt from '../CoverArt';
import CrateDetailModal from './CrateDetailModal';

// Crate listing on /my/:username. Renders the user's crates as a row
// of stacked-cover tiles with the crate title as a label below. Owner
// sees an additional "+ 새 상자" tile that inlines a name input
// and creates on Enter. Click any tile → opens CrateDetailModal.
//
// Visibility: visitors see is_public crates only (server-filtered);
// owner sees all of theirs. The component doesn't try to render
// anything when there are no crates AND the viewer isn't the owner —
// no point of an empty section taking up space.

interface Props {
  username: string;
  isOwner: boolean;
}

export default function CrateSection({ username, isOwner }: Props) {
  const crates = useUserCrates(username);
  const create = useCreateCrate();
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  if (crates.isLoading) return null;
  const list = crates.data?.crates ?? [];
  if (list.length === 0 && !isOwner) return null;

  const handleCreate = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setComposing(false);
      setNewTitle('');
      return;
    }
    try {
      const created = await create.mutateAsync({
        title: trimmed,
        isPublic: false,
      });
      setComposing(false);
      setNewTitle('');
      setOpenId(created.id);
    } catch (err: any) {
      alert(err?.response?.data?.error || '상자 만들기 실패');
    }
  };

  return (
    <section className="mt-12">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-lg font-serif italic text-white">📦 상자</h2>
        <span className="text-sm text-gray-500 tabular-nums">
          {list.length}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenId(c.id)}
            className="group text-left cursor-pointer"
          >
            <div className="relative aspect-square rounded-md overflow-hidden bg-[#0a0703] border border-white/5 group-hover:border-[#e8a020]/40 transition-colors">
              {c.coverThumbs.length > 0 ? (
                <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                  {[0, 1, 2, 3].map((i) => {
                    const t = c.coverThumbs[i];
                    return (
                      <div
                        key={i}
                        className="bg-[#1a1a1a] overflow-hidden"
                      >
                        {t && (
                          <CoverArt
                            src={t.url}
                            fallbacks={t.fallbacks}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl text-gray-700">
                  📦
                </div>
              )}
              {!c.isPublic && (
                <span
                  className="absolute top-1.5 right-1.5 text-[11px] bg-black/70 text-gray-300 px-1.5 py-0.5 rounded-sm"
                  title="비공개"
                >
                  🔒
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-sm text-gray-200 truncate group-hover:text-[#e8a020] transition-colors">
                {c.title}
              </span>
              <span className="text-[12px] text-gray-500 tabular-nums">
                {c.itemCount}
              </span>
            </div>
          </button>
        ))}

        {isOwner && composing && (
          <div className="flex flex-col gap-2">
            <div className="aspect-square rounded-md border-2 border-dashed border-[#e8a020]/40 flex items-center justify-center bg-[#0a0703]">
              <input
                type="text"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onBlur={() => {
                  if (!newTitle.trim()) {
                    setComposing(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setComposing(false);
                    setNewTitle('');
                  }
                }}
                maxLength={60}
                placeholder="상자 이름"
                className="w-full mx-3 bg-transparent border-b border-[#e8a020]/40 px-1 py-1 text-sm text-gray-200 focus:border-[#e8a020] focus:outline-none placeholder-gray-600 text-center"
              />
            </div>
            <div className="text-[12px] text-gray-500 text-center">
              Enter로 만들기
            </div>
          </div>
        )}

        {isOwner && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="aspect-square rounded-md border-2 border-dashed border-white/10 hover:border-[#e8a020]/40 hover:bg-[#e8a020]/5 transition-colors flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-[#e8a020] cursor-pointer"
          >
            <span className="text-3xl">＋</span>
            <span className="text-sm">새 상자</span>
          </button>
        )}
      </div>

      {openId != null && (
        <CrateDetailModal crateId={openId} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}
