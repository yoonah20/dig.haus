import type { MouseEvent, ReactNode } from 'react';

// Unified overlay-button for admin/owner actions on cards (edit,
// delete, report, regenerate, etc). Shared across PurchaseLinksPanel,
// ReviewSection, and SimilarAlbums so all three cards advertise their
// actions with the same visual affordance — same 6×6 circle, same
// dark pill, same hover colour.
//
// Mobile note: hover reveal is gated behind `sm:`. On touch devices
// the buttons are visible at all times (there's no hover there);
// on desktop the card stays clean until the user points at it. The
// wrapping container should apply the reveal pattern (see usage at
// PurchaseLinksPanel.tsx ~L290).
export default function CardOverlayButton({
  onClick,
  title,
  children,
  variant = 'neutral',
  disabled = false,
}: {
  onClick: (e: MouseEvent) => void;
  title: string;
  children: ReactNode;
  variant?: 'neutral' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[13px] leading-none shadow-[0_2px_4px_rgba(0,0,0,0.4)] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        variant === 'danger'
          ? 'bg-[#1a1a1a] border-white/10 text-red-500 hover:text-red-300 hover:border-red-500/40'
          : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:text-[#e8a020] hover:border-[#e8a020]/50'
      }`}
    >
      {children}
    </button>
  );
}
