import type { ZodError } from 'zod';
import type { ErrorCode } from '../../shared/api';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  OUT_OF_STOCK: 409,
  CHECKOUT_EXPIRED: 410,
  DISCOUNT_INVALID: 422,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

/** Every failure the API reports on purpose. Anything else is a 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, opts: { fields?: Record<string, string>; details?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = opts.fields;
    this.details = opts.details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (message = 'Not found') => new AppError('NOT_FOUND', message);
export const badRequest = (message: string) => new AppError('BAD_REQUEST', message);
export const conflict = (message: string, details?: unknown) => new AppError('CONFLICT', message, { details });
export const forbidden = (message = 'You do not have access to this') => new AppError('FORBIDDEN', message);
export const unauthenticated = (message = 'Please sign in') => new AppError('UNAUTHENTICATED', message);
export const invalid = (fields: Record<string, string>, message = 'Please check the highlighted fields') =>
  new AppError('VALIDATION_FAILED', message, { fields });

/** Zod issues → `{ "shippingAddress.city": "Required" }` (first message per path). */
export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** D1 surfaces constraint failures as plain messages; this names the one that fired. */
export function constraintName(err: unknown): string | null {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
  const check = /CHECK constraint failed: (\w+)/.exec(msg);
  if (check?.[1]) return check[1];
  const unique = /UNIQUE constraint failed: ([\w.]+(?:, [\w.]+)*)/.exec(msg);
  if (unique?.[1]) return `unique:${unique[1]}`;
  return null;
}
