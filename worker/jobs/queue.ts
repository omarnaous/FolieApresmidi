import { createDb } from '../db/client';
import { sendEmail } from '../email/send';
import * as templates from '../email/templates';
import { sign } from '../lib/crypto';
import { errorFields, log } from '../lib/log';
import { variantDetails } from '../services/lines';
import { rematerialize, rematerializeForProducts } from '../services/collections';
import { orderById, orderDTO } from '../services/orders';
import { getSettings } from '../services/settings';
import { runCsvImport } from './csv-import';
import type { JobMessage } from './messages';

export async function handleQueue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await runJob(env, message.body, message.id);
      message.ack();
    } catch (err) {
      log.error('job_failed', { type: message.body?.type, attempts: message.attempts, ...errorFields(err) });
      message.retry({ delaySeconds: Math.min(600, 5 * 2 ** message.attempts) });
    }
  }
}

export async function runJob(env: Env, job: JobMessage, messageId: string): Promise<void> {
  const db = createDb(env.DB);
  const settings = await getSettings(db);
  const brand: templates.StoreBrand = { name: settings.name, url: env.APP_URL, contactEmail: settings.contactEmail };

  const loadOrder = async (orderId: string) => {
    const row = await orderById(db, orderId);
    if (!row) return null;
    const token = row.checkout_id
      ? (await env.DB.prepare('SELECT order_token FROM checkouts WHERE id = ?').bind(row.checkout_id).first<{ order_token: string | null }>())?.order_token
      : null;
    return { row, dto: await orderDTO(db, row), statusUrl: token ? `${env.APP_URL}/orders/${token}` : `${env.APP_URL}/account/orders/${row.number}` };
  };

  switch (job.type) {
    case 'email.order_confirmation': {
      const o = await loadOrder(job.orderId);
      if (o) await sendEmail(env, o.row.email, templates.orderConfirmation(brand, o.dto, o.statusUrl), `order-confirmation:${job.orderId}`);
      return;
    }
    case 'email.order_status': {
      const o = await loadOrder(job.orderId);
      if (o) await sendEmail(env, o.row.email, templates.orderStatusUpdate(brand, o.dto, job.status, o.statusUrl, job.refundAmount), `order-status:${messageId}`);
      return;
    }
    case 'email.new_order_alert': {
      if (!settings.orderNotificationEmail) return;
      const o = await loadOrder(job.orderId);
      if (o) await sendEmail(env, settings.orderNotificationEmail, templates.newOrderAlert(brand, o.dto, `${env.APP_URL}/admin/orders/${job.orderId}`), `order-alert:${job.orderId}`);
      return;
    }
    case 'email.verify':
      await sendEmail(env, job.to, templates.verifyEmail(brand, job.name, job.url), `verify:${messageId}`);
      return;
    case 'email.password_reset':
      await sendEmail(env, job.to, templates.passwordReset(brand, job.name, job.url), `reset:${messageId}`);
      return;
    case 'email.staff_invite':
      await sendEmail(env, job.to, templates.staffInvite(brand, job.name, job.inviter, job.url), `invite:${messageId}`);
      return;
    case 'email.abandoned_cart': {
      const cart = await env.DB.prepare(`SELECT id, email FROM carts WHERE id = ? AND status = 'active'`).bind(job.cartId).first<{ id: string; email: string | null }>();
      if (!cart?.email) return;
      const { results } = await env.DB.prepare('SELECT variant_id, quantity FROM cart_lines WHERE cart_id = ?').bind(cart.id).all<{ variant_id: string; quantity: number }>();
      if (results.length === 0) return;
      const details = await variantDetails(env.DB, results.map((r) => r.variant_id));
      const lines = results
        .map((r) => ({ d: details.get(r.variant_id), q: r.quantity }))
        .filter((x) => x.d && x.d.productStatus === 'active')
        .map((x) => ({ title: x.d!.productTitle, variantTitle: x.d!.variantTitle, quantity: x.q }));
      if (lines.length === 0) return;
      const token = await sign(`r.${cart.id}`, env.COOKIE_SECRET);
      await sendEmail(env, cart.email, templates.abandonedCart(brand, lines, `${env.APP_URL}/cart/recover/${encodeURIComponent(token)}`), `abandoned:${cart.id}`);
      return;
    }
    case 'collections.rematerialize':
      if (job.collectionId) await rematerialize(env.DB, job.collectionId);
      if (job.productIds?.length) await rematerializeForProducts(env.DB, job.productIds);
      return;
    case 'csv.import':
      await runCsvImport(env, job.importId);
      return;
  }
}
