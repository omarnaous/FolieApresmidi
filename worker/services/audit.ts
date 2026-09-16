import { ulid } from '../lib/ids';
import { clientIp } from '../middleware/rate-limit';
import type { Ctx } from '../types';

/** Record a staff action. Best effort: an audit write never fails the action itself. */
export async function audit(
  c: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  diff: Record<string, unknown> | null = null,
): Promise<void> {
  const staff = c.get('staff');
  const now = Date.now();
  const write = c.env.DB.prepare(
    `INSERT INTO audit_log (id, staff_id, action, entity_type, entity_id, summary, diff_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(ulid(now), staff?.id ?? null, action, entityType, entityId, summary.slice(0, 500), diff ? JSON.stringify(diff).slice(0, 20_000) : null, clientIp(c), now)
    .run()
    .catch(() => undefined);
  c.executionCtx.waitUntil(write);
}
