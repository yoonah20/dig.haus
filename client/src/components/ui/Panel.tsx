import type { ElementType, ReactNode } from 'react';

// Reusable section card. Albums-page audit found three different card
// backgrounds in the wild (#1a1a1a / #1d140a / #0f0f0f) and four
// border-radius systems (rounded-md/lg/xl/2xl/full) coexisting on the
// same page; Panel locks both to a single rule so the page reads as
// one composition rather than three islands. Token-driven (bg-panel
// / rounded-panel) so the whole site moves together if the chrome
// system gets retuned later.
//
// `strong` is the variant for inputs / dim overlays / inset chrome
// where the surface should sit darker than the surrounding panel —
// e.g. an admin form panel embedded inside a reader-facing review
// list, where the form needs to read as "different layer."

type PanelProps = {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  strong?: boolean;
};

export default function Panel({
  children,
  className = '',
  as: Component = 'div',
  strong = false,
}: PanelProps) {
  const bg = strong ? 'bg-panel-strong' : 'bg-panel';
  return (
    <Component
      className={`${bg} rounded-panel border border-white/10 p-5 md:p-6 ${className}`}
    >
      {children}
    </Component>
  );
}
