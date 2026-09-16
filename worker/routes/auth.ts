import { Hono } from 'hono';
import {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
  type SessionDTO,
} from '../../shared/api';
import { enqueue } from '../jobs/messages';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/crypto';
import { AppError, invalid } from '../lib/errors';
import { ulid } from '../lib/ids';
import { json } from '../lib/validate';
import { ensureCsrfToken } from '../middleware/csrf';
import { clientIp, limit } from '../middleware/rate-limit';
import { createSession, destroySession, requireCustomer } from '../middleware/session';
import { mergeGuestCart } from '../services/cart';
import { customerByEmail, customerById, customerDTO, passwordIterations } from '../services/customers';
import { consumeToken, issueToken, recentTokenCount } from '../services/tokens';
import type { AppEnv, Ctx } from '../types';

export const auth = new Hono<AppEnv>();

const WRONG = 'That email and password do not match';

async function session(c: Ctx, customerId: string | null): Promise<SessionDTO> {
  const csrfToken = ensureCsrfToken(c);
  const row = customerId ? await customerById(c.env.DB, customerId) : null;
  return { customer: row ? customerDTO(row) : null, csrfToken };
}

async function sendVerification(c: Ctx, customer: { id: string; email: string; name: string }) {
  const token = await issueToken(c.env.DB, 'customer', customer.id, 'verify_email');
  await enqueue(c.env, { type: 'email.verify', to: customer.email, name: customer.name, url: `${c.env.APP_URL}/account/verify?token=${token}` });
}

auth.get('/auth/session', async (c) => c.json(await session(c, c.get('customer')?.id ?? null)));

auth.post('/auth/register', json(RegisterInput), async (c) => {
  await limit(c, 'RL_AUTH', `register:${clientIp(c)}`);
  const d1 = c.env.DB;
  const { email, password, name, acceptsMarketing } = c.req.valid('json');
  const existing = await customerByEmail(d1, email);
  if (existing?.password_hash) throw invalid({ email: 'An account already exists for this email — sign in instead' });

  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER, passwordIterations(c.env));
  const now = Date.now();
  let id: string;
  if (existing) {
    // a shopper who checked out as a guest claims their record; past orders stay
    // hidden until they prove they own the email (see account routes)
    id = existing.id;
    await d1
      .prepare(`UPDATE customers SET password_hash = ?, name = CASE WHEN name = '' THEN ? ELSE name END, accepts_marketing = max(accepts_marketing, ?), updated_at = ? WHERE id = ? AND password_hash IS NULL`)
      .bind(hash, name, acceptsMarketing ? 1 : 0, now, id)
      .run();
  } else {
    id = ulid(now);
    await d1
      .prepare(
        `INSERT INTO customers (id, email, password_hash, name, phone, email_verified_at, accepts_marketing, session_epoch, orders_count, total_spent_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 0, 0, ?, ?)`,
      )
      .bind(id, email, hash, name, acceptsMarketing ? 1 : 0, now, now)
      .run();
  }
  if (acceptsMarketing) {
    await d1
      .prepare(`INSERT INTO subscribers (email, customer_id, source, status, created_at, updated_at) VALUES (?, ?, 'account', 'subscribed', ?, ?) ON CONFLICT(email) DO UPDATE SET status = 'subscribed', customer_id = excluded.customer_id, updated_at = excluded.updated_at`)
      .bind(email, id, now, now)
      .run();
  }

  const row = (await customerById(d1, id))!;
  await createSession(c, 'customer', id, row.session_epoch);
  await mergeGuestCart(c, id);
  await sendVerification(c, row);
  return c.json(await session(c, id), 201);
});

auth.post('/auth/login', json(LoginInput), async (c) => {
  const { email, password } = c.req.valid('json');
  await limit(c, 'RL_AUTH', `login-ip:${clientIp(c)}`);
  await limit(c, 'RL_AUTH', `login-email:${email}`);
  const d1 = c.env.DB;
  const iterations = passwordIterations(c.env);
  const row = await customerByEmail(d1, email);
  if (!row?.password_hash) {
    await burnPasswordCheck(password, c.env.PASSWORD_PEPPER, iterations);
    throw new AppError('UNAUTHENTICATED', WRONG, { fields: { password: WRONG } });
  }
  const check = await verifyPassword(password, row.password_hash, c.env.PASSWORD_PEPPER, iterations);
  if (!check.ok) throw new AppError('UNAUTHENTICATED', WRONG, { fields: { password: WRONG } });
  if (check.needsRehash) {
    await d1.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').bind(await hashPassword(password, c.env.PASSWORD_PEPPER, iterations), row.id).run();
  }
  await createSession(c, 'customer', row.id, row.session_epoch);
  await mergeGuestCart(c, row.id);
  return c.json(await session(c, row.id));
});

auth.post('/auth/logout', async (c) => {
  await destroySession(c, 'customer');
  return c.body(null, 204);
});

auth.post('/auth/verify-email', json(VerifyEmailInput), async (c) => {
  await limit(c, 'RL_AUTH', `verify:${clientIp(c)}`);
  const found = await consumeToken(c.env.DB, 'verify_email', c.req.valid('json').token);
  if (!found || found.subjectType !== 'customer') {
    throw new AppError('BAD_REQUEST', 'This link has expired or was already used. Sign in and send a new one.');
  }
  await c.env.DB.prepare('UPDATE customers SET email_verified_at = coalesce(email_verified_at, ?), updated_at = ? WHERE id = ?').bind(Date.now(), Date.now(), found.subjectId).run();
  return c.json(await session(c, c.get('customer')?.id ?? null));
});

auth.post('/auth/resend-verification', async (c) => {
  const id = requireCustomer(c);
  await limit(c, 'RL_AUTH', `resend:${id}`);
  const row = await customerById(c.env.DB, id);
  if (row && !row.email_verified_at) {
    if ((await recentTokenCount(c.env.DB, 'customer', id, 'verify_email', 15 * 60_000)) < 3) await sendVerification(c, row);
  }
  return c.body(null, 204);
});

auth.post('/auth/forgot-password', json(ForgotPasswordInput), async (c) => {
  const { email } = c.req.valid('json');
  await limit(c, 'RL_AUTH', `forgot-ip:${clientIp(c)}`);
  await limit(c, 'RL_AUTH', `forgot-email:${email}`);
  const row = await customerByEmail(c.env.DB, email);
  // same answer whether or not the account exists
  if (row?.password_hash && (await recentTokenCount(c.env.DB, 'customer', row.id, 'reset_password', 15 * 60_000)) < 3) {
    const token = await issueToken(c.env.DB, 'customer', row.id, 'reset_password');
    await enqueue(c.env, { type: 'email.password_reset', to: row.email, name: row.name, url: `${c.env.APP_URL}/account/reset?token=${token}` });
  }
  return c.body(null, 204);
});

auth.post('/auth/reset-password', json(ResetPasswordInput), async (c) => {
  await limit(c, 'RL_AUTH', `reset:${clientIp(c)}`);
  const { token, password } = c.req.valid('json');
  const d1 = c.env.DB;
  const found = await consumeToken(d1, 'reset_password', token);
  if (!found || found.subjectType !== 'customer') {
    throw new AppError('BAD_REQUEST', 'This link has expired or was already used. Ask for a new one.');
  }
  const now = Date.now();
  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER, passwordIterations(c.env));
  // a reset signs out every other device and proves the email is theirs
  await d1
    .prepare('UPDATE customers SET password_hash = ?, session_epoch = session_epoch + 1, email_verified_at = coalesce(email_verified_at, ?), updated_at = ? WHERE id = ?')
    .bind(hash, now, now, found.subjectId)
    .run();
  const row = (await customerById(d1, found.subjectId))!;
  await createSession(c, 'customer', row.id, row.session_epoch);
  await mergeGuestCart(c, row.id);
  return c.json(await session(c, row.id));
});
