import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  Ref,
} from 'react';
import { forwardRef } from 'react';

// Form-control chrome. The album page's form surfaces (admin URL
// input, manual entry textarea, score input, excerpt edits) all
// independently reinvented `bg-panel-strong border border-white/10
// rounded-md` with subtly different padding — the audit flagged
// the dark-on-dark contrast as too low and the ad-hoc rounding as
// part of the "early-development" feel. Field locks the chrome
// (panel-strong bg, panel-input radius, amber focus ring) and
// callers just pick the kind via the `as` prop.
//
// size — md is the default standard-form chrome (px-3 py-2,
// text-sm); sm is the compact variant for tight forms like the
// SearchBar manual-entry grid (px-2.5 py-1.5, text-xs). Both
// share the same surface / border / focus language; only the
// rectangular box and the text scale shift.

const CHROME_BASE =
  'bg-panel-strong border border-white/10 text-gray-200 placeholder-gray-500 transition-colors focus:border-accent/60 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';

const CHROME_SIZE: Record<'sm' | 'md', string> = {
  sm: 'rounded px-2.5 py-1.5 text-xs',
  md: 'rounded-input px-3 py-2 text-sm',
};

// Re-exported for callers that need to compose the chrome on top
// of additional layout classes (e.g. ReviewSection's excerpt
// edit textarea adds resize-none / leading-snug). Default size
// is md to preserve the legacy callers that imported FIELD_CHROME
// before the size prop existed.
const FIELD_CHROME = `${CHROME_BASE} ${CHROME_SIZE.md}`;

type FieldSize = 'sm' | 'md';

// HTML <input> / <select> already have a `size` attribute that's a
// number (character width for text inputs, visible options for
// selects). We omit it to reclaim the prop name for our chrome
// scale — rarely used in dig.haus forms, and never on the
// surfaces being migrated here.
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  as?: 'input';
  size?: FieldSize;
};
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  as: 'textarea';
  size?: FieldSize;
};
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  as: 'select';
  size?: FieldSize;
};

type FieldProps = InputProps | TextareaProps | SelectProps;

const Field = forwardRef<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  FieldProps
>(function Field(props, ref) {
  // Pull our owned props out — className for merging, size for the
  // chrome scale, as for the element selector. Everything else
  // (`rest`) flows to the underlying element unchanged. The cast to
  // `any` on the rest spread sidesteps the strict tsc -b check that
  // refuses to spread a union with FieldSize-typed `size` into an
  // <input> whose native `size` expects number — we own that prop
  // by destructuring it out before the spread, so the runtime is
  // safe even though the type system can't follow that through the
  // discriminated union.
  const {
    className = '',
    size = 'md',
    as = 'input',
    ...rest
  } = props as {
    className?: string;
    size?: FieldSize;
    as?: 'input' | 'textarea' | 'select';
  } & Record<string, unknown>;
  const merged = `${CHROME_BASE} ${CHROME_SIZE[size]} ${className}`.trim();

  if (as === 'textarea') {
    return (
      <textarea
        {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        ref={ref as Ref<HTMLTextAreaElement>}
        className={merged}
      />
    );
  }
  if (as === 'select') {
    return (
      <select
        {...(rest as SelectHTMLAttributes<HTMLSelectElement>)}
        ref={ref as Ref<HTMLSelectElement>}
        className={merged}
      />
    );
  }
  return (
    <input
      {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      ref={ref as Ref<HTMLInputElement>}
      className={merged}
    />
  );
});

export default Field;
export { FIELD_CHROME };
