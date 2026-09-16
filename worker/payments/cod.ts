import { AppError } from '../lib/errors';
import type { PaymentProvider } from './provider';

/**
 * Cash on delivery. Nothing is charged online: the order and its stock are
 * committed when it is placed, it stays `unpaid` until staff record the cash
 * (Mark as paid, or Delivered + cash collected), and refunds are recorded for
 * the books and settled in person.
 */
export const cashOnDelivery: PaymentProvider = {
  id: 'cod',
  name: 'Cash on delivery',
  description: 'Pay the courier in cash when your order arrives.',
  commit: 'on_placement',

  isEnabled: () => true,

  async createCheckout(input) {
    return { kind: 'placed', ref: `cod_${input.checkoutId}`, instructions: 'Pay the courier in cash when your order arrives.' };
  },

  async handleWebhook() {
    throw new AppError('NOT_FOUND', 'Cash on delivery has no webhooks');
  },

  async refund() {
    return { status: 'succeeded', ref: null };
  },
};
