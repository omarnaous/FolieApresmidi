export interface TaxRule {
  id: string;
  countryCode: string;
  regionCode: string | null;
  name: string;
  rateBps: number;
  appliesToShipping: boolean;
  active: boolean;
}

/**
 * Rates for a destination. Country-wide rates apply everywhere in the country;
 * a region rate with the same name replaces the country rate for that region
 * (e.g. a province's own VAT), and a region rate with a different name is added
 * on top (e.g. a local levy).
 */
export function taxRatesFor(rates: TaxRule[], countryCode: string, regionCode: string | null): TaxRule[] {
  const country = countryCode.toUpperCase();
  const region = regionCode?.trim().toLowerCase() ?? null;
  const active = rates.filter((r) => r.active && r.countryCode === country);
  const regional = region ? active.filter((r) => r.regionCode && r.regionCode.trim().toLowerCase() === region) : [];
  const regionalNames = new Set(regional.map((r) => r.name.toLowerCase()));
  const national = active.filter((r) => !r.regionCode && !regionalNames.has(r.name.toLowerCase()));
  return [...national, ...regional];
}
