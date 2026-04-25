import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  Ref,
} from 'react';
import { forwardRef } from 'react';

// Form-control chrome. The album page's form surfaces (admin URL
// input, manual entry textarea, score input, excerpt edits) all
// independently reinvented `bg-[#0f0f0f] border border-white/10
// rounded-md` with subtly different padding — the audit flagged
// the dark-on-dark contrast as too low and the ad-hoc rounding as
// part of the "early-development" feel. Field locks the chrome
// (panel-strong bg, panel-input radius, amber focus ring) and
// callers just pick the kind via the `as` prop.

const FIELD_CHROME =
  'bg-panel-strong border border-white/10 rounded-input px-3 py-2 text-sm text-gray-200 placeholder-gray-500 transition-colors focus:border-[#e8a020]/60 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { as?: 'input' };
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  as: 'textarea';
};
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  as: 'select';
};

type FieldProps = InputProps | TextareaProps | SelectProps;

const Field = forwardRef<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  FieldProps
>(function Field(props, ref) {
  const { className = '', ...rest } = props as FieldProps & {
    className?: string;
  };
  const merged = `${FIELD_CHROME} ${className}`.trim();

  if ('as' in rest && rest.as === 'textarea') {
    const { as: _as, ...textareaProps } = rest;
    return (
      <textarea
        {...textareaProps}
        ref={ref as Ref<HTMLTextAreaElement>}
        className={merged}
      />
    );
  }
  if ('as' in rest && rest.as === 'select') {
    const { as: _as, ...selectProps } = rest;
    return (
      <select
        {...selectProps}
        ref={ref as Ref<HTMLSelectElement>}
        className={merged}
      />
    );
  }
  const { as: _as, ...inputProps } = rest as InputProps;
  return (
    <input
      {...inputProps}
      ref={ref as Ref<HTMLInputElement>}
      className={merged}
    />
  );
});

export default Field;
export { FIELD_CHROME };
