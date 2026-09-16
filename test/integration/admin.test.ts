import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminOrderDTO, AdminProductDTO, AdminSessionDTO, OrderDTO, StaffInviteResultDTO } from '../../shared/api';
import { createProduct, readyCheckout, Shopper, storeBasics } from '../helpers';

let owner: Shopper;

beforeAll(async () => {
  await storeBasics({ holdMinutes: 15 });
  owner = new Shopper();
  const wrong = await owner.json('POST', '/api/admin/auth/setup', { setupToken: 'nope', email: 'owner@example.com', name: 'Owner', password: 'owner password 1' });
  expect(wrong.status).toBe(403);
  const setup = await owner.json<AdminSessionDTO>('POST', '/api/admin/auth/setup', { setupToken: 'test-setup-token', email: 'owner@example.com', name: 'Owner', password: 'owner password 1' });
  expect(setup.status).toBe(201);
  expect(setup.data.staff?.role).toBe('owner');
});

describe('admin access', () => {
  it('allows setup only once', async () => {
    const again = await new Shopper().json('POST', '/api/admin/auth/setup', { setupToken: 'test-setup-token', email: 'second@example.com', name: 'Second', password: 'owner password 2' });
    expect(again.status).toBe(409);
  });

  it('requires a staff session', async () => {
    expect((await new Shopper().json('GET', '/api/admin/orders')).status).toBe(401);
    // a customer session is not a staff session
    const customer = new Shopper();
    await customer.json('POST', '/api/auth/register', { email: 'shopper@example.com', password: 'a long password', name: 'Shopper' });
    expect((await customer.json('GET', '/api/admin/orders')).status).toBe(401);
  });

  it('limits invited staff to their permissions', async () => {
    const invite = await owner.json<StaffInviteResultDTO>('POST', '/api/admin/staff/invite', { email: 'packer@example.com', name: 'Packer', role: 'staff', permissions: ['orders:read'] });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.inviteUrl!).searchParams.get('token')!;

    const staff = new Shopper();
    const accepted = await staff.json<AdminSessionDTO>('POST', '/api/admin/auth/accept-invite', { token, name: 'Packer', password: 'packer password' });
    expect(accepted.status).toBe(200);
    expect(accepted.data.staff?.permissions).toEqual(['orders:read']);

    expect((await staff.json('GET', '/api/admin/orders')).status).toBe(200);
    expect((await staff.json('GET', '/api/admin/products')).status).toBe(403);
    expect((await staff.json('GET', '/api/admin/staff')).status).toBe(403);

    // disabling signs them out at once
    await owner.json('PATCH', `/api/admin/staff/${accepted.data.staff!.id}`, { status: 'disabled' });
    expect((await staff.json('GET', '/api/admin/orders')).status).toBe(401);
  });
});

describe('admin catalog', () => {
  it('creates a product the storefront can sell, with sanitised copy', async () => {
    const created = await owner.json<AdminProductDTO>('POST', '/api/admin/products', {
      title: 'La robe',
      status: 'active',
      descriptionHtml: '<p onclick="steal()">Silk <script>alert(1)</script><a href="javascript:alert(1)">x</a></p>',
      options: [{ name: 'Size', values: [{ value: 'S' }, { value: 'M' }] }],
      variants: [
        { options: ['S'], price: 12_000, inventoryOnHand: 2 },
        { options: ['M'], price: 12_000, inventoryOnHand: 0 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.data.descriptionHtml).toBe('<p>Silk <a>x</a></p>');
    expect(created.data.handle).toBe('la-robe');

    const store = await new Shopper().json('GET', '/api/products/la-robe');
    expect(store.status).toBe(200);
    expect(store.data.variants.map((v: { available: boolean }) => v.available)).toEqual([true, false]);

    const history = await owner.json('GET', `/api/admin/variants/${created.data.variants[0]!.id}/inventory`);
    expect(history.data.items[0]?.delta).toBe(2);

    const draft = await owner.json('POST', '/api/admin/products/bulk', { ids: [created.data.id], action: 'draft' });
    expect(draft.status).toBe(200);
    expect((await new Shopper().json('GET', '/api/products/la-robe')).status).toBe(404);
  });

  it('rejects invalid variants with field errors', async () => {
    const res = await owner.json('POST', '/api/admin/products', {
      title: 'Broken',
      options: [{ name: 'Size', values: [{ value: 'S' }] }],
      variants: [{ options: ['S'], price: 1000, compareAtPrice: 500 }, { options: ['S'], price: 1000 }],
    });
    expect(res.status).toBe(422);
    expect(res.data.error.fields['variants.0.compareAtPrice']).toBeTruthy();
    expect(res.data.error.fields['variants.1.options']).toBeTruthy();
  });
});

describe('admin orders', () => {
  it('fulfils, ships, delivers, collects cash and refunds', async () => {
    const product = await createProduct({ stock: [5, 5] });
    const s = new Shopper();
    const { checkout } = await readyCheckout(s, product.variants[0]!.id, 2);
    const placed = await s.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    const id = placed.data.order.id;

    const step = (body: object) => owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/transition`, body);

    // nothing paid yet: refunds are refused, cancelling is the way out
    expect((await owner.json('POST', `/api/admin/orders/${id}/refunds`, { amount: 100 })).status).toBe(409);

    expect((await step({ to: 'fulfilled' })).data.status).toBe('fulfilled');
    const shipped = await step({ to: 'shipped', tracking: { carrier: 'Aramex', number: 'LB123', url: 'https://track.example/LB123' } });
    expect(shipped.data.fulfillments[0]?.trackingNumber).toBe('LB123');
    expect((await step({ to: 'cancelled' })).status).toBe(409);

    const delivered = await step({ to: 'delivered', markPaid: true });
    expect(delivered.data.status).toBe('delivered');
    expect(delivered.data.paymentStatus).toBe('paid');
    expect(delivered.data.refundableAmount).toBe(delivered.data.pricing.total);

    const partial = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/refunds`, {
      amount: 10_000,
      restock: true,
      lines: [{ orderLineId: delivered.data.lines[0]!.id, quantity: 1 }],
      reason: 'Wrong size',
    });
    expect(partial.status).toBe(200);
    expect(partial.data.paymentStatus).toBe('partially_refunded');
    expect(await env.DB.prepare('SELECT inventory_on_hand AS n FROM variants WHERE id = ?').bind(product.variants[0]!.id).first('n')).toBe(4);

    const tooMuch = await owner.json('POST', `/api/admin/orders/${id}/refunds`, { amount: partial.data.refundableAmount + 1 });
    expect(tooMuch.status).toBe(422);

    const rest = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/refunds`, { amount: partial.data.refundableAmount });
    expect(rest.data.status).toBe('refunded');
    expect(rest.data.paymentStatus).toBe('refunded');

    const types = rest.data.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['order_placed', 'status_changed', 'payment_captured', 'refund_issued']));
  });

  it('cancelling an unpaid order puts the stock back', async () => {
    const product = await createProduct({ stock: [3, 3] });
    const s = new Shopper();
    const { checkout } = await readyCheckout(s, product.variants[1]!.id, 3);
    const placed = await s.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    const stock = () => env.DB.prepare('SELECT inventory_on_hand AS n FROM variants WHERE id = ?').bind(product.variants[1]!.id).first('n');
    expect(await stock()).toBe(0);
    const cancelled = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${placed.data.order.id}/transition`, { to: 'cancelled', reason: 'Customer called', restock: true });
    expect(cancelled.data.status).toBe('cancelled');
    expect(await stock()).toBe(3);
  });

  it('reports the dashboard for a date range', async () => {
    const res = await owner.json('GET', `/api/admin/dashboard?from=${Date.now() - 86_400_000}&to=${Date.now() + 60_000}`);
    expect(res.status).toBe(200);
    expect(res.data.orders).toBeGreaterThanOrEqual(1);
    expect(res.data.series.length).toBeGreaterThanOrEqual(1);
  });
});
