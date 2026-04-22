import { Link } from 'react-router-dom';
import {
  useDeleteVinylWallSnapshot,
  useUpdateVinylWallSnapshot,
  type VinylWallSnapshotSummary,
} from '../../hooks/useMyDig';
import { formatRelativeKo } from '../../utils/relativeTime';

// Horizontal strip of saved snapshots below the live wall.
// Visitor sees only public ones (server-filtered). Owner sees all
// with inline controls to toggle public/private and delete. Each
// card links to /my/:username/snap/:slug for the read-only detail
// view.
export default function SnapshotList({
  username,
  snapshots,
  isOwner,
}: {
  username: string;
  snapshots: VinylWallSnapshotSummary[];
  isOwner: boolean;
}) {
  if (snapshots.length === 0) {
    // Hide entirely when there's nothing to show — avoids a dead
    // "아직 스냅샷이 없어요" row on first visits. The save button
    // lives in the header, so owner discovery doesn't depend on
    // this strip.
    return null;
  }
  return (
    <section className="mt-2">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-gray-500">
          Snapshots
        </h2>
        <span className="text-[11px] text-gray-600 tabular-nums">
          {snapshots.length}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {snapshots.map((s) => (
          <SnapshotCard
            key={s.id}
            username={username}
            snapshot={s}
            isOwner={isOwner}
          />
        ))}
      </div>
    </section>
  );
}

function SnapshotCard({
  username,
  snapshot,
  isOwner,
}: {
  username: string;
  snapshot: VinylWallSnapshotSummary;
  isOwner: boolean;
}) {
  const update = useUpdateVinylWallSnapshot(username);
  const del = useDeleteVinylWallSnapshot(username);

  const togglePublic = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (update.isPending) return;
    update.mutate({ id: snapshot.id, isPublic: !snapshot.isPublic });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (del.isPending) return;
    if (!confirm(`"${snapshot.name}" 스냅샷을 삭제할까요? 되돌릴 수 없어요.`)) return;
    del.mutate(snapshot.id);
  };

  return (
    <Link
      to={`/my/${encodeURIComponent(username)}/snap/${encodeURIComponent(snapshot.slug)}`}
      className="group block shrink-0 w-[180px] p-3 rounded-lg bg-[#14120d] border border-white/5 hover:border-[#e8a020]/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="text-sm text-[#f5e8c8] font-serif italic truncate leading-tight"
            title={snapshot.name}
          >
            {snapshot.name}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
            {formatRelativeKo(snapshot.createdAt)} · {snapshot.itemCount}장
          </div>
        </div>
        {snapshot.isPublic ? (
          <span
            className="text-[9px] uppercase tracking-wider text-[#e8a020] shrink-0"
            title="공개"
          >
            public
          </span>
        ) : (
          <span
            className="text-[9px] uppercase tracking-wider text-gray-600 shrink-0"
            title="비공개"
          >
            private
          </span>
        )}
      </div>
      {isOwner && (
        <div className="flex items-center gap-1 mt-3 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={togglePublic}
            disabled={update.isPending}
            className="text-[10px] text-gray-400 hover:text-[#e8a020] cursor-pointer disabled:opacity-50"
            title="공개 상태 전환"
          >
            {snapshot.isPublic ? '🔒 비공개로' : '🌐 공개로'}
          </button>
          <span className="text-gray-700">·</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="text-[10px] text-gray-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
            title="삭제"
          >
            삭제
          </button>
        </div>
      )}
    </Link>
  );
}
