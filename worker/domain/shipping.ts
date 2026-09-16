import type { ShippingRateType } from '../../shared/api';

export interface ZoneRule<R extends RateRule = RateRule> {
  id: string;
  name: string;
  regions: { countryCode: string; regionCode: string | null }[];
  rates: R[];
}

export interface RateRule {
  id: string;
  name: string;
  type: ShippingRateType;
  amount: number;
  minValue: number | null;
  maxValue: number | null;
  deliveryEstimate: string | null;
  active: boolean;
  position: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** The zone for an address: a region-specific match beats a whole-country one. */
export function zoneFor<Z extends ZoneRule>(zones: Z[], countryCode: string, regionCode: string | null): Z | null {
  const country = countryCode.toUpperCase();
  if (regionCode) {
    const exact = zones.find((z) => z.regions.some((r) => r.countryCode === country && r.regionCode && same(r.regionCode, regionCode)));
    if (exact) return exact;
  }
  return zones.find((z) => z.regions.some((r) => r.countryCode === country && !r.regionCode)) ?? null;
}

/**
 * Rates a basket qualifies for. Ranges are [min, max): min inclusive, max
 * exclusive, null = unbounded — so "0–100" and "100+" never both match.
 * Price-based rates look at the subtotal after product discounts.
 */
export function eligibleRates<R extends RateRule>(rates: R[], basket: { subtotalAfterDiscounts: number; weightGrams: number }): R[] {
  return rates
    .filter((r) => {
      if (!r.active) return false;
      if (r.type === 'flat') return true;
      const v = r.type === 'weight' ? basket.weightGrams : basket.subtotalAfterDiscounts;
      return (r.minValue === null || v >= r.minValue) && (r.maxValue === null || v < r.maxValue);
    })
    .sort((a, b) => a.amount - b.amount || a.position - b.position);
}
