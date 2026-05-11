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
//
// Click handling stops propagation + prevents default at the
// CardOverlayButton boundary. Most cards that host these overlays
// wrap an <a target="_blank"> at their root (review URL, purchase
// link), and on touch devices the bare <button> click would bubble
// to the parent anchor and navigate away before the handler's
// confirm/work could complete — making delete / edit / retranslate
// look "broken" on mobile. The button always intercepts the event
// so callers don't need to remember to pass `e` through every
// single handler signature.
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
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(e);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[13px] leading-none shadow-[0_2px_4px_rgba(0,0,0,0.4)] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        variant === 'danger'
          ? 'bg-panel border-white/10 text-red-500 hover:text-red-300 hover:border-red-500/40'
          : 'bg-panel border-white/10 text-gray-300 hover:text-accent hover:border-accent/50'
      }`}
    >
      {children}
    </button>
  );
}
