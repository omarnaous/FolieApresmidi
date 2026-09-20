import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminNewsletterDTO, AdminSessionDTO, CheckoutDTO, DiscountDTO, OrderDTO, StoreDTO, SubscribeResultDTO } from '../../shared/api';
import { listDevMail } from '../../worker/email/send';
import { unsubscribeToken } from '../../worker/services/newsletter';
import { createProduct, readyCheckout, Shopper, storeBasics } from '../helpers';

/**
 * The list gathers addresses and writes to nobody. What is tested here is
 * that joining it sends nothing, that the addresses reach the admin, and
 * that leaving works in one click.
 */

const mail = async () => (await listDevMail(env)) as { to: string; subject: string }[];
const to = (address: string) => mail().then((all) => all.filter((m) => m.to === address));

let owner: Shopper;

beforeAll(async () => {
  await storeBasics();
  owner = new Shopper();
  const setup = await owner.json<AdminSessionDTO>('POST', '/api/admin/auth/setup', {
    setupToken: 'test-setup-token',
    email: 'owner@example.com',
    name: 'Owner',
    password: 'owner password 1',
  });
  expect(setup.status).toBe(201);
});

describe('joining the list', () => {
  it('keeps the address and sends nothing back', async () => {
    const address = 'first@example.com';
    const joined = await new Shopper().json<SubscribeResultDTO>('POST', '/api/subscribe', { email: address });
    expect(joined.status).toBe(200);
    // no code is set yet, so nothing is promised
    expect(joined.data).toEqual({ code: null, offer: null });
    expect(await to(address)).toHaveLength(0);

    // twice is not an error, and still nothing goes out
    expect((await new Shopper().json('POST', '/api/subscribe', { email: address })).status).toBe(200);
    expect(await to(address)).toHaveLength(0);

    const admin = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter');
    expect(admin.status).toBe(200);
    expect(admin.data.items.map((s) => s.email)).toContain(address);
    expect(admin.data.items.find((s) => s.email === address)?.source).toBe('newsletter');
  });

  it('refuses something that is not an address', async () => {
    const bad = await new Shopper().json('POST', '/api/subscribe', { email: 'not-an-email' });
    expect(bad.status).toBe(422);
  });

  it('takes the address of a shopper who ticks the box at checkout', async () => {
    const product = await createProduct({ stock: [3, 3] });
    const shopper = new Shopper();
    const address = 'ticked@example.com';
    const { checkout } = await readyCheckout(shopper, product.variants[0]!.id, 1, address);
    await shopper.json<CheckoutDTO>('PATCH', `/api/checkout/${checkout!.id}`, { acceptsMarketing: true });
    const placed = await shopper.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    expect(placed.status).toBe(200);

    const admin = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter');
    expect(admin.data.items.find((s) => s.email === address)?.source).toBe('checkout');
  });
});

describe('the list in the admin', () => {
  it('is only for staff who manage settings', async () => {
    expect((await new Shopper().json('GET', '/api/admin/newsletter')).status).toBe(401);
  });

  it('counts both sides, searches, and separates those who left', async () => {
    for (const address of ['a@example.com', 'b@example.com']) {
      expect((await new Shopper().json('POST', '/api/subscribe', { email: address })).status).toBe(200);
    }
    const token = await unsubscribeToken('b@example.com', env.COOKIE_SECRET);
    const page = await new Shopper().request('GET', `/unsubscribe/${encodeURIComponent(token)}`);
    expect(page.status).toBe(200);

    const admin = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter');
    expect(admin.data.subscribers.unsubscribed).toBe(1);
    expect(admin.data.items.map((s) => s.email)).not.toContain('b@example.com');

    const left = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter?show=unsubscribed');
    expect(left.data.items.map((s) => s.email)).toEqual(['b@example.com']);

    const found = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter?q=a@example');
    expect(found.data.items.map((s) => s.email)).toEqual(['a@example.com']);
  });

  it('hands the whole list over a page at a time', async () => {
    const first = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter?limit=1');
    expect(first.data.items).toHaveLength(1);
    expect(first.data.nextCursor).toBeTruthy();

    const second = await owner.json<AdminNewsletterDTO>('GET', `/api/admin/newsletter?limit=1&cursor=${encodeURIComponent(first.data.nextCursor!)}`);
    expect(second.data.items).toHaveLength(1);
    expect(second.data.items[0]?.email).not.toBe(first.data.items[0]?.email);
  });

  it('leaves on one click, and an invented link changes nothing', async () => {
    const bad = await new Shopper().request('GET', '/unsubscribe/not-a-real-token');
    expect(bad.status).toBe(404);
    const still = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter');
    expect(still.data.subscribers.unsubscribed).toBe(1);
  });
});

describe('the code shown for joining', () => {
  beforeAll(async () => {
    const discount = await owner.json<DiscountDTO>('POST', '/api/admin/discounts', {
      code: 'NEWSLETTER15',
      title: '15% off your first order',
      type: 'percentage',
      value: 1500,
      usageLimitPerCustomer: 1,
      startsAt: Date.now() - 1000,
    });
    expect(discount.status).toBe(201);
  });

  it('is the owner\'s to choose, and must be a code that exists', async () => {
    const wrong = await owner.json('PUT', '/api/admin/newsletter/code', { code: 'NO-SUCH-CODE' });
    expect(wrong.status).toBe(422);
    expect(wrong.data.error.fields.code).toBeTruthy();

    const saved = await owner.json<AdminNewsletterDTO>('PUT', '/api/admin/newsletter/code', { code: 'NEWSLETTER15' });
    expect(saved.status).toBe(200);
    expect(saved.data.welcome).toEqual({ code: 'NEWSLETTER15', offer: '15% off your first order', active: true });
  });

  it('is handed to whoever joins, on the spot and by nobody else', async () => {
    const joined = await new Shopper().json<SubscribeResultDTO>('POST', '/api/subscribe', { email: 'wants-a-code@example.com' });
    expect(joined.status).toBe(200);
    expect(joined.data).toEqual({ code: 'NEWSLETTER15', offer: '15% off your first order' });
    // still nothing in anyone's inbox
    expect(await to('wants-a-code@example.com')).toHaveLength(0);

    // the shop advertises what joining is worth, but not the code itself
    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.newsletterOffer).toBe('15% off your first order');
    expect(JSON.stringify(store.data)).not.toContain('NEWSLETTER15');
  });

  it('promises nothing once the code is switched off', async () => {
    await env.DB.prepare(`UPDATE discounts SET status = 'disabled' WHERE code = 'NEWSLETTER15'`).run();
    const joined = await new Shopper().json<SubscribeResultDTO>('POST', '/api/subscribe', { email: 'too-late@example.com' });
    expect(joined.data).toEqual({ code: null, offer: null });

    // and the storefront stops advertising it
    expect((await new Shopper().json<StoreDTO>('GET', '/api/store')).data.newsletterOffer).toBeNull();

    const admin = await owner.json<AdminNewsletterDTO>('GET', '/api/admin/newsletter');
    expect(admin.data.welcome).toEqual({ code: 'NEWSLETTER15', offer: null, active: false });
    await env.DB.prepare(`UPDATE discounts SET status = 'active' WHERE code = 'NEWSLETTER15'`).run();
  });

  it('is only for staff who manage settings', async () => {
    expect((await new Shopper().json('PUT', '/api/admin/newsletter/code', { code: 'NEWSLETTER15' })).status).toBe(401);
  });
});
