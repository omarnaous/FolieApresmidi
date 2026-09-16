import { Hono } from 'hono';
import { AdminCollectionInput, CollectionProductsInput, type AdminCollectionDTO } from '../../../shared/api';
import { parseJson } from '../../db/client';
import { purge, TAGS } from '../../lib/cache';
import { conflict, invalid, notFound } from '../../lib/errors';
import { slugify, ulid } from '../../lib/ids';
import { sanitizeHtml } from '../../lib/sanitize';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { adminProductListItems } from '../../services/admin-products';
import { audit } from '../../services/audit';
import { rematerialize, type RuleSet } from '../../services/collections';
import { mediaById } from '../../services/media';
import type { AppEnv, Ctx } from '../../types';

export const adminCollections = new Hono<AppEnv>();

async function toDTO(c: Ctx, r: Record<string, unknown>): Promise<AdminCollectionDTO> {
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM collection_products WHERE collection_id = ?').bind(r.id).first<{ n: number }>();
  return {
    id: r.id as string,
    handle: r.handle as string,
    title: r.title as string,
    descriptionHtml: r.description_html as string,
    type: r.type as 'manual' | 'smart',
    rules: parseJson<RuleSet>(r.rules_json as string, { match: 'all', conditions: [] }),
    sort: r.sort as AdminCollectionDTO['sort'],
    image: r.image_media_id ? await mediaById(c.get('db'), r.image_media_id as string) : null,
    published: !!r.published,
    seoTitle: (r.seo_title as string | null) ?? null,
    seoDescription: (r.seo_description as string | null) ?? null,
    productsCount: count?.n ?? 0,
    updatedAt: r.updated_at as number,
  };
}

async function handleFor(d1: D1Database, wanted: string, id: string, explicit: boolean): Promise<string> {
  const base = slugify(wanted);
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await d1.prepare('SELECT id FROM collections WHERE handle = ? AND id != ?').bind(candidate, id).first())) return candidate;
    if (explicit) throw invalid({ handle: 'Another collection already uses this handle' });
  }
  return `${base}-${id.slice(-6).toLowerCase()}`;
}

const invalidate = (c: Ctx, id: string) => purge(c.executionCtx, [TAGS.catalog, TAGS.collections, TAGS.products, TAGS.collection(id)]);

adminCollections.get('/collections', staffOnly('products:read'), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM collections ORDER BY title COLLATE NOCASE').all<Record<string, unknown>>();
  const items: AdminCollectionDTO[] = [];
  for (const r of results) items.push(await toDTO(c, r));
  return c.json({ items });
});

adminCollections.post('/collections', staffOnly('products:write'), json(AdminCollectionInput), async (c) => {
  const input = c.req.valid('json');
  const d1 = c.env.DB;
  const now = Date.now();
  const id = ulid(now);
  const handle = await handleFor(d1, input.handle ?? input.title, id, !!input.handle);
  if (input.type === 'smart' && input.rules.conditions.length === 0) throw invalid({ rules: 'Add at least one condition' });
  await d1
    .prepare(
      `INSERT INTO collections (id, handle, title, description_html, type, rules_json, sort, image_media_id, published, seo_title, seo_description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, handle, input.title, await sanitizeHtml(input.descriptionHtml), input.type, JSON.stringify(input.rules), input.sort, input.imageId, input.published ? 1 : 0, input.seoTitle, input.seoDescription, now, now)
    .run();
  if (input.type === 'smart') await rematerialize(d1, id);
  invalidate(c, id);
  await audit(c, 'collection.created', 'collection', id, `Created collection "${input.title}"`);
  return c.json(await toDTO(c, (await d1.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<Record<string, unknown>>())!), 201);
});

adminCollections.get('/collections/:id', staffOnly('products:read'), async (c) => {
  const d1 = c.env.DB;
  const row = await d1.prepare('SELECT * FROM collections WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) throw notFound('Collection not found');
  const { results } = await d1
    .prepare(
      `SELECT p.id, p.handle, p.title, p.status, p.product_type, p.updated_at,
              (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id) AS variants_count,
              (SELECT coalesce(SUM(CASE WHEN v.inventory_tracked = 1 THEN v.inventory_on_hand ELSE 0 END), 0) FROM variants v WHERE v.product_id = p.id) AS inventory_total,
              (SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS price_min,
              (SELECT MAX(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS price_max,
              (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
         FROM collection_products cp JOIN products p ON p.id = cp.product_id
        WHERE cp.collection_id = ? ORDER BY cp.position, p.title LIMIT 1000`,
    )
    .bind(row.id)
    .all<Record<string, unknown>>();
  return c.json({ ...(await toDTO(c, row)), products: await adminProductListItems(d1, results) });
});

adminCollections.put('/collections/:id', staffOnly('products:write'), json(AdminCollectionInput), async (c) => {
  const input = c.req.valid('json');
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const row = await d1.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) throw notFound('Collection not found');
  if (row.type !== input.type) throw conflict('A collection cannot change between manual and smart — create a new one');
  if (input.type === 'smart' && input.rules.conditions.length === 0) throw invalid({ rules: 'Add at least one condition' });
  const handle = await handleFor(d1, input.handle ?? (row.handle as string), id, !!input.handle && input.handle !== row.handle);
  await d1
    .prepare(
      `UPDATE collections SET handle = ?, title = ?, description_html = ?, rules_json = ?, sort = ?, image_media_id = ?, published = ?, seo_title = ?, seo_description = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(handle, input.title, await sanitizeHtml(input.descriptionHtml), JSON.stringify(input.rules), input.sort, input.imageId, input.published ? 1 : 0, input.seoTitle, input.seoDescription, Date.now(), id)
    .run();
  if (input.type === 'smart') await rematerialize(d1, id);
  invalidate(c, id);
  await audit(c, 'collection.updated', 'collection', id, `Updated collection "${input.title}"`);
  return c.json(await toDTO(c, (await d1.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<Record<string, unknown>>())!));
});

adminCollections.put('/collections/:id/products', staffOnly('products:write'), json(CollectionProductsInput), async (c) => {
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const row = await d1.prepare('SELECT type, title FROM collections WHERE id = ?').bind(id).first<{ type: string; title: string }>();
  if (!row) throw notFound('Collection not found');
  if (row.type !== 'manual') throw conflict('Smart collections choose their own products');
  const ids = [...new Set(c.req.valid('json').productIds)];
  const payload = JSON.stringify(ids.map((pid, i) => ({ p: pid, i })));
  await d1.batch([
    d1.prepare('DELETE FROM collection_products WHERE collection_id = ?').bind(id),
    d1
      .prepare(
        `INSERT INTO collection_products (collection_id, product_id, position)
         SELECT ?2, p.id, json_extract(m.value, '$.i') FROM json_each(?1) m JOIN products p ON p.id = json_extract(m.value, '$.p')`,
      )
      .bind(payload, id),
    d1.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
  ]);
  invalidate(c, id);
  await audit(c, 'collection.products_set', 'collection', id, `Set ${ids.length} products in "${row.title}"`);
  return c.body(null, 204);
});

adminCollections.delete('/collections/:id', staffOnly('products:write'), async (c) => {
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const row = await d1.prepare('SELECT title, handle FROM collections WHERE id = ?').bind(id).first<{ title: string; handle: string }>();
  if (!row) throw notFound('Collection not found');
  await d1.batch([
    d1.prepare('DELETE FROM collection_products WHERE collection_id = ?').bind(id),
    d1.prepare(`DELETE FROM discount_targets WHERE target_type = 'collection' AND target_id = ?`).bind(id),
    d1.prepare('DELETE FROM collections WHERE id = ?').bind(id),
  ]);
  invalidate(c, id);
  await audit(c, 'collection.deleted', 'collection', id, `Deleted collection "${row.title}"`);
  return c.body(null, 204);
});
