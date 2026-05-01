// Empty-state mascot — the headlamp digger illustration over a short
// Korean copy line. Rendered wherever a list / feed / modal section
// comes back empty (no snapshots yet, no followers, no search hits).
// Centralising the treatment keeps the empty-state language across
// the site visually unified — same crop, same proportion, same muted
// type — so the mascot reads as the site's "nothing here" voice
// rather than a one-off illustration in any single screen.
//
// The image is cropped to head + face via object-cover + object-top;
// digman.webp is a head-and-shoulders illustration so the bottom
// ~30% of the source is torso that adds nothing in this context.
//
// `size` toggles between two presets — `md` for in-page feed empties
// (snapshot rail, modal lists), `lg` for full-page empties like the
// 404 catch-all where the mascot can fill more vertical budget.

type DigmanEmptyProps = {
  /** Korean copy under the mascot. Short — one line, no punctuation
   *  beyond the trailing period. */
  message: string;
  /** Optional secondary line (smaller, dimmer) below the message —
   *  for surfaces that want a follow-up hint. */
  hint?: string;
  size?: 'md' | 'lg';
  className?: string;
};

const SIZE_CLASSES: Record<NonNullable<DigmanEmptyProps['size']>, string> = {
  // ~80×64 (md) and ~160×128 (lg). Both keep the 5:4 crop ratio that
  // matches the SectionTitle pairing on the home feed so the mascot's
  // proportions stay consistent across surfaces.
  md: 'w-20 h-16',
  lg: 'w-40 h-32',
};

export default function DigmanEmpty({
  message,
  hint,
  size = 'md',
  className = '',
}: DigmanEmptyProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 py-6 text-center ${className}`}
    >
      <div className={`${SIZE_CLASSES[size]} overflow-hidden`}>
        <img
          src="/textures/digman.webp"
          alt=""
          aria-hidden
          className="block w-full h-full object-cover object-top opacity-80 select-none"
          draggable={false}
        />
      </div>
      <div
        className={`${size === 'lg' ? 'text-base' : 'text-sm'} text-gray-500 italic`}
      >
        {message}
      </div>
      {hint && (
        <div className="text-xs text-gray-600">{hint}</div>
      )}
    </div>
  );
}
