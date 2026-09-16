import type { PricingDTO } from '../../shared/api';
import { evaluateDiscount, type DiscountRule } from './discounts';
import { allocate, divRound, sum } from './math';
import type { RateRule } from './shipping';
import type { TaxRule } from './tax';

export interface PriceLine {
  id: string;
  variantId: string;
  productId: string;
  collectionIds: string[];
  quantity: number;
  unitPrice: number;
  weightGrams: number;
  requiresShipping: boolean;
  taxable: boolean;
}

export interface PricingInput {
  currency: string;
  pricesIncludeTax: boolean;
  lines: PriceLine[];
  discount: DiscountRule | null;
  /** times this customer already used the discount */
  discountCustomerUses: number;
  /** the chosen rate; null while none is chosen */
  shippingRate: RateRule | null;
  /** rates for the destination (see taxRatesFor); empty before an address */
  taxRates: TaxRule[];
  now: number;
}

export interface LineBreakdown {
  lineId: string;
  subtotal: number;
  discount: number;
  tax: number;
  /** what the line contributes to the order total */
  total: number;
}

export interface PricingResult extends PricingDTO {
  lines: LineBreakdown[];
  discountId: string | null;
  discountError: string | null;
  requiresShipping: boolean;
  weightGrams: number;
  /** subtotal − product discounts; what price-based shipping rates compare against */
  subtotalAfterDiscounts: number;
  shippingTax: number;
}

/**
 * The only place an order total is computed. Everything is integer minor
 * units. Tax is computed per line on the discounted amount; when prices
 * include tax it is extracted (base × r / (1 + r)) rather than added, and
 * several rates on one line share one extraction so they never over-count.
 */
export function priceOrder(input: PricingInput): PricingResult {
  const { lines, currency, pricesIncludeTax } = input;
  const subtotal = sum(lines.map((l) => l.unitPrice * l.quantity));
  const requiresShipping = lines.some((l) => l.requiresShipping);
  const weightGrams = sum(lines.filter((l) => l.requiresShipping).map((l) => l.weightGrams * l.quantity));

  // ── discount
  let discountId: string | null = null;
  let discountError: string | null = null;
  let freeShipping = false;
  const lineDiscount = new Map<string, number>();
  const discounts: PricingDTO['discounts'] = [];

  if (input.discount) {
    const result = evaluateDiscount(
      input.discount,
      lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        collectionIds: l.collectionIds,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        requiresShipping: l.requiresShipping,
      })),
      { now: input.now, currency, customerUses: input.discountCustomerUses },
    );
    if (result.ok) {
      discountId = input.discount.id;
      freeShipping = result.freeShipping;
      for (const [id, amount] of Object.entries(result.allocations)) lineDiscount.set(id, amount);
      discounts.push({ code: input.discount.code, title: input.discount.title || input.discount.code, amount: result.amount });
    } else {
      discountError = result.reason;
    }
  }

  const discountTotal = sum([...lineDiscount.values()]);
  const subtotalAfterDiscounts = subtotal - discountTotal;

  // ── shipping
  const shipping = !requiresShipping ? 0 : input.shippingRate ? input.shippingRate.amount : null;
  const shippingDiscount = freeShipping && shipping ? shipping : 0;

  // ── tax
  const rates = input.taxRates.filter((r) => r.rateBps > 0);
  const taxByRate = new Map<string, { name: string; rateBps: number; amount: number }>();
  const addTax = (rate: TaxRule, amount: number) => {
    const key = `${rate.name}|${rate.rateBps}`;
    const entry = taxByRate.get(key) ?? { name: rate.name, rateBps: rate.rateBps, amount: 0 };
    entry.amount += amount;
    taxByRate.set(key, entry);
  };

  const taxOn = (base: number, applicable: TaxRule[]): number => {
    if (base <= 0 || applicable.length === 0) return 0;
    const combined = sum(applicable.map((r) => r.rateBps));
    if (pricesIncludeTax) {
      const tax = divRound(base * combined, 10_000 + combined);
      allocate(tax, applicable.map((r) => r.rateBps)).forEach((amt, i) => addTax(applicable[i]!, amt));
      return tax;
    }
    let tax = 0;
    for (const r of applicable) {
      const amt = divRound(base * r.rateBps, 10_000);
      addTax(r, amt);
      tax += amt;
    }
    return tax;
  };

  const breakdown: LineBreakdown[] = lines.map((l) => {
    const lineSubtotal = l.unitPrice * l.quantity;
    const discount = lineDiscount.get(l.id) ?? 0;
    const tax = l.taxable ? taxOn(lineSubtotal - discount, rates) : 0;
    return {
      lineId: l.id,
      subtotal: lineSubtotal,
      discount,
      tax,
      total: lineSubtotal - discount + (pricesIncludeTax ? 0 : tax),
    };
  });

  const shippingTax = shipping ? taxOn(shipping - shippingDiscount, rates.filter((r) => r.appliesToShipping)) : 0;
  const taxTotal = sum(breakdown.map((b) => b.tax)) + shippingTax;

  const total =
    subtotalAfterDiscounts + (shipping ?? 0) - shippingDiscount + (pricesIncludeTax ? 0 : taxTotal);

  return {
    currency,
    subtotal,
    discountTotal,
    discounts: discounts.filter((d) => d.amount > 0),
    shipping,
    shippingDiscount,
    taxTotal,
    taxLines: [...taxByRate.values()].filter((t) => t.amount > 0),
    pricesIncludeTax,
    total,
    lines: breakdown,
    discountId,
    discountError,
    requiresShipping,
    weightGrams,
    subtotalAfterDiscounts,
    shippingTax,
  };
}

/** The public part of a pricing result. */
export function toPricingDTO(p: PricingResult): PricingDTO {
  return {
    currency: p.currency,
    subtotal: p.subtotal,
    discountTotal: p.discountTotal,
    discounts: p.discounts,
    shipping: p.shipping,
    shippingDiscount: p.shippingDiscount,
    taxTotal: p.taxTotal,
    taxLines: p.taxLines,
    pricesIncludeTax: p.pricesIncludeTax,
    total: p.total,
  };
}
