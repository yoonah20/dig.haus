import SnapshotFeed from './SnapshotFeed';

// Right-side activity rail for the home page. Currently holds a
// single section — recent public mydig walls — because the comment
// feed went back to a marquee ticker below the grid, where its
// motion-heavy horizontal scroll has more room to read as a ticker
// rather than a jittery vertical list in a narrow column.
//
// Desktop layout is done by the parent grid (fraction of the
// viewport); this component is just the stacked section. Mobile
// placement is also parent-driven — on narrow widths the rail
// slots below the album grid rather than beside it. The close
// button lives at the LEFT of the section header via the onClose
// prop — a chevron on the right end of "mydigs" read too much like
// a "go to" arrow pointing at the label rather than a collapse
// action. Hidden on mobile via `hidden lg:inline-flex` since
// mobile doesn't offer a collapse affordance (rail always stacks).
export default function ActivityRail({
  onClose,
}: {
  onClose?: () => void;
}) {
  return (
    <aside aria-label="활동" className="flex flex-col gap-6">
      <section>
        <div className="flex items-center gap-2 mb-[10px]">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="활동 레일 접기"
              aria-label="활동 레일 접기"
              className="hidden lg:inline-flex items-center justify-center w-5 h-5 rounded-md border border-white/15 bg-background/40 hover:border-accent/60 hover:bg-accent/10 text-gray-400 hover:text-accent transition-colors cursor-pointer"
            >
              {/* > chevron, styled as a visible pill button so it
                  reads as "this closes the panel" rather than a
                  label-direction indicator. The outer row handles
                  the actual slide-right animation when railOpen
                  flips false. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3 h-3"
                aria-hidden
              >
                <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}
          <h3 className="text-xs uppercase tracking-wider text-gray-300">
            최근의 기억들
          </h3>
        </div>
        <SnapshotFeed count={5} />
      </section>
    </aside>
  );
}
