import SnapshotFeed from './SnapshotFeed';
import CommentList from './CommentList';

// Left-side activity rail for the home page. Desktop layout is
// done by the parent grid (fraction of the viewport); this
// component is just the stacked section contents. Mobile placement
// is also handled by the parent — on narrow widths the rail slots
// below the album grid rather than beside it.
//
// Order is fixed: snapshots up top (visual, quick to scan from a
// distance), comments below (text, requires actually reading). The
// lighter surface up top pulls the eye into the rail; the denser
// text block sits where it naturally settles.
export default function ActivityRail() {
  return (
    <aside aria-label="활동" className="flex flex-col gap-6">
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2 px-1">
          최근 스냅샷
        </h3>
        <SnapshotFeed count={3} />
      </section>
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2 px-1">
          최근 코멘트
        </h3>
        <CommentList count={5} />
      </section>
    </aside>
  );
}
