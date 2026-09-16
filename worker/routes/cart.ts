import { Hono } from 'hono';
import { ApplyDiscountInput, CartAddLineInput, CartUpdateLineInput } from '../../shared/api';
import { json } from '../lib/validate';
import { rateLimit } from '../middleware/rate-limit';
import { addLine, cartDTO, setDiscount, updateLine } from '../services/cart';
import type { AppEnv } from '../types';

export const cart = new Hono<AppEnv>();

cart.use('/cart/*', async (c, next) => {
  if (c.req.method !== 'GET') return rateLimit('RL_API')(c, next);
  await next();
});

cart.get('/cart', async (c) => c.json(await cartDTO(c)));

cart.post('/cart/lines', json(CartAddLineInput), async (c) => {
  const { variantId, quantity } = c.req.valid('json');
  return c.json(await cartDTO(c, await addLine(c, variantId, quantity)));
});

cart.patch('/cart/lines/:id', json(CartUpdateLineInput), async (c) =>
  c.json(await cartDTO(c, await updateLine(c, c.req.param('id'), c.req.valid('json').quantity))),
);

cart.delete('/cart/lines/:id', async (c) => c.json(await cartDTO(c, await updateLine(c, c.req.param('id'), 0))));

cart.post('/cart/discount', json(ApplyDiscountInput), async (c) => c.json(await cartDTO(c, await setDiscount(c, c.req.valid('json').code))));

cart.delete('/cart/discount', async (c) => c.json(await cartDTO(c, await setDiscount(c, null))));
