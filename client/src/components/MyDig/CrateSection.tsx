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

      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenId(c.id)}
            className="group text-left cursor-pointer"
          >
            <div className="relative aspect-square rounded-md overflow-hidden bg-[#0a0703] border border-white/5 group-hover:border-accent/40 transition-colors">
              {c.coverThumbs.length > 0 ? (
                <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                  {[0, 1, 2, 3].map((i) => {
                    const t = c.coverThumbs[i];
                    return (
                      <div
                        key={i}
                        className="bg-panel overflow-hidden"
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
                <div className="w-full h-full flex items-center justify-center text-xl text-gray-700">
                  📦
                </div>
              )}
              {!c.isPublic && (
                <span
                  className="absolute top-1 right-1 text-[9px] bg-black/70 text-gray-300 px-1 py-0.5 rounded-sm"
                  title="비공개"
                >
                  🔒
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-[12px] text-gray-200 truncate group-hover:text-accent transition-colors">
                {c.title}
              </span>
              <span className="text-[10px] text-gray-500 tabular-nums">
                {c.itemCount}
              </span>
            </div>
          </button>
        ))}

        {isOwner && composing && (
          <div className="flex flex-col gap-1">
            <div className="aspect-square rounded-md border-2 border-dashed border-accent/40 flex items-center justify-center bg-[#0a0703] px-2">
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
                placeholder="이름"
                className="w-full bg-transparent border-b border-accent/40 px-0.5 py-0.5 text-[12px] text-gray-200 focus:border-accent focus:outline-none placeholder-gray-600 text-center"
              />
            </div>
            <div className="text-[10px] text-gray-500 text-center">
              Enter
            </div>
          </div>
        )}

        {isOwner && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="aspect-square rounded-md border-2 border-dashed border-white/10 hover:border-accent/40 hover:bg-accent/5 transition-colors flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-accent cursor-pointer"
          >
            <span className="text-xl">＋</span>
            <span className="text-[11px]">새 상자</span>
          </button>
        )}
      </div>

      {openId != null && (
        <CrateDetailModal crateId={openId} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}
