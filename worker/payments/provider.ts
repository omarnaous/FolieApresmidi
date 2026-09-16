/**
 * Payment provider abstraction. Business logic (checkout, orders, refunds)
 * only ever talks to this interface and to the normalised PaymentEvent — a new
 * gateway is one file implementing PaymentProvider plus a registry entry.
 *
 *  commit: 'on_placement'  stock and the order are committed when the shopper
 *                          places the order (cash on delivery, bank transfer…)
 *  commit: 'webhook'       the shopper is redirected to pay; stock and the order
 *                          are committed when the verified webhook confirms it
 */

export interface CreatePaymentInput {
  checkoutId: string;
  amount: number;
  currency: string;
  email: string;
  /** where a redirecting gateway sends the shopper back */
  returnUrl: string;
  cancelUrl: string;
  description: string;
}

export type CreatePaymentResult =
  | { kind: 'redirect'; url: string; ref: string }
  | { kind: 'placed'; ref: string; instructions: string | null };

export interface PaymentEvent {
  /** the gateway's own event id — the idempotency key */
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded';
  checkoutId: string | null;
  ref: string;
  amount: number;
  currency: string;
}

export interface RefundRequest {
  ref: string | null;
  amount: number;
  currency: string;
  reason: string | null;
}

export interface RefundResult {
  status: 'succeeded' | 'failed';
  ref: string | null;
  error?: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly commit: 'on_placement' | 'webhook';
  isEnabled(env: Env): boolean;
  createCheckout(input: CreatePaymentInput, env: Env): Promise<CreatePaymentResult>;
  /** Must verify the signature and throw on anything it cannot authenticate. */
  handleWebhook(request: Request, env: Env): Promise<PaymentEvent[]>;
  refund(input: RefundRequest, env: Env): Promise<RefundResult>;
}
