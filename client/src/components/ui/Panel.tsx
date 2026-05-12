import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

// Reusable section card. Albums-page audit found three different card
// backgrounds in the wild (#1a1a1a / #1d140a / #0f0f0f) and four
// border-radius systems (rounded-md/lg/xl/2xl/full) coexisting on the
// same page; Panel locks the chrome (bg + border + radius + padding)
// to a system so the page reads as one composition rather than
// three islands.
//
// `strong` selects the surface tier — default panel for content
// cards, panel-strong for inputs / dim overlays / inset chrome where
// the surface should sit darker than the surrounding panel.
//
// `pad` controls the inner padding. Default `md` matches the
// album-page section cards (`p-5 md:p-6`); `sm` is the compact
// inline pad for dropdown / popover surfaces; `lg` for hero-scale
// section cards; `none` opts out entirely when the caller wants to
// own padding inside.
//
// `radius` picks the corner rounding. Default `panel` (12px via the
// shared --radius-panel token) is the standard section-card corner;
// `lg`/`xl`/`2xl` are the modal / dropdown alternates that already
// circulate. Borders default to the neutral white/10 the section
// cards use — callers that want a themed border (accent/40 etc)
// pass it through className and it overrides via order.

type PanelPad = 'none' | 'sm' | 'md' | 'lg';
type PanelRadius = 'panel' | 'lg' | 'xl' | '2xl';

type PanelProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  strong?: boolean;
  pad?: PanelPad;
  radius?: PanelRadius;
};

const PAD: Record<PanelPad, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-8',
};

const RADIUS: Record<PanelRadius, string> = {
  panel: 'rounded-panel',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
};

export default function Panel({
  children,
  className = '',
  as: Component = 'div',
  strong = false,
  pad = 'md',
  radius = 'panel',
  ...rest
}: PanelProps) {
  const bg = strong ? 'bg-panel-strong' : 'bg-panel';
  return (
    <Component
      {...rest}
      className={`${bg} ${RADIUS[radius]} border border-white/10 ${PAD[pad]} ${className}`.trim()}
    >
      {children}
    </Component>
  );
}
