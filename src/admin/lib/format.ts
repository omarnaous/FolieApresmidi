import type { OrderStatus, PaymentStatus, ProductStatus } from './contract';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export const fmtDate = (ms: number | null | undefined): string => (ms == null ? '—' : dateFmt.format(ms));
export const fmtDateTime = (ms: number | null | undefined): string => (ms == null ? '—' : dateTimeFmt.format(ms));
export const fmtShortDate = (d: Date): string => shortDateFmt.format(d);
export const fmtNumber = (n: number): string => n.toLocaleString();

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function fmtRelative(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return 'Never';
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 864e5],
    ['month', 30 * 864e5],
    ['week', 7 * 864e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return 'Just now';
}

/** Percentage change, or null when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function fmtPct(p: number): string {
  const rounded = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(undefined, { type: 'region' });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'info' },
  fulfilled: { label: 'Fulfilled', tone: 'accent' },
  shipped: { label: 'Shipped', tone: 'accent' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'danger' },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partially refunded', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'danger' },
};

export const PRODUCT_STATUS_META: Record<ProductStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'warning' },
};
