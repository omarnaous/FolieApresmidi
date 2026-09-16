/**
 * The checkout's field pattern — a pill input under a small label, a red
 * border and a line of explanation when something is wrong — for every form
 * in the storefront.
 */
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

interface Common {
  id: string;
  label: string;
  error?: string;
  /** not required; drops the asterisk */
  optional?: boolean;
  /** required, but no asterisk — for short forms where every field is */
  plain?: boolean;
  wide?: boolean;
  hint?: string;
}

const describedBy = (id: string, error?: string, hint?: string) =>
  [error ? `${id}-err` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

function Caption({ id, label, optional, plain, error, hint }: Common) {
  return (
    <>
      <span className="label muted">
        {label}
        {optional || plain ? '' : ' *'}
      </span>
      {hint && !error && <span className="label muted co-hint" id={`${id}-hint`}>{hint}</span>}
    </>
  );
}

export function TextField({
  id, label, error, optional, plain, wide, hint, ...input
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  return (
    <label className={`co-field ${error ? 'bad' : ''} ${wide ? 'wide' : ''}`} htmlFor={id}>
      <Caption id={id} label={label} optional={optional} plain={plain} error={error} hint={hint} />
      <input
        id={id}
        required={!optional}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        {...input}
      />
      {error && <span className="co-err label" id={`${id}-err`}>{error}</span>}
    </label>
  );
}

export function SelectField({
  id, label, error, optional, plain, wide, hint, options, ...select
}: Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { options: { value: string; label: string }[] }) {
  return (
    <label className={`co-field ${error ? 'bad' : ''} ${wide ? 'wide' : ''}`} htmlFor={id}>
      <Caption id={id} label={label} optional={optional} plain={plain} error={error} hint={hint} />
      <select
        id={id}
        required={!optional}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        {...select}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <span className="co-err label" id={`${id}-err`}>{error}</span>}
    </label>
  );
}

export function CheckField({
  id, label, checked, onChange, wide,
}: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; wide?: boolean }) {
  return (
    <label className={`co-check ${wide ? 'wide' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="label">{label}</span>
    </label>
  );
}

/** A form-level message: what went wrong that no single field owns. */
export function FormAlert({ message }: { message: string | null | undefined }) {
  return (
    <p className="co-alert-line label" role="alert" hidden={!message}>
      {message}
    </p>
  );
}
