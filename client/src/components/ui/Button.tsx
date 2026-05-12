import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Shared button primitive. Consolidates the dozens of hand-rolled
// `bg-accent text-black ... hover:bg-...` / `border-accent/60 text-accent
// hover:bg-accent ...` / red-tinted delete patterns the audit found
// scattered across nav buttons, modal save / cancel, form CTAs, and
// inline actions. The three variants cover the visual roles
// the design language has settled into:
//
//   primary — filled amber, dark ink. The "do the thing" button:
//     submit, save, register, confirm.
//   ghost   — transparent on the page, amber border + amber label,
//     hover fills. Used for secondary actions and the round nav
//     icon buttons (with iconOnly).
//   danger  — transparent + red border + red label, hover fills red.
//     Used for destructive actions: delete account, clear data,
//     remove links. Cards already have CardOverlayButton for the
//     small corner-action variant — this one is the standard-size
//     destructive button when the action is the main CTA of a row
//     or panel.
//
// iconOnly switches the geometry from a rectangular pill to a
// circle (rounded-full + square dimensions). All the nav icon
// buttons (digger / mydig / search / login) collapse onto this.
//
// Specialised buttons that don't fit the three variants stay
// hand-rolled — split-pill voting buttons (굿굿/별루, 샀음/살거),
// sticker chips, and any button whose interaction is the
// primitive's identity rather than a generic action. The escape
// hatch is `className` which appends to (rather than replaces)
// the variant's class list.

type ButtonVariant = 'primary' | 'ghost' | 'ghost-soft' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Round icon-only button (nav icons, toolbar actions). Forces a
   *  square footprint at the size's pixel dimensions and switches
   *  rounded-md → rounded-full. Children should be a single icon
   *  glyph (SVG, emoji, mask-image). */
  iconOnly?: boolean;
  children: ReactNode;
}

// Variant tokens — kept here as the single source of truth. Other
// surfaces that want the same look can pull these classes via the
// Button component rather than retyping the soup.
// Disabled rules — `disabled:opacity-50` is the universal fade.
// Ghost / danger variants additionally cancel their hover fills
// while disabled, otherwise a disabled-and-hovered button would
// flash the active hover state at 50% opacity which reads as a
// confusing "is this clickable?" affordance. Primary keeps its
// hover fill at 50% since accent → accent-hover is a small enough
// shift not to mislead.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-ink font-semibold hover:bg-accent-hover disabled:opacity-50',
  ghost:
    'bg-transparent border border-accent/60 text-accent hover:bg-accent hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-accent',
  // ghost-soft — same amber border/text language as ghost but with a
  // gentler hover that only tints the surface (bg-accent/10) rather
  // than filling it solid. Used inside modals where the bolder ghost
  // fill reads as too loud against the quieter dialog tone (Username
  // Modal, Snapshot save dialog, VinylWallEditor confirm bar).
  'ghost-soft':
    'bg-transparent border border-accent/60 text-accent hover:bg-accent/10 hover:border-accent disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-accent/60',
  danger:
    'bg-transparent border border-red-500/40 text-red-400 hover:bg-red-500/90 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-red-400',
};

// Rectangular sizes — text + horizontal padding tuned so the two
// sizes feel distinct without becoming an explicit "small / large"
// pair (we don't have a lg yet; add if a third size earns its
// place).
const SIZE: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1',
  md: 'text-sm px-4 py-1.5',
};

// Icon-only — square + rounded-full so nav glyphs sit in a circle.
// sm matches the inline corner-action chips (SearchBar +/⚡, etc).
// md matches the existing nav-button footprint (w-8 h-8) so swapping
// nav buttons over to <Button iconOnly size="md"> doesn't shift any
// nav layout px.
const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-7 h-7 p-0',
  md: 'w-8 h-8 p-0',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const shape = iconOnly ? 'rounded-full' : 'rounded-md';
  const dims = iconOnly ? ICON_SIZE[size] : SIZE[size];
  return (
    <button
      type={type}
      {...rest}
      className={[
        'inline-flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed',
        shape,
        dims,
        VARIANT[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  );
}
