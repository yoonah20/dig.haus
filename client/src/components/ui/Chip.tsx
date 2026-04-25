import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Pill-shaped badge / button. Replaces the bag of bespoke chip
// stylings the album page accumulated (admin curation buttons, tag
// pills, score badges, streaming-link buttons) — each had grown its
// own padding / radius / hover combo, which is what made the page
// read as built by five different people.
//
// Three semantic variants cover the existing usage cases:
//   default — neutral chrome, the most common state
//   accent  — amber-on-amber, used for primary admin actions
//   danger  — red, used for destructive admin actions
// Add a new variant only when a chip can't be expressed by the
// existing ones; resist one-off colors at call sites.

type ChipVariant = 'default' | 'accent' | 'danger';

type BaseProps = {
  children: ReactNode;
  className?: string;
  variant?: ChipVariant;
};

type ChipAsSpan = BaseProps & {
  as?: 'span';
};

type ChipAsButton = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    as: 'button';
  };

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  default:
    'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:border-white/20',
  accent:
    'bg-[#e8a020]/10 text-[#e8a020] border border-[#e8a020]/40 hover:bg-[#e8a020]/15 hover:border-[#e8a020]/60',
  danger:
    'bg-red-500/10 text-red-400 border border-red-500/40 hover:bg-red-500/15 hover:border-red-500/60',
};

export default function Chip(props: ChipAsSpan | ChipAsButton) {
  const { children, className = '', variant = 'default' } = props;
  const base = `inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`;

  if (props.as === 'button') {
    const { as: _as, variant: _v, className: _c, children: _ch, ...rest } = props;
    return (
      <button {...rest} className={base}>
        {children}
      </button>
    );
  }
  return <span className={base}>{children}</span>;
}
