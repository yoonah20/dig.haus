import { useUserReviewsFeed } from '../../hooks/useUserReviewsFeed';
import { TickerItem } from './CommentTicker';

// Vertical list variant of the comment feed. Re-uses TickerItem's
// render in fullWidth mode — each 50자 평 card stretches to the
// rail's column width rather than the fixed 320px the marquee used.
// Count defaults to 5 for the rail; caller can override.
export default function CommentList({ count = 5 }: { count?: number }) {
  const { data, isLoading } = useUserReviewsFeed(true, Math.max(count, 5));
  const items = (data?.items ?? []).slice(0, count);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="h-[72px] rounded-2xl border border-white/5 bg-[#0e0903] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-600 italic py-4 text-center">
        아직 50자 평이 없어요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <TickerItem key={item.id} item={item} fullWidth />
      ))}
    </div>
  );
}
