// Z-index lift for the home hero's slot wrappers, JS-controlled.
//
// Earlier passes tried this as a pure CSS rule on `.dig-hero-slot`
// (`transition: z-index 0s linear 300ms` baseline + an override on
// `:has(.dig-postit:hover)` that flipped the delay to 0s). The
// asymmetric-delay pattern is correct on paper — z-index isn't
// interpolatable but a `0s linear <delay>` transition still makes
// the discrete jump fire after the delay — but in practice the
// browser's handling of "transition rule changes between hover-start
// and hover-end" is inconsistent enough that the operator kept
// seeing the slot z-down the moment hover ended, mid-shrink.
//
// JS resolves the ambiguity: lift sets the slot's inline z-index
// immediately and clears any pending release timer; release schedules
// the inline z-index removal via setTimeout. The timer ID lives on
// the slot itself (data-z-timer attribute) so two adjacent triggers
// inside the same slot (cover + post-it) coordinate without needing
// a shared React ref or context.

const TIMER_ATTR = 'data-z-timer';
const LIFT_Z = '60';

export function liftHeroSlot(el: HTMLElement | null) {
  const slot = el?.closest('.dig-hero-slot') as HTMLElement | null;
  if (!slot) return;
  const tid = slot.getAttribute(TIMER_ATTR);
  if (tid) {
    window.clearTimeout(Number(tid));
    slot.removeAttribute(TIMER_ATTR);
  }
  slot.style.zIndex = LIFT_Z;
}

export function releaseHeroSlot(
  el: HTMLElement | null,
  delayMs = 300
) {
  const slot = el?.closest('.dig-hero-slot') as HTMLElement | null;
  if (!slot) return;
  const tid = window.setTimeout(() => {
    slot.style.zIndex = '';
    slot.removeAttribute(TIMER_ATTR);
  }, delayMs);
  slot.setAttribute(TIMER_ATTR, String(tid));
}
