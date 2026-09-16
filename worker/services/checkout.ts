import type { z } from 'zod';
import type { AddressDTO, CheckoutDTO, CheckoutLineDTO, CheckoutUpdateInput, OrderDTO } from '../../shared/api';
import { priceOrder, toPricingDTO, type PriceLine, type PricingResult } from '../domain/pricing';
import { eligibleRates, zoneFor, type RateRule, type ZoneRule } from '../domain/shipping';
import { taxRatesFor, type TaxRule } from '../domain/tax';
import { purgeProducts, type BackgroundCtx } from '../lib/cache';
import { COOKIES, readCookie } from '../lib/cookies';
import { randomToken, sha256Hex, unsign } from '../lib/crypto';
import { AppError, constraintName, invalid, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { log } from '../lib/log';
import { enqueue } from '../jobs/messages';
import { clientIp, limit } from '../middleware/rate-limit';
import { getProvider, paymentMethods } from '../payments/registry';
import type { PaymentProvider } from '../payments/provider';
import type { Ctx } from '../types';
import { findCart } from './cart';
import { discountByCode, redemptionsBy, toRule } from './discount-rules';
import { commitStatements, holdStatements, shortfalls } from './inventory';
import { variantDetails, type VariantDetail } from './lines';
import { mediaByIds } from './media';
import { orderByToken, orderDTO } from './orders';
import { getSettings, type StoreSettings } from './settings';
import { STATUS_COPY } from '../domain/order-state';
import { eventStatement } from './events';
import { parseJson } from '../db/client';

const CHECKOUT_TTL_MS = 60 * 60 * 1000;

export interface CheckoutRow {
  id: string;
  cart_id: string;
  customer_id: string | null;
  email: string | null;
  phone: string | null;
  accepts_marketing: number;
  shipping_address_json: string | null;
  shipping_rate_id: string | null;
  discount_code: string | null;
  note: string | null;
  lines_json: string;
  pricing_json: string | null;
  total_amount: number;
  currency: string;
  provider: string | null;
  provider_ref: string | null;
  status: 'open' | 'completed' | 'expired';
  expires_at: number;
  order_id: string | null;
  order_token: string | null;
  created_at: number;
  updated_at: number;
}

type Line = { variantId: string; quantity: number };

/* ─────────────────────────── reference data ─────────────────────────── */

export async function shippingZones(d1: D1Database): Promise<ZoneRule<RateRule>[]> {
  const [zones, regions, rates] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT id, name FROM shipping_zones ORDER BY name'),
    d1.prepare('SELECT zone_id, country_code, region_code FROM shipping_zone_regions'),
    d1.prepare('SELECT * FROM shipping_rates ORDER BY position, amount'),
  ]);
  return ((zones?.results ?? []) as { id: string; name: string }[]).map((z) => ({
    id: z.id,
    name: z.name,
    regions: ((regions?.results ?? []) as { zone_id: string; country_code: string; region_code: string | null }[])
      .filter((r) => r.zone_id === z.id)
      .map((r) => ({ countryCode: r.country_code, regionCode: r.region_code })),
    rates: ((rates?.results ?? []) as Record<string, unknown>[])
      .filter((r) => r.zone_id === z.id)
      .map((r) => ({
        id: r.id as string,
        name: r.name as string,
        type: r.type as RateRule['type'],
        amount: r.amount as number,
        minValue: (r.min_value as number | null) ?? null,
        maxValue: (r.max_value as number | null) ?? null,
        deliveryEstimate: (r.delivery_estimate as string | null) ?? null,
        active: !!r.active,
        position: r.position as number,
      })),
  }));
}

export async function taxRules(d1: D1Database): Promise<TaxRule[]> {
  const { results } = await d1.prepare('SELECT * FROM tax_rates').all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r.id as string,
    countryCode: r.country_code as string,
    regionCode: (r.region_code as string | null) ?? null,
    name: r.name as string,
    rateBps: r.rate_bps as number,
    appliesToShipping: !!r.applies_to_shipping,
    active: !!r.active,
  }));
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string): string => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

export async function shipsTo(d1: D1Database): Promise<{ code: string; name: string }[]> {
  const { results } = await d1
    .prepare(
      `SELECT DISTINCT r.country_code AS code FROM shipping_zone_regions r
        WHERE EXISTS (SELECT 1 FROM shipping_rates s WHERE s.zone_id = r.zone_id AND s.active = 1)
        ORDER BY code`,
    )
    .all<{ code: string }>();
  return results.map((r) => ({ code: r.code, name: countryName(r.code) }));
}

/* ─────────────────────────── loading & authorisation ─────────────────────────── */

/** A checkout belongs to the cart in the shopper's cookie, or to their account. */
export async function loadCheckout(c: Ctx, id: string): Promise<CheckoutRow> {
  const row = await c.env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(id).first<CheckoutRow>();
  if (!row) throw notFound('Checkout not found');
  const customer = c.get('customer');
  const cookieCart = await unsign(readCookie(c, COOKIES.cart), c.env.COOKIE_SECRET);
  const owns = (customer && row.customer_id === customer.id) || (!row.customer_id && cookieCart === row.cart_id);
  if (!owns) throw notFound('Checkout not found');
  return row;
}

async function assertOpen(c: Ctx, row: CheckoutRow): Promise<void> {
  if (row.status === 'completed') throw new AppError('CONFLICT', 'This checkout is already complete');
  if (row.status === 'expired' || row.expires_at < Date.now()) {
    if (row.status === 'open') {
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE checkouts SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'`).bind(Date.now(), row.id),
        c.env.DB.prepare('DELETE FROM inventory_reservations WHERE checkout_id = ?').bind(row.id),
      ]);
    }
    throw new AppError('CHECKOUT_EXPIRED', 'This checkout expired. We have started a fresh one with your bag.');
  }
}

/* ─────────────────────────── pricing ─────────────────────────── */

export interface ComputedCheckout {
  dto: CheckoutDTO;
  pricing: PricingResult;
  details: Map<string, VariantDetail>;
  lines: Line[];
  rate: RateRule | null;
  address: AddressDTO | null;
}

export async function computeCheckout(c: Ctx, row: CheckoutRow, settings: StoreSettings, now = Date.now()): Promise<ComputedCheckout> {
  const d1 = c.env.DB;
  const db = c.get('db');
  const allLines = parseJson<Line[]>(row.lines_json, []);
  const details = await variantDetails(d1, allLines.map((l) => l.variantId));

  const problems: CheckoutDTO['problems'] = [];
  const lines = allLines.filter((l) => {
    const d = details.get(l.variantId);
    if (d && d.productStatus === 'active') return true;
    problems.push({ code: 'UNAVAILABLE', variantId: l.variantId, available: 0, message: 'This piece is no longer available' });
    return false;
  });

  for (const s of await shortfalls(d1, lines, now, row.id)) {
    const d = details.get(s.variantId);
    problems.push({
      code: 'OUT_OF_STOCK',
      variantId: s.variantId,
      available: s.available,
      message: `${d?.productTitle ?? 'An item'}${d?.variantTitle ? ` (${d.variantTitle})` : ''}: ${s.available === 0 ? 'sold out' : `only ${s.available} left`}`,
    });
  }

  const address = parseJson<AddressDTO | null>(row.shipping_address_json, null);
  const priceLines: PriceLine[] = lines.map((l) => {
    const d = details.get(l.variantId)!;
    return {
      id: l.variantId,
      variantId: l.variantId,
      productId: d.productId,
      collectionIds: d.collectionIds,
      quantity: l.quantity,
      unitPrice: d.price,
      weightGrams: d.weightGrams,
      requiresShipping: d.requiresShipping,
      taxable: d.taxable,
    };
  });

  const rule = row.discount_code ? await discountByCode(d1, row.discount_code) : null;
  const uses = rule ? await redemptionsBy(d1, rule.id, row.email, row.customer_id) : 0;
  const taxes = address ? taxRatesFor(await taxRules(d1), address.countryCode, address.region) : [];

  const base = {
    currency: settings.currency,
    pricesIncludeTax: settings.pricesIncludeTax,
    lines: priceLines,
    discount: rule ? toRule(rule) : null,
    discountCustomerUses: uses,
    taxRates: taxes,
    now,
  };

  // price once without shipping to know what price-based rates compare against
  const draft = priceOrder({ ...base, shippingRate: null });
  const zone = address ? zoneFor(await shippingZones(d1), address.countryCode, address.region) : null;
  const rates = zone ? eligibleRates(zone.rates, { subtotalAfterDiscounts: draft.subtotalAfterDiscounts, weightGrams: draft.weightGrams }) : [];
  const rate = rates.find((r) => r.id === row.shipping_rate_id) ?? null;
  const pricing = priceOrder({ ...base, shippingRate: rate });

  const media = await mediaByIds(db, lines.map((l) => details.get(l.variantId)?.mediaId ?? ''));
  const dtoLines: CheckoutLineDTO[] = lines.map((l) => {
    const d = details.get(l.variantId)!;
    const b = pricing.lines.find((x) => x.lineId === l.variantId);
    return {
      variantId: l.variantId,
      productHandle: d.handle,
      productTitle: d.productTitle,
      variantTitle: d.variantTitle,
      image: d.mediaId ? media.get(d.mediaId) ?? null : null,
      quantity: l.quantity,
      unitPrice: d.price,
      lineTotal: d.price * l.quantity,
      discount: b?.discount ?? 0,
    };
  });

  const dto: CheckoutDTO = {
    id: row.id,
    status: row.status === 'open' && row.expires_at < now ? 'expired' : row.status,
    email: row.email,
    phone: row.phone,
    acceptsMarketing: !!row.accepts_marketing,
    shippingAddress: address,
    requiresShipping: pricing.requiresShipping,
    shippingRates: rates.map((r) => ({ id: r.id, name: r.name, amount: r.amount, deliveryEstimate: r.deliveryEstimate })),
    shippingRateId: rate?.id ?? null,
    discountCode: row.discount_code,
    discountError: row.discount_code ? (rule ? pricing.discountError : 'That code does not exist') : null,
    note: row.note,
    lines: dtoLines,
    pricing: toPricingDTO(pricing),
    paymentMethods: paymentMethods(c.env),
    expiresAt: row.expires_at,
    problems,
    orderToken: row.order_token,
  };
  return { dto, pricing, details, lines, rate, address };
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

export async function createCheckout(c: Ctx): Promise<CheckoutDTO> {
  const d1 = c.env.DB;
  const db = c.get('db');
  const cart = await findCart(c);
  if (!cart) throw new AppError('BAD_REQUEST', 'Your bag is empty');
  const { results: cartLines } = await d1
    .prepare('SELECT variant_id, quantity FROM cart_lines WHERE cart_id = ? ORDER BY created_at')
    .bind(cart.id)
    .all<{ variant_id: string; quantity: number }>();
  if (cartLines.length === 0) throw new AppError('BAD_REQUEST', 'Your bag is empty');

  const now = Date.now();
  const lines: Line[] = cartLines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity }));
  const details = await variantDetails(d1, lines.map((l) => l.variantId));
  const gone = lines.filter((l) => details.get(l.variantId)?.productStatus !== 'active');
  const short = await shortfalls(d1, lines.filter((l) => !gone.includes(l)), now);
  if (gone.length || short.length) {
    throw new AppError('OUT_OF_STOCK', 'Some pieces in your bag are no longer available in that quantity', {
      details: { lines: [...gone.map((l) => ({ variantId: l.variantId, available: 0 })), ...short.map((s) => ({ variantId: s.variantId, available: s.available }))] },
    });
  }

  const settings = await getSettings(db);
  const customer = c.get('customer');
  let email = cart.email;
  let phone: string | null = null;
  let address: AddressDTO | null = null;
  let acceptsMarketing = false;
  if (customer) {
    const me = await d1.prepare('SELECT email, name, phone, accepts_marketing FROM customers WHERE id = ?').bind(customer.id).first<{ email: string; name: string; phone: string | null; accepts_marketing: number }>();
    email = me?.email ?? email;
    phone = me?.phone ?? null;
    acceptsMarketing = !!me?.accepts_marketing;
    const a = await d1
      .prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, updated_at DESC LIMIT 1')
      .bind(customer.id)
      .first<Record<string, unknown>>();
    if (a) {
      address = {
        name: a.name as string,
        phone: a.phone as string,
        line1: a.line1 as string,
        line2: a.line2 as string,
        city: a.city as string,
        region: (a.region as string | null) ?? null,
        postalCode: (a.postal_code as string | null) ?? null,
        countryCode: a.country_code as string,
        notes: (a.notes as string | null) ?? null,
      };
      phone ??= address.phone;
    }
  }

  const id = ulid(now);
  const holdUntil = now + settings.checkoutHoldMinutes * 60_000;
  await d1.batch([
    d1.prepare(`DELETE FROM inventory_reservations WHERE checkout_id IN (SELECT id FROM checkouts WHERE cart_id = ? AND status = 'open')`).bind(cart.id),
    d1.prepare(`UPDATE checkouts SET status = 'expired', updated_at = ? WHERE cart_id = ? AND status = 'open'`).bind(now, cart.id),
    d1
      .prepare(
        `INSERT INTO checkouts (id, cart_id, customer_id, email, phone, accepts_marketing, shipping_address_json, shipping_rate_id,
                                discount_code, note, lines_json, pricing_json, total_amount, currency, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, 0, ?, 'open', ?, ?, ?)`,
      )
      .bind(id, cart.id, customer?.id ?? null, email, phone, acceptsMarketing ? 1 : 0, address ? JSON.stringify(address) : null, cart.discount_code, JSON.stringify(lines), settings.currency, now + CHECKOUT_TTL_MS, now, now),
    ...(settings.checkoutHoldMinutes > 0 ? holdStatements(d1, id, lines, holdUntil) : []),
  ]);

  const row = (await d1.prepare('SELECT * FROM checkouts WHERE id = ?').bind(id).first<CheckoutRow>())!;
  const computed = await computeCheckout(c, row, settings, now);
  await persistPricing(d1, row.id, computed.pricing);
  return computed.dto;
}

async function persistPricing(d1: D1Database, id: string, pricing: PricingResult) {
  await d1.prepare('UPDATE checkouts SET pricing_json = ?, total_amount = ? WHERE id = ?').bind(JSON.stringify(toPricingDTO(pricing)), pricing.total, id).run();
}

export async function getCheckout(c: Ctx, id: string): Promise<CheckoutDTO> {
  const row = await loadCheckout(c, id);
  if (row.status === 'open' && row.expires_at < Date.now()) await assertOpen(c, row);
  const settings = await getSettings(c.get('db'));
  return (await computeCheckout(c, row, settings)).dto;
}

export async function updateCheckout(c: Ctx, id: string, input: z.output<typeof CheckoutUpdateInput>): Promise<CheckoutDTO> {
  const d1 = c.env.DB;
  const row = await loadCheckout(c, id);
  await assertOpen(c, row);
  const settings = await getSettings(c.get('db'));
  const now = Date.now();

  let discountCode = row.discount_code;
  if (input.discountCode !== undefined) {
    if (input.discountCode === null || input.discountCode === '') discountCode = null;
    else {
      const found = await discountByCode(d1, input.discountCode);
      if (!found) throw invalid({ discountCode: 'That code does not exist' }, 'That code does not exist');
      discountCode = found.code;
    }
  }

  const next: CheckoutRow = {
    ...row,
    email: input.email ?? row.email,
    phone: input.phone ?? row.phone,
    accepts_marketing: input.acceptsMarketing === undefined ? row.accepts_marketing : input.acceptsMarketing ? 1 : 0,
    shipping_address_json: input.shippingAddress ? JSON.stringify(input.shippingAddress) : row.shipping_address_json,
    shipping_rate_id: input.shippingRateId === undefined ? row.shipping_rate_id : input.shippingRateId,
    discount_code: discountCode,
    note: input.note === undefined ? row.note : input.note,
    expires_at: now + CHECKOUT_TTL_MS,
    updated_at: now,
  };

  const lines = parseJson<Line[]>(row.lines_json, []);
  const computed = await computeCheckout(c, next, settings, now);
  // a rate that no longer applies (new address, new subtotal) is dropped rather than silently kept
  if (next.shipping_rate_id && !computed.rate) next.shipping_rate_id = null;

  await d1.batch([
    d1
      .prepare(
        `UPDATE checkouts SET email = ?, phone = ?, accepts_marketing = ?, shipping_address_json = ?, shipping_rate_id = ?,
                              discount_code = ?, note = ?, pricing_json = ?, total_amount = ?, expires_at = ?, updated_at = ?
          WHERE id = ? AND status = 'open'`,
      )
      .bind(next.email, next.phone, next.accepts_marketing, next.shipping_address_json, next.shipping_rate_id, next.discount_code, next.note, JSON.stringify(computed.dto.pricing), computed.pricing.total, next.expires_at, now, id),
    // the captured email is what abandoned-cart reminders are sent to
    d1.prepare('UPDATE carts SET email = coalesce(?, email), discount_code = ?, updated_at = ? WHERE id = ?').bind(next.email, next.discount_code, now, row.cart_id),
    ...(settings.checkoutHoldMinutes > 0 ? holdStatements(d1, id, lines, now + settings.checkoutHoldMinutes * 60_000) : []),
  ]);

  return next.shipping_rate_id === row.shipping_rate_id || computed.rate ? computed.dto : (await computeCheckout(c, next, settings, now)).dto;
}

/* ─────────────────────────── completion ─────────────────────────── */

export async function completeCheckout(c: Ctx, id: string, paymentMethod: string): Promise<{ orderToken: string; order: OrderDTO }> {
  await limit(c, 'RL_CHECKOUT', clientIp(c));
  const d1 = c.env.DB;
  const db = c.get('db');
  const row = await loadCheckout(c, id);

  // a double-submitted "Place order" returns the order the first one created
  if (row.status === 'completed' && row.order_token) {
    const order = await orderByToken(db, row.order_token);
    if (order) return { orderToken: row.order_token, order: await orderDTO(db, order) };
  }
  await assertOpen(c, row);

  const provider = getProvider(c.env, paymentMethod);
  if (!provider) throw invalid({ paymentMethod: 'Choose how you want to pay' });

  const settings = await getSettings(db);
  const computed = await computeCheckout(c, row, settings);
  const { pricing, dto } = computed;

  const fields: Record<string, string> = {};
  if (!row.email) fields.email = 'Required';
  if (!row.phone) fields.phone = 'Required';
  if (pricing.requiresShipping && !computed.address) fields.shippingAddress = 'Add a delivery address';
  if (pricing.requiresShipping && computed.address && !computed.rate) fields.shippingRateId = 'Choose a delivery method';
  if (Object.keys(fields).length) throw invalid(fields);

  if (computed.lines.length === 0) throw new AppError('BAD_REQUEST', 'Your bag is empty');
  if (dto.problems.length) {
    throw new AppError('OUT_OF_STOCK', dto.problems[0]!.message, {
      details: { lines: dto.problems.map((p) => ({ variantId: p.variantId, available: p.available })) },
    });
  }
  if (row.discount_code && dto.discountError) {
    throw new AppError('DISCOUNT_INVALID', dto.discountError, { fields: { discountCode: dto.discountError } });
  }

  const created = await provider.createCheckout(
    {
      checkoutId: row.id,
      amount: pricing.total,
      currency: pricing.currency,
      email: row.email!,
      returnUrl: `${c.env.APP_URL}/checkout?resume=${row.id}`,
      cancelUrl: `${c.env.APP_URL}/checkout`,
      description: `${settings.name} order`,
    },
    c.env,
  );
  if (created.kind === 'redirect') {
    // webhook-committed gateways: the order is written when the payment is confirmed
    await d1.prepare('UPDATE checkouts SET provider = ?, provider_ref = ?, updated_at = ? WHERE id = ?').bind(provider.id, created.ref, Date.now(), row.id).run();
    throw new AppError('BAD_REQUEST', 'Redirect payment providers are not enabled in this store');
  }

  const result = await commitOrder(c.env, row, computed, provider, created.ref, 'unpaid', {
    userAgent: c.req.header('user-agent') ?? null,
    ctx: c.executionCtx,
  });
  const order = await orderByToken(db, result.token);
  return { orderToken: result.token, order: await orderDTO(db, order!) };
}

/**
 * Write the order. One D1 batch — a transaction — does all of it: customer
 * record, order + lines + tax lines, stock decrement (CHECK-guarded), holds
 * released, discount usage (CHECK-guarded) and redemption, payment record,
 * audit events, checkout completed (UNIQUE-guarded), cart converted.
 * Any guard failing rolls every statement back.
 */
export async function commitOrder(
  env: Env,
  row: CheckoutRow,
  computed: ComputedCheckout,
  provider: PaymentProvider,
  providerRef: string,
  paymentStatus: 'unpaid' | 'paid',
  opts: { userAgent: string | null; ctx?: BackgroundCtx },
): Promise<{ orderId: string; token: string }> {
  const d1 = env.DB;
  const { pricing, details, lines, address, rate } = computed;
  const now = Date.now();
  const orderId = ulid(now);
  const token = randomToken(24);
  const email = row.email!.toLowerCase();
  const name = address?.name ?? '';
  const productDiscount = pricing.discountTotal;

  const lineJson = JSON.stringify(
    lines.map((l) => {
      const d = details.get(l.variantId)!;
      const b = pricing.lines.find((x) => x.lineId === l.variantId)!;
      return {
        id: ulid(now),
        p: d.productId,
        v: d.variantId,
        h: d.handle,
        t: d.productTitle,
        vt: d.variantTitle,
        s: d.sku,
        m: d.mediaId,
        q: l.quantity,
        u: d.price,
        dc: b.discount,
        tx: b.tax,
        tt: b.total,
        rs: d.requiresShipping ? 1 : 0,
        it: d.tracked ? 1 : 0,
      };
    }),
  );

  const customerStmt = row.customer_id
    ? d1
        .prepare(`UPDATE customers SET orders_count = orders_count + 1, total_spent_amount = total_spent_amount + ?, last_order_at = ?, phone = coalesce(phone, ?), updated_at = ? WHERE id = ?`)
        .bind(pricing.total, now, row.phone, now, row.customer_id)
    : d1
        .prepare(
          `INSERT INTO customers (id, email, password_hash, name, phone, accepts_marketing, session_epoch, orders_count, total_spent_amount, last_order_at, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, 0, 1, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             orders_count = customers.orders_count + 1,
             total_spent_amount = customers.total_spent_amount + excluded.total_spent_amount,
             last_order_at = excluded.last_order_at,
             phone = coalesce(customers.phone, excluded.phone),
             name = CASE WHEN customers.name = '' THEN excluded.name ELSE customers.name END,
             accepts_marketing = max(customers.accepts_marketing, excluded.accepts_marketing),
             updated_at = excluded.updated_at`,
        )
        .bind(ulid(now), email, name, row.phone, row.accepts_marketing, pricing.total, now, now, now);

  const customerRef = row.customer_id ? '?' : '(SELECT id FROM customers WHERE email = ?)';
  const customerParam = row.customer_id ?? email;

  const statements: D1PreparedStatement[] = [
    customerStmt,
    d1
      .prepare(
        `INSERT INTO orders (id, number, checkout_id, customer_id, email, phone, status, payment_status, provider, provider_ref, currency,
                             subtotal_amount, discount_amount, shipping_amount, shipping_discount_amount, tax_amount, total_amount, refunded_amount,
                             prices_include_tax, pricing_json, shipping_address_json, shipping_method, discount_codes_json, note,
                             access_token_hash, user_agent, placed_at, updated_at)
         VALUES (?, (SELECT next_number FROM order_counters WHERE id = 1), ?, ${customerRef}, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        orderId, row.id, customerParam, email, row.phone, paymentStatus === 'paid' ? 'paid' : 'pending', paymentStatus, provider.id, providerRef, pricing.currency,
        pricing.subtotal, productDiscount, pricing.shipping ?? 0, pricing.shippingDiscount, pricing.taxTotal, pricing.total,
        pricing.pricesIncludeTax ? 1 : 0, JSON.stringify(toPricingDTO(pricing)), address ? JSON.stringify(address) : null, rate?.name ?? null,
        JSON.stringify(row.discount_code && pricing.discountId ? [row.discount_code] : []), row.note, await sha256Hex(token), opts.userAgent?.slice(0, 300) ?? null, now, now,
      ),
    d1.prepare('UPDATE order_counters SET next_number = next_number + 1 WHERE id = 1'),
    d1
      .prepare(
        `INSERT INTO order_lines (id, order_id, product_id, variant_id, product_handle, title, variant_title, sku, media_id, quantity,
                                  unit_price_amount, discount_amount, tax_amount, total_amount, requires_shipping, inventory_tracked,
                                  fulfilled_quantity, refunded_quantity, restocked_quantity)
         SELECT json_extract(value, '$.id'), ?2, json_extract(value, '$.p'), json_extract(value, '$.v'), json_extract(value, '$.h'),
                json_extract(value, '$.t'), json_extract(value, '$.vt'), json_extract(value, '$.s'), json_extract(value, '$.m'),
                json_extract(value, '$.q'), json_extract(value, '$.u'), json_extract(value, '$.dc'), json_extract(value, '$.tx'),
                json_extract(value, '$.tt'), json_extract(value, '$.rs'), json_extract(value, '$.it'), 0, 0, 0
           FROM json_each(?1)`,
      )
      .bind(lineJson, orderId),
    d1
      .prepare(
        `INSERT INTO order_tax_lines (id, order_id, order_line_id, name, rate_bps, amount)
         SELECT json_extract(value, '$.id'), ?2, NULL, json_extract(value, '$.n'), json_extract(value, '$.r'), json_extract(value, '$.a') FROM json_each(?1)`,
      )
      .bind(JSON.stringify(pricing.taxLines.map((t) => ({ id: ulid(now), n: t.name, r: t.rateBps, a: t.amount }))), orderId),
    ...commitStatements(d1, lines, { orderId, now }),
    d1.prepare('DELETE FROM inventory_reservations WHERE checkout_id = ?').bind(row.id),
  ];

  if (pricing.discountId) {
    statements.push(
      d1.prepare('UPDATE discounts SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?').bind(now, pricing.discountId),
      d1
        .prepare(`INSERT INTO discount_redemptions (id, discount_id, order_id, customer_id, email, amount, created_at) VALUES (?, ?, ?, ${customerRef}, ?, ?, ?)`)
        .bind(ulid(now), pricing.discountId, orderId, customerParam, email, pricing.discountTotal + pricing.shippingDiscount, now),
    );
  }

  statements.push(
    d1
      .prepare(`INSERT INTO payments (id, order_id, checkout_id, provider, kind, status, amount, currency, provider_ref, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(ulid(now), orderId, row.id, provider.id, paymentStatus === 'paid' ? 'succeeded' : 'pending', pricing.total, pricing.currency, providerRef, now, now),
    eventStatement(d1, { orderId, type: 'order_placed', from: null, to: paymentStatus === 'paid' ? 'paid' : 'pending', actorType: 'customer', actorId: row.customer_id, message: STATUS_COPY.pending, data: { provider: provider.id, total: pricing.total }, customerVisible: true, now }),
    eventStatement(d1, { orderId, type: 'inventory_committed', from: null, to: null, actorType: 'system', actorId: null, message: 'Stock committed', data: { lines: lines.length }, customerVisible: false, now }),
    d1
      .prepare(`UPDATE checkouts SET status = 'completed', order_id = ?, order_token = ?, provider = ?, provider_ref = ?, updated_at = ? WHERE id = ?`)
      .bind(orderId, token, provider.id, providerRef, now, row.id),
    d1.prepare(`UPDATE carts SET status = 'converted', converted_order_id = ?, updated_at = ? WHERE id = ?`).bind(orderId, now, row.cart_id),
    d1.prepare('DELETE FROM cart_lines WHERE cart_id = ?').bind(row.cart_id),
  );

  if (row.accepts_marketing) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO subscribers (email, customer_id, source, status, created_at, updated_at) VALUES (?, ${customerRef}, 'checkout', 'subscribed', ?, ?)
           ON CONFLICT(email) DO UPDATE SET status = 'subscribed', customer_id = coalesce(subscribers.customer_id, excluded.customer_id), updated_at = excluded.updated_at`,
        )
        .bind(email, customerParam, now, now),
    );
  }

  try {
    await d1.batch(statements);
  } catch (err) {
    const name = constraintName(err);
    if (name === 'variants_stock') {
      const short = await shortfalls(d1, lines, Date.now(), row.id);
      throw new AppError('OUT_OF_STOCK', 'Someone just bought the last one — please review your bag', {
        details: { lines: short.map((s) => ({ variantId: s.variantId, available: s.available })) },
      });
    }
    if (name === 'discounts_usage') {
      throw new AppError('DISCOUNT_INVALID', 'This code is no longer available', { fields: { discountCode: 'This code is no longer available' } });
    }
    if (name?.startsWith('unique:orders.checkout_id')) throw new AppError('CONFLICT', 'This order was already placed');
    throw err;
  }

  log.info('order_placed', { orderId, total: pricing.total, provider: provider.id, lines: lines.length });

  await Promise.all([
    enqueue(env, { type: 'email.order_confirmation', orderId }),
    enqueue(env, { type: 'email.new_order_alert', orderId }),
  ]).catch((err) => log.warn('enqueue_failed', { orderId, error: String(err) }));

  // listings show "sold out" — refresh the cache for anything that just sold through
  const { results: soldOut } = await d1
    .prepare(
      `SELECT DISTINCT v.product_id AS id FROM variants v
        WHERE v.product_id IN (SELECT json_extract(value, '$.p') FROM json_each(?))
          AND v.inventory_tracked = 1 AND v.inventory_policy = 'deny' AND v.inventory_on_hand <= 0`,
    )
    .bind(lineJson)
    .all<{ id: string }>();
  if (soldOut.length) purgeProducts(opts.ctx, soldOut.map((r) => r.id));

  return { orderId, token };
}

