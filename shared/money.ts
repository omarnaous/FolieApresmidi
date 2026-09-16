/**
 * Money is an integer count of the currency's minor unit (cents for USD).
 * Nothing in the system stores or computes with floating-point amounts;
 * floats appear only at the edge, when a person types or reads a price.
 */

const DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, AED: 2, SAR: 2, CAD: 2, AUD: 2, CHF: 2,
  LBP: 0, JPY: 0, KRW: 0,
};

export const decimalsFor = (currency: string): number => DECIMALS[currency.toUpperCase()] ?? 2;

/** `formatMoney(14500, 'USD')` → `$145`; `formatMoney(14550, 'USD')` → `$145.50`. */
export function formatMoney(
  amount: number,
  currency = 'USD',
  opts: { trimZeros?: boolean; locale?: string } = {},
): string {
  const d = decimalsFor(currency);
  const major = amount / 10 ** d;
  const whole = amount % 10 ** d === 0;
  const trim = opts.trimZeros ?? true;
  return new Intl.NumberFormat(opts.locale ?? 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: trim && whole ? 0 : d,
    maximumFractionDigits: d,
  }).format(major);
}

/**
 * Parse what a person typed ("145", "145.5", "1,450.00") into minor units
 * without going through a float. Returns null when it is not a price.
 */
export function parseMoney(input: string, currency = 'USD'): number | null {
  const d = decimalsFor(currency);
  const clean = input.trim().replace(/[,\s]/g, '').replace(/^[^\d-]+/, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').slice(0, d).padEnd(d, '0');
  if ((m[2] ?? '').length > d && /[1-9]/.test((m[2] ?? '').slice(d))) return null;
  return Number(whole) * 10 ** d + (d ? Number(frac) : 0);
}

/** 14550 → "145.50" (for inputs and CSV). */
export function toMajorString(amount: number, currency = 'USD'): string {
  const d = decimalsFor(currency);
  if (d === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 10 ** d)}.${String(abs % 10 ** d).padStart(d, '0')}`;
}

/** Basis points → display percentage: 1100 → "11%", 1250 → "12.5%". */
export const formatRate = (bps: number): string => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
