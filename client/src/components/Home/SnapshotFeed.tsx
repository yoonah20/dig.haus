import { useHomeSnapshots } from '../../hooks/useHomeSnapshots';
import SnapshotCard from './SnapshotCard';

// Count defaults to 3 — small enough to keep the rail short at
// fixed height, large enough that the section reads as a "feed"
// rather than a single promoted item. Callers override via prop
// so a denser variant (e.g. a future dedicated /snapshots page)
// can reuse the same feed component.
export default function SnapshotFeed({ count = 3 }: { count?: number }) {
  const { data, isLoading } = useHomeSnapshots(true, count);
  const snaps = (data?.snapshots ?? []).slice(0, count);

  if (isLoading) {
    return (
      <div className="space-y-[4px]">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="h-[148px] rounded-lg border border-white/5 bg-[#0e0903] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (snaps.length === 0) {
    return (
      <div className="text-xs text-gray-600 italic py-4 text-center">
        아직 공개된 스냅샷이 없어요.
      </div>
    );
  }

  return (
    <div className="space-y-[3px]">
      {snaps.map((snap) => (
        <SnapshotCard key={snap.id} snap={snap} />
      ))}
    </div>
  );
}
