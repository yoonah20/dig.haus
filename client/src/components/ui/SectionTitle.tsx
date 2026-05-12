import type { ReactNode } from 'react';

// Section heading for the album page (and any other surface that
// wants the same look). Standard variant matches what the live page
// already uses (text-2xl Playfair serif white) — locking it into
// a primitive lets PR3+ replace the duplicated `<h2 className="...">`
// declarations with a single import, and keeps any future
// retune (different size, leading, optional trailing meta slot) in
// one place.
//
// `tape` variant is the "디제이 노트" ornament direction — borrows
// the masking-tape language from mydig storefront for sections that
// should read as hand-placed labels on a record-shop counter rather
// than typeset headings. Implemented as a styled block (cream
// background + tape-ink color + small tilt + handwritten font)
// rather than the SVG ragged-edge TapeLabel from mydig primitives,
// because that one is scene-composition with seeded jitter; for
// an inline heading a CSS-only treatment is cheaper and reads the
// same at section-title size.

type SectionTitleProps = {
  children: ReactNode;
  /** When set, renders alongside the title in a smaller muted style —
   *  e.g. "12명의 평" next to "고객 50자 평". */
  meta?: ReactNode;
  /** Visual treatment. `default` is the typeset Playfair heading;
   *  `tape` is the masking-tape variant for the ornament direction. */
  variant?: 'default' | 'tape';
  className?: string;
};

export default function SectionTitle({
  children,
  meta,
  variant = 'default',
  className = '',
}: SectionTitleProps) {
  if (variant === 'tape') {
    // <h2> for semantics — the inline-flex visual still works on a
    // heading element. Outer is the heading, inner span is the
    // tape-styled label, so screen readers still see "Heading: 리뷰
    // 모음집" while sighted readers see the masking-tape treatment.
    return (
      <h2 className={`mb-6 flex items-center gap-3 flex-wrap ${className}`}>
        <span
          className="inline-block bg-tape-cream text-tape-ink px-3 py-1 text-lg font-semibold"
          style={{
            fontFamily:
              "'Gaegu', 'Nanum Pen Script', 'Caveat', 'Bradley Hand', cursive",
            transform: 'rotate(-2deg)',
            // Subtle inner shadow so the tape reads as physical paper
            // pressed flat against the surface, not a flat fill.
            boxShadow:
              '0 2px 4px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)',
            // Letter-spacing slightly negative so the handwritten
            // glyphs sit closer together — Gaegu's default tracking
            // reads as "drawn carefully", whereas a real tape label
            // is hand-marked quickly.
            letterSpacing: '-0.01em',
          }}
        >
          {children}
        </span>
        {meta && (
          <span className="text-sm text-gray-500 font-sans font-normal inline-flex items-center gap-1.5">
            {meta}
          </span>
        )}
      </h2>
    );
  }

  return (
    <h2
      className={`text-editorial-md font-bold text-white mb-6 font-serif inline-flex items-center gap-3 ${className}`}
    >
      <span>{children}</span>
      {meta && (
        <span className="text-sm text-gray-500 font-sans font-normal">
          {meta}
        </span>
      )}
    </h2>
  );
}
