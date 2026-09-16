import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { PERMISSIONS, type Permission, type StaffRole } from '../../shared/api';
import { parseJson, schema } from '../db/client';
import { clearCookie, COOKIES, readCookie, writeCookie } from '../lib/cookies';
import { forbidden, unauthenticated } from '../lib/errors';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { AppEnv, Ctx, StaffPrincipal } from '../types';

/**
 * Sessions: a random 256-bit token in an httpOnly cookie; KV holds the record
 * under the token's SHA-256, so a KV dump cannot be replayed as cookies.
 * Revocation is by epoch: logout-everywhere, a password change or a role
 * change bumps the account's session_epoch in D1, and every session carrying
 * an older epoch is refused on its next request — no need to find the keys.
 */

type Kind = 'customer' | 'staff';

interface SessionRecord {
  kind: Kind;
  sub: string;
  epoch: number;
  iat: number;
  exp: number;
}

const TTL: Record<Kind, number> = { customer: 60 * 60 * 24 * 30, staff: 60 * 60 * 12 };
const COOKIE: Record<Kind, string> = { customer: COOKIES.customerSession, staff: COOKIES.staffSession };

const keyFor = async (kind: Kind, token: string) => `sess:${kind}:${await sha256Hex(token)}`;

export async function createSession(c: Ctx, kind: Kind, sub: string, epoch: number): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  const record: SessionRecord = { kind, sub, epoch, iat: now, exp: now + TTL[kind] * 1000 };
  const key = await keyFor(kind, token);
  await c.env.KV.put(key, JSON.stringify(record), { expirationTtl: TTL[kind] });
  writeCookie(c, COOKIE[kind], token, { maxAge: TTL[kind], sameSite: kind === 'staff' ? 'Strict' : 'Lax' });
  return key;
}

async function readSession(c: Ctx, kind: Kind): Promise<{ record: SessionRecord; key: string; token: string } | null> {
  const token = readCookie(c, COOKIE[kind]);
  if (!token || token.length > 128) return null;
  const key = await keyFor(kind, token);
  const record = await c.env.KV.get<SessionRecord>(key, 'json');
  if (!record || record.kind !== kind || record.exp < Date.now()) return null;
  return { record, key, token };
}

/** Sliding expiry: refresh once less than half the lifetime remains. */
async function maybeExtend(c: Ctx, kind: Kind, s: { record: SessionRecord; key: string; token: string }) {
  const remaining = s.record.exp - Date.now();
  if (remaining > (TTL[kind] * 1000) / 2) return;
  const record = { ...s.record, exp: Date.now() + TTL[kind] * 1000 };
  await c.env.KV.put(s.key, JSON.stringify(record), { expirationTtl: TTL[kind] });
  writeCookie(c, COOKIE[kind], s.token, { maxAge: TTL[kind], sameSite: kind === 'staff' ? 'Strict' : 'Lax' });
}

export async function destroySession(c: Ctx, kind: Kind): Promise<void> {
  const token = readCookie(c, COOKIE[kind]);
  if (token && token.length <= 128) await c.env.KV.delete(await keyFor(kind, token));
  clearCookie(c, COOKIE[kind]);
}

export function effectivePermissions(role: StaffRole, permissionsJson: string): Permission[] {
  if (role === 'owner' || role === 'admin') return [...PERMISSIONS];
  const list = parseJson<string[]>(permissionsJson, []);
  return PERMISSIONS.filter((p) => list.includes(p));
}

/** Resolves the signed-in customer (storefront routes). */
export const loadCustomer = createMiddleware<AppEnv>(async (c, next) => {
  const s = await readSession(c, 'customer');
  if (s) {
    const row = await c
      .get('db')
      .select({ id: schema.customers.id, epoch: schema.customers.sessionEpoch, hasPassword: schema.customers.passwordHash })
      .from(schema.customers)
      .where(eq(schema.customers.id, s.record.sub))
      .get();
    if (row && row.epoch === s.record.epoch && row.hasPassword) {
      c.set('customer', { id: row.id, sessionKey: s.key });
      await maybeExtend(c, 'customer', s);
    } else {
      await destroySession(c, 'customer');
    }
  }
  await next();
});

/** Resolves the signed-in staff member (admin routes). Role and permissions are read fresh every request. */
export const loadStaff = createMiddleware<AppEnv>(async (c, next) => {
  const s = await readSession(c, 'staff');
  if (s) {
    const row = await c.get('db').select().from(schema.staffUsers).where(eq(schema.staffUsers.id, s.record.sub)).get();
    if (row && row.status === 'active' && row.sessionEpoch === s.record.epoch) {
      const principal: StaffPrincipal = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        permissions: effectivePermissions(row.role, row.permissionsJson),
        sessionKey: s.key,
      };
      c.set('staff', principal);
      await maybeExtend(c, 'staff', s);
    } else {
      await destroySession(c, 'staff');
    }
  }
  await next();
});

export function requireCustomer(c: Ctx): string {
  const customer = c.get('customer');
  if (!customer) throw unauthenticated('Please sign in to continue');
  return customer.id;
}

export function requireStaff(c: Ctx, permission?: Permission): StaffPrincipal {
  const staff = c.get('staff');
  if (!staff) throw unauthenticated('Please sign in to the admin');
  if (permission && !staff.permissions.includes(permission)) throw forbidden();
  return staff;
}

/** Route guard form of requireStaff. */
export const staffOnly = (permission?: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    requireStaff(c, permission);
    await next();
  });
