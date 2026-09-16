import { Hono } from 'hono';
import { AdminCustomerListQuery, AdminCustomerUpdateInput, type AdminCustomerDTO, type AdminCustomerListItemDTO, type Page } from '../../../shared/api';
import { notFound } from '../../lib/errors';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { decodeCursor, encodeCursor } from '../../services/catalog';
import { addressDTO, customerById, type CustomerRow } from '../../services/customers';
import { adminOrderListItems, type OrderRow } from '../../services/orders';
import type { AppEnv } from '../../types';

export const adminCustomers = new Hono<AppEnv>();

const listItem = (r: CustomerRow): AdminCustomerListItemDTO => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  ordersCount: r.orders_count,
  totalSpent: r.total_spent_amount,
  acceptsMarketing: !!r.accepts_marketing,
  hasAccount: !!r.password_hash,
  createdAt: r.created_at,
  lastOrderAt: r.last_order_at,
});

adminCustomers.get('/customers', staffOnly('customers:read'), query(AdminCustomerListQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (q.q) {
    const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(lower(email) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  const order = { created_desc: 'created_at DESC', spent_desc: 'total_spent_amount DESC, created_at DESC', orders_desc: 'orders_count DESC, created_at DESC' }[q.sort];
  const offset = decodeCursor(q.cursor);
  const d1 = c.env.DB;
  const [rows, count] = await d1.batch<Record<string, unknown>>([
    d1.prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, q.limit + 1, offset),
    d1.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${where.join(' AND ')}`).bind(...params),
  ]);
  const list = (rows?.results ?? []) as unknown as CustomerRow[];
  const body: Page<AdminCustomerListItemDTO> = {
    items: list.slice(0, q.limit).map(listItem),
    nextCursor: list.length > q.limit ? encodeCursor(offset + q.limit) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});

async function detail(d1: D1Database, db: Parameters<typeof adminOrderListItems>[0], id: string): Promise<AdminCustomerDTO> {
  const row = await customerById(d1, id);
  if (!row) throw notFound('Customer not found');
  const [addresses, orders] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, updated_at DESC').bind(id),
    d1.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY placed_at DESC LIMIT 100').bind(id),
  ]);
  const orderRows = (orders?.results ?? []) as unknown as OrderRow[];
  const counted = orderRows.filter((o) => o.status !== 'cancelled');
  return {
    ...listItem(row),
    emailVerified: !!row.email_verified_at,
    note: row.note,
    averageOrderValue: counted.length ? Math.round(row.total_spent_amount / counted.length) : 0,
    addresses: (addresses?.results ?? []).map(addressDTO),
    orders: await adminOrderListItems(db, orderRows),
  };
}

adminCustomers.get('/customers/:id', staffOnly('customers:read'), async (c) => c.json(await detail(c.env.DB, c.get('db'), c.req.param('id'))));

adminCustomers.patch('/customers/:id', staffOnly('customers:write'), json(AdminCustomerUpdateInput), async (c) => {
  const id = c.req.param('id');
  const d1 = c.env.DB;
  const row = await customerById(d1, id);
  if (!row) throw notFound('Customer not found');
  const input = c.req.valid('json');
  await d1
    .prepare('UPDATE customers SET name = ?, phone = ?, note = ?, accepts_marketing = ?, updated_at = ? WHERE id = ?')
    .bind(
      input.name ?? row.name,
      input.phone === undefined ? row.phone : input.phone,
      input.note === undefined ? row.note : input.note,
      input.acceptsMarketing === undefined ? row.accepts_marketing : input.acceptsMarketing ? 1 : 0,
      Date.now(),
      id,
    )
    .run();
  await audit(c, 'customer.updated', 'customer', id, `Updated customer ${row.email}`);
  return c.json(await detail(d1, c.get('db'), id));
});
