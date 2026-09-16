import { ulid } from '../lib/ids';

export interface OrderEventInput {
  orderId: string;
  type: string;
  from: string | null;
  to: string | null;
  actorType: 'system' | 'customer' | 'staff' | 'webhook';
  actorId: string | null;
  message: string;
  data: Record<string, unknown> | null;
  customerVisible: boolean;
  now: number;
}

/** One row in the append-only order audit trail, for use inside a batch. */
export function eventStatement(d1: D1Database, e: OrderEventInput): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_type, actor_id, message, data_json, customer_visible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ulid(e.now), e.orderId, e.type, e.from, e.to, e.actorType, e.actorId, e.message, e.data ? JSON.stringify(e.data) : null, e.customerVisible ? 1 : 0, e.now);
}
