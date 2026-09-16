import type {
  AddressDTO,
  AdminOrderDTO,
  AdminOrderListItemDTO,
  FulfillmentDTO,
  OrderDTO,
  OrderEventDTO,
  OrderLineDTO,
  OrderStatus,
  OrderSummaryDTO,
  OrderTransitionInput,
  PaymentStatus,
  PricingDTO,
  RefundDTO,
  RefundInput,
} from '../../shared/api';
import { parseJson, type DB } from '../db/client';
import { allowedTransitions, canTransition, STATUS_COPY } from '../domain/order-state';
import { enqueue } from '../jobs/messages';
import { purgeProducts, type BackgroundCtx } from '../lib/cache';
import { sha256Hex } from '../lib/crypto';
import { AppError, conflict, invalid, notFound } from '../lib/errors';
import { guard, guardedBatch } from '../lib/guard';
import { ulid } from '../lib/ids';
import { log } from '../lib/log';
import { anyProvider, providerName } from '../payments/registry';
import type { StaffPrincipal } from '../types';
import { eventStatement } from './events';
import { restockStatements } from './inventory';
import { mediaByIds } from './media';

export interface OrderRow {
  id: string;
  number: number;
  checkout_id: string | null;
  customer_id: string | null;
  email: string;
  phone: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  provider: string;
  provider_ref: string | null;
  currency: string;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  shipping_discount_amount: number;
  tax_amount: number;
  total_amount: number;
  refunded_amount: number;
  prices_include_tax: number;
  pricing_json: string;
  shipping_address_json: string | null;
  shipping_method: string | null;
  discount_codes_json: string;
  note: string | null;
  access_token_hash: string;
  user_agent: string | null;
  cancel_reason: string | null;
  cancelled_at: number | null;
  placed_at: number;
  updated_at: number;
}

interface LineRow {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_handle: string | null;
  title: string;
  variant_title: string;
  sku: string | null;
  media_id: string | null;
  quantity: number;
  unit_price_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  requires_shipping: number;
  inventory_tracked: number;
  fulfilled_quantity: number;
  refunded_quantity: number;
  restocked_quantity: number;
}

export const orderName = (n: number) => `#${n}`;

export async function orderById(db: DB, id: string): Promise<OrderRow | null> {
  return db.$client.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<OrderRow>();
}

export async function orderByToken(db: DB, token: string): Promise<OrderRow | null> {
  if (!token || token.length > 100) return null;
  return db.$client.prepare('SELECT * FROM orders WHERE access_token_hash = ?').bind(await sha256Hex(token)).first<OrderRow>();
}

export function summaryDTO(o: OrderRow, itemCount: number): OrderSummaryDTO {
  return {
    id: o.id,
    number: o.number,
    name: orderName(o.number),
    status: o.status,
    paymentStatus: o.payment_status,
    placedAt: o.placed_at,
    total: o.total_amount,
    currency: o.currency,
    itemCount,
  };
}

export async function orderDTO(db: DB, o: OrderRow): Promise<OrderDTO> {
  const d1 = db.$client;
  const [lines, fulfillments, events] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid').bind(o.id),
    d1.prepare('SELECT * FROM fulfillments WHERE order_id = ? ORDER BY created_at').bind(o.id),
    d1.prepare('SELECT created_at, to_status, message FROM order_events WHERE order_id = ? AND customer_visible = 1 ORDER BY created_at, rowid').bind(o.id),
  ]);
  const lineRows = (lines?.results ?? []) as unknown as LineRow[];
  const media = await mediaByIds(db, lineRows.map((l) => l.media_id ?? ''));
  const pricing = parseJson<PricingDTO>(o.pricing_json, {
    currency: o.currency,
    subtotal: o.subtotal_amount,
    discountTotal: o.discount_amount,
    discounts: [],
    shipping: o.shipping_amount,
    shippingDiscount: o.shipping_discount_amount,
    taxTotal: o.tax_amount,
    taxLines: [],
    pricesIncludeTax: !!o.prices_include_tax,
    total: o.total_amount,
  });

  const orderLines: OrderLineDTO[] = lineRows.map((l) => ({
    id: l.id,
    productId: l.product_id,
    productHandle: l.product_handle,
    variantId: l.variant_id,
    title: l.title,
    variantTitle: l.variant_title,
    sku: l.sku,
    image: l.media_id ? media.get(l.media_id) ?? null : null,
    quantity: l.quantity,
    unitPrice: l.unit_price_amount,
    discount: l.discount_amount,
    tax: l.tax_amount,
    total: l.total_amount,
    fulfilledQuantity: l.fulfilled_quantity,
    refundedQuantity: l.refunded_quantity,
  }));

  return {
    ...summaryDTO(o, orderLines.reduce((n, l) => n + l.quantity, 0)),
    email: o.email,
    phone: o.phone,
    lines: orderLines,
    pricing: { ...pricing, refunded: o.refunded_amount },
    shippingAddress: parseJson<AddressDTO | null>(o.shipping_address_json, null),
    shippingMethod: o.shipping_method,
    paymentMethod: { id: o.provider, name: providerName(o.provider) },
    note: o.note,
    fulfillments: ((fulfillments?.results ?? []) as Record<string, unknown>[]).map(
      (f): FulfillmentDTO => ({
        id: f.id as string,
        status: f.status as FulfillmentDTO['status'],
        carrier: (f.carrier as string | null) ?? null,
        trackingNumber: (f.tracking_number as string | null) ?? null,
        trackingUrl: (f.tracking_url as string | null) ?? null,
        createdAt: f.created_at as number,
        shippedAt: (f.shipped_at as number | null) ?? null,
        deliveredAt: (f.delivered_at as number | null) ?? null,
      }),
    ),
    timeline: ((events?.results ?? []) as { created_at: number; to_status: OrderStatus | null; message: string }[]).map((e) => ({
      at: e.created_at,
      status: e.to_status,
      message: e.message,
    })),
    cancelledAt: o.cancelled_at,
  };
}

export async function adminOrderDTO(db: DB, o: OrderRow): Promise<AdminOrderDTO> {
  const d1 = db.$client;
  const base = await orderDTO(db, o);
  const [customer, events, refunds] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT id, name, email, orders_count, total_spent_amount FROM customers WHERE id = ?').bind(o.customer_id ?? ''),
    d1
      .prepare(
        `SELECT e.*, s.name AS staff_name FROM order_events e LEFT JOIN staff_users s ON e.actor_type = 'staff' AND s.id = e.actor_id
          WHERE e.order_id = ? ORDER BY e.created_at, e.rowid`,
      )
      .bind(o.id),
    d1.prepare('SELECT r.*, s.name AS staff_name FROM refunds r LEFT JOIN staff_users s ON s.id = r.staff_id WHERE r.order_id = ? ORDER BY r.created_at').bind(o.id),
  ]);
  const cust = (customer?.results?.[0] ?? null) as { id: string; name: string; email: string; orders_count: number; total_spent_amount: number } | null;
  const refundable = o.payment_status === 'paid' || o.payment_status === 'partially_refunded' ? o.total_amount - o.refunded_amount : 0;

  return {
    ...base,
    customer: cust ? { id: cust.id, name: cust.name, email: cust.email, ordersCount: cust.orders_count, totalSpent: cust.total_spent_amount } : null,
    events: ((events?.results ?? []) as Record<string, unknown>[]).map(
      (e): OrderEventDTO => ({
        id: e.id as string,
        type: e.type as string,
        fromStatus: (e.from_status as OrderStatus | null) ?? null,
        toStatus: (e.to_status as OrderStatus | null) ?? null,
        actor: {
          type: e.actor_type as OrderEventDTO['actor']['type'],
          id: (e.actor_id as string | null) ?? null,
          name: e.actor_type === 'staff' ? ((e.staff_name as string | null) ?? 'Staff') : e.actor_type === 'customer' ? 'Customer' : null,
        },
        message: e.message as string,
        data: parseJson<Record<string, unknown> | null>(e.data_json as string | null, null),
        createdAt: e.created_at as number,
      }),
    ),
    refunds: ((refunds?.results ?? []) as Record<string, unknown>[]).map(
      (r): RefundDTO => ({
        id: r.id as string,
        amount: r.amount as number,
        reason: (r.reason as string | null) ?? null,
        restock: !!r.restock,
        lines: parseJson<{ orderLineId: string; quantity: number }[]>(r.lines_json as string, []),
        staffName: (r.staff_name as string | null) ?? null,
        createdAt: r.created_at as number,
      }),
    ),
    allowedTransitions: allowedTransitions({ status: o.status, paymentStatus: o.payment_status }),
    refundableAmount: Math.max(0, refundable),
    userAgent: o.user_agent,
  };
}

export async function adminOrderListItems(db: DB, rows: OrderRow[]): Promise<AdminOrderListItemDTO[]> {
  if (rows.length === 0) return [];
  const d1 = db.$client;
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  const customers = new Map<string, { id: string; name: string; email: string }>();
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const { results } = await d1
      .prepare(`SELECT order_id, SUM(quantity) AS n FROM order_lines WHERE order_id IN (${part.map(() => '?').join(',')}) GROUP BY order_id`)
      .bind(...part)
      .all<{ order_id: string; n: number }>();
    for (const r of results) counts.set(r.order_id, r.n);
  }
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
  for (let i = 0; i < customerIds.length; i += 80) {
    const part = customerIds.slice(i, i + 80);
    const { results } = await d1.prepare(`SELECT id, name, email FROM customers WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all<{ id: string; name: string; email: string }>();
    for (const r of results) customers.set(r.id, r);
  }
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    name: orderName(o.number),
    placedAt: o.placed_at,
    customer: o.customer_id ? customers.get(o.customer_id) ?? null : null,
    email: o.email,
    total: o.total_amount,
    currency: o.currency,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: providerName(o.provider),
    itemCount: counts.get(o.id) ?? 0,
  }));
}

/* ─────────────────────────── staff actions ─────────────────────────── */

const STALE = 'This order changed while you were looking at it. Refresh and try again.';

function stillAt(d1: D1Database, o: OrderRow) {
  return guard(d1, `(SELECT status FROM orders WHERE id = ?) = ? AND (SELECT payment_status FROM orders WHERE id = ?) = ? AND (SELECT refunded_amount FROM orders WHERE id = ?) = ?`, [
    o.id, o.status, o.id, o.payment_status, o.id, o.refunded_amount,
  ]);
}

const latestFulfillment = `(SELECT id FROM fulfillments WHERE order_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1)`;

export async function transitionOrder(
  env: Env,
  db: DB,
  orderId: string,
  input: Required<Pick<OrderTransitionInput, 'to'>> & OrderTransitionInput,
  staff: StaffPrincipal,
  ctx?: BackgroundCtx,
): Promise<AdminOrderDTO> {
  const d1 = env.DB;
  const o = await orderById(db, orderId);
  if (!o) throw notFound('Order not found');
  const to = input.to;
  if (!canTransition({ status: o.status, paymentStatus: o.payment_status }, to)) {
    throw conflict(`An order that is ${o.status} cannot be marked ${to}`);
  }

  const now = Date.now();
  const actor = { actorType: 'staff' as const, actorId: staff.id, now, orderId: o.id };
  const stmts: D1PreparedStatement[] = [stillAt(d1, o)];
  let email: 'shipped' | 'delivered' | 'cancelled' | null = null;
  let restockedProducts: string[] = [];

  switch (to) {
    case 'paid': {
      const moves = o.status === 'pending';
      stmts.push(
        d1.prepare(`UPDATE orders SET status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END, payment_status = 'paid', updated_at = ? WHERE id = ?`).bind(now, o.id),
        d1.prepare(`UPDATE payments SET status = 'succeeded', updated_at = ? WHERE order_id = ? AND kind = 'sale' AND status = 'pending'`).bind(now, o.id),
        eventStatement(d1, { ...actor, type: 'payment_captured', from: moves ? o.status : null, to: moves ? 'paid' : null, message: moves ? STATUS_COPY.paid : 'Payment recorded', data: { amount: o.total_amount }, customerVisible: moves }),
      );
      break;
    }

    case 'fulfilled': {
      const fid = ulid(now);
      stmts.push(
        d1
          .prepare(`INSERT INTO fulfillments (id, order_id, status, carrier, tracking_number, tracking_url, shipped_at, delivered_at, created_at, updated_at) VALUES (?, ?, 'fulfilled', ?, ?, ?, NULL, NULL, ?, ?)`)
          .bind(fid, o.id, input.tracking?.carrier ?? null, input.tracking?.number ?? null, input.tracking?.url ?? null, now, now),
        d1
          .prepare(`INSERT INTO fulfillment_lines (fulfillment_id, order_line_id, quantity) SELECT ?, id, quantity - refunded_quantity FROM order_lines WHERE order_id = ? AND quantity > refunded_quantity`)
          .bind(fid, o.id),
        d1.prepare('UPDATE order_lines SET fulfilled_quantity = quantity - refunded_quantity WHERE order_id = ?').bind(o.id),
        d1.prepare(`UPDATE orders SET status = 'fulfilled', updated_at = ? WHERE id = ?`).bind(now, o.id),
        eventStatement(d1, { ...actor, type: 'status_changed', from: o.status, to: 'fulfilled', message: STATUS_COPY.fulfilled, data: null, customerVisible: true }),
      );
      break;
    }

    case 'shipped': {
      const t = input.tracking ?? {};
      stmts.push(
        d1
          .prepare(
            `UPDATE fulfillments SET status = 'shipped', carrier = coalesce(?, carrier), tracking_number = coalesce(?, tracking_number),
                    tracking_url = coalesce(?, tracking_url), shipped_at = ?, updated_at = ? WHERE id = ${latestFulfillment}`,
          )
          .bind(t.carrier ?? null, t.number ?? null, t.url ?? null, now, now, o.id),
        d1.prepare(`UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ?`).bind(now, o.id),
        eventStatement(d1, {
          ...actor,
          type: 'status_changed',
          from: o.status,
          to: 'shipped',
          message: t.number ? `${STATUS_COPY.shipped} — ${[t.carrier, t.number].filter(Boolean).join(' ')}` : STATUS_COPY.shipped,
          data: { carrier: t.carrier ?? null, trackingNumber: t.number ?? null, trackingUrl: t.url ?? null },
          customerVisible: true,
        }),
      );
      if (input.notifyCustomer !== false) email = 'shipped';
      break;
    }

    case 'delivered': {
      const collect = !!input.markPaid && o.payment_status === 'unpaid';
      stmts.push(
        d1.prepare(`UPDATE fulfillments SET status = 'delivered', shipped_at = coalesce(shipped_at, ?), delivered_at = ?, updated_at = ? WHERE id = ${latestFulfillment}`).bind(now, now, now, o.id),
        d1.prepare(`UPDATE orders SET status = 'delivered', payment_status = ?, updated_at = ? WHERE id = ?`).bind(collect ? 'paid' : o.payment_status, now, o.id),
        eventStatement(d1, { ...actor, type: 'status_changed', from: o.status, to: 'delivered', message: STATUS_COPY.delivered, data: null, customerVisible: true }),
      );
      if (collect) {
        stmts.push(
          d1.prepare(`UPDATE payments SET status = 'succeeded', updated_at = ? WHERE order_id = ? AND kind = 'sale' AND status = 'pending'`).bind(now, o.id),
          eventStatement(d1, { ...actor, type: 'payment_captured', from: null, to: null, message: 'Cash collected on delivery', data: { amount: o.total_amount }, customerVisible: false }),
        );
      }
      if (input.notifyCustomer !== false) email = 'delivered';
      break;
    }

    case 'cancelled': {
      const { results: lines } = await d1
        .prepare('SELECT variant_id, product_id, quantity, restocked_quantity FROM order_lines WHERE order_id = ? AND inventory_tracked = 1 AND variant_id IS NOT NULL')
        .bind(o.id)
        .all<{ variant_id: string; product_id: string | null; quantity: number; restocked_quantity: number }>();
      stmts.push(
        d1.prepare(`UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`).bind(now, input.reason ?? null, now, o.id),
        d1.prepare(`UPDATE fulfillments SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'fulfilled'`).bind(now, o.id),
        d1.prepare(`UPDATE payments SET status = 'failed', error_code = 'cancelled', updated_at = ? WHERE order_id = ? AND kind = 'sale' AND status = 'pending'`).bind(now, o.id),
        d1.prepare('UPDATE customers SET total_spent_amount = max(0, total_spent_amount - ?), updated_at = ? WHERE id = ?').bind(o.total_amount - o.refunded_amount, now, o.customer_id ?? ''),
        eventStatement(d1, { ...actor, type: 'status_changed', from: o.status, to: 'cancelled', message: input.reason ? `${STATUS_COPY.cancelled} — ${input.reason}` : STATUS_COPY.cancelled, data: { restock: input.restock !== false }, customerVisible: true }),
      );
      if (input.restock !== false) {
        const moves = lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity - l.restocked_quantity }));
        stmts.push(
          ...restockStatements(d1, moves, { reason: 'cancel_restock', orderId: o.id, staffId: staff.id, now }),
          d1.prepare('UPDATE order_lines SET restocked_quantity = quantity WHERE order_id = ? AND inventory_tracked = 1 AND variant_id IS NOT NULL').bind(o.id),
          eventStatement(d1, { ...actor, type: 'inventory_restocked', from: null, to: null, message: 'Items returned to stock', data: { lines: moves.length }, customerVisible: false }),
        );
        restockedProducts = lines.map((l) => l.product_id).filter((x): x is string => !!x);
      }
      if (input.notifyCustomer !== false) email = 'cancelled';
      break;
    }
  }

  await guardedBatch(d1, stmts, STALE);
  log.info('order_transition', { orderId: o.id, from: o.status, to, staffId: staff.id });
  if (email) await enqueue(env, { type: 'email.order_status', orderId: o.id, status: email }).catch(() => undefined);
  if (restockedProducts.length) purgeProducts(ctx, restockedProducts);
  return adminOrderDTO(db, (await orderById(db, o.id))!);
}

export async function refundOrder(
  env: Env,
  db: DB,
  orderId: string,
  input: RefundInput,
  staff: StaffPrincipal,
  ctx?: BackgroundCtx,
): Promise<AdminOrderDTO> {
  const d1 = env.DB;
  const o = await orderById(db, orderId);
  if (!o) throw notFound('Order not found');
  if (o.payment_status !== 'paid' && o.payment_status !== 'partially_refunded') {
    throw conflict('Nothing has been paid on this order yet. Cancel it instead.');
  }
  const refundable = o.total_amount - o.refunded_amount;
  if (input.amount > refundable) throw invalid({ amount: `At most ${refundable} can be refunded` });

  const { results: lineRows } = await d1.prepare('SELECT * FROM order_lines WHERE order_id = ?').bind(o.id).all<LineRow>();
  const requested = input.lines ?? [];
  for (const [i, l] of requested.entries()) {
    const row = lineRows.find((r) => r.id === l.orderLineId);
    if (!row) throw invalid({ [`lines.${i}.orderLineId`]: 'Not a line on this order' });
    if (l.quantity > row.quantity - row.refunded_quantity) throw invalid({ [`lines.${i}.quantity`]: `At most ${row.quantity - row.refunded_quantity}` });
  }

  const provider = anyProvider(o.provider);
  if (!provider) throw new AppError('INTERNAL', `The payment method for this order (${o.provider}) is not available`);
  const result = await provider.refund({ ref: o.provider_ref, amount: input.amount, currency: o.currency, reason: input.reason ?? null }, env);
  if (result.status !== 'succeeded') throw new AppError('INTERNAL', result.error ?? 'The payment provider refused the refund');

  const now = Date.now();
  const actor = { actorType: 'staff' as const, actorId: staff.id, now, orderId: o.id };
  const full = o.refunded_amount + input.amount >= o.total_amount;
  const restock = !!input.restock && requested.length > 0;
  const lineJson = JSON.stringify(requested.map((l) => ({ id: l.orderLineId, q: l.quantity, r: restock ? l.quantity : 0 })));

  const stmts: D1PreparedStatement[] = [
    stillAt(d1, o),
    d1
      .prepare(`INSERT INTO refunds (id, order_id, amount, reason, restock, lines_json, provider_ref, status, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?)`)
      .bind(ulid(now), o.id, input.amount, input.reason ?? null, restock ? 1 : 0, JSON.stringify(requested), result.ref, staff.id, now),
    d1
      .prepare(
        `UPDATE orders SET refunded_amount = refunded_amount + ?, payment_status = ?, status = CASE WHEN ? = 1 AND status != 'cancelled' THEN 'refunded' ELSE status END, updated_at = ? WHERE id = ?`,
      )
      .bind(input.amount, full ? 'refunded' : 'partially_refunded', full ? 1 : 0, now, o.id),
    d1
      .prepare(`INSERT INTO payments (id, order_id, checkout_id, provider, kind, status, amount, currency, provider_ref, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, 'refund', 'succeeded', ?, ?, ?, NULL, ?, ?)`)
      .bind(ulid(now), o.id, o.checkout_id, o.provider, input.amount, o.currency, result.ref, now, now),
    d1.prepare('UPDATE customers SET total_spent_amount = max(0, total_spent_amount - ?), updated_at = ? WHERE id = ?').bind(input.amount, now, o.customer_id ?? ''),
    eventStatement(d1, {
      ...actor,
      type: 'refund_issued',
      from: full && o.status !== 'cancelled' ? o.status : null,
      to: full && o.status !== 'cancelled' ? 'refunded' : null,
      message: full ? STATUS_COPY.refunded : 'Partial refund issued',
      data: { amount: input.amount, reason: input.reason ?? null, restock },
      customerVisible: true,
    }),
  ];

  if (requested.length) {
    // CHECK constraints cap refunded/restocked quantities at the ordered quantity
    stmts.push(
      d1
        .prepare(
          `UPDATE order_lines
              SET refunded_quantity = refunded_quantity + (SELECT json_extract(m.value, '$.q') FROM json_each(?1) m WHERE json_extract(m.value, '$.id') = order_lines.id),
                  restocked_quantity = restocked_quantity + (SELECT json_extract(m.value, '$.r') FROM json_each(?1) m WHERE json_extract(m.value, '$.id') = order_lines.id)
            WHERE order_id = ?2 AND id IN (SELECT json_extract(m.value, '$.id') FROM json_each(?1) m)`,
        )
        .bind(lineJson, o.id),
    );
  }

  const restockedProducts: string[] = [];
  if (restock) {
    const moves = requested
      .map((l) => {
        const row = lineRows.find((r) => r.id === l.orderLineId)!;
        if (!row.variant_id || !row.inventory_tracked) return null;
        if (row.product_id) restockedProducts.push(row.product_id);
        return { variantId: row.variant_id, quantity: Math.min(l.quantity, row.quantity - row.restocked_quantity) };
      })
      .filter((x): x is { variantId: string; quantity: number } => !!x);
    stmts.push(...restockStatements(d1, moves, { reason: 'refund_restock', orderId: o.id, staffId: staff.id, now }));
  }

  await guardedBatch(d1, stmts, STALE);
  log.info('order_refund', { orderId: o.id, amount: input.amount, staffId: staff.id });
  if (input.notifyCustomer !== false) {
    await enqueue(env, { type: 'email.order_status', orderId: o.id, status: 'refunded', refundAmount: input.amount }).catch(() => undefined);
  }
  if (restockedProducts.length) purgeProducts(ctx, restockedProducts);
  return adminOrderDTO(db, (await orderById(db, o.id))!);
}

export async function addOrderNote(env: Env, db: DB, orderId: string, body: string, staff: StaffPrincipal): Promise<AdminOrderDTO> {
  const o = await orderById(db, orderId);
  if (!o) throw notFound('Order not found');
  await eventStatement(env.DB, { orderId, type: 'note', from: null, to: null, actorType: 'staff', actorId: staff.id, message: body, data: null, customerVisible: false, now: Date.now() }).run();
  return adminOrderDTO(db, o);
}

export async function updateOrderDetails(
  env: Env,
  db: DB,
  orderId: string,
  input: { email?: string | undefined; phone?: string | null | undefined; shippingAddress?: AddressDTO | undefined; note?: string | null | undefined },
  staff: StaffPrincipal,
): Promise<AdminOrderDTO> {
  const d1 = env.DB;
  const o = await orderById(db, orderId);
  if (!o) throw notFound('Order not found');
  if (o.status === 'shipped' || o.status === 'delivered') {
    if (input.shippingAddress) throw conflict('The parcel has already shipped — the address can no longer change');
  }
  const now = Date.now();
  const changed = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  if (changed.length === 0) return adminOrderDTO(db, o);
  await guardedBatch(
    d1,
    [
      stillAt(d1, o),
      d1
        .prepare('UPDATE orders SET email = ?, phone = ?, shipping_address_json = ?, note = ?, updated_at = ? WHERE id = ?')
        .bind(
          input.email ?? o.email,
          input.phone === undefined ? o.phone : input.phone,
          input.shippingAddress ? JSON.stringify(input.shippingAddress) : o.shipping_address_json,
          input.note === undefined ? o.note : input.note,
          now,
          o.id,
        ),
      eventStatement(d1, { orderId, type: 'order_edited', from: null, to: null, actorType: 'staff', actorId: staff.id, message: `Updated ${changed.join(', ')}`, data: { fields: changed }, customerVisible: false, now }),
    ],
    STALE,
  );
  return adminOrderDTO(db, (await orderById(db, o.id))!);
}
