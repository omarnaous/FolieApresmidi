import type { OrderStatus } from '../../shared/api';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** 1726480000000 → "16 September 2026" */
export const formatDate = (ms: number) => DATE.format(new Date(ms));

/** Order states in the words a customer would use. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Received',
  paid: 'Paid',
  fulfilled: 'Packed',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Only web links are followed out of the store — a tracking URL is data someone typed. */
export const isWebUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
