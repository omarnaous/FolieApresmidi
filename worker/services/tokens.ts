import { randomToken, sha256Hex } from '../lib/crypto';
import { ulid } from '../lib/ids';

export type TokenPurpose = 'verify_email' | 'reset_password' | 'staff_invite';
export type TokenSubject = 'customer' | 'staff';

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  staff_invite: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Emailed tokens: 256 random bits, stored only as a SHA-256 hash, single use,
 * short-lived. Issuing a new one retires older unused tokens for the same purpose.
 */
export async function issueToken(d1: D1Database, subjectType: TokenSubject, subjectId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await d1.batch([
    d1
      .prepare(`UPDATE auth_tokens SET used_at = ? WHERE subject_type = ? AND subject_id = ? AND purpose = ? AND used_at IS NULL`)
      .bind(now, subjectType, subjectId, purpose),
    d1
      .prepare(
        `INSERT INTO auth_tokens (id, subject_type, subject_id, purpose, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(ulid(now), subjectType, subjectId, purpose, await sha256Hex(token), now + TOKEN_TTL[purpose], now),
  ]);
  return token;
}

/** Atomically marks the token used; null if unknown, used, expired or for another purpose. */
export async function consumeToken(
  d1: D1Database,
  purpose: TokenPurpose,
  token: string,
): Promise<{ subjectType: TokenSubject; subjectId: string } | null> {
  const now = Date.now();
  const row = await d1
    .prepare(
      `UPDATE auth_tokens SET used_at = ?
        WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
        RETURNING subject_type, subject_id`,
    )
    .bind(now, await sha256Hex(token), purpose, now)
    .first<{ subject_type: TokenSubject; subject_id: string }>();
  return row ? { subjectType: row.subject_type, subjectId: row.subject_id } : null;
}

/** How many tokens of this purpose were issued to a subject recently (hard reset-rate cap). */
export async function recentTokenCount(d1: D1Database, subjectType: TokenSubject, subjectId: string, purpose: TokenPurpose, windowMs: number): Promise<number> {
  const row = await d1
    .prepare(`SELECT COUNT(*) AS n FROM auth_tokens WHERE subject_type = ? AND subject_id = ? AND purpose = ? AND created_at > ?`)
    .bind(subjectType, subjectId, purpose, Date.now() - windowMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
