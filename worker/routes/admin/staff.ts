import { Hono } from 'hono';
import { StaffInviteInput, StaffUpdateInput, type AuditEntryDTO, type Page, type Permission, type StaffInviteResultDTO } from '../../../shared/api';
import { enqueue } from '../../jobs/messages';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { decodeCursor, encodeCursor } from '../../services/catalog';
import { issueToken } from '../../services/tokens';
import type { AppEnv, StaffPrincipal } from '../../types';
import { staffDTO, type StaffRow } from './auth';

export const adminStaff = new Hono<AppEnv>();

/**
 * Who may manage whom: nobody edits the owner or themselves; only the owner
 * creates, edits or removes admins; admins manage staff.
 */
function assertCanManage(actor: StaffPrincipal, target: Pick<StaffRow, 'id' | 'role'>, nextRole?: string) {
  if (target.role === 'owner') throw forbidden('The owner account cannot be changed here');
  if (target.id === actor.id) throw forbidden('Ask another admin to change your own account');
  if ((target.role === 'admin' || nextRole === 'admin') && actor.role !== 'owner') throw forbidden('Only the owner can manage admins');
}

/**
 * Nobody hands out authority they do not hold themselves. Without this, the
 * one permission needed to invite staff was the only one worth having: a
 * member allowed to manage the team could invite a second account carrying
 * every permission — refunds, discounts, the customer list — accept their own
 * invitation, and walk back in with all of it. The owner and admins already
 * hold everything, so the check only bites on staff.
 */
function assertCanGrant(actor: StaffPrincipal, permissions: Permission[] | undefined) {
  if (actor.role === 'owner' || actor.role === 'admin') return;
  const beyond = (permissions ?? []).filter((p) => !actor.permissions.includes(p));
  if (beyond.length) throw forbidden(`You cannot give out permissions you do not have yourself: ${beyond.join(', ')}`);
}

adminStaff.get('/staff', staffOnly('staff:manage'), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM staff_users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name`).all<StaffRow>();
  return c.json({ items: results.map(staffDTO) });
});

adminStaff.post('/staff/invite', staffOnly('staff:manage'), json(StaffInviteInput), async (c) => {
  const actor = c.get('staff')!;
  const input = c.req.valid('json');
  if (input.role === 'admin' && actor.role !== 'owner') throw forbidden('Only the owner can invite admins');
  assertCanGrant(actor, input.role === 'staff' ? input.permissions : undefined);
  const d1 = c.env.DB;
  if (await d1.prepare('SELECT id FROM staff_users WHERE email = ?').bind(input.email).first()) throw conflict('Someone with this email is already on the team');

  const now = Date.now();
  const id = ulid(now);
  await d1
    .prepare(
      `INSERT INTO staff_users (id, email, password_hash, name, role, permissions_json, status, session_epoch, last_login_at, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'invited', 0, NULL, ?, ?)`,
    )
    .bind(id, input.email, input.name, input.role, JSON.stringify(input.role === 'staff' ? input.permissions : []), now, now)
    .run();
  const token = await issueToken(d1, 'staff', id, 'staff_invite');
  const url = `${c.env.APP_URL}/admin/invite?token=${token}`;
  await enqueue(c.env, { type: 'email.staff_invite', to: input.email, name: input.name, url, inviter: actor.name });
  await audit(c, 'staff.invited', 'staff', id, `Invited ${input.email} as ${input.role}`);

  const row = (await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<StaffRow>())!;
  const body: StaffInviteResultDTO = {
    staff: staffDTO(row),
    /* The link is a live credential — whoever holds it sets the password and
       is signed in. It goes back over the wire in development only, where
       there is no mail provider to carry it. A deployed shop with no mail
       configured shows nothing rather than handing the token to the caller. */
    inviteUrl: c.env.APP_ENV === 'development' ? url : null,
  };
  return c.json(body, 201);
});

adminStaff.patch('/staff/:id', staffOnly('staff:manage'), json(StaffUpdateInput), async (c) => {
  const actor = c.get('staff')!;
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const target = await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<StaffRow>();
  if (!target) throw notFound('Staff member not found');
  const input = c.req.valid('json');
  assertCanManage(actor, target, input.role);
  assertCanGrant(actor, input.permissions);

  const role = input.role ?? target.role;
  const disabling = input.status === 'disabled' && target.status !== 'disabled';
  await d1
    .prepare(
      `UPDATE staff_users SET name = ?, role = ?, permissions_json = ?, status = ?, session_epoch = session_epoch + ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      input.name ?? target.name,
      role,
      role === 'staff' ? JSON.stringify(input.permissions ?? JSON.parse(target.permissions_json)) : '[]',
      target.status === 'invited' && input.status === 'active' ? 'invited' : (input.status ?? target.status),
      disabling ? 1 : 0,
      Date.now(),
      id,
    )
    .run();
  await audit(c, 'staff.updated', 'staff', id, `Updated ${target.email}`, { role: input.role, status: input.status, permissions: input.permissions });
  return c.json(staffDTO((await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<StaffRow>())!));
});

adminStaff.delete('/staff/:id', staffOnly('staff:manage'), async (c) => {
  const actor = c.get('staff')!;
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const target = await d1.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<StaffRow>();
  if (!target) throw notFound('Staff member not found');
  assertCanManage(actor, target);
  await d1.batch([
    d1.prepare(`DELETE FROM auth_tokens WHERE subject_type = 'staff' AND subject_id = ?`).bind(id),
    d1.prepare('DELETE FROM staff_users WHERE id = ?').bind(id),
  ]);
  await audit(c, 'staff.removed', 'staff', id, `Removed ${target.email}`);
  return c.body(null, 204);
});

adminStaff.get('/audit', staffOnly('staff:manage'), async (c) => {
  const offset = decodeCursor(c.req.query('cursor'));
  const d1 = c.env.DB;
  const [rows, count] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT a.*, s.name AS staff_name FROM audit_log a LEFT JOIN staff_users s ON s.id = a.staff_id ORDER BY a.created_at DESC LIMIT 51 OFFSET ?').bind(offset),
    d1.prepare('SELECT COUNT(*) AS n FROM audit_log'),
  ]);
  const list = rows?.results ?? [];
  const body: Page<AuditEntryDTO> = {
    items: list.slice(0, 50).map((r) => ({
      id: r.id as string,
      staff: r.staff_id ? { id: r.staff_id as string, name: (r.staff_name as string | null) ?? 'Former staff' } : null,
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: (r.entity_id as string | null) ?? null,
      summary: r.summary as string,
      ip: (r.ip as string | null) ?? null,
      createdAt: r.created_at as number,
    })),
    nextCursor: list.length > 50 ? encodeCursor(offset + 50) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});
