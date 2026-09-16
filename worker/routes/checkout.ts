import { Hono } from 'hono';
import { CheckoutCompleteInput, CheckoutUpdateInput } from '../../shared/api';
import { notFound } from '../lib/errors';
import { json } from '../lib/validate';
import { clientIp, limit, rateLimit } from '../middleware/rate-limit';
import { completeCheckout, createCheckout, getCheckout, updateCheckout } from '../services/checkout';
import { orderByToken, orderDTO } from '../services/orders';
import type { AppEnv } from '../types';

export const checkout = new Hono<AppEnv>();

checkout.post('/checkout', rateLimit('RL_CHECKOUT'), async (c) => c.json(await createCheckout(c), 201));

checkout.get('/checkout/:id', async (c) => c.json(await getCheckout(c, c.req.param('id'))));

checkout.patch('/checkout/:id', rateLimit('RL_API'), json(CheckoutUpdateInput), async (c) =>
  c.json(await updateCheckout(c, c.req.param('id'), c.req.valid('json'))),
);

checkout.post('/checkout/:id/complete', json(CheckoutCompleteInput), async (c) =>
  c.json(await completeCheckout(c, c.req.param('id'), c.req.valid('json').paymentMethod)),
);

/** Order status page for anyone holding the link from the confirmation email. */
checkout.get('/orders/:token', async (c) => {
  await limit(c, 'RL_API', `order-token:${clientIp(c)}`);
  const db = c.get('db');
  const order = await orderByToken(db, c.req.param('token'));
  if (!order) throw notFound('Order not found');
  return c.json(await orderDTO(db, order), 200, { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
});
