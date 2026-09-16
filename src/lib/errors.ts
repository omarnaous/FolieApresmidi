/**
 * Turning ApiError into words a shopper can act on, and into per-field
 * messages a form can pin to the right input.
 */
import type { z } from 'zod';
import { ApiError } from './api';

export const RATE_LIMITED_MESSAGE = 'Too many tries in a row. Wait a minute, then try again.';

export function messageFor(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(err instanceof ApiError)) return fallback;
  switch (err.code) {
    case 'RATE_LIMITED':
      return RATE_LIMITED_MESSAGE;
    case 'OUT_OF_STOCK': {
      const [line] = stockLines(err);
      if (!line) return 'Not enough in stock.';
      return line.available > 0 ? `Only ${line.available} left` : 'Sold out';
    }
    default:
      return err.message || fallback;
  }
}

/** OUT_OF_STOCK carries `{ lines: [{ variantId, available }] }`. */
export function stockLines(err: unknown): { variantId: string; available: number }[] {
  if (!(err instanceof ApiError) || err.code !== 'OUT_OF_STOCK') return [];
  const lines = (err.details as { lines?: unknown } | undefined)?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (l): l is { variantId: string; available: number } =>
      !!l && typeof l.variantId === 'string' && typeof l.available === 'number',
  );
}

export const isNotFound = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND');

export type FieldErrors = Record<string, string>;

/**
 * The server's field paths ("shippingAddress.city") mapped onto a form's own
 * ids. `map` returns the form id for a path, or null to drop it.
 */
export function apiFields(err: unknown, map: (path: string) => string | null = (p) => p): FieldErrors {
  if (!(err instanceof ApiError)) return {};
  const out: FieldErrors = {};
  for (const [path, message] of Object.entries(err.fields)) {
    const id = map(path);
    if (id && !out[id]) out[id] = message;
  }
  return out;
}

/** Same shape from a failed client-side parse, so both sources render alike. */
export function zodFields(error: z.ZodError, map: (path: string) => string | null = (p) => p): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const id = map(issue.path.map(String).join('.'));
    if (id && !out[id]) out[id] = issue.message;
  }
  return out;
}

/** Bring the first complaint into view, in the order the fields appear on the page. */
export function focusFirstError(errors: FieldErrors, order: string[], idFor: (field: string) => string) {
  const first = order.find((f) => errors[f]) ?? Object.keys(errors)[0];
  if (!first) return;
  const el = document.getElementById(idFor(first));
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.focus?.({ preventScroll: true });
}
