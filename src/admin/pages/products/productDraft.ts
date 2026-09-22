import { AdminProductInput, type AdminLookPieceDTO, type AdminProductDTO, type InventoryPolicy, type MediaDTO, type ProductStatus } from '../../lib/contract';
import { validate, type FieldErrors } from '../../lib/forms';
import { cartesian, clientKey } from '../../lib/util';

export const MAX_VARIANTS = 250;
export const MAX_OPTIONS = 3;

export interface OptionDraft {
  key: string;
  name: string;
  values: { value: string; swatch: string | null }[];
}

export interface VariantDraft {
  key: string;
  id?: string;
  options: string[];
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  sku: string;
  weightGrams: number | null;
  requiresShipping: boolean;
  taxable: boolean;
  inventoryTracked: boolean;
  inventoryPolicy: InventoryPolicy;
  inventoryOnHand: number | null;
  /** on-hand when the product was loaded; lets the server apply only this editor's change */
  inventoryBaseline?: number | null;
  inventoryReserved: number;
  imageId: string | null;
}

export interface ProductDraft {
  title: string;
  handle: string;
  /** false while the handle still follows the title (new products) */
  handleTouched: boolean;
  descriptionHtml: string;
  status: ProductStatus;
  productType: string;
  isAccessory: boolean;
  vendor: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  options: OptionDraft[];
  variants: VariantDraft[];
  media: MediaDTO[];
  collectionIds: string[];
  /** Shop the look, in order */
  look: AdminLookPieceDTO[];
}

export const isColourOption = (name: string) => /^colou?r$/i.test(name.trim());
export const variantTitle = (options: string[]) => (options.length ? options.join(' / ') : 'Default');
const activeOptions = (options: OptionDraft[]) => options.filter((o) => o.values.length > 0);
export const combinationCount = (options: OptionDraft[]) => activeOptions(options).reduce((n, o) => n * o.values.length, 1);

export function newVariant(options: string[], template?: VariantDraft): VariantDraft {
  return {
    key: clientKey('v'),
    options,
    price: template?.price ?? null,
    compareAtPrice: template?.compareAtPrice ?? null,
    costPrice: template?.costPrice ?? null,
    sku: '',
    weightGrams: template?.weightGrams ?? 0,
    requiresShipping: template?.requiresShipping ?? true,
    taxable: template?.taxable ?? true,
    inventoryTracked: template?.inventoryTracked ?? true,
    inventoryPolicy: template?.inventoryPolicy ?? 'deny',
    inventoryOnHand: 0,
    inventoryReserved: 0,
    imageId: null,
  };
}

export const emptyDraft = (): ProductDraft => ({
  title: '',
  handle: '',
  handleTouched: false,
  descriptionHtml: '',
  status: 'draft',
  productType: '',
  isAccessory: false,
  vendor: '',
  tags: [],
  seoTitle: '',
  seoDescription: '',
  options: [],
  variants: [newVariant([])],
  media: [],
  collectionIds: [],
  look: [],
});

export function fromDTO(p: AdminProductDTO): ProductDraft {
  return {
    title: p.title,
    handle: p.handle,
    handleTouched: true,
    descriptionHtml: p.descriptionHtml,
    status: p.status,
    productType: p.productType,
    isAccessory: p.isAccessory,
    vendor: p.vendor ?? '',
    tags: p.tags,
    seoTitle: p.seoTitle ?? '',
    seoDescription: p.seoDescription ?? '',
    options: p.options.map((o) => ({ key: clientKey('o'), name: o.name, values: o.values.map((v) => ({ value: v.value, swatch: v.swatch })) })),
    variants: p.variants.map((v) => ({
      key: v.id,
      id: v.id,
      options: v.options,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      sku: v.sku ?? '',
      weightGrams: v.weightGrams,
      requiresShipping: v.requiresShipping,
      taxable: v.taxable,
      inventoryTracked: v.inventoryTracked,
      inventoryPolicy: v.inventoryPolicy,
      inventoryOnHand: v.inventoryOnHand,
      inventoryBaseline: v.inventoryOnHand,
      inventoryReserved: v.inventoryReserved,
      imageId: v.imageId,
    })),
    media: p.media,
    collectionIds: p.collections.filter((c) => c.type === 'manual').map((c) => c.id),
    look: p.look,
  };
}

/**
 * Regenerate the variant grid after options change: the cartesian product of
 * option values, keeping existing variants (ids, prices, stock) whose option
 * tuple still exists. Tuples are matched per option (by option key), so an
 * added option extends existing variants and a removed option collapses them.
 */
export function syncVariants(prevOptions: OptionDraft[], nextOptions: OptionDraft[], variants: VariantDraft[]): VariantDraft[] {
  const prevActive = activeOptions(prevOptions);
  const nextActive = activeOptions(nextOptions);

  if (nextActive.length === 0) {
    const keep = variants[0];
    return [keep ? { ...keep, options: [] } : newVariant([])];
  }
  if (combinationCount(nextOptions) > MAX_VARIANTS) return variants;

  const projected = variants.map((v) => {
    const byOption = new Map(prevActive.map((o, i) => [o.key, v.options[i]]));
    return { v, tuple: nextActive.map((o) => byOption.get(o.key) ?? null) };
  });
  const combos = cartesian(nextActive.map((o) => o.values.map((x) => x.value)));
  const used = new Set<VariantDraft>();
  const take = (combo: string[], match: (tuple: (string | null)[]) => boolean) => {
    const hit = projected.find((p) => !used.has(p.v) && match(p.tuple));
    if (!hit) return null;
    used.add(hit.v);
    return { ...hit.v, options: combo };
  };

  // exact matches first, so a loose match never steals a variant that has one
  const exact = combos.map((combo) => take(combo, (t) => t.every((val, i) => val === combo[i])));
  const template = variants[0];
  return combos.map(
    (combo, i) => exact[i] ?? take(combo, (t) => t.every((val, j) => val === null || val === combo[j])) ?? newVariant(combo, template),
  );
}

/** Client checks + the contract schema; returns the request body and errors keyed like the server's. */
export function buildPayload(d: ProductDraft): { payload: AdminProductInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  d.options.forEach((o, i) => {
    const name = o.name.trim().toLowerCase();
    if (!name) errors[`options.${i}.name`] = 'Name this option';
    else if (seen.has(name)) errors[`options.${i}.name`] = 'Option names must be different';
    seen.add(name);
    if (!o.values.length) errors[`options.${i}.values`] = 'Add at least one value';
  });
  if (combinationCount(d.options) > MAX_VARIANTS) errors.variants = `Too many combinations — a product can have at most ${MAX_VARIANTS} variants`;
  d.variants.forEach((v, i) => {
    if (v.price === null) errors[`variants.${i}.price`] = 'Enter a price';
    if (v.inventoryOnHand === null) errors[`variants.${i}.inventoryOnHand`] = 'Enter a quantity';
    if (v.weightGrams === null) errors[`variants.${i}.weightGrams`] = 'Enter a weight';
  });

  const payload: AdminProductInput = {
    title: d.title,
    handle: d.handle.trim() || undefined,
    descriptionHtml: d.descriptionHtml,
    status: d.status,
    productType: d.productType,
    isAccessory: d.isAccessory,
    vendor: d.vendor.trim() || null,
    tags: d.tags,
    seoTitle: d.seoTitle.trim() || null,
    seoDescription: d.seoDescription.trim() || null,
    options: d.options.map((o) => ({
      name: o.name.trim(),
      values: o.values.map((v) => ({ value: v.value, swatch: isColourOption(o.name) ? v.swatch : null })),
    })),
    variants: d.variants.map((v) => ({
      id: v.id,
      sku: v.sku.trim() || null,
      options: v.options,
      price: v.price ?? 0,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      weightGrams: v.weightGrams ?? 0,
      requiresShipping: v.requiresShipping,
      taxable: v.taxable,
      inventoryTracked: v.inventoryTracked,
      inventoryPolicy: v.inventoryPolicy,
      inventoryOnHand: v.inventoryOnHand ?? 0,
      inventoryBaseline: v.id ? (v.inventoryBaseline ?? null) : null,
      imageId: v.imageId,
    })),
    mediaIds: d.media.map((m) => m.id),
    collectionIds: d.collectionIds,
    lookProductIds: d.look.map((p) => p.id),
  };
  return { payload, errors: { ...(validate(AdminProductInput, payload) ?? {}), ...errors } };
}
