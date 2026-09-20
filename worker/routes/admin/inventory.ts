import { Hono } from 'hono';
import { InventoryListQuery, InventorySetInput, type InventoryRowDTO, type Page } from '../../../shared/api';
import { purgeProducts } from '../../lib/cache';
import { constraintName, invalid } from '../../lib/errors';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { decodeCursor, encodeCursor } from '../../services/catalog';
import { adjustStatements } from '../../services/inventory';
import { mediaByIdsRaw } from '../../services/media';
import { getSettings } from '../../services/settings';
import type { AppEnv } from '../../types';

/** Stock for the whole shop on one screen, rather than a product at a time. */
export const adminInventory = new Hono<AppEnv>();

interface Row {
  variant_id: string;
  product_id: string;
  product_title: string;
  variant_title: string;
  sku: string | null;
  media_id: string | null;
  on_hand: number;
  reserved: number;
  tracked: number;
  policy: 'deny' | 'continue';
  status: string;
}

async function rows(d1: D1Database, sql: string, params: unknown[]): Promise<InventoryRowDTO[]> {
  const { results } = await d1.prepare(sql).bind(...params).all<Row>();
  const media = await mediaByIdsRaw(d1, results.map((r) => r.media_id ?? ''));
  return results.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    productTitle: r.product_title,
    variantTitle: r.variant_title,
    sku: r.sku,
    image: r.media_id ? media.get(r.media_id) ?? null : null,
    onHand: r.on_hand,
    reserved: r.reserved,
    tracked: !!r.tracked,
    policy: r.policy,
    status: r.status as InventoryRowDTO['status'],
  }));
}

/* The reserved count is what open checkouts are holding; sellable is what is
   left after them, and that is what "low" and "out" are measured against. */
const SELECT = `
  SELECT v.id AS variant_id, p.id AS product_id, p.title AS product_title, v.title AS variant_title, v.sku, p.status,
         v.inventory_on_hand AS on_hand, v.inventory_tracked AS tracked, v.inventory_policy AS policy,
         COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id = v.id AND r.expires_at > ?), 0) AS reserved,
         COALESCE(v.media_id, (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1)) AS media_id
    FROM variants v JOIN products p ON p.id = v.product_id`;

adminInventory.get('/inventory', staffOnly('products:read'), query(InventoryListQuery), async (c) => {
  const q = c.req.valid('query');
  const settings = await getSettings(c.get('db'));
  const now = Date.now();
  const where: string[] = [`p.status != 'archived'`];
  const params: unknown[] = [now];

  if (q.q) {
    const like = `%${q.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
    where.push(`(lower(p.title) LIKE ? ESCAPE '\\' OR lower(v.title) LIKE ? ESCAPE '\\' OR lower(v.sku) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  // only pieces that are actually counted can be low or out
  const left = `(v.inventory_on_hand - COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id = v.id AND r.expires_at > ${now}), 0))`;
  if (q.show === 'low') where.push(`v.inventory_tracked = 1 AND v.inventory_policy = 'deny' AND ${left} > 0 AND ${left} <= ${settings.lowStockThreshold}`);
  if (q.show === 'out') where.push(`v.inventory_tracked = 1 AND v.inventory_policy = 'deny' AND ${left} <= 0`);

  const whereSql = where.join(' AND ');
  const offset = decodeCursor(q.cursor);
  const items = await rows(
    c.env.DB,
    `${SELECT} WHERE ${whereSql} ORDER BY p.title COLLATE NOCASE, v.position LIMIT ? OFFSET ?`,
    [...params, q.limit + 1, offset],
  );
  const count = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM variants v JOIN products p ON p.id = v.product_id WHERE ${whereSql}`)
    .bind(...params.slice(1))
    .first<{ n: number }>();

  const body: Page<InventoryRowDTO> = {
    items: items.slice(0, q.limit),
    nextCursor: items.length > q.limit ? encodeCursor(offset + q.limit) : null,
    total: count?.n ?? 0,
  };
  return c.json(body);
});

adminInventory.post('/inventory', staffOnly('products:write'), json(InventorySetInput), async (c) => {
  const staff = c.get('staff')!;
  const { items } = c.req.valid('json');
  const d1 = c.env.DB;
  const now = Date.now();

  const ids = items.map((i) => i.variantId);
  const { results: current } = await d1
    .prepare(`SELECT id, product_id, inventory_on_hand AS on_hand FROM variants WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; product_id: string; on_hand: number }>();
  const by = new Map(current.map((v) => [v.id, v]));
  const missing = items.findIndex((i) => !by.has(i.variantId));
  if (missing >= 0) throw invalid({ [`items.${missing}.variantId`]: 'That variant no longer exists' });

  /* The change the screen made, not the number it saw: a sale that happened
     while it was open still counts. */
  const statements = items.flatMap((i) => adjustStatements(d1, i.variantId, i.onHand - i.baseline, { reason: 'manual', staffId: staff.id, note: null, now }));
  if (statements.length) {
    try {
      await d1.batch(statements);
    } catch (err) {
      if (constraintName(err) === 'variants_stock') throw invalid({ items: 'That would put a piece below zero — reload and try again' });
      throw err;
    }
  }

  const changed = items.filter((i) => i.onHand !== i.baseline);
  purgeProducts(c.executionCtx, [...new Set(changed.map((i) => by.get(i.variantId)!.product_id))]);
  if (changed.length) await audit(c, 'inventory.adjusted', 'variant', null, `Stock set on ${changed.length} variant${changed.length === 1 ? '' : 's'}`);

  const saved = await rows(d1, `${SELECT} WHERE v.id IN (${ids.map(() => '?').join(',')})`, [now, ...ids]);
  return c.json({ items: saved });
});
