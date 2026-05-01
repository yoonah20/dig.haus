// Empty-state mascot — digger illustration over a short Korean copy
// line. Rendered wherever a list / feed / modal section comes back
// empty. Centralising the treatment keeps the empty-state language
// across the site visually unified — same proportion, same muted
// type — so the mascot reads as the site's "nothing here" voice
// rather than a one-off illustration in any single screen.
//
// `variant` picks the asset + framing:
//   - 'default' (digman.webp): head-and-shoulders source, cropped to
//     head + face via object-cover + object-top so the bottom ~30%
//     torso doesn't eat vertical budget. Use for general empties —
//     no snapshots, no followers, no search hits, 404.
//   - 'sign'    (digman_sign.webp): digman holding a yellow A-frame
//     "work in progress" sign with the dig.haus logotype. The sign
//     is the central element so the asset is rendered uncropped
//     (object-contain) at a slightly larger footprint. Use for
//     "we're still working on it" empties — review-not-yet-collected,
//     pipeline-pending content. Reads as "곧 도착", not "비어 있음".
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
  /** 'default' = head-cropped digman; 'sign' = digman + WIP sign. */
  variant?: 'default' | 'sign';
  className?: string;
};

const SIZE_CLASSES: Record<
  NonNullable<DigmanEmptyProps['variant']>,
  Record<NonNullable<DigmanEmptyProps['size']>, string>
> = {
  // Default: ~80×64 (md) and ~160×128 (lg). 5:4 crop matches the
  // SectionTitle pairing on the home feed so proportions stay
  // consistent across surfaces.
  default: {
    md: 'w-20 h-16',
    lg: 'w-40 h-32',
  },
  // Sign: larger than default because the WIP sign holds a logotype
  // + warning symbol that needs to be legible — shrinking it past a
  // certain point turns the asset into an unreadable yellow blob.
  // Sized so the figure reads at glance even on review-section
  // empty states where it's the main focal point of the area.
  sign: {
    md: 'w-[168px] h-[144px]',
    lg: 'w-72 h-60',
  },
};

export default function DigmanEmpty({
  message,
  hint,
  size = 'md',
  variant = 'default',
  className = '',
}: DigmanEmptyProps) {
  const isSign = variant === 'sign';
  const src = isSign ? '/textures/digman_sign.webp' : '/textures/digman.webp';
  // Default crops head; sign keeps the whole composition visible.
  const imgFit = isSign
    ? 'object-contain object-center'
    : 'object-cover object-top';

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 py-6 text-center ${className}`}
    >
      <div className={`${SIZE_CLASSES[variant][size]} overflow-hidden`}>
        <img
          src={src}
          alt=""
          aria-hidden
          className={`block w-full h-full ${imgFit} opacity-80 select-none`}
          draggable={false}
        />
      </div>
      {/* Sign variant gets larger type because the asset itself is
          larger; default keeps the muted/quieter sizing it shipped
          with so it still reads as background voice on lists. */}
      <div
        className={`${
          isSign
            ? size === 'lg'
              ? 'text-lg'
              : 'text-base'
            : size === 'lg'
              ? 'text-base'
              : 'text-sm'
        } text-gray-500 italic`}
      >
        {message}
      </div>
      {hint && (
        <div className={`${isSign ? 'text-sm' : 'text-xs'} text-gray-600`}>
          {hint}
        </div>
      )}
    </div>
  );
}
