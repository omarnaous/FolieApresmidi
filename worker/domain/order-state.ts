import type { OrderStatus, PaymentStatus } from '../../shared/api';

/**
 * Order lifecycle. `status` is where the parcel is; `payment_status` is where
 * the money is. They move separately because cash on delivery is paid last:
 * a COD order can be fulfilled and shipped while still unpaid.
 *
 * `refunded` is never a manual transition — it is reached when refunds cover
 * the whole total (see services/orders.ts).
 */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'fulfilled', 'cancelled'],
  paid: ['fulfilled', 'cancelled'],
  fulfilled: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
};

export interface OrderStateView {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

export function canTransition(order: OrderStateView, to: OrderStatus): boolean {
  if (to === 'paid') {
    // "mark as paid" is also allowed after fulfilment for COD, as a payment-only change
    return order.paymentStatus === 'unpaid' && !['cancelled', 'refunded'].includes(order.status);
  }
  return TRANSITIONS[order.status].includes(to);
}

export function allowedTransitions(order: OrderStateView): OrderStatus[] {
  const next = new Set<OrderStatus>(TRANSITIONS[order.status]);
  if (canTransition(order, 'paid')) next.add('paid');
  else next.delete('paid');
  return [...next];
}

/** Customer-facing wording for the order timeline and emails. */
export const STATUS_COPY: Record<OrderStatus, string> = {
  pending: 'Order placed',
  paid: 'Payment received',
  fulfilled: 'Packed and ready to ship',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Order cancelled',
  refunded: 'Refunded',
};

export const PAYMENT_STATUS_AFTER_REFUND = (total: number, refunded: number): PaymentStatus =>
  refunded <= 0 ? 'paid' : refunded >= total ? 'refunded' : 'partially_refunded';
