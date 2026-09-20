import { asc, eq, inArray } from 'drizzle-orm';
import type {
  AvailabilityDTO,
  CollectionDTO,
  LookDTO,
  MediaDTO,
  ProductDTO,
  ProductListDTO,
  ProductOptionDTO,
  ProductSort,
  SearchSuggestDTO,
  VariantDTO,
} from '../../shared/api';
import { LOOK_MAX } from '../../shared/api';
import { schema, type DB } from '../db/client';
import { chunk, mediaById, toMediaDTO } from './media';
import { sellable, stockFor } from './inventory';

export type ProductRow = typeof schema.products.$inferSelect;
type VariantRow = typeof schema.variants.$inferSelect;

export const variantTitle = (options: (string | null)[]) => options.filter(Boolean).join(' / ');
export const variantOptions = (v: Pick<VariantRow, 'option1' | 'option2' | 'option3'>, count: number): string[] =>
  [v.option1, v.option2, v.option3].slice(0, count).map((o) => o ?? '');

const isAvailable = (v: Pick<VariantRow, 'inventoryTracked' | 'inventoryPolicy' | 'inventoryOnHand'>) =>
  !v.inventoryTracked || v.inventoryPolicy === 'continue' || v.inventoryOnHand > 0;

export const plainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Assemble full ProductDTOs for a set of product rows in a fixed number of
 * queries (not per product), preserving the input order.
 */
export async function productDTOs(db: DB, rows: ProductRow[]): Promise<ProductDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const s = schema;

  const options: (typeof s.productOptions.$inferSelect)[] = [];
  const variantRows: VariantRow[] = [];
  const mediaRows: { productId: string; position: number; media: typeof s.media.$inferSelect }[] = [];
  const tagRows: { productId: string; name: string }[] = [];
  const collectionRows: { productId: string; handle: string; title: string }[] = [];

  for (const part of chunk(ids)) {
    options.push(...(await db.select().from(s.productOptions).where(inArray(s.productOptions.productId, part)).orderBy(asc(s.productOptions.position)).all()));
    variantRows.push(...(await db.select().from(s.variants).where(inArray(s.variants.productId, part)).orderBy(asc(s.variants.position)).all()));
    mediaRows.push(
      ...(await db
        .select({ productId: s.productMedia.productId, position: s.productMedia.position, media: s.media })
        .from(s.productMedia)
        .innerJoin(s.media, eq(s.media.id, s.productMedia.mediaId))
        .where(inArray(s.productMedia.productId, part))
        .orderBy(asc(s.productMedia.position))
        .all()),
    );
    tagRows.push(
      ...(await db
        .select({ productId: s.productTags.productId, name: s.tags.name })
        .from(s.productTags)
        .innerJoin(s.tags, eq(s.tags.id, s.productTags.tagId))
        .where(inArray(s.productTags.productId, part))
        .all()),
    );
    collectionRows.push(
      ...(await db
        .select({ productId: s.collectionProducts.productId, handle: s.collections.handle, title: s.collections.title, published: s.collections.published })
        .from(s.collectionProducts)
        .innerJoin(s.collections, eq(s.collections.id, s.collectionProducts.collectionId))
        .where(inArray(s.collectionProducts.productId, part))
        .all()).filter((r) => r.published),
    );
  }

  const values: (typeof s.productOptionValues.$inferSelect)[] = [];
  for (const part of chunk(options.map((o) => o.id))) {
    values.push(...(await db.select().from(s.productOptionValues).where(inArray(s.productOptionValues.optionId, part)).orderBy(asc(s.productOptionValues.position)).all()));
  }

  const group = <T, K>(items: T[], key: (t: T) => K) => {
    const m = new Map<K, T[]>();
    for (const it of items) {
      const k = key(it);
      const list = m.get(k);
      if (list) list.push(it);
      else m.set(k, [it]);
    }
    return m;
  };

  const optionsBy = group(options, (o) => o.productId);
  const valuesBy = group(values, (v) => v.optionId);
  const variantsBy = group(variantRows, (v) => v.productId);
  const mediaBy = group(mediaRows, (m) => m.productId);
  const tagsBy = group(tagRows, (t) => t.productId);
  const collectionsBy = group(collectionRows, (c) => c.productId);

  return rows.map((p): ProductDTO => {
    const opts: ProductOptionDTO[] = (optionsBy.get(p.id) ?? []).map((o) => ({
      name: o.name,
      values: (valuesBy.get(o.id) ?? []).map((v) => ({ value: v.value, swatch: v.swatch })),
    }));
    const vs = variantsBy.get(p.id) ?? [];
    const variants: VariantDTO[] = vs.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      options: variantOptions(v, opts.length),
      price: v.priceAmount,
      compareAtPrice: v.compareAtAmount && v.compareAtAmount > v.priceAmount ? v.compareAtAmount : null,
      available: isAvailable(v),
      imageId: v.mediaId,
    }));
    const cheapest = variants.reduce<VariantDTO | null>((best, v) => (!best || v.price < best.price ? v : best), null);
    const images: MediaDTO[] = (mediaBy.get(p.id) ?? []).map((m) => toMediaDTO(m.media));
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      description: p.descriptionText,
      descriptionHtml: p.descriptionHtml,
      productType: p.productType,
      vendor: p.vendor,
      tags: (tagsBy.get(p.id) ?? []).map((t) => t.name),
      price: cheapest?.price ?? 0,
      compareAtPrice: cheapest?.compareAtPrice ?? null,
      priceRange: {
        min: variants.length ? Math.min(...variants.map((v) => v.price)) : 0,
        max: variants.length ? Math.max(...variants.map((v) => v.price)) : 0,
      },
      images,
      options: opts,
      variants,
      available: variants.some((v) => v.available),
      collections: (collectionsBy.get(p.id) ?? []).map((c) => ({ handle: c.handle, title: c.title })),
      seo: { title: p.seoTitle || p.title, description: p.seoDescription || p.descriptionText.slice(0, 160) },
      createdAt: p.createdAt,
    };
  });
}

const rowFrom = (r: Record<string, unknown>): ProductRow => ({
  id: r.id as string,
  handle: r.handle as string,
  title: r.title as string,
  descriptionHtml: r.description_html as string,
  descriptionText: r.description_text as string,
  status: r.status as ProductRow['status'],
  productType: r.product_type as string,
  vendor: (r.vendor as string | null) ?? null,
  seoTitle: (r.seo_title as string | null) ?? null,
  seoDescription: (r.seo_description as string | null) ?? null,
  position: r.position as number,
  publishedAt: (r.published_at as number | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

export async function productByHandle(db: DB, handle: string, opts: { includeDrafts?: boolean } = {}): Promise<ProductDTO | null> {
  const row = await db.$client
    .prepare(`SELECT * FROM products WHERE handle = ? ${opts.includeDrafts ? '' : `AND status = 'active'`}`)
    .bind(handle)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const [dto] = await productDTOs(db, [rowFrom(row)]);
  return dto ?? null;
}

/* ─────────────────────────── search & listing ─────────────────────────── */

/**
 * Shopper text → a safe FTS5 query: every word must match, as a prefix, with
 * diacritics folded by the tokenizer ("etag" finds "Étagère"). Quotes and
 * operators are stripped, so input can never become FTS syntax.
 */
export function ftsQuery(input: string): string | null {
  const words = input
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' ');
}

export interface ListParams {
  collection?: string | undefined;
  q?: string | undefined;
  tag?: string | undefined;
  type?: string | undefined;
  options: { name: string; values: string[] }[];
  min?: number | undefined;
  max?: number | undefined;
  available?: boolean | undefined;
  sort: ProductSort;
  offset: number;
  limit: number;
}

export const encodeCursor = (offset: number) => btoa(`o:${offset}`).replace(/=+$/, '');
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const m = /^o:(\d{1,7})$/.exec(atob(cursor));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** Parse `option=Size:Small&option=Size:Medium&option=Colour:Red` into groups. */
export function parseOptionFilters(raw: string[]): { name: string; values: string[] }[] {
  const groups = new Map<string, { name: string; values: string[] }>();
  for (const item of raw.slice(0, 30)) {
    const i = item.indexOf(':');
    if (i < 1) continue;
    const name = item.slice(0, i).trim().slice(0, 40);
    const value = item.slice(i + 1).trim().slice(0, 80);
    if (!name || !value) continue;
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { name, values: [] };
    if (!g.values.includes(value)) g.values.push(value);
    groups.set(key, g);
  }
  return [...groups.values()];
}

interface Where {
  sql: string[];
  params: (string | number)[];
}

function baseWhere(p: ListParams, fts: string | null): Where {
  const w: Where = { sql: [`p.status = 'active'`], params: [] };
  if (p.collection) {
    w.sql.push(`p.id IN (SELECT cp.product_id FROM collection_products cp JOIN collections c ON c.id = cp.collection_id WHERE c.handle = ? AND c.published = 1)`);
    w.params.push(p.collection);
  }
  if (fts) {
    w.sql.push(`p.id IN (SELECT product_id FROM products_fts WHERE products_fts MATCH ?)`);
    w.params.push(fts);
  }
  if (p.tag) {
    w.sql.push(`p.id IN (SELECT pt.product_id FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE lower(t.name) = lower(?))`);
    w.params.push(p.tag);
  }
  if (p.type) {
    w.sql.push(`lower(p.product_type) = lower(?)`);
    w.params.push(p.type);
  }
  return w;
}

const OPTION_VALUE = `CASE o.position WHEN 0 THEN v.option1 WHEN 1 THEN v.option2 ELSE v.option3 END`;

function narrowWhere(p: ListParams, base: Where): Where {
  const w: Where = { sql: [...base.sql], params: [...base.params] };
  for (const g of p.options) {
    const marks = g.values.map(() => '?').join(',');
    w.sql.push(
      `p.id IN (SELECT v.product_id FROM variants v JOIN product_options o ON o.product_id = v.product_id
                WHERE lower(o.name) = lower(?) AND ${OPTION_VALUE} IN (${marks}))`,
    );
    w.params.push(g.name, ...g.values);
  }
  if (p.min !== undefined) {
    w.sql.push(`(SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) >= ?`);
    w.params.push(p.min);
  }
  if (p.max !== undefined) {
    w.sql.push(`(SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) <= ?`);
    w.params.push(p.max);
  }
  if (p.available) {
    w.sql.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND (v.inventory_tracked = 0 OR v.inventory_policy = 'continue' OR v.inventory_on_hand > 0))`);
  }
  return w;
}

export async function listProducts(db: DB, p: ListParams): Promise<ProductListDTO> {
  const d1 = db.$client;
  const fts = p.q ? ftsQuery(p.q) : null;
  if (p.q && !fts) return { items: [], nextCursor: null, total: 0, facets: { options: [], productTypes: [], price: null } };

  const base = baseWhere(p, fts);
  const where = narrowWhere(p, base);
  const whereSql = where.sql.join(' AND ');

  const sort: ProductSort = p.sort === 'relevance' && !fts ? 'featured' : p.sort;
  const joins: string[] = [];
  const joinParams: (string | number)[] = [];
  let order: string;
  switch (sort) {
    case 'relevance':
      joins.push(`JOIN (SELECT product_id, bm25(products_fts, 0, 10.0, 2.0, 4.0, 4.0, 1.0) AS rank FROM products_fts WHERE products_fts MATCH ?) f ON f.product_id = p.id`);
      joinParams.push(fts ?? '');
      order = 'f.rank ASC, p.position ASC';
      break;
    case 'price_asc':
      order = 'min_price ASC, p.position ASC';
      break;
    case 'price_desc':
      order = 'min_price DESC, p.position ASC';
      break;
    case 'title_asc':
      order = 'p.title COLLATE NOCASE ASC';
      break;
    case 'created_desc':
      order = 'p.created_at DESC';
      break;
    default:
      if (p.collection) {
        joins.push(`LEFT JOIN collection_products cpf ON cpf.product_id = p.id AND cpf.collection_id = (SELECT id FROM collections WHERE handle = ?)`);
        joinParams.push(p.collection);
        order = 'cpf.position ASC, p.position ASC, p.created_at DESC';
      } else {
        order = 'p.position ASC, p.created_at DESC';
      }
  }

  const listSql = `SELECT p.*, (SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS min_price
    FROM products p ${joins.join(' ')} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`;

  const [list, count, optionFacets, typeFacets, priceFacet] = await d1.batch<Record<string, unknown>>([
    d1.prepare(listSql).bind(...joinParams, ...where.params, p.limit + 1, p.offset),
    d1.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`).bind(...where.params),
    d1
      .prepare(
        `SELECT o.name AS name, ${OPTION_VALUE} AS value, COUNT(DISTINCT p.id) AS count,
                MIN(COALESCE((SELECT pov.position FROM product_option_values pov WHERE pov.option_id = o.id AND pov.value = ${OPTION_VALUE}), 999)) AS pos
           FROM products p JOIN product_options o ON o.product_id = p.id JOIN variants v ON v.product_id = p.id
          WHERE ${base.sql.join(' AND ')} AND ${OPTION_VALUE} IS NOT NULL AND ${OPTION_VALUE} != ''
          GROUP BY lower(o.name), value ORDER BY lower(o.name), pos, value LIMIT 300`,
      )
      .bind(...base.params),
    d1
      .prepare(`SELECT p.product_type AS value, COUNT(*) AS count FROM products p WHERE ${base.sql.join(' AND ')} AND p.product_type != '' GROUP BY p.product_type ORDER BY count DESC`)
      .bind(...base.params),
    d1
      .prepare(`SELECT MIN(mp) AS min, MAX(mp) AS max FROM (SELECT (SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS mp FROM products p WHERE ${base.sql.join(' AND ')})`)
      .bind(...base.params),
  ]);

  const rows = (list?.results ?? []).map(rowFrom);
  const hasMore = rows.length > p.limit;
  const items = await productDTOs(db, rows.slice(0, p.limit));

  const optionMap = new Map<string, { name: string; values: { value: string; count: number }[] }>();
  for (const r of (optionFacets?.results ?? []) as { name: string; value: string; count: number }[]) {
    const key = r.name.toLowerCase();
    const g = optionMap.get(key) ?? { name: r.name, values: [] };
    g.values.push({ value: r.value, count: r.count });
    optionMap.set(key, g);
  }
  const price = (priceFacet?.results?.[0] ?? null) as { min: number | null; max: number | null } | null;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(p.offset + p.limit) : null,
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
    facets: {
      options: [...optionMap.values()],
      productTypes: (typeFacets?.results ?? []) as { value: string; count: number }[],
      price: price && price.min !== null && price.max !== null ? { min: price.min, max: price.max } : null,
    },
  };
}

/**
 * Shop the look under a product: the pieces the owner paired with it, in
 * their order, leaving out any that are not on sale. With none paired, the
 * store suggests pieces that complete it rather than repeat it — another
 * category first, then the same collections (the same drop), in stock first.
 */
export async function shopTheLook(db: DB, product: ProductDTO, suggestions = 4): Promise<LookDTO> {
  const d1 = db.$client;
  const { results: paired } = await d1
    .prepare(
      `SELECT p.* FROM product_looks l JOIN products p ON p.id = l.look_product_id
        WHERE l.product_id = ? AND p.status = 'active'
        ORDER BY l.position
        LIMIT ?`,
    )
    .bind(product.id, LOOK_MAX)
    .all<Record<string, unknown>>();
  if (paired.length) return { items: await productDTOs(db, paired.map(rowFrom)), curated: true };

  const { results } = await d1
    .prepare(
      `SELECT p.* FROM products p
        WHERE p.status = 'active' AND p.id != ?
        ORDER BY (p.product_type != ?) DESC,
                 (p.id IN (SELECT cp2.product_id FROM collection_products cp2
                           WHERE cp2.collection_id IN (SELECT collection_id FROM collection_products WHERE product_id = ?))) DESC,
                 p.position ASC
        LIMIT ?`,
    )
    .bind(product.id, product.productType, product.id, suggestions * 3)
    .all<Record<string, unknown>>();
  const candidates = await productDTOs(db, results.map(rowFrom));
  // a stable sort, so the ranking above holds within each half
  const items = [...candidates].sort((a, b) => Number(b.available) - Number(a.available)).slice(0, suggestions);
  return { items, curated: false };
}

export async function availability(db: DB, product: ProductDTO, lowStockThreshold: number): Promise<AvailabilityDTO> {
  const stock = await stockFor(db.$client, product.variants.map((v) => v.id), Date.now());
  return {
    productId: product.id,
    variants: product.variants.map((v) => {
      const s = stock.get(v.id);
      const n = s ? sellable(s) : 0;
      const available = n === null || n > 0;
      const lowStock = n !== null && n > 0 && n <= lowStockThreshold;
      return { id: v.id, available, lowStock, quantity: lowStock ? n : null };
    }),
  };
}

export async function suggest(db: DB, q: string): Promise<SearchSuggestDTO> {
  const fts = ftsQuery(q);
  if (!fts) return { products: [], collections: [] };
  const d1 = db.$client;
  const [prods, cols] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT p.handle, p.title,
                (SELECT MIN(v.price_amount) FROM variants v WHERE v.product_id = p.id) AS price,
                (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
           FROM (SELECT product_id, bm25(products_fts, 0, 10.0, 2.0, 4.0, 4.0, 1.0) AS rank FROM products_fts WHERE products_fts MATCH ? ORDER BY rank LIMIT 20) f
           JOIN products p ON p.id = f.product_id
          WHERE p.status = 'active' ORDER BY f.rank LIMIT 6`,
      )
      .bind(fts),
    d1
      .prepare(`SELECT handle, title FROM collections WHERE published = 1 AND lower(title) LIKE ? ESCAPE '\\' ORDER BY title LIMIT 4`)
      .bind(`%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`),
  ]);
  const products = await Promise.all(
    ((prods?.results ?? []) as { handle: string; title: string; price: number | null; media_id: string | null }[]).map(async (r) => ({
      handle: r.handle,
      title: r.title,
      price: r.price ?? 0,
      image: r.media_id ? await mediaById(db, r.media_id) : null,
    })),
  );
  return { products, collections: (cols?.results ?? []) as { handle: string; title: string }[] };
}

/* ─────────────────────────── collections ─────────────────────────── */

type CollectionRow = typeof schema.collections.$inferSelect;

export async function collectionDTO(db: DB, c: CollectionRow): Promise<CollectionDTO> {
  const count = await db.$client
    .prepare(`SELECT COUNT(*) AS n FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = ? AND p.status = 'active'`)
    .bind(c.id)
    .first<{ n: number }>();
  const description = plainText(c.descriptionHtml);
  return {
    id: c.id,
    handle: c.handle,
    title: c.title,
    description,
    descriptionHtml: c.descriptionHtml,
    image: c.imageMediaId ? await mediaById(db, c.imageMediaId) : null,
    productsCount: count?.n ?? 0,
    seo: { title: c.seoTitle || c.title, description: c.seoDescription || description.slice(0, 160) },
  };
}

/** Rebuild the search document for these products. */
export function reindexStatements(d1: D1Database, productIds: string[]): D1PreparedStatement[] {
  return productIds.flatMap((id) => [
    d1.prepare('DELETE FROM products_fts WHERE product_id = ?').bind(id),
    d1
      .prepare(
        `INSERT INTO products_fts (product_id, title, body, tags, options, skus)
         SELECT p.id, p.title, p.description_text,
                trim(p.product_type || ' ' || coalesce(p.vendor, '') || ' ' ||
                     coalesce((SELECT group_concat(t.name, ' ') FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id), '')),
                coalesce((SELECT group_concat(pov.value, ' ') FROM product_option_values pov JOIN product_options o ON o.id = pov.option_id WHERE o.product_id = p.id), ''),
                coalesce((SELECT group_concat(v.sku, ' ') FROM variants v WHERE v.product_id = p.id AND v.sku IS NOT NULL), '')
           FROM products p WHERE p.id = ?`,
      )
      .bind(id),
  ]);
}
