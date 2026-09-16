import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { z } from 'zod';
import { AdminProductInput, type AdminProductDTO, type CheckoutDTO } from '../shared/api';
import { app } from '../worker/app';
import { adminProductDTO, saveProductCore } from '../worker/services/admin-products';

let ipCounter = 0;

/**
 * A browser-shaped client: keeps cookies, sends the Origin header and the CSRF
 * token on writes, and gets its own IP so rate limits never couple tests.
 */
export class Shopper {
  readonly jar = new Map<string, string>();
  readonly ip = `10.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}.${Math.floor(Math.random() * 250)}`;

  private absorb(res: Response) {
    for (const header of res.headers.getSetCookie()) {
      const [pair = ''] = header.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(header) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { origin: 'http://localhost', 'cf-connecting-ip': this.ip, ...headers };
    if (method !== 'GET' && !this.jar.has('fdm_csrf')) {
      await this.request('GET', path.startsWith('/api/admin') ? '/api/admin/auth/session' : '/api/auth/session');
    }
    if (method !== 'GET' && !('x-csrf-token' in headers)) h['x-csrf-token'] = this.jar.get('fdm_csrf') ?? '';
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');

    const init: RequestInit = { method, headers: h };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const ctx = createExecutionContext();
    const res = await app.request(`http://localhost${path}`, init, env, ctx);
    await waitOnExecutionContext(ctx);
    this.absorb(res);
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T }> {
    const res = await this.request(method, path, body, headers);
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }
}

let productCounter = 0;

export async function createProduct(overrides: Partial<z.input<typeof AdminProductInput>> & { stock?: number[]; prices?: number[] } = {}): Promise<AdminProductDTO> {
  productCounter += 1;
  const sizes = ['Small', 'Medium'];
  const input = AdminProductInput.parse({
    title: `Test piece ${productCounter}`,
    handle: `test-piece-${productCounter}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'active',
    productType: 'Dresses',
    options: [{ name: 'Size', values: sizes.map((value) => ({ value })) }],
    variants: sizes.map((s, i) => ({ options: [s], price: overrides.prices?.[i] ?? 10_000, inventoryOnHand: overrides.stock?.[i] ?? 5 })),
    ...overrides,
  });
  const id = await saveProductCore(env.DB, null, input, null);
  return adminProductDTO(env.DB, id);
}

/** A shipping zone for Lebanon with a flat $5 rate, and checkout holds set as asked. */
export async function storeBasics(opts: { holdMinutes?: number; shipping?: number } = {}) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE store_settings SET name = 'Test Store', currency = 'USD', checkout_hold_minutes = ?, updated_at = ? WHERE id = 1`).bind(opts.holdMinutes ?? 15, now),
    env.DB.prepare(`INSERT OR IGNORE INTO shipping_zones (id, name, created_at, updated_at) VALUES ('zone-lb', 'Lebanon', ?, ?)`).bind(now, now),
    env.DB.prepare(`INSERT OR IGNORE INTO shipping_zone_regions (id, zone_id, country_code, region_code) VALUES ('region-lb', 'zone-lb', 'LB', NULL)`),
    env.DB.prepare(
      `INSERT OR IGNORE INTO shipping_rates (id, zone_id, name, type, amount, min_value, max_value, delivery_estimate, active, position, created_at, updated_at)
       VALUES ('rate-lb', 'zone-lb', 'Courier', 'flat', ?, NULL, NULL, '1–2 days', 1, 1, ?, ?)`,
    ).bind(opts.shipping ?? 500, now, now),
  ]);
}

export const ADDRESS = {
  name: 'Test Buyer',
  phone: '+961 3 123 456',
  line1: 'Armenia St.',
  line2: 'Building 4',
  city: 'Beirut',
  countryCode: 'LB',
};

/** Bag → checkout → contact, address and delivery chosen. Returns the ready checkout. */
export async function readyCheckout(shopper: Shopper, variantId: string, quantity = 1, email = `buyer${Math.random().toString(36).slice(2, 8)}@example.com`) {
  const add = await shopper.json('POST', '/api/cart/lines', { variantId, quantity });
  if (add.status !== 200) return { status: add.status, data: add.data, checkout: null as CheckoutDTO | null };
  const created = await shopper.json<CheckoutDTO>('POST', '/api/checkout');
  if (created.status !== 201) return { status: created.status, data: created.data, checkout: null };
  const withAddress = await shopper.json<CheckoutDTO>('PATCH', `/api/checkout/${created.data.id}`, { email, phone: ADDRESS.phone, shippingAddress: ADDRESS });
  const rate = withAddress.data.shippingRates[0]!;
  const ready = await shopper.json<CheckoutDTO>('PATCH', `/api/checkout/${created.data.id}`, { shippingRateId: rate.id });
  return { status: ready.status, data: ready.data, checkout: ready.data };
}

export const stockOf = async (variantId: string) =>
  (await env.DB.prepare('SELECT inventory_on_hand AS n FROM variants WHERE id = ?').bind(variantId).first<{ n: number }>())?.n;
