// Empty-state mascot — digger illustration over a short Korean copy
// line. Rendered wherever a list / feed / modal section comes back
// empty. Centralising the treatment keeps the empty-state language
// across the site visually unified — same proportion, same muted
// type — so the mascot reads as the site's "nothing here" voice
// rather than a one-off illustration in any single screen.
//
// `variant` picks the asset + framing:
//   - 'thinking' (digman_thinking.webp): finger-on-chin question
//     mark. Use for search-style empties where the user just
//     issued a query and got nothing back — the mascot reads as
//     "let me think where that is" rather than "it's not here".
//   - 'sad'      (digman_sad.webp): teardrop. Use for relational
//     empties (no followers, no following) where the absence has
//     a slight emotional charge.
//   - 'sleep'    (digman_sleep.webp): eyes closed, Z. Use for
//     dormant content surfaces (no snapshots, empty crate) —
//     reads as "this is waiting to be filled".
//   - 'dizzy'    (digman_dizzy.webp): spiral eyes. Use for 404 /
//     route-not-found — the digger's lost their bearings.
//   - 'sign'     (digman_signpost.webp): digman holding a yellow
//     A-frame "dig.haus" sign with a caution glyph. The sign is the
//     central element so the asset is rendered uncropped
//     (object-contain) at a slightly larger footprint. Use for
//     "we're still working on it" empties — review-not-yet-collected,
//     pipeline-pending content. Reads as "곧 도착", not "비어 있음".
//   - 'digging'  (digman_digging.webp): digman mid-swing with a
//     shovel. Use for in-flight pipeline state where work is
//     actively happening right now — auto-curation polling, batch
//     jobs in progress. Renders at full opacity (vs the muted 80%
//     the rest get) and slightly larger because the energy of the
//     pose is the point; a faded swing reads as static.
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
  /** Which expression to render. Each variant maps to one webp under
   *  /textures/. 'thinking' is the default for surfaces that don't
   *  pick an emotion explicitly. */
  variant?: 'thinking' | 'sad' | 'sleep' | 'dizzy' | 'sign' | 'digging';
  className?: string;
};

const VARIANT_SRC: Record<NonNullable<DigmanEmptyProps['variant']>, string> = {
  thinking: '/textures/digman_thinking.webp',
  sad: '/textures/digman_sad.webp',
  sleep: '/textures/digman_sleep.webp',
  dizzy: '/textures/digman_dizzy.webp',
  sign: '/textures/digman_signpost.webp',
  digging: '/textures/digman_digging.webp',
};

const SIZE_CLASSES: Record<
  NonNullable<DigmanEmptyProps['variant']>,
  Record<NonNullable<DigmanEmptyProps['size']>, string>
> = {
  // Head-and-shoulders mascot frames: ~1:1 aspect, rendered uncropped.
  // 96×96 (md) for in-page list empties, 160×160 (lg) for full-page
  // empties like 404 where the mascot can take more vertical budget.
  thinking: { md: 'w-24 h-24', lg: 'w-40 h-40' },
  sad: { md: 'w-24 h-24', lg: 'w-40 h-40' },
  sleep: { md: 'w-24 h-24', lg: 'w-40 h-40' },
  dizzy: { md: 'w-24 h-24', lg: 'w-40 h-40' },
  // Sign: larger than the expression variants because the asset holds
  // a "dig.haus" A-frame sign with a logotype + warning symbol that
  // needs to be legible — shrinking it past a certain point turns the
  // sign text into an unreadable yellow blob. Sized square to match
  // the source asset (550px square full-body) — earlier rectangular
  // frames (168×144 md / 288×240 lg) letterboxed the square source
  // and shrank the effective render to the height dimension.
  sign: {
    md: 'w-48 h-48',
    lg: 'w-80 h-80',
  },
  // Digging: same square footprint as sign — the asset is full-body
  // with the shovel swing taking up the diagonal, so it needs the
  // larger frame to read clearly.
  digging: {
    md: 'w-48 h-48',
    lg: 'w-80 h-80',
  },
};

export default function DigmanEmpty({
  message,
  hint,
  size = 'md',
  variant = 'thinking',
  className = '',
}: DigmanEmptyProps) {
  const isSign = variant === 'sign';
  const isDigging = variant === 'digging';
  const isLarge = isSign || isDigging;
  const src = VARIANT_SRC[variant];

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 py-6 text-center ${className}`}
    >
      <div className={SIZE_CLASSES[variant][size]}>
        <img
          src={src}
          alt=""
          aria-hidden
          // Digging renders at full opacity — the muted treatment that
          // works for "nothing here" expressions reads as a broken /
          // blurry image when the pose is conveying "actively working".
          className={`block w-full h-full object-contain object-center ${
            isDigging ? 'opacity-100' : 'opacity-80'
          } select-none`}
          draggable={false}
        />
      </div>
      {/* Larger asset variants (sign, digging) get larger type because
          the mascot itself is larger; expression variants keep the
          muted/quieter sizing so they still read as background voice
          on lists. */}
      <div
        className={`${
          isLarge
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
        <div className={`${isLarge ? 'text-sm' : 'text-xs'} text-gray-600`}>
          {hint}
        </div>
      )}
    </div>
  );
}
