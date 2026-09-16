import { AppError } from './errors';

const MARKER = 'fdm_precondition_failed';

/**
 * A batch statement that aborts the whole D1 batch unless `condition` holds.
 *
 * D1 has no interactive transactions, so "update only if the order is still
 * pending" cannot be read-then-written safely. Instead the check runs inside
 * the batch: when the condition is false the statement evaluates json() on
 * invalid input, which raises, and D1 rolls every statement in the batch back.
 */
export function guard(d1: D1Database, condition: string, params: unknown[]): D1PreparedStatement {
  return d1.prepare(`SELECT CASE WHEN (${condition}) THEN 1 ELSE json('${MARKER}') END AS ok`).bind(...params);
}

export const isGuardFailure = (err: unknown): boolean => {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
  return /malformed JSON/i.test(msg);
};

/** Run a batch; a failed guard becomes a 409 with a shopper/staff-friendly message. */
export async function guardedBatch(d1: D1Database, statements: D1PreparedStatement[], conflictMessage: string): Promise<D1Result[]> {
  try {
    return await d1.batch(statements);
  } catch (err) {
    if (isGuardFailure(err)) throw new AppError('CONFLICT', conflictMessage);
    throw err;
  }
}
