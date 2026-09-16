import { Hono } from 'hono';
import type { z } from 'zod';
import { AdminDiscountInput } from '../../../shared/api';
import { constraintName, invalid, notFound } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { discountDTOs } from '../../services/discount-rules';
import type { AppEnv } from '../../types';

export const adminDiscounts = new Hono<AppEnv>();

type Input = z.output<typeof AdminDiscountInput>;

function writeStatements(d1: D1Database, id: string, d: Input, now: number, insert: boolean): D1PreparedStatement[] {
  const bxgy = d.type === 'buy_x_get_y';
  const cols = [
    d.code, d.title, d.type, d.value, d.appliesTo, d.minSubtotal, d.minQuantity, d.usageLimit, d.usageLimitPerCustomer,
    bxgy ? d.buyX?.quantity ?? null : null, bxgy ? d.getY?.quantity ?? null : null, bxgy ? d.maxUsesPerOrder : null,
    d.startsAt, d.endsAt, d.status,
  ];
  const targets: [string, string, string][] = [];
  if (d.appliesTo === 'products') d.targets.productIds.forEach((t) => targets.push(['product', t, 'applies']));
  if (d.appliesTo === 'collections') d.targets.collectionIds.forEach((t) => targets.push(['collection', t, 'applies']));
  if (bxgy) {
    d.buyX?.targets.productIds.forEach((t) => targets.push(['product', t, 'buy']));
    d.buyX?.targets.collectionIds.forEach((t) => targets.push(['collection', t, 'buy']));
    d.getY?.targets.productIds.forEach((t) => targets.push(['product', t, 'get']));
    d.getY?.targets.collectionIds.forEach((t) => targets.push(['collection', t, 'get']));
  }
  return [
    insert
      ? d1
          .prepare(
            `INSERT INTO discounts (id, code, title, type, value, applies_to, min_subtotal_amount, min_quantity, usage_limit, usage_limit_per_customer,
                                    buy_quantity, get_quantity, max_uses_per_order, starts_at, ends_at, status, usage_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          )
          .bind(id, ...cols, now, now)
      : d1
          .prepare(
            `UPDATE discounts SET code = ?, title = ?, type = ?, value = ?, applies_to = ?, min_subtotal_amount = ?, min_quantity = ?, usage_limit = ?,
                    usage_limit_per_customer = ?, buy_quantity = ?, get_quantity = ?, max_uses_per_order = ?, starts_at = ?, ends_at = ?, status = ?, updated_at = ?
              WHERE id = ?`,
          )
          .bind(...cols, now, id),
    d1.prepare('DELETE FROM discount_targets WHERE discount_id = ?').bind(id),
    d1
      .prepare(
        `INSERT OR IGNORE INTO discount_targets (discount_id, target_type, target_id, role)
         SELECT ?2, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?1)`,
      )
      .bind(JSON.stringify(targets), id),
  ];
}

async function run(d1: D1Database, statements: D1PreparedStatement[], d: Input) {
  try {
    await d1.batch(statements);
  } catch (err) {
    if (constraintName(err)?.startsWith('unique:discounts.code')) throw invalid({ code: `The code ${d.code} is already in use` });
    if (constraintName(err) === 'discounts_usage') throw invalid({ usageLimit: 'This code has already been used more times than that' });
    throw err;
  }
}

adminDiscounts.get('/discounts', staffOnly('discounts:read'), async (c) => c.json({ items: await discountDTOs(c.env.DB, 'ORDER BY created_at DESC', []) }));

adminDiscounts.post('/discounts', staffOnly('discounts:write'), json(AdminDiscountInput), async (c) => {
  const d = c.req.valid('json');
  const now = Date.now();
  const id = ulid(now);
  await run(c.env.DB, writeStatements(c.env.DB, id, d, now, true), d);
  await audit(c, 'discount.created', 'discount', id, `Created discount ${d.code}`);
  const [dto] = await discountDTOs(c.env.DB, 'WHERE id = ?', [id]);
  return c.json(dto, 201);
});

adminDiscounts.get('/discounts/:id', staffOnly('discounts:read'), async (c) => {
  const [dto] = await discountDTOs(c.env.DB, 'WHERE id = ?', [c.req.param('id')]);
  if (!dto) throw notFound('Discount not found');
  return c.json(dto);
});

adminDiscounts.put('/discounts/:id', staffOnly('discounts:write'), json(AdminDiscountInput), async (c) => {
  const id = c.req.param('id');
  const [existing] = await discountDTOs(c.env.DB, 'WHERE id = ?', [id]);
  if (!existing) throw notFound('Discount not found');
  const d = c.req.valid('json');
  await run(c.env.DB, writeStatements(c.env.DB, id, d, Date.now(), false), d);
  await audit(c, 'discount.updated', 'discount', id, `Updated discount ${d.code}`);
  const [dto] = await discountDTOs(c.env.DB, 'WHERE id = ?', [id]);
  return c.json(dto);
});

adminDiscounts.delete('/discounts/:id', staffOnly('discounts:write'), async (c) => {
  const id = c.req.param('id');
  const d1 = c.env.DB;
  const row = await d1.prepare('SELECT code FROM discounts WHERE id = ?').bind(id).first<{ code: string }>();
  if (!row) throw notFound('Discount not found');
  // redemptions stay for the order history
  await d1.batch([d1.prepare('DELETE FROM discount_targets WHERE discount_id = ?').bind(id), d1.prepare('DELETE FROM discounts WHERE id = ?').bind(id)]);
  await audit(c, 'discount.deleted', 'discount', id, `Deleted discount ${row.code}`);
  return c.body(null, 204);
});
