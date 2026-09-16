import { Hono } from 'hono';
import { AppError, notFound } from '../lib/errors';
import { errorFields, log } from '../lib/log';
import { anyProvider } from '../payments/registry';
import type { PaymentEvent, PaymentProvider } from '../payments/provider';
import { commitOrder, computeCheckout, type CheckoutRow } from '../services/checkout';
import { getSettings } from '../services/settings';
import type { AppEnv, Ctx } from '../types';

export const webhooks = new Hono<AppEnv>();

/**
 * Payment webhooks. The provider verifies the signature (and throws if it
 * cannot); each event id is claimed in webhook_events before it is applied,
 * so a redelivered event is acknowledged and ignored. If applying fails, the
 * claim is released so the provider's retry can process it again. Orders are
 * additionally one-per-checkout (UNIQUE), so even a lost claim cannot create
 * a second order.
 */
webhooks.post('/webhooks/:provider', async (c) => {
  const provider = anyProvider(c.req.param('provider'));
  if (!provider || provider.commit !== 'webhook') throw notFound('Unknown webhook');

  let events: PaymentEvent[];
  try {
    events = await provider.handleWebhook(c.req.raw, c.env);
  } catch (err) {
    log.warn('webhook_rejected', { provider: provider.id, ...errorFields(err) });
    throw new AppError('BAD_REQUEST', 'Invalid webhook');
  }

  const d1 = c.env.DB;
  let applied = 0;
  for (const event of events) {
    const claim = await d1
      .prepare('INSERT OR IGNORE INTO webhook_events (provider, event_id, type, received_at) VALUES (?, ?, ?, ?)')
      .bind(provider.id, event.eventId, event.type, Date.now())
      .run();
    if (!claim.meta.changes) continue;
    try {
      await applyEvent(c, provider, event);
      applied += 1;
    } catch (err) {
      await d1.prepare('DELETE FROM webhook_events WHERE provider = ? AND event_id = ?').bind(provider.id, event.eventId).run();
      log.error('webhook_apply_failed', { provider: provider.id, eventId: event.eventId, ...errorFields(err) });
      throw err;
    }
  }
  return c.json({ received: events.length, applied });
});

async function applyEvent(c: Ctx, provider: PaymentProvider, event: PaymentEvent): Promise<void> {
  const d1 = c.env.DB;
  if (event.type === 'refund.succeeded') return; // refunds start in the admin and are recorded there

  const row = event.checkoutId
    ? await d1.prepare('SELECT * FROM checkouts WHERE id = ?').bind(event.checkoutId).first<CheckoutRow>()
    : await d1.prepare('SELECT * FROM checkouts WHERE provider = ? AND provider_ref = ?').bind(provider.id, event.ref).first<CheckoutRow>();
  if (!row) {
    log.warn('webhook_unknown_checkout', { provider: provider.id, eventId: event.eventId });
    return;
  }

  if (event.type === 'payment.failed') {
    await d1.prepare('DELETE FROM inventory_reservations WHERE checkout_id = ?').bind(row.id).run();
    return;
  }

  if (row.status === 'completed') return;
  const settings = await getSettings(c.get('db'));
  const computed = await computeCheckout(c, row, settings);
  if (computed.pricing.total !== event.amount || computed.pricing.currency !== event.currency) {
    log.warn('webhook_amount_mismatch', { checkoutId: row.id, expected: computed.pricing.total, paid: event.amount });
  }

  try {
    await commitOrder(c.env, { ...row, status: 'open' }, computed, provider, event.ref, 'paid', { userAgent: null, ctx: c.executionCtx });
  } catch (err) {
    if (err instanceof AppError && (err.code === 'OUT_OF_STOCK' || err.code === 'DISCOUNT_INVALID')) {
      // paid, but it cannot be fulfilled: give the money back rather than oversell
      const refund = await provider.refund({ ref: event.ref, amount: event.amount, currency: event.currency, reason: 'Out of stock at payment' }, c.env);
      await d1.prepare(`UPDATE checkouts SET status = 'expired', updated_at = ? WHERE id = ?`).bind(Date.now(), row.id).run();
      log.error('webhook_oversold_refunded', { checkoutId: row.id, refund: refund.status });
      return;
    }
    if (err instanceof AppError && err.code === 'CONFLICT') return; // already placed
    throw err;
  }
}
