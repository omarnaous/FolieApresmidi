import { Hono } from 'hono';
import { ORDER_STATUSES, type DashboardDTO, type OrderStatus } from '../../../shared/api';
import { invalid } from '../../lib/errors';
import { staffOnly } from '../../middleware/session';
import { mediaByIdsRaw } from '../../services/media';
import { adminOrderListItems, type OrderRow } from '../../services/orders';
import { getSettings } from '../../services/settings';
import type { AppEnv } from '../../types';

export const adminDashboard = new Hono<AppEnv>();

const DAY = 86_400_000;

/**
 * Revenue is what was sold net of refunds, from orders that were not
 * cancelled, bucketed by the UTC day the order was placed. Cash-on-delivery
 * orders count when placed, like every storefront report.
 */
adminDashboard.get('/dashboard', staffOnly('dashboard:read'), async (c) => {
  const now = Date.now();
  const to = Number(c.req.query('to') ?? now);
  const from = Number(c.req.query('from') ?? to - 30 * DAY);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw invalid({ from: 'The start must be before the end' });
  if (to - from > 3 * 366 * DAY) throw invalid({ from: 'Choose a range of at most three years' });
  const prevFrom = from - (to - from);

  const d1 = c.env.DB;
  const db = c.get('db');
  const settings = await getSettings(db);
  const monthly = to - from > 120 * DAY;
  const bucket = monthly ? `strftime('%Y-%m', placed_at / 1000, 'unixepoch')` : `strftime('%Y-%m-%d', placed_at / 1000, 'unixepoch')`;

  const totals = `SELECT coalesce(SUM(total_amount - refunded_amount), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE status != 'cancelled' AND placed_at >= ? AND placed_at < ?`;
  const itemsSql = `SELECT coalesce(SUM(l.quantity - l.refunded_quantity), 0) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status != 'cancelled' AND o.placed_at >= ? AND o.placed_at < ?`;
  const customersSql = 'SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?';
  const [cur, prev, items, customers, prevItems, prevCustomers, series, top, statuses, low, recent] = await d1.batch<Record<string, unknown>>([
    d1.prepare(totals).bind(from, to),
    d1.prepare(totals).bind(prevFrom, from),
    d1.prepare(itemsSql).bind(from, to),
    d1.prepare(customersSql).bind(from, to),
    d1.prepare(itemsSql).bind(prevFrom, from),
    d1.prepare(customersSql).bind(prevFrom, from),
    d1
      .prepare(`SELECT ${bucket} AS day, coalesce(SUM(total_amount - refunded_amount), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE status != 'cancelled' AND placed_at >= ? AND placed_at < ? GROUP BY day ORDER BY day`)
      .bind(from, to),
    d1
      .prepare(
        `SELECT l.product_id, l.title, SUM(l.quantity - l.refunded_quantity) AS quantity, SUM(l.total_amount) AS revenue, MAX(l.media_id) AS media_id
           FROM order_lines l JOIN orders o ON o.id = l.order_id
          WHERE o.status != 'cancelled' AND o.placed_at >= ? AND o.placed_at < ?
          GROUP BY coalesce(l.product_id, l.title) ORDER BY revenue DESC LIMIT 5`,
      )
      .bind(from, to),
    d1.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE placed_at >= ? AND placed_at < ? GROUP BY status').bind(from, to),
    d1
      .prepare(
        `SELECT v.id AS variant_id, p.id AS product_id, p.title AS product_title, v.title AS variant_title, v.inventory_on_hand AS on_hand
           FROM variants v JOIN products p ON p.id = v.product_id
          WHERE p.status = 'active' AND v.inventory_tracked = 1 AND v.inventory_policy = 'deny' AND v.inventory_on_hand <= ?
          ORDER BY v.inventory_on_hand ASC, p.title LIMIT 10`,
      )
      .bind(settings.lowStockThreshold),
    d1.prepare('SELECT * FROM orders ORDER BY placed_at DESC LIMIT 8'),
  ]);

  const first = <T>(r: D1Result<Record<string, unknown>> | undefined) => (r?.results?.[0] ?? {}) as T;
  const c1 = first<{ revenue: number; orders: number }>(cur);
  const c0 = first<{ revenue: number; orders: number }>(prev);

  // fill empty days/months so the chart has an even axis
  const byKey = new Map(((series?.results ?? []) as { day: string; revenue: number; orders: number }[]).map((r) => [r.day, r]));
  const points: DashboardDTO['series'] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  if (monthly) cursor.setUTCDate(1);
  while (cursor.getTime() < to && points.length < 400) {
    const key = monthly ? cursor.toISOString().slice(0, 7) : cursor.toISOString().slice(0, 10);
    const hit = byKey.get(key);
    points.push({ date: monthly ? `${key}-01` : key, revenue: hit?.revenue ?? 0, orders: hit?.orders ?? 0 });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const topRows = (top?.results ?? []) as { product_id: string | null; title: string; quantity: number; revenue: number; media_id: string | null }[];
  const media = await mediaByIdsRaw(d1, topRows.map((t) => t.media_id ?? ''));

  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of (statuses?.results ?? []) as { status: OrderStatus; n: number }[]) statusCounts[r.status] = r.n;

  const body: DashboardDTO = {
    currency: settings.currency,
    range: { from, to },
    revenue: c1.revenue ?? 0,
    orders: c1.orders ?? 0,
    averageOrderValue: c1.orders ? Math.round(c1.revenue / c1.orders) : 0,
    itemsSold: first<{ n: number }>(items).n ?? 0,
    newCustomers: first<{ n: number }>(customers).n ?? 0,
    previous: {
      revenue: c0.revenue ?? 0,
      orders: c0.orders ?? 0,
      averageOrderValue: c0.orders ? Math.round(c0.revenue / c0.orders) : 0,
      itemsSold: first<{ n: number }>(prevItems).n ?? 0,
      newCustomers: first<{ n: number }>(prevCustomers).n ?? 0,
    },
    series: points,
    topProducts: topRows.map((t) => ({ productId: t.product_id, title: t.title, quantity: t.quantity, revenue: t.revenue, image: t.media_id ? media.get(t.media_id) ?? null : null })),
    statusCounts,
    lowStock: ((low?.results ?? []) as { variant_id: string; product_id: string; product_title: string; variant_title: string; on_hand: number }[]).map((r) => ({
      variantId: r.variant_id,
      productId: r.product_id,
      productTitle: r.product_title,
      variantTitle: r.variant_title,
      onHand: r.on_hand,
    })),
    recentOrders: await adminOrderListItems(db, (recent?.results ?? []) as unknown as OrderRow[]),
  };
  return c.json(body);
});
