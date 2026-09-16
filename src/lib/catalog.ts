/**
 * Small readings of the catalog DTOs that more than one component needs:
 * which option is the colour, which variant a set of picks lands on, how a
 * line's options read out loud.
 */
import { imageSrc, type MediaDTO, type ProductDTO, type ProductOptionDTO, type StoreDTO, type VariantDTO } from '../../shared/api';

export const isColourOption = (name: string) => /^colou?rs?$/i.test(name.trim());
export const isSizeOption = (name: string) => /^sizes?$/i.test(name.trim());

/** A single "Default Title" value is how an option-less product is stored, not a choice. */
export const isPlaceholderOption = (o: ProductOptionDTO) => o.values.length === 1 && o.values[0]?.value === 'Default Title';

export const srcSet = (m: Pick<MediaDTO, 'url'>, widths: readonly number[] = [320, 640, 960]) =>
  widths.map((w) => `${imageSrc(m, w)} ${w}w`).join(', ');

/** In the store's featured collection — the current drop. */
export const featuredIn = (p: Pick<ProductDTO, 'collections'>, store: StoreDTO | null | undefined) => {
  const handle = store?.featuredCollectionHandle;
  return handle ? p.collections.find((c) => c.handle === handle) ?? null : null;
};

const onlyValue = (o: ProductOptionDTO) => (o.values.length === 1 ? o.values[0]?.value ?? null : null);

/** "Dresses · Red" when the piece comes in one colour, otherwise just the category. */
export function productSubtitle(p: ProductDTO): string {
  const colour = p.options.find((o) => isColourOption(o.name));
  return [p.productType, colour ? onlyValue(colour) : null].filter(Boolean).join(' · ');
}

export type VariantChoice = string | Record<string, string | null | undefined>;

/**
 * The variant a shopper's picks land on. Accepts a variant id, or picks keyed
 * by option name — `size` and `colour` work as aliases for the usual two, and
 * an option with a single value picks itself.
 */
export function resolveVariant(product: ProductDTO, choice?: VariantChoice | null): VariantDTO | null {
  if (typeof choice === 'string') return product.variants.find((v) => v.id === choice) ?? null;
  if (!product.options.length) return product.variants.length === 1 ? product.variants[0] ?? null : null;

  const picks = choice ?? {};
  const values = product.options.map((o) => {
    const direct = picks[o.name];
    if (direct) return direct;
    if (isColourOption(o.name)) return picks.colour ?? picks.color ?? onlyValue(o);
    if (isSizeOption(o.name)) return picks.size ?? onlyValue(o);
    return onlyValue(o);
  });
  if (values.some((v) => !v)) return null;
  return product.variants.find((v) => values.every((val, i) => v.options[i] === val)) ?? null;
}

/** "Red · Size M" — the way a bag line has always been labelled. */
export function optionSummary(options: { name: string; value: string }[]): string {
  return options
    .filter((o) => o.value !== 'Default Title')
    .map((o) => (isSizeOption(o.name) && o.value !== 'One size' ? `Size ${o.value}` : o.value))
    .join(' · ');
}

/** "Small / Red" → "Small · Red", for lines that only carry the variant title. */
export const variantLabel = (title: string) => (title === 'Default Title' ? '' : title.split(' / ').join(' · '));
