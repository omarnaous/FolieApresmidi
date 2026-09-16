import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../worker/app';
import { hmacSha256, safeEqual, toB64url } from '../../worker/lib/crypto';
import type { PaymentEvent, PaymentProvider } from '../../worker/payments/provider';
import { registerProvider } from '../../worker/payments/registry';
import { createProduct, readyCheckout, Shopper, stockOf, storeBasics } from '../helpers';

const SECRET = 'whsec_test';
const refunds: { ref: string | null; amount: number }[] = [];

/** A webhook-driven gateway with HMAC-signed events, standing in for a real one. */
const fakePay: PaymentProvider = {
  id: 'fakepay',
  name: 'Fake Pay',
  description: 'Test gateway',
  commit: 'webhook',
  isEnabled: () => true,
  async createCheckout(input) {
    return { kind: 'redirect', url: 'https://pay.example/checkout', ref: `ref_${input.checkoutId}` };
  },
  async handleWebhook(request) {
    const body = await request.text();
    const expected = toB64url(await hmacSha256(SECRET, body));
    const given = request.headers.get('x-signature') ?? '';
    if (!(await safeEqual(given, expected))) throw new Error('bad signature');
    return [JSON.parse(body) as PaymentEvent];
  },
  async refund(input) {
    refunds.push({ ref: input.ref, amount: input.amount });
    return { status: 'succeeded', ref: 're_1' };
  },
};

let unregister: () => void;

beforeAll(async () => {
  unregister = registerProvider(fakePay);
  await storeBasics({ holdMinutes: 0 });
});
afterAll(() => unregister());

async function deliver(event: PaymentEvent, signature?: string) {
  const body = JSON.stringify(event);
  const ctx = createExecutionContext();
  const res = await app.request(
    'http://localhost/api/webhooks/fakepay',
    { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': signature ?? toB64url(await hmacSha256(SECRET, body)) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, data: (await res.json()) as { received?: number; applied?: number } };
}

describe('payment webhooks', () => {
  it('verifies signatures, commits once, and ignores redelivery', async () => {
    const product = await createProduct({ stock: [2, 2] });
    const { checkout } = await readyCheckout(new Shopper(), product.variants[0]!.id);
    const event: PaymentEvent = { eventId: 'evt_1', type: 'payment.succeeded', checkoutId: checkout!.id, ref: 'ref_1', amount: checkout!.pricing.total, currency: 'USD' };

    expect((await deliver(event, 'forged')).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE checkout_id = ?').bind(checkout!.id).first('n')).toBe(0);

    const first = await deliver(event);
    expect(first.status).toBe(200);
    expect(first.data.applied).toBe(1);

    const replay = await deliver(event);
    expect(replay.status).toBe(200);
    expect(replay.data.applied).toBe(0);

    const order = await env.DB.prepare('SELECT status, payment_status FROM orders WHERE checkout_id = ?').bind(checkout!.id).first<{ status: string; payment_status: string }>();
    expect(order).toEqual({ status: 'paid', payment_status: 'paid' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE checkout_id = ?').bind(checkout!.id).first('n')).toBe(1);
    expect(await stockOf(product.variants[0]!.id)).toBe(1);
  });

  it('refunds instead of overselling when stock ran out before payment landed', async () => {
    const product = await createProduct({ stock: [1, 1] });
    const variant = product.variants[0]!;
    const a = await readyCheckout(new Shopper(), variant.id);
    const b = await readyCheckout(new Shopper(), variant.id);

    await deliver({ eventId: 'evt_a', type: 'payment.succeeded', checkoutId: a.checkout!.id, ref: 'ref_a', amount: a.checkout!.pricing.total, currency: 'USD' });
    const late = await deliver({ eventId: 'evt_b', type: 'payment.succeeded', checkoutId: b.checkout!.id, ref: 'ref_b', amount: b.checkout!.pricing.total, currency: 'USD' });

    expect(late.status).toBe(200);
    expect(await stockOf(variant.id)).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE checkout_id = ?').bind(b.checkout!.id).first('n')).toBe(0);
    expect(refunds).toContainEqual({ ref: 'ref_b', amount: b.checkout!.pricing.total });
  });
});
