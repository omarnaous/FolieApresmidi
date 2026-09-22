import type { AdminLookPieceDTO, AdminProductDTO, AdminProductInput, AdminProductListItemDTO, AdminVariantDTO, MediaDTO, ProductOptionDTO } from '../../shared/api';
import type { z } from 'zod';
import type { AdminProductInput as AdminProductInputSchema } from '../../shared/api';
import { constraintName, invalid, notFound } from '../lib/errors';
import { slugify, ulid } from '../lib/ids';
import { sanitizeHtml } from '../lib/sanitize';
import { plainText, reindexStatements, variantOptions, variantTitle } from './catalog';
import { rematerializeForProducts } from './collections';
import { adjustStatements } from './inventory';
import { chunk, mediaByIdsRaw, toMediaDTO } from './media';

export type ProductInput = z.output<typeof AdminProductInputSchema>;
export type { AdminProductInput };

interface VariantRow {
  id: string;
  product_id: string;
  sku: string | null;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price_amount: number;
  compare_at_amount: number | null;
  cost_amount: number | null;
  weight_grams: number;
  requires_shipping: number;
  taxable: number;
  inventory_tracked: number;
  inventory_policy: 'deny' | 'continue';
  inventory_on_hand: number;
  media_id: string | null;
  position: number;
}

async function uniqueHandle(d1: D1Database, wanted: string, productId: string | null, explicit: boolean): Promise<string> {
  const base = slugify(wanted);
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await d1.prepare('SELECT id FROM products WHERE handle = ? AND id != ?').bind(candidate, productId ?? '').first();
    if (!taken) return candidate;
    if (explicit) throw invalid({ handle: 'Another product already uses this handle' });
  }
  return `${base}-${ulid().slice(-6).toLowerCase()}`;
}

/**
 * Create or replace a product in one batch: row, options, variants (stock
 * changes recorded as adjustments), media order, tags, manual collections,
 * its look, and its search document. Returns the product id.
 */
export async function saveProductCore(d1: D1Database, id: string | null, input: ProductInput, staffId: string | null, reason: 'manual' | 'import' = 'manual'): Promise<string> {
  const now = Date.now();
  const existing = id ? await d1.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<{ id: string; status: string; published_at: number | null; created_at: number }>() : null;
  if (id && !existing) throw notFound('Product not found');
  const productId = id ?? ulid(now);

  const handle = await uniqueHandle(d1, input.handle ?? input.title, productId, !!input.handle);
  const descriptionHtml = await sanitizeHtml(input.descriptionHtml ?? '');
  const publishedAt = input.status === 'active' ? existing?.published_at ?? now : existing?.published_at ?? null;

  // referenced media and collections must exist
  if (input.mediaIds.length) {
    const found = await mediaByIdsRaw(d1, input.mediaIds);
    const missing = input.mediaIds.filter((m) => !found.has(m));
    if (missing.length) throw invalid({ mediaIds: 'Some images no longer exist — re-upload them' });
  }
  let manualCollections: string[] = [];
  if (input.collectionIds.length) {
    const { results } = await d1
      .prepare(`SELECT id FROM collections WHERE type = 'manual' AND id IN (${input.collectionIds.map(() => '?').join(',')})`)
      .bind(...input.collectionIds.slice(0, 90))
      .all<{ id: string }>();
    manualCollections = results.map((r) => r.id);
  }
  const look = input.lookProductIds;
  if (look?.includes(productId)) throw invalid({ lookProductIds: 'A piece cannot complete its own look' });
  if (look?.length) {
    const { results } = await d1
      .prepare(`SELECT id FROM products WHERE id IN (${look.map(() => '?').join(',')})`)
      .bind(...look)
      .all<{ id: string }>();
    if (results.length !== look.length) throw invalid({ lookProductIds: 'Some of these pieces no longer exist — remove them and save again' });
  }

  const { results: currentVariants } = await d1.prepare('SELECT * FROM variants WHERE product_id = ?').bind(productId).all<VariantRow>();
  const byId = new Map(currentVariants.map((v) => [v.id, v]));

  const statements: D1PreparedStatement[] = [
    existing
      ? d1
          .prepare(
            `UPDATE products SET handle = ?, title = ?, description_html = ?, description_text = ?, status = ?, product_type = ?, is_accessory = ?, vendor = ?,
                    seo_title = ?, seo_description = ?, published_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(handle, input.title, descriptionHtml, plainText(descriptionHtml), input.status, input.productType, input.isAccessory ? 1 : 0, input.vendor, input.seoTitle, input.seoDescription, publishedAt, now, productId)
      : d1
          .prepare(
            `INSERT INTO products (id, handle, title, description_html, description_text, status, product_type, is_accessory, vendor, seo_title, seo_description, position, published_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM products), ?, ?, ?)`,
          )
          .bind(productId, handle, input.title, descriptionHtml, plainText(descriptionHtml), input.status, input.productType, input.isAccessory ? 1 : 0, input.vendor, input.seoTitle, input.seoDescription, publishedAt, now, now),

    // options are small; replace them wholesale
    d1.prepare('DELETE FROM product_option_values WHERE option_id IN (SELECT id FROM product_options WHERE product_id = ?)').bind(productId),
    d1.prepare('DELETE FROM product_options WHERE product_id = ?').bind(productId),
  ];

  input.options.forEach((o, i) => {
    const optionId = ulid(now);
    statements.push(d1.prepare('INSERT INTO product_options (id, product_id, name, position) VALUES (?, ?, ?, ?)').bind(optionId, productId, o.name, i));
    o.values.forEach((v, j) =>
      statements.push(d1.prepare('INSERT INTO product_option_values (id, option_id, value, position, swatch) VALUES (?, ?, ?, ?, ?)').bind(ulid(now), optionId, v.value, j, v.swatch ?? null)),
    );
  });

  // variants: update the ones we know, create the rest, delete what was removed
  const keep = new Set<string>();
  input.variants.forEach((v, i) => {
    const opts = [v.options[0] ?? null, v.options[1] ?? null, v.options[2] ?? null];
    const title = variantTitle(opts) || 'Default';
    const prior = v.id ? byId.get(v.id) : undefined;
    if (prior) {
      keep.add(prior.id);
      statements.push(
        d1
          .prepare(
            `UPDATE variants SET sku = ?, title = ?, option1 = ?, option2 = ?, option3 = ?, price_amount = ?, compare_at_amount = ?, cost_amount = ?,
                    weight_grams = ?, requires_shipping = ?, taxable = ?, inventory_tracked = ?, inventory_policy = ?, media_id = ?, position = ?, updated_at = ?
              WHERE id = ?`,
          )
          .bind(v.sku, title, opts[0], opts[1], opts[2], v.price, v.compareAtPrice, v.costPrice, v.weightGrams, v.requiresShipping ? 1 : 0, v.taxable ? 1 : 0, v.inventoryTracked ? 1 : 0, v.inventoryPolicy, v.imageId, i, now, prior.id),
        // with a baseline, apply only the editor's change; otherwise set the absolute value
        ...adjustStatements(
          d1,
          prior.id,
          v.inventoryBaseline !== null && v.inventoryBaseline !== undefined ? v.inventoryOnHand - v.inventoryBaseline : v.inventoryOnHand - prior.inventory_on_hand,
          { reason, staffId, note: null, now },
        ),
      );
    } else {
      const variantId = ulid(now);
      statements.push(
        d1
          .prepare(
            `INSERT INTO variants (id, product_id, sku, title, option1, option2, option3, price_amount, compare_at_amount, cost_amount, weight_grams,
                                   requires_shipping, taxable, inventory_tracked, inventory_policy, inventory_on_hand, media_id, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          )
          .bind(variantId, productId, v.sku, title, opts[0], opts[1], opts[2], v.price, v.compareAtPrice, v.costPrice, v.weightGrams, v.requiresShipping ? 1 : 0, v.taxable ? 1 : 0, v.inventoryTracked ? 1 : 0, v.inventoryPolicy, v.imageId, i, now, now),
        ...adjustStatements(d1, variantId, v.inventoryOnHand, { reason, staffId, note: null, now }),
      );
    }
  });
  const removed = currentVariants.filter((v) => !keep.has(v.id)).map((v) => v.id);
  for (const part of chunk(removed)) {
    const marks = part.map(() => '?').join(',');
    statements.push(
      d1.prepare(`DELETE FROM inventory_reservations WHERE variant_id IN (${marks})`).bind(...part),
      d1.prepare(`DELETE FROM variants WHERE id IN (${marks})`).bind(...part),
    );
  }

  statements.push(d1.prepare('DELETE FROM product_media WHERE product_id = ?').bind(productId));
  input.mediaIds.forEach((m, i) => statements.push(d1.prepare('INSERT OR IGNORE INTO product_media (product_id, media_id, position) VALUES (?, ?, ?)').bind(productId, m, i)));

  statements.push(d1.prepare('DELETE FROM product_tags WHERE product_id = ?').bind(productId));
  for (const tag of [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))]) {
    statements.push(
      d1.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)').bind(ulid(now), tag),
      d1.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag_id) SELECT ?, id FROM tags WHERE lower(name) = lower(?)').bind(productId, tag),
    );
  }

  const keepCollections = manualCollections.length ? `AND collection_id NOT IN (${manualCollections.map(() => '?').join(',')})` : '';
  statements.push(
    d1.prepare(`DELETE FROM collection_products WHERE product_id = ? AND collection_id IN (SELECT id FROM collections WHERE type = 'manual') ${keepCollections}`).bind(productId, ...manualCollections),
  );
  for (const cid of manualCollections) {
    statements.push(
      d1
        .prepare(`INSERT OR IGNORE INTO collection_products (collection_id, product_id, position) VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM collection_products WHERE collection_id = ?))`)
        .bind(cid, productId, cid),
    );
  }

  // left out means "as it was", so an import never wipes a look
  if (look) {
    statements.push(d1.prepare('DELETE FROM product_looks WHERE product_id = ?').bind(productId));
    look.forEach((lookId, i) =>
      statements.push(d1.prepare('INSERT INTO product_looks (product_id, look_product_id, position) VALUES (?, ?, ?)').bind(productId, lookId, i)),
    );
  }

  statements.push(...reindexStatements(d1, [productId]));

  try {
    await d1.batch(statements);
  } catch (err) {
    const name = constraintName(err);
    if (name?.startsWith('unique:variants.sku')) throw invalid({ variants: 'Another product already uses one of these SKUs' });
    if (name === 'variants_stock') throw invalid({ variants: 'Stock changed while you were editing (an order came in). Reload and try again.' });
    if (name?.startsWith('unique:products.handle')) throw invalid({ handle: 'Another product already uses this handle' });
    throw err;
  }

  await rematerializeForProducts(d1, [productId]);
  return productId;
}

export async function adminProductDTO(d1: D1Database, id: string): Promise<AdminProductDTO> {
  const p = await d1.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!p) throw notFound('Product not found');
  const now = Date.now();
  const [options, values, variants, media, tags, collections, reserved, look] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT * FROM product_options WHERE product_id = ? ORDER BY position').bind(id),
    d1.prepare('SELECT v.* FROM product_option_values v JOIN product_options o ON o.id = v.option_id WHERE o.product_id = ? ORDER BY v.position').bind(id),
    d1.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY position').bind(id),
    d1.prepare('SELECT m.* FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = ? ORDER BY pm.position').bind(id),
    d1.prepare('SELECT t.name FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = ? ORDER BY t.name').bind(id),
    d1.prepare('SELECT c.id, c.title, c.type FROM collection_products cp JOIN collections c ON c.id = cp.collection_id WHERE cp.product_id = ? ORDER BY c.title').bind(id),
    d1
      .prepare('SELECT r.variant_id, SUM(r.quantity) AS n FROM inventory_reservations r JOIN variants v ON v.id = r.variant_id WHERE v.product_id = ? AND r.expires_at > ? GROUP BY r.variant_id')
      .bind(id, now),
    d1
      .prepare(
        `SELECT p.id, p.handle, p.title, p.status,
                (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
           FROM product_looks l JOIN products p ON p.id = l.look_product_id
          WHERE l.product_id = ? ORDER BY l.position`,
      )
      .bind(id),
  ]);

  const optionRows = (options?.results ?? []) as { id: string; name: string }[];
  const opts: ProductOptionDTO[] = optionRows.map((o) => ({
    name: o.name,
    values: ((values?.results ?? []) as { option_id: string; value: string; swatch: string | null }[])
      .filter((v) => v.option_id === o.id)
      .map((v) => ({ value: v.value, swatch: v.swatch })),
  }));
  const reservedBy = new Map(((reserved?.results ?? []) as { variant_id: string; n: number }[]).map((r) => [r.variant_id, r.n]));
  const lookRows = (look?.results ?? []) as { id: string; handle: string; title: string; status: AdminLookPieceDTO['status']; media_id: string | null }[];
  const lookMedia = await mediaByIdsRaw(d1, lookRows.map((r) => r.media_id ?? ''));

  return {
    id,
    handle: p.handle as string,
    title: p.title as string,
    descriptionHtml: p.description_html as string,
    status: p.status as AdminProductDTO['status'],
    productType: p.product_type as string,
    isAccessory: !!p.is_accessory,
    vendor: (p.vendor as string | null) ?? null,
    tags: ((tags?.results ?? []) as { name: string }[]).map((t) => t.name),
    seoTitle: (p.seo_title as string | null) ?? null,
    seoDescription: (p.seo_description as string | null) ?? null,
    options: opts,
    variants: ((variants?.results ?? []) as unknown as VariantRow[]).map(
      (v): AdminVariantDTO => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        options: variantOptions({ option1: v.option1, option2: v.option2, option3: v.option3 }, opts.length),
        price: v.price_amount,
        compareAtPrice: v.compare_at_amount,
        costPrice: v.cost_amount,
        weightGrams: v.weight_grams,
        requiresShipping: !!v.requires_shipping,
        taxable: !!v.taxable,
        inventoryTracked: !!v.inventory_tracked,
        inventoryPolicy: v.inventory_policy,
        inventoryOnHand: v.inventory_on_hand,
        inventoryReserved: reservedBy.get(v.id) ?? 0,
        imageId: v.media_id,
      }),
    ),
    media: ((media?.results ?? []) as Record<string, unknown>[]).map(
      (m): MediaDTO => toMediaDTO({ id: m.id as string, r2Key: m.r2_key as string, alt: m.alt as string, width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null }),
    ),
    collections: ((collections?.results ?? []) as { id: string; title: string; type: 'manual' | 'smart' }[]).map((c) => ({ id: c.id, title: c.title, type: c.type })),
    look: lookRows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, status: r.status, image: r.media_id ? lookMedia.get(r.media_id) ?? null : null })),
    publishedAt: (p.published_at as number | null) ?? null,
    createdAt: p.created_at as number,
    updatedAt: p.updated_at as number,
  };
}

export async function adminProductListItems(d1: D1Database, rows: Record<string, unknown>[]): Promise<AdminProductListItemDTO[]> {
  const mediaIds = rows.map((r) => (r.media_id as string | null) ?? '').filter(Boolean);
  const media = await mediaByIdsRaw(d1, mediaIds);
  return rows.map((r) => ({
    id: r.id as string,
    handle: r.handle as string,
    title: r.title as string,
    status: r.status as AdminProductListItemDTO['status'],
    productType: r.product_type as string,
    image: r.media_id ? media.get(r.media_id as string) ?? null : null,
    variantsCount: (r.variants_count as number) ?? 0,
    inventoryTotal: (r.inventory_total as number) ?? 0,
    priceMin: (r.price_min as number | null) ?? 0,
    priceMax: (r.price_max as number | null) ?? 0,
    updatedAt: r.updated_at as number,
  }));
}

/** Everything a product owns, for deletion. Order lines keep their snapshots. */
export function deleteProductStatements(d1: D1Database, ids: string[]): D1PreparedStatement[] {
  return chunk(ids).flatMap((part) => {
    const marks = part.map(() => '?').join(',');
    return [
      `DELETE FROM inventory_reservations WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${marks}))`,
      `DELETE FROM cart_lines WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${marks}))`,
      `DELETE FROM product_option_values WHERE option_id IN (SELECT id FROM product_options WHERE product_id IN (${marks}))`,
      `DELETE FROM product_options WHERE product_id IN (${marks})`,
      `DELETE FROM variants WHERE product_id IN (${marks})`,
      `DELETE FROM product_media WHERE product_id IN (${marks})`,
      `DELETE FROM product_tags WHERE product_id IN (${marks})`,
      `DELETE FROM collection_products WHERE product_id IN (${marks})`,
      `DELETE FROM product_looks WHERE product_id IN (${marks})`,
      `DELETE FROM product_looks WHERE look_product_id IN (${marks})`,
      `DELETE FROM wishlist_items WHERE product_id IN (${marks})`,
      `DELETE FROM products_fts WHERE product_id IN (${marks})`,
      `DELETE FROM products WHERE id IN (${marks})`,
    ].map((sql) => d1.prepare(sql).bind(...part));
  });
}
