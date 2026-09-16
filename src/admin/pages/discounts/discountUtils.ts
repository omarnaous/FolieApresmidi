import { formatMoney, formatRate, type DiscountDTO } from '../../lib/contract';
import type { Tone } from '../../lib/format';
import { plural } from '../../lib/util';

export type DiscountState = 'active' | 'scheduled' | 'expired' | 'disabled';

export const DISCOUNT_STATE_META: Record<DiscountState, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  disabled: { label: 'Disabled', tone: 'warning' },
};

type StateInput = Pick<DiscountDTO, 'status' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usageCount'>;

export function discountState(d: StateInput, now = Date.now()): DiscountState {
  if (d.status === 'disabled') return 'disabled';
  if (d.startsAt > now) return 'scheduled';
  if ((d.endsAt !== null && d.endsAt <= now) || (d.usageLimit !== null && d.usageCount >= d.usageLimit)) return 'expired';
  return 'active';
}

export type SummaryInput = Pick<DiscountDTO, 'type' | 'value' | 'appliesTo' | 'targets' | 'minSubtotal' | 'minQuantity' | 'buyX' | 'getY'>;

/** "10% off all products", "$20 off", "Free shipping over $100", "Buy 2 get 1 free". */
export function discountSummary(d: SummaryInput, currency: string): string {
  const scope =
    d.appliesTo === 'all' ? 'all products' : d.appliesTo === 'products' ? plural(d.targets.productIds.length, 'product') : plural(d.targets.collectionIds.length, 'collection');
  const min = d.minSubtotal !== null ? ` over ${formatMoney(d.minSubtotal, currency)}` : d.minQuantity !== null ? ` on ${d.minQuantity}+ items` : '';
  switch (d.type) {
    case 'percentage':
      return `${formatRate(d.value)} off ${scope}${min}`;
    case 'fixed_amount':
      return `${formatMoney(d.value, currency)} off${d.appliesTo === 'all' ? '' : ` ${scope}`}${min}`;
    case 'free_shipping':
      return `Free shipping${min}`;
    case 'buy_x_get_y':
      return `Buy ${d.buyX?.quantity ?? '?'} get ${d.getY?.quantity ?? '?'} ${d.value >= 10_000 ? 'free' : `at ${formatRate(d.value)} off`}`;
  }
}
