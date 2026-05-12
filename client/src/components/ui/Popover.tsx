import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// Floating-UI surface — tooltips, dropdowns, menus, hover cards.
// Distinct from Panel because popovers always carry shadow + z
// + (often) a fade-in animation, and they're rendered into a
// positioned container the caller owns. Panel is for inline
// section cards; Popover is for elements that float above the
// page surface.
//
// Positioning is left to the caller (absolute/fixed + offsets
// via className) so the primitive doesn't try to be a portal /
// anchor system — that's a much bigger surface and not worth
// the abstraction at dig.haus's current scale.

type PopoverTone = 'default' | 'accent' | 'accent-faint';
type PopoverRadius = 'md' | 'lg' | 'xl' | '2xl';
type PopoverPad = 'none' | 'sm' | 'md' | 'lg';
type PopoverShadow = 'lg' | 'xl' | '2xl';

type PopoverProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode;
  className?: string;
  /** panel (default) — bg-panel; strong — bg-panel-strong.
   *  Strong is the common default for menus / tooltips that sit
   *  above the page so they read as a separate layer; default
   *  for inline reveals that should feel like they belong to
   *  the surface beneath. */
  strong?: boolean;
  /** Border tone: default (white/10), accent (accent/40, themed
   *  tooltips), accent-faint (accent/25, hover-card style). */
  tone?: PopoverTone;
  /** Corner radius — popovers tend to be lg/xl rather than the
   *  full 12px panel system. */
  radius?: PopoverRadius;
  /** Inner padding. `none` for menu-list surfaces that pad each
   *  item independently. */
  pad?: PopoverPad;
  /** Shadow weight. Floating UI always carries shadow; the only
   *  question is how much. */
  shadow?: PopoverShadow;
  /** Animate in with the global fadeInUp 150ms keyframe. Skip
   *  for tooltips that should appear instantly. */
  animate?: boolean;
};

const TONE: Record<PopoverTone, string> = {
  default: 'border border-white/10',
  accent: 'border border-accent/40',
  'accent-faint': 'border border-accent/25',
};

const RADIUS: Record<PopoverRadius, string> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
};

const PAD: Record<PopoverPad, string> = {
  none: '',
  sm: 'p-2.5',
  md: 'p-3',
  lg: 'p-5',
};

const SHADOW: Record<PopoverShadow, string> = {
  lg: 'shadow-lg',
  xl: 'shadow-xl',
  '2xl': 'shadow-2xl',
};

const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  {
    children,
    className = '',
    strong = true,
    tone = 'default',
    radius = 'lg',
    pad = 'md',
    shadow = 'xl',
    animate = false,
    ...rest
  },
  ref
) {
  const bg = strong ? 'bg-panel-strong' : 'bg-panel';
  const motion = animate ? 'animate-[fadeInUp_150ms_ease-out]' : '';
  return (
    <div
      {...rest}
      ref={ref}
      className={`${bg} ${TONE[tone]} ${RADIUS[radius]} ${PAD[pad]} ${SHADOW[shadow]} ${motion} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
});

export default Popover;
