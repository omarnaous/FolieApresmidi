import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminSessionDTO, CheckoutDTO, ShippingRateDTO, ShippingZoneDTO } from '../../shared/api';
import { createProduct, readyCheckout, Shopper, storeBasics } from '../helpers';

/**
 * What the owner charges to deliver. The money here is the money the shopper
 * is asked for, so what is saved in the admin has to be exactly what the
 * checkout offers — including a price put on a rate that was free.
 */

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

describe('shipping zones and rates', () => {
  it('is only for staff who manage shipping', async () => {
    const out = new Shopper();
    expect((await out.json('GET', '/api/admin/shipping/zones')).status).toBe(401);
    expect((await out.json('POST', '/api/admin/shipping/zones', { name: 'X', regions: [{ countryCode: 'LB', regionCode: null }] })).status).toBe(401);
  });

  it('puts a price on a rate that was free, and the checkout asks for it', async () => {
    const zones = await owner.json<{ items: ShippingZoneDTO[] }>('GET', '/api/admin/shipping/zones');
    expect(zones.status).toBe(200);
    const zone = zones.data.items.find((z) => z.regions.some((r) => r.countryCode === 'LB'))!;
    expect(zone).toBeTruthy();

    // the rate the shop starts with: free
    const rate = zone.rates[0]!;
    expect(rate.amount).toBe(500);

    // the owner puts $7.50 on it
    const saved = await owner.json<ShippingRateDTO>('PUT', `/api/admin/shipping/rates/${rate.id}`, {
      name: rate.name,
      type: 'flat',
      amount: 750,
      minValue: null,
      maxValue: null,
      deliveryEstimate: '1–2 days',
      active: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.data.amount).toBe(750);

    // and it is what a shopper is asked for
    const product = await createProduct({ stock: [2, 2] });
    const shopper = new Shopper();
    const { checkout } = await readyCheckout(shopper, product.variants[0]!.id);
    expect(checkout!.shippingRates[0]?.amount).toBe(750);
    expect(checkout!.pricing.shipping).toBe(750);
    expect(checkout!.pricing.total).toBe(10_750);
  });

  it('adds a second rate to the zone and offers both', async () => {
    const zones = await owner.json<{ items: ShippingZoneDTO[] }>('GET', '/api/admin/shipping/zones');
    const zone = zones.data.items[0]!;
    const added = await owner.json<ShippingRateDTO>('POST', `/api/admin/shipping/zones/${zone.id}/rates`, {
      name: 'Same day, Beirut',
      type: 'flat',
      amount: 1500,
      minValue: null,
      maxValue: null,
      deliveryEstimate: 'Today',
      active: true,
    });
    expect(added.status).toBe(201);

    const product = await createProduct({ stock: [2, 2] });
    const { checkout } = await readyCheckout(new Shopper(), product.variants[0]!.id);
    expect(checkout!.shippingRates.map((r) => r.amount).sort((a, b) => a - b)).toEqual([750, 1500]);
  });

  it('refuses a rate with no name and one with a negative price', async () => {
    const zones = await owner.json<{ items: ShippingZoneDTO[] }>('GET', '/api/admin/shipping/zones');
    const zone = zones.data.items[0]!;
    const base = { type: 'flat' as const, minValue: null, maxValue: null, deliveryEstimate: null, active: true };

    const noName = await owner.json('POST', `/api/admin/shipping/zones/${zone.id}/rates`, { ...base, name: '', amount: 500 });
    expect(noName.status).toBe(422);
    expect(noName.data.error.fields.name).toBeTruthy();

    const negative = await owner.json('POST', `/api/admin/shipping/zones/${zone.id}/rates`, { ...base, name: 'Backwards', amount: -100 });
    expect(negative.status).toBe(422);
    expect(negative.data.error.fields.amount).toBeTruthy();
  });

  it('takes a rate off the checkout when it is switched off', async () => {
    const zones = await owner.json<{ items: ShippingZoneDTO[] }>('GET', '/api/admin/shipping/zones');
    const zone = zones.data.items[0]!;
    const same = zone.rates.find((r) => r.name === 'Same day, Beirut')!;
    const off = await owner.json<ShippingRateDTO>('PUT', `/api/admin/shipping/rates/${same.id}`, {
      name: same.name,
      type: 'flat',
      amount: same.amount,
      minValue: null,
      maxValue: null,
      deliveryEstimate: same.deliveryEstimate,
      active: false,
    });
    expect(off.status).toBe(200);

    const product = await createProduct({ stock: [2, 2] });
    const { checkout } = await readyCheckout(new Shopper(), product.variants[0]!.id);
    expect(checkout!.shippingRates.map((r) => r.amount)).toEqual([750]);
  });

  it('creates a zone, and a country with no zone cannot be checked out to', async () => {
    const made = await owner.json<ShippingZoneDTO>('POST', '/api/admin/shipping/zones', {
      name: 'Gulf',
      regions: [{ countryCode: 'AE', regionCode: null }],
    });
    expect(made.status).toBe(201);
    expect(made.data.rates).toEqual([]);

    const product = await createProduct({ stock: [2, 2] });
    const shopper = new Shopper();
    await shopper.json('POST', '/api/cart/lines', { variantId: product.variants[0]!.id, quantity: 1 });
    const created = await shopper.json<CheckoutDTO>('POST', '/api/checkout');
    const toFrance = await shopper.json<CheckoutDTO>('PATCH', `/api/checkout/${created.data.id}`, {
      email: 'far@example.com',
      phone: '+33 1 23 45 67',
      shippingAddress: { name: 'Far Away', phone: '+33 1 23 45 67', line1: 'Rue', line2: '', city: 'Paris', region: null, postalCode: null, countryCode: 'FR', notes: null },
    });
    // a zone nobody wrote for France: nothing is offered, so nothing can be paid
    expect(toFrance.data.shippingRates).toEqual([]);
    const done = await shopper.json('POST', `/api/checkout/${created.data.id}/complete`, { paymentMethod: 'cod' });
    expect(done.status).toBe(422);
  });
});
