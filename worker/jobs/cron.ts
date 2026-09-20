import { createDb } from '../db/client';
import { errorFields, log } from '../lib/log';
import { getSettings } from '../services/settings';
import { enqueue } from './messages';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const task = { '*/5 * * * *': expireHolds, '0 * * * *': abandonedCarts, '30 3 * * *': cleanup }[controller.cron];
  if (!task) return;
  ctx.waitUntil(
    task(env).catch((err) => {
      log.error('cron_failed', { cron: controller.cron, ...errorFields(err) });
      throw err;
    }),
  );
}

/** Release stock held by checkouts nobody finished. */
export async function expireHolds(env: Env): Promise<void> {
  const now = Date.now();
  const [holds, checkouts] = await env.DB.batch([
    env.DB.prepare('DELETE FROM inventory_reservations WHERE expires_at <= ?').bind(now),
    env.DB.prepare(`UPDATE checkouts SET status = 'expired', updated_at = ? WHERE status = 'open' AND expires_at <= ?`).bind(now, now),
  ]);
  log.info('cron_expire_holds', { holds: holds?.meta.changes ?? 0, checkouts: checkouts?.meta.changes ?? 0 });
}

/**
 * One reminder per cart, to shoppers who gave an email at checkout and left
 * between one and twenty-four hours ago. The reminder is claimed before it is
 * queued, so an overlapping run cannot send it twice.
 */
export async function abandonedCarts(env: Env): Promise<void> {
  const settings = await getSettings(createDb(env.DB));
  if (!settings.abandonedCartEmails) return;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM carts c
      WHERE c.status = 'active' AND c.email IS NOT NULL AND c.reminder_sent_at IS NULL
        AND c.customer_id IS NULL
        AND c.updated_at BETWEEN ? AND ?
        AND EXISTS (SELECT 1 FROM cart_lines l WHERE l.cart_id = c.id)
      ORDER BY c.updated_at LIMIT 200`,
  )
    .bind(now - DAY, now - HOUR)
    .all<{ id: string }>();

  let queued = 0;
  for (const { id } of results) {
    const claim = await env.DB.prepare('UPDATE carts SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL').bind(now, id).run();
    if (!claim.meta.changes) continue;
    await enqueue(env, { type: 'email.abandoned_cart', cartId: id });
    queued += 1;
  }
  log.info('cron_abandoned_carts', { queued });
}

/** Housekeeping. Orders, events and redemptions are never deleted. */
export async function cleanup(env: Env): Promise<void> {
  const now = Date.now();
  const d1 = env.DB;
  const results = await d1.batch([
    d1.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(now - 7 * DAY),
    d1.prepare(`DELETE FROM cart_lines WHERE cart_id IN (SELECT id FROM carts WHERE updated_at < ? AND status != 'converted')`).bind(now - 60 * DAY),
    d1.prepare(`DELETE FROM carts WHERE updated_at < ? AND status != 'converted'`).bind(now - 60 * DAY),
    d1.prepare(`DELETE FROM carts WHERE updated_at < ? AND status = 'converted'`).bind(now - 180 * DAY),
    d1.prepare(`DELETE FROM checkouts WHERE status = 'expired' AND updated_at < ?`).bind(now - 30 * DAY),
    d1.prepare(`UPDATE checkouts SET order_token = NULL WHERE status = 'completed' AND updated_at < ?`).bind(now - 90 * DAY),
    d1.prepare('DELETE FROM webhook_events WHERE received_at < ?').bind(now - 90 * DAY),
    d1.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(now - 730 * DAY),
  ]);
  log.info('cron_cleanup', { changes: results.map((r) => r.meta.changes ?? 0) });
}
