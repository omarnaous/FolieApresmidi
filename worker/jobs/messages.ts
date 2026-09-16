import { jobQueue } from '../lib/bindings';

/** Everything that goes through the JOBS queue. Payloads are small and JSON-safe. */
export type JobMessage =
  | { type: 'email.order_confirmation'; orderId: string }
  | { type: 'email.order_status'; orderId: string; status: 'shipped' | 'delivered' | 'cancelled' | 'refunded'; refundAmount?: number }
  | { type: 'email.new_order_alert'; orderId: string }
  | { type: 'email.verify'; to: string; name: string; url: string }
  | { type: 'email.password_reset'; to: string; name: string; url: string }
  | { type: 'email.staff_invite'; to: string; name: string; url: string; inviter: string }
  | { type: 'email.abandoned_cart'; cartId: string }
  | { type: 'collections.rematerialize'; collectionId?: string; productIds?: string[] }
  | { type: 'csv.import'; importId: string };

export async function enqueue(env: Env, message: JobMessage): Promise<void> {
  const queue = jobQueue(env);
  if (queue) {
    await queue.send(message, { contentType: 'json' });
    return;
  }
  // No Queues binding (the free-plan preview environment): run the job on this
  // request instead of dropping it. Imported lazily to keep the cycle between
  // this module and the consumer out of the module graph's eager phase.
  const { runJob } = await import('./queue');
  await runJob(env, message, `inline:${crypto.randomUUID()}`);
}
