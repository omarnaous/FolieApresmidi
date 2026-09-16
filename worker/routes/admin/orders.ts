import { Hono } from 'hono';
import { AdminOrderListQuery, AdminOrderUpdateInput, OrderNoteInput, OrderTransitionInput, RefundInput, type AdminOrderListItemDTO, type Page } from '../../../shared/api';
import { notFound } from '../../lib/errors';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { decodeCursor, encodeCursor } from '../../services/catalog';
import { addOrderNote, adminOrderDTO, adminOrderListItems, orderById, refundOrder, transitionOrder, updateOrderDetails, type OrderRow } from '../../services/orders';
import type { AppEnv } from '../../types';

export const adminOrders = new Hono<AppEnv>();

adminOrders.get('/orders', staffOnly('orders:read'), query(AdminOrderListQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (q.status) {
    where.push('o.status = ?');
    params.push(q.status);
  }
  if (q.paymentStatus) {
    where.push('o.payment_status = ?');
    params.push(q.paymentStatus);
  }
  if (q.customerId) {
    where.push('o.customer_id = ?');
    params.push(q.customerId);
  }
  if (q.from !== undefined) {
    where.push('o.placed_at >= ?');
    params.push(q.from);
  }
  if (q.to !== undefined) {
    where.push('o.placed_at < ?');
    params.push(q.to);
  }
  if (q.q) {
    const digits = q.q.replace(/^#/, '');
    if (/^\d+$/.test(digits)) {
      where.push('o.number = ?');
      params.push(Number(digits));
    } else {
      const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push(`(lower(o.email) LIKE ? ESCAPE '\\' OR lower(coalesce(json_extract(o.shipping_address_json, '$.name'), '')) LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
  }
  const offset = decodeCursor(q.cursor);
  const d1 = c.env.DB;
  const [rows, count] = await d1.batch<Record<string, unknown>>([
    d1.prepare(`SELECT o.* FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.placed_at DESC LIMIT ? OFFSET ?`).bind(...params, q.limit + 1, offset),
    d1.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(' AND ')}`).bind(...params),
  ]);
  const list = (rows?.results ?? []) as unknown as OrderRow[];
  const body: Page<AdminOrderListItemDTO> = {
    items: await adminOrderListItems(c.get('db'), list.slice(0, q.limit)),
    nextCursor: list.length > q.limit ? encodeCursor(offset + q.limit) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});

adminOrders.get('/orders/:id', staffOnly('orders:read'), async (c) => {
  const db = c.get('db');
  const order = await orderById(db, c.req.param('id'));
  if (!order) throw notFound('Order not found');
  return c.json(await adminOrderDTO(db, order));
});

adminOrders.patch('/orders/:id', staffOnly('orders:write'), json(AdminOrderUpdateInput), async (c) => {
  const dto = await updateOrderDetails(c.env, c.get('db'), c.req.param('id'), c.req.valid('json'), c.get('staff')!);
  await audit(c, 'order.updated', 'order', dto.id, `Edited order ${dto.name}`);
  return c.json(dto);
});

adminOrders.post('/orders/:id/transition', staffOnly('orders:write'), json(OrderTransitionInput), async (c) => {
  const input = c.req.valid('json');
  const dto = await transitionOrder(c.env, c.get('db'), c.req.param('id'), input, c.get('staff')!, c.executionCtx);
  await audit(c, `order.${input.to}`, 'order', dto.id, `Marked order ${dto.name} ${input.to}`);
  return c.json(dto);
});

adminOrders.post('/orders/:id/refunds', staffOnly('orders:refund'), json(RefundInput), async (c) => {
  const input = c.req.valid('json');
  const dto = await refundOrder(c.env, c.get('db'), c.req.param('id'), input, c.get('staff')!, c.executionCtx);
  await audit(c, 'order.refunded', 'order', dto.id, `Refunded ${input.amount} on order ${dto.name}`, { amount: input.amount, restock: input.restock });
  return c.json(dto);
});

adminOrders.post('/orders/:id/notes', staffOnly('orders:write'), json(OrderNoteInput), async (c) => {
  const dto = await addOrderNote(c.env, c.get('db'), c.req.param('id'), c.req.valid('json').body, c.get('staff')!);
  return c.json(await adminOrderDTO(c.get('db'), (await orderById(c.get('db'), dto.id))!));
});
