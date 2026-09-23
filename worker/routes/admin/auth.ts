import { Hono } from 'hono';
import {
  AcceptInviteInput, AdminLoginInput, AdminLoginVerifyInput, AdminSetupInput, ForgotPasswordInput, ResetPasswordInput,
  TwoFactorDisableInput, TwoFactorEnableInput,
  type AdminSessionDTO, type LoginChallengeDTO, type StaffDTO, type TwoFactorEnabledDTO, type TwoFactorSetupDTO,
} from '../../../shared/api';
import { enqueue } from '../../jobs/messages';
import { burnPasswordCheck, hashPassword, safeEqual, sign, unsign, verifyPassword } from '../../lib/crypto';
import { AppError, conflict } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { log } from '../../lib/log';
import { json } from '../../lib/validate';
import { hashBackupCodes, newBackupCodes, newSecret, otpauthUri, spendBackupCode, verifyTotp } from '../../lib/totp';
import { staffOnly } from '../../middleware/session';
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
  totp_secret: string | null;
  totp_enabled: number;
  backup_codes_json: string;
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
  twoFactorEnabled: !!r.totp_enabled,
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

  // The password was right. If the account carries a second factor, no session
  // is created yet: a short-lived, signed challenge is handed back, and the
  // code is checked at /auth/login/verify. The challenge names the account and
  // an expiry, and is signed with COOKIE_SECRET, so it cannot be forged or
  // pointed at a different account.
  if (row.totp_enabled) {
    const challenge = await sign(`2fa.${row.id}.${Date.now() + CHALLENGE_TTL_MS}`, c.env.COOKIE_SECRET);
    return c.json<LoginChallengeDTO>({ twoFactorRequired: true, challenge });
  }

  await signIn(c, row);
  return c.json(await session(c, row.id));
});

/** How long the between-steps challenge is good for. */
const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * The second step: a six-digit authenticator code, or a one-time backup code.
 * The challenge from step one is verified, unexpired, and tied to the account
 * whose code this is. The same IP and email rate limits apply, so the code
 * cannot be brute-forced any more than the password.
 */
adminAuth.post('/auth/login/verify', json(AdminLoginVerifyInput), async (c) => {
  const { challenge, code } = c.req.valid('json');
  await limit(c, 'RL_AUTH', `admin-2fa-ip:${clientIp(c)}`);

  const value = await unsign(challenge, c.env.COOKIE_SECRET);
  const parts = value?.split('.') ?? [];
  const BAD = 'That sign-in request has expired. Start again.';
  if (parts[0] !== '2fa' || parts.length !== 3) throw new AppError('UNAUTHENTICATED', BAD);
  const staffId = parts[1]!;
  if (Number(parts[2]) < Date.now()) throw new AppError('UNAUTHENTICATED', BAD);

  await limit(c, 'RL_AUTH', `admin-2fa-id:${staffId}`);
  const row = await c.env.DB.prepare('SELECT * FROM staff_users WHERE id = ?').bind(staffId).first<StaffRow>();
  if (!row || row.status !== 'active' || !row.totp_enabled || !row.totp_secret) {
    throw new AppError('UNAUTHENTICATED', BAD);
  }

  const WRONG_CODE = 'That code is not right.';
  const looksLikeBackup = code.includes('-') || code.replace(/\s/g, '').length > 6;
  if (looksLikeBackup) {
    const remaining = await spendBackupCode(code, JSON.parse(row.backup_codes_json) as string[], c.env.PASSWORD_PEPPER);
    if (!remaining) {
      log.warn('staff_2fa_failed', { staffId, ip: clientIp(c), kind: 'backup' });
      throw new AppError('UNAUTHENTICATED', WRONG_CODE, { fields: { code: WRONG_CODE } });
    }
    // a spent backup code is gone for good
    await c.env.DB.prepare('UPDATE staff_users SET backup_codes_json = ? WHERE id = ?').bind(JSON.stringify(remaining), staffId).run();
  } else if (!(await verifyTotp(row.totp_secret, code))) {
    log.warn('staff_2fa_failed', { staffId, ip: clientIp(c), kind: 'totp' });
    throw new AppError('UNAUTHENTICATED', WRONG_CODE, { fields: { code: WRONG_CODE } });
  }

  await signIn(c, row);
  return c.json(await session(c, row.id));
});

/**
 * Turning on 2FA — three routes, all for a staff member already signed in:
 *   setup   makes a secret and the QR line, but does not switch anything on
 *   enable  checks a code from the app, then switches it on and returns the
 *           backup codes, shown this once
 *   disable turns it off again, behind the account's own password
 * A fresh secret each setup means an abandoned attempt leaves nothing armed.
 */
adminAuth.post('/auth/2fa/setup', staffOnly(), async (c) => {
  const me = c.get('staff')!;
  const secret = newSecret();
  await c.env.DB.prepare('UPDATE staff_users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').bind(secret, me.id).run();
  const account = (await c.env.DB.prepare('SELECT email FROM staff_users WHERE id = ?').bind(me.id).first<{ email: string }>())?.email ?? 'admin';
  return c.json<TwoFactorSetupDTO>({ secret, otpauthUri: otpauthUri(secret, account, "Follies d'Après-Midi") });
});

adminAuth.post('/auth/2fa/enable', staffOnly(), json(TwoFactorEnableInput), async (c) => {
  const me = c.get('staff')!;
  const row = await c.env.DB.prepare('SELECT * FROM staff_users WHERE id = ?').bind(me.id).first<StaffRow>();
  if (!row?.totp_secret) throw new AppError('BAD_REQUEST', 'Start the setup first.');
  if (!(await verifyTotp(row.totp_secret, c.req.valid('json').code))) {
    throw new AppError('BAD_REQUEST', 'That code is not right — check the app and try again.', { fields: { code: 'That code is not right' } });
  }
  const backupCodes = newBackupCodes();
  const hashed = await hashBackupCodes(backupCodes, c.env.PASSWORD_PEPPER);
  await c.env.DB.prepare('UPDATE staff_users SET totp_enabled = 1, backup_codes_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(hashed), Date.now(), me.id)
    .run();
  log.info('staff_2fa_enabled', { staffId: me.id });
  return c.json<TwoFactorEnabledDTO>({ backupCodes });
});

adminAuth.post('/auth/2fa/disable', staffOnly(), json(TwoFactorDisableInput), async (c) => {
  const me = c.get('staff')!;
  const row = await c.env.DB.prepare('SELECT * FROM staff_users WHERE id = ?').bind(me.id).first<StaffRow>();
  // the password guards switching it off, so a walked-up-to open session cannot
  if (!row?.password_hash || !(await verifyPassword(c.req.valid('json').password, row.password_hash, c.env.PASSWORD_PEPPER, passwordIterations(c.env))).ok) {
    throw new AppError('UNAUTHENTICATED', 'That password is not right.', { fields: { password: 'That password is not right' } });
  }
  await c.env.DB.prepare("UPDATE staff_users SET totp_enabled = 0, totp_secret = NULL, backup_codes_json = '[]', updated_at = ? WHERE id = ?").bind(Date.now(), me.id).run();
  log.info('staff_2fa_disabled', { staffId: me.id });
  return c.json(await session(c, me.id));
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
