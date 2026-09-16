import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { decimalsFor, formatRate, parseMoney, toMajorString } from '../lib/contract';
import { cx } from '../lib/util';
import { IconClose } from './icons';

interface FieldBits {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  /** right-aligned note beside the label, e.g. a character counter */
  aside?: ReactNode;
  labelHidden?: boolean;
  optional?: boolean;
  className?: string;
}

const describedBy = (id: string, error?: string, hint?: ReactNode) =>
  [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

export function Field({ id, label, error, hint, aside, labelHidden, optional, className, children }: FieldBits & { id: string; children: ReactNode }) {
  return (
    <div className={cx('adm-field', error && 'adm-field--error', className)}>
      <div className={cx('adm-field__top', labelHidden && 'adm-sr')}>
        <label htmlFor={id} className="adm-field__label">
          {label}
          {optional && <span className="adm-field__opt"> (optional)</span>}
        </label>
        {aside && <span className="adm-field__aside">{aside}</span>}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="adm-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="adm-field__error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Label-less inputs in the same shape, for table cells etc. */
export const useFieldId = (id?: string) => {
  const auto = useId();
  return id ?? auto;
};

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & FieldBits & { prefix?: ReactNode; suffix?: ReactNode };

export function TextInput({ label, error, hint, aside, labelHidden, optional, className, id, prefix, suffix, ...rest }: InputProps) {
  const iid = useFieldId(id);
  const input = (
    <input id={iid} className="adm-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(iid, error, hint)} {...rest} />
  );
  return (
    <Field id={iid} label={label} error={error} hint={hint} aside={aside} labelHidden={labelHidden} optional={optional} className={className}>
      {prefix || suffix ? (
        <div className="adm-affix">
          {prefix && <span className="adm-affix__part">{prefix}</span>}
          {input}
          {suffix && <span className="adm-affix__part">{suffix}</span>}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & FieldBits;

export function Textarea({ label, error, hint, aside, labelHidden, optional, className, id, rows = 4, ...rest }: TextareaProps) {
  const iid = useFieldId(id);
  return (
    <Field id={iid} label={label} error={error} hint={hint} aside={aside} labelHidden={labelHidden} optional={optional} className={className}>
      <textarea id={iid} rows={rows} className="adm-input adm-textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(iid, error, hint)} {...rest} />
    </Field>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & FieldBits;

export function Select({ label, error, hint, aside, labelHidden, optional, className, id, children, ...rest }: SelectProps) {
  const iid = useFieldId(id);
  return (
    <Field id={iid} label={label} error={error} hint={hint} aside={aside} labelHidden={labelHidden} optional={optional} className={className}>
      <select id={iid} className="adm-input adm-select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(iid, error, hint)} {...rest}>
        {children}
      </select>
    </Field>
  );
}

/** Characters-used counter for the `aside` slot. */
export const CharCount = ({ value, max }: { value: string; max: number }) => (
  <span className={cx('adm-count', value.length > max && 'adm-count--over')}>
    {value.length}/{max}
  </span>
);

/* ── Numeric inputs: text state while typing, integers out ── */

interface NumericBase extends FieldBits {
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}

function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * Money in minor units. Shows major units; parses with parseMoney (no floats).
 * Emits null for empty or unparseable text.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  ...field
}: NumericBase & { value: number | null; onChange: (cents: number | null) => void; currency: string }) {
  const toText = (v: number | null) => (v === null ? '' : toMajorString(v, currency));
  const [text, setText] = useState(() => toText(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (parseMoney(text, currency) !== value) {
      setText(value === null ? '' : toMajorString(value, currency));
      setInvalid(false);
    }
    // only react to outside changes of `value`
  }, [value, currency]);

  const d = decimalsFor(currency);
  return (
    <NumericShell
      {...field}
      error={field.error ?? (invalid ? `Enter an amount like ${d ? `12.${'0'.repeat(d)}` : '12'}` : undefined)}
      text={text}
      inputMode={d ? 'decimal' : 'numeric'}
      prefix={currencySymbol(currency)}
      onText={(t) => {
        setText(t);
        const parsed = t.trim() === '' ? null : parseMoney(t, currency);
        setInvalid(t.trim() !== '' && parsed === null);
        onChange(parsed);
      }}
      onBlur={() => {
        const parsed = parseMoney(text, currency);
        if (parsed !== null) setText(toMajorString(parsed, currency));
      }}
    />
  );
}

/** Whole numbers. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
  ...field
}: NumericBase & { value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; suffix?: ReactNode }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    const parsed = /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : null;
    if (parsed !== value) setText(value === null ? '' : String(value));
  }, [value]);
  const trimmed = text.trim();
  const parsed = /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
  let localError: string | undefined;
  if (trimmed !== '' && parsed === null) localError = 'Enter a whole number';
  else if (parsed !== null && min !== undefined && parsed < min) localError = `Minimum ${min}`;
  else if (parsed !== null && max !== undefined && parsed > max) localError = `Maximum ${max}`;
  return (
    <NumericShell
      {...field}
      error={field.error ?? localError}
      text={text}
      inputMode="numeric"
      suffix={suffix}
      onText={(t) => {
        setText(t);
        const n = /^-?\d+$/.test(t.trim()) ? Number(t.trim()) : null;
        onChange(n);
      }}
    />
  );
}

/** Percent typed as "11.5", stored as basis points (1150). */
export function PercentInput({ value, onChange, ...field }: NumericBase & { value: number | null; onChange: (bps: number | null) => void }) {
  const toText = (v: number | null) => (v === null ? '' : formatRate(v).slice(0, -1));
  const [text, setText] = useState(() => toText(value));
  useEffect(() => {
    if (parseMoney(text, 'USD') !== value) setText(value === null ? '' : formatRate(value).slice(0, -1));
  }, [value]);
  const parsed = text.trim() === '' ? null : parseMoney(text, 'USD');
  const localError = text.trim() !== '' && (parsed === null || parsed > 10_000) ? 'Enter a percentage from 0 to 100, up to 2 decimals' : undefined;
  return (
    <NumericShell
      {...field}
      error={field.error ?? localError}
      text={text}
      inputMode="decimal"
      suffix="%"
      onText={(t) => {
        setText(t);
        const n = t.trim() === '' ? null : parseMoney(t, 'USD');
        onChange(n !== null && n <= 10_000 ? n : null);
      }}
    />
  );
}

function NumericShell({
  label,
  error,
  hint,
  aside,
  labelHidden,
  optional,
  className,
  id,
  disabled,
  placeholder,
  required,
  text,
  onText,
  onBlur,
  inputMode,
  prefix,
  suffix,
}: NumericBase & {
  text: string;
  onText: (t: string) => void;
  onBlur?: () => void;
  inputMode: 'decimal' | 'numeric';
  prefix?: ReactNode;
  suffix?: ReactNode;
}) {
  const iid = useFieldId(id);
  return (
    <Field id={iid} label={label} error={error} hint={hint} aside={aside} labelHidden={labelHidden} optional={optional} className={className}>
      <div className="adm-affix">
        {prefix && <span className="adm-affix__part">{prefix}</span>}
        <input
          id={iid}
          className="adm-input adm-input--num"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(iid, error, hint)}
          onChange={(e) => onText(e.target.value)}
          onBlur={onBlur}
        />
        {suffix && <span className="adm-affix__part">{suffix}</span>}
      </div>
    </Field>
  );
}

/* ── Choice controls ── */

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
  disabled,
  className,
  id,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const iid = useFieldId(id);
  return (
    <div className={cx('adm-check', className)}>
      <input
        id={iid}
        type="checkbox"
        className="adm-check__box"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${iid}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <label htmlFor={iid} className="adm-check__label">
          {label}
        </label>
        {hint && (
          <p id={`${iid}-hint`} className="adm-field__hint">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
  className,
  labelHidden,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  labelHidden?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('adm-toggle', labelHidden && 'adm-toggle--bare', className)}>
      <div className={cx(labelHidden && 'adm-sr')}>
        <span id={`${id}-l`} className="adm-check__label">
          {label}
        </span>
        {hint && (
          <p id={`${id}-h`} className="adm-field__hint">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={disabled}
        className="adm-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="adm-switch__thumb" />
        <span className="adm-switch__text" aria-hidden="true">
          {checked ? 'On' : 'Off'}
        </span>
      </button>
    </div>
  );
}

/** Radio cards / segmented choice. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  columns,
  className,
}: {
  label: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; description?: ReactNode }[];
  disabled?: boolean;
  columns?: number;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx('adm-choices', className)} disabled={disabled}>
      <legend className="adm-field__label">{label}</legend>
      <div className="adm-choices__grid" style={columns ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.floor(560 / columns)}px), 1fr))` } : undefined}>
        {options.map((o) => (
          <label key={o.value} className={cx('adm-choice', value === o.value && 'adm-choice--on')}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="adm-choice__label">{o.label}</span>
            {o.description && <span className="adm-choice__desc">{o.description}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Free-form chips: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({
  label,
  value,
  onChange,
  placeholder = 'Type and press Enter',
  error,
  hint,
  max,
  id,
  className,
}: {
  label: ReactNode;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  max?: number;
  id?: string;
  className?: string;
}) {
  const iid = useFieldId(id);
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(max ? next.slice(0, max) : next);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <Field id={iid} label={label} error={error} hint={hint} className={className}>
      <div className={cx('adm-tags', error && 'adm-tags--error')}>
        {value.map((tag) => (
          <span key={tag} className="adm-chip">
            {tag}
            <button type="button" className="adm-chip__x" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
              <IconClose size={12} />
            </button>
          </span>
        ))}
        <input
          id={iid}
          className="adm-tags__input"
          value={draft}
          placeholder={value.length ? '' : placeholder}
          aria-describedby={describedBy(iid, error, hint)}
          onChange={(e) => {
            if (e.target.value.includes(',')) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
        />
      </div>
    </Field>
  );
}
