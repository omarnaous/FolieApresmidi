import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CartDTO, CheckoutDTO, OrderDTO, ProductDTO } from '../../shared/api';
import { createProduct, readyCheckout, Shopper, stockOf, storeBasics } from '../helpers';

beforeAll(async () => {
  await storeBasics({ holdMinutes: 15, shipping: 500 });
});

describe('storefront catalog', () => {
  it('lists, searches and filters active products', async () => {
    const product = await createProduct({ title: 'Étagère Midi', prices: [14_500, 14_500] });
    await createProduct({ title: 'Hidden draft', status: 'draft' });
    const s = new Shopper();

    const one = await s.json<ProductDTO>('GET', `/api/products/${product.handle}`);
    expect(one.status).toBe(200);
    expect(one.data.price).toBe(14_500);
    expect(one.data.options[0]?.name).toBe('Size');

    const search = await s.json<{ items: ProductDTO[] }>('GET', '/api/products?q=etagere');
    expect(search.data.items.map((p) => p.handle)).toContain(product.handle);

    const drafts = await s.json<{ items: ProductDTO[] }>('GET', '/api/products?q=hidden');
    expect(drafts.data.items).toHaveLength(0);

    const filtered = await s.json<{ items: ProductDTO[] }>('GET', '/api/products?option=Size:Small&sort=price_desc');
    expect(filtered.status).toBe(200);
  });
});

describe('checkout', () => {
  it('places a cash-on-delivery order end to end', async () => {
    const product = await createProduct({ stock: [3, 3] });
    const variant = product.variants[0]!;
    const s = new Shopper();

    // the client cannot set a price: unknown fields are dropped by validation
    const add = await s.json<CartDTO>('POST', '/api/cart/lines', { variantId: variant.id, quantity: 2, price: 1 });
    expect(add.status).toBe(200);
    expect(add.data.subtotal).toBe(20_000);

    const created = await s.json<CheckoutDTO>('POST', '/api/checkout');
    expect(created.status).toBe(201);
    const ready = await readyCheckoutFrom(s, created.data.id);
    expect(ready.pricing.total).toBe(20_500);

    const done = await s.json<{ orderToken: string; order: OrderDTO }>('POST', `/api/checkout/${created.data.id}/complete`, { paymentMethod: 'cod' });
    expect(done.status).toBe(200);
    expect(done.data.order.status).toBe('pending');
    expect(done.data.order.paymentStatus).toBe('unpaid');
    expect(done.data.order.pricing.total).toBe(20_500);
    expect(done.data.order.number).toBeGreaterThanOrEqual(1001);

    expect(await stockOf(variant.id)).toBe(1);
    const cart = await s.json<CartDTO>('GET', '/api/cart');
    expect(cart.data.lines).toHaveLength(0);

    const status = await s.json<OrderDTO>('GET', `/api/orders/${done.data.orderToken}`);
    expect(status.status).toBe(200);
    expect(status.data.timeline[0]?.message).toContain('Order placed');

    // placing it twice returns the same order
    const again = await s.json<{ orderToken: string }>('POST', `/api/checkout/${created.data.id}/complete`, { paymentMethod: 'cod' });
    expect(again.status).toBe(200);
    expect(again.data.orderToken).toBe(done.data.orderToken);
    const orders = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE checkout_id = ?').bind(created.data.id).first<{ n: number }>();
    expect(orders?.n).toBe(1);

    // the audit trail is append-only
    const orderId = done.data.order.id;
    await expect(env.DB.prepare(`UPDATE order_events SET message = 'x' WHERE order_id = ?`).bind(orderId).run()).rejects.toThrow();
  });

  it('holds the last piece for the shopper who started checking out', async () => {
    const product = await createProduct({ stock: [1, 1] });
    const variant = product.variants[0]!;
    const first = await readyCheckout(new Shopper(), variant.id);
    expect(first.checkout).not.toBeNull();

    const second = await new Shopper().json('POST', '/api/cart/lines', { variantId: variant.id, quantity: 1 });
    expect(second.status).toBe(409);
    expect(second.data.error.code).toBe('OUT_OF_STOCK');
  });

  it('never oversells when two shoppers pay for the last piece at once', async () => {
    await env.DB.prepare('UPDATE store_settings SET checkout_hold_minutes = 0 WHERE id = 1').run();
    try {
      const product = await createProduct({ stock: [1, 1] });
      const variant = product.variants[0]!;
      const a = new Shopper();
      const b = new Shopper();
      const ca = await readyCheckout(a, variant.id);
      const cb = await readyCheckout(b, variant.id);
      expect(ca.checkout && cb.checkout).toBeTruthy();

      const results = await Promise.all([
        a.json('POST', `/api/checkout/${ca.checkout!.id}/complete`, { paymentMethod: 'cod' }),
        b.json('POST', `/api/checkout/${cb.checkout!.id}/complete`, { paymentMethod: 'cod' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.data.error.code).toBe('OUT_OF_STOCK');
      expect(await stockOf(variant.id)).toBe(0);
    } finally {
      await env.DB.prepare('UPDATE store_settings SET checkout_hold_minutes = 15 WHERE id = 1').run();
    }
  });

  it('enforces a discount usage limit under concurrency', async () => {
    await env.DB.prepare('UPDATE store_settings SET checkout_hold_minutes = 0 WHERE id = 1').run();
    try {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO discounts (id, code, title, type, value, applies_to, usage_limit, usage_count, starts_at, status, created_at, updated_at)
         VALUES ('once', 'ONCE', 'Once', 'percentage', 1000, 'all', 1, 0, ?, 'active', ?, ?)`,
      ).bind(now - 1000, now, now).run();
      const product = await createProduct({ stock: [10, 10] });
      const a = new Shopper();
      const b = new Shopper();
      const ca = await readyCheckout(a, product.variants[0]!.id);
      const cb = await readyCheckout(b, product.variants[0]!.id);
      for (const [s, c] of [[a, ca], [b, cb]] as const) {
        const applied = await s.json<CheckoutDTO>('PATCH', `/api/checkout/${c.checkout!.id}`, { discountCode: 'once' });
        expect(applied.data.pricing.discountTotal).toBe(1000);
      }
      const results = await Promise.all([
        a.json('POST', `/api/checkout/${ca.checkout!.id}/complete`, { paymentMethod: 'cod' }),
        b.json('POST', `/api/checkout/${cb.checkout!.id}/complete`, { paymentMethod: 'cod' }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const usage = await env.DB.prepare(`SELECT usage_count AS n FROM discounts WHERE id = 'once'`).first<{ n: number }>();
      expect(usage?.n).toBe(1);
    } finally {
      await env.DB.prepare('UPDATE store_settings SET checkout_hold_minutes = 15 WHERE id = 1').run();
    }
  });

  it('requires contact, address and delivery before completing', async () => {
    const product = await createProduct();
    const s = new Shopper();
    await s.json('POST', '/api/cart/lines', { variantId: product.variants[0]!.id, quantity: 1 });
    const created = await s.json<CheckoutDTO>('POST', '/api/checkout');
    const res = await s.json('POST', `/api/checkout/${created.data.id}/complete`, { paymentMethod: 'cod' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.data.error.fields)).toEqual(expect.arrayContaining(['email', 'phone', 'shippingAddress']));

    const badMethod = await s.json('POST', `/api/checkout/${created.data.id}/complete`, { paymentMethod: 'bitcoin' });
    expect(badMethod.status).toBe(422);
  });

  it('expires an abandoned checkout', async () => {
    const product = await createProduct();
    const s = new Shopper();
    const { checkout } = await readyCheckout(s, product.variants[0]!.id);
    await env.DB.prepare('UPDATE checkouts SET expires_at = 0 WHERE id = ?').bind(checkout!.id).run();
    const res = await s.json('PATCH', `/api/checkout/${checkout!.id}`, { note: 'hello' });
    expect(res.status).toBe(410);
    expect(res.data.error.code).toBe('CHECKOUT_EXPIRED');
  });

  it("does not let one shopper read another's checkout", async () => {
    const product = await createProduct();
    const { checkout } = await readyCheckout(new Shopper(), product.variants[0]!.id);
    const res = await new Shopper().json('GET', `/api/checkout/${checkout!.id}`);
    expect(res.status).toBe(404);
  });
});

async function readyCheckoutFrom(s: Shopper, id: string): Promise<CheckoutDTO> {
  const withAddress = await s.json<CheckoutDTO>('PATCH', `/api/checkout/${id}`, {
    email: 'buyer@example.com',
    phone: '+961 3 123 456',
    shippingAddress: { name: 'Test Buyer', phone: '+961 3 123 456', line1: 'Armenia St.', city: 'Beirut', countryCode: 'LB' },
  });
  expect(withAddress.status).toBe(200);
  const ready = await s.json<CheckoutDTO>('PATCH', `/api/checkout/${id}`, { shippingRateId: withAddress.data.shippingRates[0]!.id });
  expect(ready.data.shippingRateId).toBeTruthy();
  return ready.data;
}
