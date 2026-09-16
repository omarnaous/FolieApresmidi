import { Hono } from 'hono';
import { ChangePasswordInput, SavedAddressInput, UpdateAccountInput, WishlistAddInput, type OrderSummaryDTO, type Page } from '../../shared/api';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { AppError, forbidden, invalid, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { json } from '../lib/validate';
import { clientIp, limit } from '../middleware/rate-limit';
import { createSession, requireCustomer } from '../middleware/session';
import { decodeCursor, encodeCursor, productDTOs, type ProductRow } from '../services/catalog';
import { addressDTO, customerById, customerDTO, passwordIterations } from '../services/customers';
import { orderDTO, summaryDTO, type OrderRow } from '../services/orders';
import type { AppEnv, Ctx } from '../types';
import { schema } from '../db/client';
import { and, desc, eq, inArray } from 'drizzle-orm';

export const account = new Hono<AppEnv>();

const MAX_ADDRESSES = 20;

account.use('/account', async (c, next) => {
  requireCustomer(c);
  await next();
});
account.use('/account/*', async (c, next) => {
  requireCustomer(c);
  await next();
});

async function me(c: Ctx) {
  const row = await customerById(c.env.DB, requireCustomer(c));
  if (!row) throw notFound('Account not found');
  return row;
}

account.get('/account', async (c) => c.json(customerDTO(await me(c))));

account.patch('/account', json(UpdateAccountInput), async (c) => {
  const row = await me(c);
  const input = c.req.valid('json');
  const now = Date.now();
  const d1 = c.env.DB;
  const statements = [
    d1
      .prepare('UPDATE customers SET name = ?, phone = ?, accepts_marketing = ?, updated_at = ? WHERE id = ?')
      .bind(input.name ?? row.name, input.phone === undefined ? row.phone : input.phone, input.acceptsMarketing === undefined ? row.accepts_marketing : input.acceptsMarketing ? 1 : 0, now, row.id),
  ];
  if (input.acceptsMarketing !== undefined) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO subscribers (email, customer_id, source, status, created_at, updated_at) VALUES (?, ?, 'account', ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET status = excluded.status, customer_id = excluded.customer_id, updated_at = excluded.updated_at`,
        )
        .bind(row.email, row.id, input.acceptsMarketing ? 'subscribed' : 'unsubscribed', now, now),
    );
  }
  await d1.batch(statements);
  return c.json(customerDTO((await customerById(d1, row.id))!));
});

account.post('/account/password', json(ChangePasswordInput), async (c) => {
  const row = await me(c);
  await limit(c, 'RL_AUTH', `password:${row.id}`);
  const { currentPassword, newPassword } = c.req.valid('json');
  const iterations = passwordIterations(c.env);
  const check = row.password_hash ? await verifyPassword(currentPassword, row.password_hash, c.env.PASSWORD_PEPPER, iterations) : { ok: false };
  if (!check.ok) throw invalid({ currentPassword: 'That is not your current password' });
  const hash = await hashPassword(newPassword, c.env.PASSWORD_PEPPER, iterations);
  // signs out every other device; this one gets a fresh session
  await c.env.DB.prepare('UPDATE customers SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE id = ?').bind(hash, Date.now(), row.id).run();
  await createSession(c, 'customer', row.id, row.session_epoch + 1);
  return c.body(null, 204);
});

/* ─────────── orders ─────────── */

/** Orders are matched to accounts by email, so history needs a verified email. */
async function requireVerified(c: Ctx) {
  const row = await me(c);
  if (!row.email_verified_at) throw forbidden('Confirm your email address to see your orders — we sent you a link.');
  return row;
}

account.get('/account/orders', async (c) => {
  const row = await requireVerified(c);
  const offset = decodeCursor(c.req.query('cursor'));
  const limitN = 20;
  const d1 = c.env.DB;
  const [list, count] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT o.*, (SELECT SUM(quantity) FROM order_lines l WHERE l.order_id = o.id) AS item_count
           FROM orders o WHERE o.customer_id = ? ORDER BY o.placed_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(row.id, limitN + 1, offset),
    d1.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').bind(row.id),
  ]);
  const rows = (list?.results ?? []) as unknown as (OrderRow & { item_count: number | null })[];
  const body: Page<OrderSummaryDTO> = {
    items: rows.slice(0, limitN).map((o) => summaryDTO(o, o.item_count ?? 0)),
    nextCursor: rows.length > limitN ? encodeCursor(offset + limitN) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});

account.get('/account/orders/:number', async (c) => {
  const row = await requireVerified(c);
  const number = Number(c.req.param('number').replace(/^#/, ''));
  if (!Number.isInteger(number)) throw notFound('Order not found');
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE number = ? AND customer_id = ?').bind(number, row.id).first<OrderRow>();
  if (!order) throw notFound('Order not found');
  return c.json(await orderDTO(c.get('db'), order));
});

/* ─────────── addresses ─────────── */

account.get('/account/addresses', async (c) => {
  const id = requireCustomer(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, updated_at DESC').bind(id).all<Record<string, unknown>>();
  return c.json({ items: results.map(addressDTO) });
});

function writeAddress(d1: D1Database, customerId: string, addressId: string, a: ReturnType<typeof SavedAddressInput.parse>, now: number, insert: boolean) {
  const statements: D1PreparedStatement[] = [];
  if (a.isDefault) statements.push(d1.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').bind(customerId));
  statements.push(
    insert
      ? d1
          .prepare(
            `INSERT INTO customer_addresses (id, customer_id, name, phone, line1, line2, city, region, postal_code, country_code, notes, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(addressId, customerId, a.name, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.countryCode, a.notes, a.isDefault ? 1 : 0, now, now)
      : d1
          .prepare(
            `UPDATE customer_addresses SET name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, country_code = ?, notes = ?, is_default = ?, updated_at = ?
              WHERE id = ? AND customer_id = ?`,
          )
          .bind(a.name, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.countryCode, a.notes, a.isDefault ? 1 : 0, now, addressId, customerId),
  );
  return statements;
}

account.post('/account/addresses', json(SavedAddressInput), async (c) => {
  const id = requireCustomer(c);
  const d1 = c.env.DB;
  const count = await d1.prepare('SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_id = ?').bind(id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ADDRESSES) throw new AppError('BAD_REQUEST', `You can save up to ${MAX_ADDRESSES} addresses`);
  const input = c.req.valid('json');
  const now = Date.now();
  const addressId = ulid(now);
  // the first address becomes the default
  const isDefault = input.isDefault || (count?.n ?? 0) === 0;
  await d1.batch(writeAddress(d1, id, addressId, { ...input, isDefault }, now, true));
  const row = await d1.prepare('SELECT * FROM customer_addresses WHERE id = ?').bind(addressId).first<Record<string, unknown>>();
  return c.json(addressDTO(row!), 201);
});

account.patch('/account/addresses/:id', json(SavedAddressInput), async (c) => {
  const id = requireCustomer(c);
  const d1 = c.env.DB;
  const addressId = c.req.param('id');
  const existing = await d1.prepare('SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?').bind(addressId, id).first();
  if (!existing) throw notFound('Address not found');
  await d1.batch(writeAddress(d1, id, addressId, c.req.valid('json'), Date.now(), false));
  const row = await d1.prepare('SELECT * FROM customer_addresses WHERE id = ?').bind(addressId).first<Record<string, unknown>>();
  return c.json(addressDTO(row!));
});

account.delete('/account/addresses/:id', async (c) => {
  const id = requireCustomer(c);
  const res = await c.env.DB.prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?').bind(c.req.param('id'), id).run();
  if (!res.meta.changes) throw notFound('Address not found');
  return c.body(null, 204);
});

/* ─────────── wishlist ─────────── */

account.get('/account/wishlist', async (c) => {
  const id = requireCustomer(c);
  const db = c.get('db');
  const saved = await db
    .select({ productId: schema.wishlistItems.productId })
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.customerId, id))
    .orderBy(desc(schema.wishlistItems.createdAt))
    .limit(200)
    .all();
  if (saved.length === 0) return c.json({ items: [] });
  const ids = saved.map((s) => s.productId);
  const rows: ProductRow[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    rows.push(...(await db.select().from(schema.products).where(and(inArray(schema.products.id, ids.slice(i, i + 90)), eq(schema.products.status, 'active'))).all()));
  }
  const order = new Map(ids.map((pid, i) => [pid, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return c.json({ items: await productDTOs(db, rows) });
});

account.post('/account/wishlist', json(WishlistAddInput), async (c) => {
  const id = requireCustomer(c);
  await limit(c, 'RL_API', `wishlist:${clientIp(c)}`);
  const { productId } = c.req.valid('json');
  const d1 = c.env.DB;
  const product = await d1.prepare(`SELECT id FROM products WHERE id = ? AND status = 'active'`).bind(productId).first();
  if (!product) throw notFound('That piece is not in the boutique');
  await d1.prepare('INSERT OR IGNORE INTO wishlist_items (id, customer_id, product_id, created_at) VALUES (?, ?, ?, ?)').bind(ulid(), id, productId, Date.now()).run();
  return c.body(null, 204);
});

account.delete('/account/wishlist/:productId', async (c) => {
  const id = requireCustomer(c);
  await c.env.DB.prepare('DELETE FROM wishlist_items WHERE customer_id = ? AND product_id = ?').bind(id, c.req.param('productId')).run();
  return c.body(null, 204);
});
