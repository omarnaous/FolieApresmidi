import type { z } from 'zod';
import { ApiError } from './contract';

/** Dotted path ("variants.2.price") → message. "_" holds form-level messages. */
export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map((p) => String(p)).join('.') : '_';
    out[key] ??= issue.message;
  }
  return out;
}

export const apiFieldErrors = (err: unknown): FieldErrors => (err instanceof ApiError ? { ...err.fields } : {});

/** Keep only errors under `prefix.` and strip the prefix. */
export function scopeErrors(errors: FieldErrors, prefix: string): FieldErrors {
  const out: FieldErrors = {};
  const p = `${prefix}.`;
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(p)) out[k.slice(p.length)] = v;
  return out;
}

/** Validate a payload against a contract schema; returns errors or null. */
export function validate<S extends z.ZodType>(schema: S, payload: unknown): FieldErrors | null {
  const r = schema.safeParse(payload);
  return r.success ? null : zodFieldErrors(r.error);
}

/** Human label for a dotted path, for the error summary. */
export function pathLabel(path: string): string {
  if (path === '_') return 'Form';
  return path
    .split('.')
    .map((seg) => (/^\d+$/.test(seg) ? `#${Number(seg) + 1}` : seg.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()))
    .join(' › ')
    .replace(/^./, (c) => c.toUpperCase());
}
