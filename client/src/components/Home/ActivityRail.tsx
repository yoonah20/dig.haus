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
        <div className="flex items-center gap-1.5 mb-2 px-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="활동 레일 접기"
              aria-label="활동 레일 접기"
              className="hidden lg:inline-flex items-center justify-center w-4 h-4 rounded text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
            >
              {/* × close glyph — unambiguous ("close this panel")
                  in a way the earlier right-pointing chevron wasn't. */}
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
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <h3 className="text-[11px] lowercase tracking-wider text-gray-500">
            mydigs
          </h3>
        </div>
        <SnapshotFeed count={3} />
      </section>
    </aside>
  );
}
