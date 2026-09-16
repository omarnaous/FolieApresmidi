import { Hono } from 'hono';
import {
  AdminProductInput,
  AdminProductListQuery,
  BulkProductActionInput,
  InventoryAdjustInput,
  MediaUpdateInput,
  type CsvImportDTO,
  type InventoryAdjustmentDTO,
  type MediaDTO,
  type Page,
} from '../../../shared/api';
import { toMajorString } from '../../../shared/money';
import { parseJson } from '../../db/client';
import { enqueue } from '../../jobs/messages';
import { imagesBinding, mediaBucket, requireMediaBucket } from '../../lib/bindings';
import { purgeProducts } from '../../lib/cache';
import { csvLine } from '../../lib/csv';
import { AppError, constraintName, invalid, notFound } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, sniffImage } from '../../lib/images';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { adminProductDTO, adminProductListItems, deleteProductStatements, saveProductCore } from '../../services/admin-products';
import { audit } from '../../services/audit';
import { decodeCursor, encodeCursor } from '../../services/catalog';
import { rematerializeForProducts } from '../../services/collections';
import { adjustStatements } from '../../services/inventory';
import { toMediaDTO } from '../../services/media';
import { getSettings } from '../../services/settings';
import type { AppEnv } from '../../types';

export const adminProducts = new Hono<AppEnv>();

const LIST_SELECT = `SELECT p.id, p.handle, p.title, p.status, p.product_type, p.updated_at,
  (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id) AS variants_count,
  (SELECT coalesce(SUM(CASE WHEN v.inventory_tracked = 1 THEN v.inventory_on_hand ELSE 0 END), 0) FROM variants v WHERE v.product_id = p.id) AS inventory_total,
  (SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS price_min,
  (SELECT MAX(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS price_max,
  (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
  FROM products p`;

adminProducts.get('/products', staffOnly('products:read'), query(AdminProductListQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  }
  if (q.collectionId) {
    where.push('p.id IN (SELECT product_id FROM collection_products WHERE collection_id = ?)');
    params.push(q.collectionId);
  }
  if (q.q) {
    const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(lower(p.title) LIKE ? ESCAPE '\\' OR p.handle LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND lower(v.sku) LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like);
  }
  const offset = decodeCursor(q.cursor);
  const d1 = c.env.DB;
  const [rows, count] = await d1.batch<Record<string, unknown>>([
    d1.prepare(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`).bind(...params, q.limit + 1, offset),
    d1.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`).bind(...params),
  ]);
  const list = rows?.results ?? [];
  const body: Page<Awaited<ReturnType<typeof adminProductListItems>>[number]> = {
    items: await adminProductListItems(d1, list.slice(0, q.limit)),
    nextCursor: list.length > q.limit ? encodeCursor(offset + q.limit) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});

adminProducts.post('/products', staffOnly('products:write'), json(AdminProductInput), async (c) => {
  const staff = c.get('staff')!;
  const id = await saveProductCore(c.env.DB, null, c.req.valid('json'), staff.id);
  purgeProducts(c.executionCtx, [id]);
  const dto = await adminProductDTO(c.env.DB, id);
  await audit(c, 'product.created', 'product', id, `Created product "${dto.title}"`);
  return c.json(dto, 201);
});

/* ─────────── CSV (registered before /products/:id) ─────────── */

const CSV_HEADER = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Status',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Price', 'Variant Compare At Price', 'Variant Inventory Qty', 'Variant Inventory Tracked',
  'Variant Inventory Policy', 'Variant Weight Grams', 'Variant Requires Shipping', 'Variant Taxable',
  'Image Src', 'Image Position', 'Image Alt Text', 'SEO Title', 'SEO Description',
];

adminProducts.get('/products/export.csv', staffOnly('products:read'), async (c) => {
  const d1 = c.env.DB;
  const settings = await getSettings(c.get('db'));
  const origin = c.env.APP_URL;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(csvLine(CSV_HEADER)));
      for (let offset = 0; ; offset += 50) {
        const { results: ids } = await d1.prepare('SELECT id FROM products ORDER BY position, created_at LIMIT 50 OFFSET ?').bind(offset).all<{ id: string }>();
        if (ids.length === 0) break;
        for (const { id } of ids) {
          const p = await adminProductDTO(d1, id);
          const rows = Math.max(p.variants.length, p.media.length, 1);
          const money = (n: number | null) => (n === null ? '' : toMajorString(n, settings.currency));
          for (let i = 0; i < rows; i += 1) {
            const v = p.variants[i];
            const m = p.media[i];
            const first = i === 0;
            controller.enqueue(
              encoder.encode(
                csvLine([
                  p.handle,
                  first ? p.title : '',
                  first ? p.descriptionHtml : '',
                  first ? p.vendor ?? '' : '',
                  first ? p.productType : '',
                  first ? p.tags.join(', ') : '',
                  first ? p.status : '',
                  first ? p.options[0]?.name ?? '' : '', v?.options[0] ?? '',
                  first ? p.options[1]?.name ?? '' : '', v?.options[1] ?? '',
                  first ? p.options[2]?.name ?? '' : '', v?.options[2] ?? '',
                  v?.sku ?? '',
                  v ? money(v.price) : '',
                  v ? money(v.compareAtPrice) : '',
                  v ? v.inventoryOnHand : '',
                  v ? String(v.inventoryTracked) : '',
                  v?.inventoryPolicy ?? '',
                  v ? v.weightGrams : '',
                  v ? String(v.requiresShipping) : '',
                  v ? String(v.taxable) : '',
                  m ? `${origin}${m.url}` : '',
                  m ? i + 1 : '',
                  m?.alt ?? '',
                  first ? p.seoTitle ?? '' : '',
                  first ? p.seoDescription ?? '' : '',
                ]),
              ),
            );
          }
        }
      }
      controller.close();
    },
  });

  await audit(c, 'product.exported', 'product', null, 'Exported products as CSV');
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
});

adminProducts.post('/products/import', staffOnly('products:write'), async (c) => {
  const staff = c.get('staff')!;
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw invalid({ file: 'Choose a CSV file' });
  if (file.size > 5 * 1024 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 'CSV files can be at most 5 MB');
  const text = await file.text();
  if (!text.split(/\r?\n/, 1)[0]?.includes('Handle')) throw invalid({ file: 'The first row must be a header with a "Handle" column' });

  const now = Date.now();
  const id = ulid(now);
  const key = `imports/${id}.csv`;
  await requireMediaBucket(c.env).put(key, text, { httpMetadata: { contentType: 'text/csv' } });
  await c.env.DB.prepare(`INSERT INTO csv_imports (id, staff_id, r2_key, status, summary_json, errors_json, created_at, finished_at) VALUES (?, ?, ?, 'queued', NULL, '[]', ?, NULL)`)
    .bind(id, staff.id, key, now)
    .run();
  await enqueue(c.env, { type: 'csv.import', importId: id });
  await audit(c, 'product.import_started', 'csv_import', id, `Started CSV import "${file.name}"`);
  const body: CsvImportDTO = { id, status: 'queued', summary: null, errors: [], createdAt: now, finishedAt: null };
  return c.json(body, 202);
});

adminProducts.get('/imports/:id', staffOnly('products:read'), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM csv_imports WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) throw notFound('Import not found');
  const body: CsvImportDTO = {
    id: row.id as string,
    status: row.status as CsvImportDTO['status'],
    summary: parseJson(row.summary_json as string | null, null),
    errors: parseJson(row.errors_json as string, []),
    createdAt: row.created_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
  };
  return c.json(body);
});

/* ─────────── bulk ─────────── */

adminProducts.post('/products/bulk', staffOnly('products:write'), json(BulkProductActionInput), async (c) => {
  const { ids, action } = c.req.valid('json');
  const d1 = c.env.DB;
  const now = Date.now();
  let updated = 0;
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const marks = part.map(() => '?').join(',');
    if (action === 'delete') {
      await d1.batch(deleteProductStatements(d1, part));
      updated += part.length;
    } else {
      const status = action === 'activate' ? 'active' : action === 'draft' ? 'draft' : 'archived';
      const res = await d1
        .prepare(`UPDATE products SET status = ?, published_at = CASE WHEN ? = 'active' THEN coalesce(published_at, ?) ELSE published_at END, updated_at = ? WHERE id IN (${marks})`)
        .bind(status, status, now, now, ...part)
        .run();
      updated += res.meta.changes ?? 0;
    }
  }
  if (action !== 'delete') await rematerializeForProducts(d1, ids);
  purgeProducts(c.executionCtx, ids);
  await audit(c, `product.bulk_${action}`, 'product', null, `${action} ${ids.length} products`, { ids });
  return c.json({ updated });
});

/* ─────────── single product ─────────── */

adminProducts.get('/products/:id', staffOnly('products:read'), async (c) => c.json(await adminProductDTO(c.env.DB, c.req.param('id'))));

adminProducts.put('/products/:id', staffOnly('products:write'), json(AdminProductInput), async (c) => {
  const staff = c.get('staff')!;
  const id = await saveProductCore(c.env.DB, c.req.param('id'), c.req.valid('json'), staff.id);
  purgeProducts(c.executionCtx, [id]);
  const dto = await adminProductDTO(c.env.DB, id);
  await audit(c, 'product.updated', 'product', id, `Updated product "${dto.title}"`);
  return c.json(dto);
});

adminProducts.delete('/products/:id', staffOnly('products:write'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT title FROM products WHERE id = ?').bind(id).first<{ title: string }>();
  if (!row) throw notFound('Product not found');
  await c.env.DB.batch(deleteProductStatements(c.env.DB, [id]));
  purgeProducts(c.executionCtx, [id]);
  await audit(c, 'product.deleted', 'product', id, `Deleted product "${row.title}"`);
  return c.body(null, 204);
});

/* ─────────── inventory ─────────── */

adminProducts.post('/variants/:id/inventory', staffOnly('products:write'), json(InventoryAdjustInput), async (c) => {
  const staff = c.get('staff')!;
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const v = await d1.prepare('SELECT product_id, inventory_on_hand FROM variants WHERE id = ?').bind(id).first<{ product_id: string; inventory_on_hand: number }>();
  if (!v) throw notFound('Variant not found');
  const { mode, quantity, note } = c.req.valid('json');
  if (mode === 'set' && quantity < 0) throw invalid({ quantity: 'Cannot be negative' });
  const delta = mode === 'set' ? quantity - v.inventory_on_hand : quantity;
  try {
    await d1.batch(adjustStatements(d1, id, delta, { reason: 'manual', staffId: staff.id, note: note ?? null, now: Date.now() }));
  } catch (err) {
    if (constraintName(err) === 'variants_stock') throw invalid({ quantity: 'Stock cannot go below zero' });
    throw err;
  }
  purgeProducts(c.executionCtx, [v.product_id]);
  await audit(c, 'inventory.adjusted', 'variant', id, `Stock ${delta >= 0 ? '+' : ''}${delta}`, { delta, note: note ?? null });
  const dto = await adminProductDTO(d1, v.product_id);
  return c.json(dto.variants.find((x) => x.id === id));
});

adminProducts.get('/variants/:id/inventory', staffOnly('products:read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, s.name AS staff_name FROM inventory_adjustments a LEFT JOIN staff_users s ON s.id = a.staff_id
      WHERE a.variant_id = ? ORDER BY a.created_at DESC LIMIT 100`,
  )
    .bind(c.req.param('id'))
    .all<Record<string, unknown>>();
  const items: InventoryAdjustmentDTO[] = results.map((r) => ({
    id: r.id as string,
    delta: r.delta as number,
    reason: r.reason as string,
    note: (r.note as string | null) ?? null,
    orderId: (r.order_id as string | null) ?? null,
    staffName: (r.staff_name as string | null) ?? null,
    createdAt: r.created_at as number,
  }));
  return c.json({ items });
});

/* ─────────── media library ─────────── */

adminProducts.get('/media', staffOnly('products:read'), async (c) => {
  const offset = decodeCursor(c.req.query('cursor'));
  const d1 = c.env.DB;
  const [rows, count] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 61 OFFSET ?').bind(offset),
    d1.prepare('SELECT COUNT(*) AS n FROM media'),
  ]);
  const list = rows?.results ?? [];
  const body: Page<MediaDTO> = {
    items: list.slice(0, 60).map((m) => toMediaDTO({ id: m.id as string, r2Key: m.r2_key as string, alt: m.alt as string, width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null })),
    nextCursor: list.length > 60 ? encodeCursor(offset + 60) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
  return c.json(body);
});

adminProducts.post('/media', staffOnly('products:write'), async (c) => {
  const staff = c.get('staff')!;
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > 95 * 1024 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 'Upload at most 95 MB at a time');
  const form = await c.req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) throw invalid({ files: 'Choose at least one image' });
  if (files.length > MAX_UPLOAD_FILES) throw invalid({ files: `Upload at most ${MAX_UPLOAD_FILES} images at a time` });

  const bucket = requireMediaBucket(c.env);
  const items: MediaDTO[] = [];
  for (const [i, file] of files.entries()) {
    if (file.size > MAX_UPLOAD_BYTES) throw invalid({ [`files.${i}`]: `${file.name} is larger than 10 MB` });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw invalid({ [`files.${i}`]: `${file.name} is not a JPEG, PNG, WebP, AVIF or GIF image` });

    let width: number | null = null;
    let height: number | null = null;
    try {
      const info = await imagesBinding(c.env)!.info(new Blob([bytes]).stream());
      if ('width' in info) {
        width = info.width;
        height = info.height;
      }
    } catch {
      // dimensions are a nicety; the Images binding may be unavailable locally
    }

    const now = Date.now();
    const id = ulid(now);
    const key = `products/${new Date(now).getUTCFullYear()}/${id.toLowerCase()}.${kind.ext}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: kind.mime, cacheControl: 'public, max-age=31536000, immutable' } });
    const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 120);
    await c.env.DB.prepare('INSERT INTO media (id, r2_key, source_url, mime, bytes, width, height, alt, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, key, kind.mime, bytes.byteLength, width, height, alt, staff.id, now)
      .run();
    items.push(toMediaDTO({ id, r2Key: key, alt, width, height }));
  }
  await audit(c, 'media.uploaded', 'media', null, `Uploaded ${items.length} image${items.length === 1 ? '' : 's'}`);
  return c.json({ items }, 201);
});

adminProducts.patch('/media/:id', staffOnly('products:write'), json(MediaUpdateInput), async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('UPDATE media SET alt = ? WHERE id = ?').bind(c.req.valid('json').alt, id).run();
  if (!res.meta.changes) throw notFound('Image not found');
  const m = (await c.env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(id).first<Record<string, unknown>>())!;
  const { results } = await c.env.DB.prepare('SELECT product_id FROM product_media WHERE media_id = ?').bind(id).all<{ product_id: string }>();
  purgeProducts(c.executionCtx, results.map((r) => r.product_id));
  return c.json(toMediaDTO({ id, r2Key: m.r2_key as string, alt: m.alt as string, width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null }));
});

adminProducts.delete('/media/:id', staffOnly('products:write'), async (c) => {
  const id = c.req.param('id');
  const d1 = c.env.DB;
  const m = await d1.prepare('SELECT r2_key FROM media WHERE id = ?').bind(id).first<{ r2_key: string }>();
  if (!m) throw notFound('Image not found');
  const { results } = await d1.prepare('SELECT product_id FROM product_media WHERE media_id = ?').bind(id).all<{ product_id: string }>();
  await d1.batch([
    d1.prepare('DELETE FROM product_media WHERE media_id = ?').bind(id),
    d1.prepare('UPDATE variants SET media_id = NULL WHERE media_id = ?').bind(id),
    d1.prepare('UPDATE collections SET image_media_id = NULL WHERE image_media_id = ?').bind(id),
    d1.prepare('UPDATE store_settings SET logo_media_id = NULL WHERE logo_media_id = ?').bind(id),
    d1.prepare('DELETE FROM media WHERE id = ?').bind(id),
  ]);
  await mediaBucket(c.env)?.delete(m.r2_key);
  purgeProducts(c.executionCtx, results.map((r) => r.product_id));
  await audit(c, 'media.deleted', 'media', id, 'Deleted an image');
  return c.body(null, 204);
});
