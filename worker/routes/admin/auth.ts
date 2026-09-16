import { Hono } from 'hono';
import { AcceptInviteInput, AdminLoginInput, AdminSetupInput, ForgotPasswordInput, ResetPasswordInput, type AdminSessionDTO, type StaffDTO } from '../../../shared/api';
import { enqueue } from '../../jobs/messages';
import { burnPasswordCheck, hashPassword, safeEqual, verifyPassword } from '../../lib/crypto';
import { AppError, conflict } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { log } from '../../lib/log';
import { json } from '../../lib/validate';
import { ensureCsrfToken } from '../../middleware/csrf';
import { clientIp, limit } from '../../middleware/rate-limit';
import { createSession, destroySession, effectivePermissions } from '../../middleware/session';
import { passwordIterations } from '../../services/customers';
import { consumeToken, issueToken, recentTokenCount } from '../../services/tokens';
import type { AppEnv, Ctx } from '../../types';

export const adminAuth = new Hono<AppEnv>();

export interface StaffRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: StaffDTO['role'];
  permissions_json: string;
  status: StaffDTO['status'];
  session_epoch: number;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

export const staffDTO = (r: StaffRow): StaffDTO => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  permissions: effectivePermissions(r.role, r.permissions_json),
  status: r.status,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

const WRONG = 'That email and password do not match';

async function session(c: Ctx, staffId: string | null): Promise<AdminSessionDTO> {
  const d1 = c.env.DB;
  const csrfToken = ensureCsrfToken(c);
  const count = await d1.prepare('SELECT COUNT(*) AS n FROM staff_users').first<{ n: number }>();
  const row = staffId ? await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(staffId).first<StaffRow>() : null;
  return { staff: row ? staffDTO(row) : null, setupRequired: (count?.n ?? 0) === 0, csrfToken };
}

async function signIn(c: Ctx, row: StaffRow) {
  await c.env.DB.prepare('UPDATE staff_users SET last_login_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  await createSession(c, 'staff', row.id, row.session_epoch);
  log.info('staff_login', { staffId: row.id, ip: clientIp(c) });
}

adminAuth.get('/auth/session', async (c) => c.json(await session(c, c.get('staff')?.id ?? null)));

/** First run only: creates the owner. Needs the SETUP_TOKEN secret and an empty staff table. */
adminAuth.post('/auth/setup', json(AdminSetupInput), async (c) => {
  await limit(c, 'RL_AUTH', `setup:${clientIp(c)}`);
  const { setupToken, email, name, password } = c.req.valid('json');
  if (!c.env.SETUP_TOKEN || !(await safeEqual(setupToken, c.env.SETUP_TOKEN))) {
    throw new AppError('FORBIDDEN', 'That setup token is not right', { fields: { setupToken: 'That setup token is not right' } });
  }
  const now = Date.now();
  const id = ulid(now);
  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER, passwordIterations(c.env));
  const res = await c.env.DB.prepare(
    `INSERT INTO staff_users (id, email, password_hash, name, role, permissions_json, status, session_epoch, last_login_at, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'owner', '[]', 'active', 0, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM staff_users)`,
  )
    .bind(id, email, hash, name, now, now)
    .run();
  if (!res.meta.changes) throw conflict('The store already has an owner. Sign in instead.');
  const row = (await c.env.DB.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<StaffRow>())!;
  await signIn(c, row);
  return c.json(await session(c, id), 201);
});

adminAuth.post('/auth/login', json(AdminLoginInput), async (c) => {
  const { email, password } = c.req.valid('json');
  await limit(c, 'RL_AUTH', `admin-login-ip:${clientIp(c)}`);
  await limit(c, 'RL_AUTH', `admin-login-email:${email}`);
  const iterations = passwordIterations(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM staff_users WHERE email = ?').bind(email).first<StaffRow>();
  if (!row?.password_hash || row.status !== 'active') {
    await burnPasswordCheck(password, c.env.PASSWORD_PEPPER, iterations);
    log.warn('staff_login_failed', { email, ip: clientIp(c) });
    throw new AppError('UNAUTHENTICATED', WRONG, { fields: { password: WRONG } });
  }
  const check = await verifyPassword(password, row.password_hash, c.env.PASSWORD_PEPPER, iterations);
  if (!check.ok) {
    log.warn('staff_login_failed', { email, ip: clientIp(c) });
    throw new AppError('UNAUTHENTICATED', WRONG, { fields: { password: WRONG } });
  }
  if (check.needsRehash) {
    await c.env.DB.prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password, c.env.PASSWORD_PEPPER, iterations), row.id).run();
  }
  await signIn(c, row);
  return c.json(await session(c, row.id));
});

adminAuth.post('/auth/logout', async (c) => {
  await destroySession(c, 'staff');
  return c.body(null, 204);
});

adminAuth.post('/auth/accept-invite', json(AcceptInviteInput), async (c) => {
  await limit(c, 'RL_AUTH', `invite:${clientIp(c)}`);
  const { token, name, password } = c.req.valid('json');
  const d1 = c.env.DB;
  const found = await consumeToken(d1, 'staff_invite', token);
  if (!found || found.subjectType !== 'staff') {
    const message = 'This invitation has expired or was already used. Ask for a new one.';
    throw new AppError('BAD_REQUEST', message, { fields: { token: message } });
  }
  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER, passwordIterations(c.env));
  const res = await d1
    .prepare(`UPDATE staff_users SET name = ?, password_hash = ?, status = 'active', session_epoch = session_epoch + 1, updated_at = ? WHERE id = ? AND status = 'invited'`)
    .bind(name, hash, Date.now(), found.subjectId)
    .run();
  if (!res.meta.changes) throw new AppError('BAD_REQUEST', 'This invitation is no longer valid.');
  const row = (await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(found.subjectId).first<StaffRow>())!;
  await signIn(c, row);
  return c.json(await session(c, row.id));
});

adminAuth.post('/auth/forgot-password', json(ForgotPasswordInput), async (c) => {
  const { email } = c.req.valid('json');
  await limit(c, 'RL_AUTH', `admin-forgot-ip:${clientIp(c)}`);
  await limit(c, 'RL_AUTH', `admin-forgot-email:${email}`);
  const row = await c.env.DB.prepare(`SELECT * FROM staff_users WHERE email = ? AND status = 'active'`).bind(email).first<StaffRow>();
  if (row && (await recentTokenCount(c.env.DB, 'staff', row.id, 'reset_password', 15 * 60_000)) < 3) {
    const token = await issueToken(c.env.DB, 'staff', row.id, 'reset_password');
    await enqueue(c.env, { type: 'email.password_reset', to: row.email, name: row.name, url: `${c.env.APP_URL}/admin/reset?token=${token}` });
  }
  return c.body(null, 204);
});

adminAuth.post('/auth/reset-password', json(ResetPasswordInput), async (c) => {
  await limit(c, 'RL_AUTH', `admin-reset:${clientIp(c)}`);
  const { token, password } = c.req.valid('json');
  const d1 = c.env.DB;
  const found = await consumeToken(d1, 'reset_password', token);
  if (!found || found.subjectType !== 'staff') {
    const message = 'This link has expired or was already used. Ask for a new one.';
    throw new AppError('BAD_REQUEST', message, { fields: { token: message } });
  }
  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER, passwordIterations(c.env));
  await d1.prepare(`UPDATE staff_users SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE id = ? AND status = 'active'`).bind(hash, Date.now(), found.subjectId).run();
  const row = await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(found.subjectId).first<StaffRow>();
  if (!row || row.status !== 'active') throw new AppError('FORBIDDEN', 'This account is disabled');
  await signIn(c, row);
  return c.json(await session(c, row.id));
});
