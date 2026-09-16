import { chunk } from './media';

/** Everything pricing, stock and display need about a variant, in one read. */
export interface VariantDetail {
  variantId: string;
  productId: string;
  handle: string;
  productTitle: string;
  productStatus: 'draft' | 'active' | 'archived';
  variantTitle: string;
  options: { name: string; value: string }[];
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  weightGrams: number;
  requiresShipping: boolean;
  taxable: boolean;
  tracked: boolean;
  policy: 'deny' | 'continue';
  onHand: number;
  /** the variant's own image, else the product's first */
  mediaId: string | null;
  collectionIds: string[];
}

interface Row {
  id: string;
  product_id: string;
  handle: string;
  product_title: string;
  product_status: VariantDetail['productStatus'];
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  price_amount: number;
  compare_at_amount: number | null;
  weight_grams: number;
  requires_shipping: number;
  taxable: number;
  inventory_tracked: number;
  inventory_policy: 'deny' | 'continue';
  inventory_on_hand: number;
  media_id: string | null;
  first_media_id: string | null;
}

export async function variantDetails(d1: D1Database, variantIds: string[]): Promise<Map<string, VariantDetail>> {
  const out = new Map<string, VariantDetail>();
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return out;

  const rows: Row[] = [];
  for (const part of chunk(ids, 80)) {
    const { results } = await d1
      .prepare(
        `SELECT v.id, v.product_id, p.handle, p.title AS product_title, p.status AS product_status, v.title,
                v.option1, v.option2, v.option3, v.sku, v.price_amount, v.compare_at_amount, v.weight_grams,
                v.requires_shipping, v.taxable, v.inventory_tracked, v.inventory_policy, v.inventory_on_hand, v.media_id,
                (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS first_media_id
           FROM variants v JOIN products p ON p.id = v.product_id
          WHERE v.id IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<Row>();
    rows.push(...results);
  }

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const optionNames = new Map<string, string[]>();
  const collections = new Map<string, string[]>();
  for (const part of chunk(productIds, 80)) {
    const marks = part.map(() => '?').join(',');
    const [opts, cols] = await d1.batch<{ product_id: string; name?: string; collection_id?: string }>([
      d1.prepare(`SELECT product_id, name FROM product_options WHERE product_id IN (${marks}) ORDER BY position`).bind(...part),
      d1.prepare(`SELECT product_id, collection_id FROM collection_products WHERE product_id IN (${marks})`).bind(...part),
    ]);
    for (const o of opts?.results ?? []) optionNames.set(o.product_id, [...(optionNames.get(o.product_id) ?? []), o.name ?? '']);
    for (const c of cols?.results ?? []) collections.set(c.product_id, [...(collections.get(c.product_id) ?? []), c.collection_id ?? '']);
  }

  for (const r of rows) {
    const names = optionNames.get(r.product_id) ?? [];
    const values = [r.option1, r.option2, r.option3];
    out.set(r.id, {
      variantId: r.id,
      productId: r.product_id,
      handle: r.handle,
      productTitle: r.product_title,
      productStatus: r.product_status,
      variantTitle: r.title,
      options: names.map((name, i) => ({ name, value: values[i] ?? '' })),
      sku: r.sku,
      price: r.price_amount,
      compareAtPrice: r.compare_at_amount && r.compare_at_amount > r.price_amount ? r.compare_at_amount : null,
      weightGrams: r.weight_grams,
      requiresShipping: !!r.requires_shipping,
      taxable: !!r.taxable,
      tracked: !!r.inventory_tracked,
      policy: r.inventory_policy,
      onHand: r.inventory_on_hand,
      mediaId: r.media_id ?? r.first_media_id,
      collectionIds: collections.get(r.product_id) ?? [],
    });
  }
  return out;
}
