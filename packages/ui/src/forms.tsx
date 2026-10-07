import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Icon } from './primitives';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

export function Field({ label, hint, error, required, children, htmlFor, className }: FieldProps) {
  return (
    <div className={clsx('ex-field', className)}>
      {label ? (
        <label className="ex-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="req" aria-hidden>*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="ex-error" role="alert" id={htmlFor ? `${htmlFor}-err` : undefined}>
          <Icon name="CircleAlert" size={13} />
          {error}
        </span>
      ) : hint ? (
        <span className="ex-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  icon?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  wrapClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, icon, prefix, suffix, size = 'md', required, id, className, wrapClassName, disabled, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const input = (
    <div className={clsx('ex-input-wrap', size !== 'md' && `ex-input-wrap--${size}`, error && 'ex-input-wrap--invalid', disabled && 'ex-input-wrap--disabled', wrapClassName)}>
      {icon ? <Icon name={icon} size={size === 'md' ? 16 : 20} /> : null}
      {prefix ? <span className="ex-affix">{prefix}</span> : null}
      <input
        ref={ref}
        id={fid}
        className={clsx('ex-input', className)}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        required={required}
        disabled={disabled}
        {...rest}
      />
      {suffix ? <span className="ex-affix">{suffix}</span> : null}
    </div>
  );
  if (!label && !hint && !error) return input;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fid}>
      {input}
    </Field>
  );
});

export const SearchInput = forwardRef<HTMLInputElement, TextFieldProps & { onClear?: () => void }>(function SearchInput({ onClear, value, ...rest }, ref) {
  return (
    <TextField
      ref={ref}
      icon="Search"
      type="search"
      value={value}
      suffix={
        onClear && value ? (
          <button type="button" onClick={onClear} aria-label="Clear search" style={{ border: 0, background: 'none', cursor: 'pointer', display: 'grid', color: 'var(--text-muted)' }}>
            <Icon name="X" size={15} />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
});

/**
 * Scanner/keyboard input. Scanners type fast and end with Enter → onScan(code).
 * Keeps focus by default so billing never needs the mouse (§22, §53).
 */
export const BarcodeInput = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'onChange'> & { value: string; onChange: (v: string) => void; onScan: (code: string) => void }>(function BarcodeInput(
  { value, onChange, onScan, size = 'lg', placeholder = 'Scan barcode or search products…', ...rest },
  ref,
) {
  return (
    <TextField
      ref={ref}
      icon="ScanBarcode"
      size={size}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          e.preventDefault();
          onScan(value.trim());
        }
        rest.onKeyDown?.(e);
      }}
      {...rest}
    />
  );
});

export function Textarea({ label, hint, error, required, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fid}>
      <textarea id={fid} className="ex-textarea" required={required} {...rest} />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({ label, hint, error, options, placeholder, size, required, id, className, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { label?: ReactNode; hint?: ReactNode; error?: ReactNode; options: SelectOption[]; placeholder?: string; size?: 'sm' }) {
  const auto = useId();
  const fid = id ?? auto;
  const sel = (
    <select id={fid} className={clsx('ex-select', size && `ex-select--${size}`, className)} required={required} aria-invalid={!!error || undefined} {...rest}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!label && !hint && !error) return sel;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fid}>
      {sel}
    </Field>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="ex-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="ex-check">
      <input type="radio" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ex-switch" style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ex-switch__track" aria-hidden />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function QuantityStepper({ value, onChange, min = 0, max = 9999, step = 1, decimal, size, dark, label = 'Quantity' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; decimal?: boolean; size?: 'sm' | 'lg'; dark?: boolean; label?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (s: string) => {
    const n = decimal ? parseFloat(s) : parseInt(s, 10);
    if (isFinite(n)) onChange(Math.min(max, Math.max(min, decimal ? Math.round(n * 1000) / 1000 : n)));
    else setDraft(String(value));
  };
  return (
    <div className={clsx('ex-stepper', size && `ex-stepper--${size}`, dark && 'ex-stepper--dark')} role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))}>
        <Icon name="Minus" size={16} />
      </button>
      <input
        aria-label={label}
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, Math.round((value + step) * 1000) / 1000))}>
        <Icon name="Plus" size={16} />
      </button>
    </div>
  );
}

/** 4-digit PIN entry with on-screen keypad and physical keyboard support. */
export function PinInput({ length = 4, value, onChange, onComplete, error, autoFocus = true }: { length?: number; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; error?: boolean; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const set = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };
  return (
    <div className="ex-stack" style={{ alignItems: 'center' }}>
      <div className={clsx('ex-pin', error && 'ex-pin--error')} onClick={() => ref.current?.focus()}>
        {Array.from({ length }).map((_, i) => (
          <div key={i} className={clsx('ex-pin__cell', i < value.length && 'ex-pin__cell--filled', i === value.length && 'ex-pin__cell--active')}>
            {i < value.length ? '•' : ''}
          </div>
        ))}
      </div>
      <input ref={ref} className="sr-only" aria-label="PIN" inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => set(e.target.value)} />
      <NumericKeypad onKey={(k) => (k === 'back' ? set(value.slice(0, -1)) : k === 'clear' ? set('') : k === '.' ? undefined : set(value + k))} showDot={false} />
    </div>
  );
}

export function NumericKeypad({ onKey, showDot = true, compact, quick }: { onKey: (k: string) => void; showDot?: boolean; compact?: boolean; quick?: Array<{ label: string; onClick: () => void }> }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', showDot ? '.' : 'clear', '0', 'back'];
  return (
    <div className="ex-stack" style={{ width: '100%', maxWidth: 320, gap: 8 }}>
      {quick?.length ? (
        <div className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {quick.map((q) => (
            <button key={q.label} type="button" className="ex-chip" onClick={q.onClick}>
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={clsx('ex-keypad', compact && 'ex-keypad--compact')}>
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => onKey(k)} aria-label={k === 'back' ? 'Backspace' : k === 'clear' ? 'Clear' : k}>
            {k === 'back' ? <Icon name="Delete" size={20} /> : k === 'clear' ? <span style={{ fontSize: 14 }}>Clear</span> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
