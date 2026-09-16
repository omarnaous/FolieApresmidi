import { ulid } from '../lib/ids';
import { chunk } from './media';

/**
 * Stock rules
 *  - on_hand is only ever changed inside a D1 batch, next to the order or
 *    adjustment that explains it. The variants_stock CHECK constraint makes a
 *    decrement past zero abort the entire batch, so two shoppers racing for
 *    the last piece cannot both win.
 *  - Checkout holds (inventory_reservations) lower what the storefront calls
 *    available, but never touch on_hand. Adding to the bag reserves nothing.
 *  - Multi-line changes are one statement over json_each(?), so a checkout is
 *    a fixed number of D1 queries however many lines it has.
 */

export interface VariantStock {
  variantId: string;
  tracked: boolean;
  policy: 'deny' | 'continue';
  onHand: number;
  reserved: number;
}

/** Units that can still be sold; null = unlimited (untracked or oversell allowed). */
export const sellable = (s: VariantStock): number | null =>
  !s.tracked || s.policy === 'continue' ? null : Math.max(0, s.onHand - s.reserved);

export async function stockFor(
  d1: D1Database,
  variantIds: string[],
  now: number,
  excludeCheckoutId: string | null = null,
): Promise<Map<string, VariantStock>> {
  const out = new Map<string, VariantStock>();
  for (const ids of chunk([...new Set(variantIds)], 80)) {
    const { results } = await d1
      .prepare(
        `SELECT v.id, v.inventory_tracked AS tracked, v.inventory_policy AS policy, v.inventory_on_hand AS on_hand,
                COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r
                          WHERE r.variant_id = v.id AND r.expires_at > ? AND r.checkout_id != ?), 0) AS reserved
           FROM variants v WHERE v.id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(now, excludeCheckoutId ?? '', ...ids)
      .all<{ id: string; tracked: number; policy: 'deny' | 'continue'; on_hand: number; reserved: number }>();
    for (const r of results) {
      out.set(r.id, { variantId: r.id, tracked: !!r.tracked, policy: r.policy, onHand: r.on_hand, reserved: r.reserved });
    }
  }
  return out;
}

export interface Shortfall {
  variantId: string;
  requested: number;
  available: number;
}

/** Lines that cannot be sold at the requested quantity right now. */
export async function shortfalls(
  d1: D1Database,
  lines: { variantId: string; quantity: number }[],
  now: number,
  excludeCheckoutId: string | null = null,
): Promise<Shortfall[]> {
  const stock = await stockFor(d1, lines.map((l) => l.variantId), now, excludeCheckoutId);
  const out: Shortfall[] = [];
  for (const l of lines) {
    const s = stock.get(l.variantId);
    const n = s ? sellable(s) : 0;
    if (n !== null && n < l.quantity) out.push({ variantId: l.variantId, requested: l.quantity, available: n });
  }
  return out;
}

type Movement = { variantId: string; quantity: number };

const movementJson = (lines: Movement[], sign: 1 | -1, now: number) =>
  JSON.stringify(lines.filter((l) => l.quantity > 0).map((l) => ({ id: ulid(now), v: l.variantId, d: sign * l.quantity })));

function applyMovements(
  d1: D1Database,
  json: string,
  ref: { reason: string; orderId: string | null; staffId: string | null; note: string | null; now: number },
): D1PreparedStatement[] {
  return [
    d1
      .prepare(
        `UPDATE variants
            SET inventory_on_hand = inventory_on_hand + (SELECT json_extract(m.value, '$.d') FROM json_each(?1) m WHERE json_extract(m.value, '$.v') = variants.id),
                updated_at = ?2
          WHERE inventory_tracked = 1 AND id IN (SELECT json_extract(m.value, '$.v') FROM json_each(?1) m)`,
      )
      .bind(json, ref.now),
    d1
      .prepare(
        `INSERT INTO inventory_adjustments (id, variant_id, delta, reason, order_id, staff_id, note, created_at)
         SELECT json_extract(m.value, '$.id'), v.id, json_extract(m.value, '$.d'), ?2, ?3, ?4, ?5, ?6
           FROM json_each(?1) m JOIN variants v ON v.id = json_extract(m.value, '$.v') AND v.inventory_tracked = 1`,
      )
      .bind(json, ref.reason, ref.orderId, ref.staffId, ref.note, ref.now),
  ];
}

/** Decrement on_hand for an order. The CHECK constraint aborts the batch on oversell. */
export const commitStatements = (d1: D1Database, lines: Movement[], ref: { orderId: string; now: number }) =>
  applyMovements(d1, movementJson(lines, -1, ref.now), { reason: 'order', orderId: ref.orderId, staffId: null, note: null, now: ref.now });

export const restockStatements = (
  d1: D1Database,
  lines: Movement[],
  ref: { reason: 'cancel_restock' | 'refund_restock'; orderId: string; staffId: string | null; now: number },
) => applyMovements(d1, movementJson(lines, 1, ref.now), { reason: ref.reason, orderId: ref.orderId, staffId: ref.staffId, note: null, now: ref.now });

/** A manual or imported stock change for one variant. */
export function adjustStatements(
  d1: D1Database,
  variantId: string,
  delta: number,
  ref: { reason: 'manual' | 'import'; staffId: string | null; note: string | null; now: number },
): D1PreparedStatement[] {
  if (delta === 0) return [];
  return [
    d1.prepare('UPDATE variants SET inventory_on_hand = inventory_on_hand + ?, updated_at = ? WHERE id = ?').bind(delta, ref.now, variantId),
    d1
      .prepare(`INSERT INTO inventory_adjustments (id, variant_id, delta, reason, order_id, staff_id, note, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`)
      .bind(ulid(ref.now), variantId, delta, ref.reason, ref.staffId, ref.note, ref.now),
  ];
}

/** Hold stock for a checkout (replacing any previous holds it had). */
export function holdStatements(d1: D1Database, checkoutId: string, lines: Movement[], expiresAt: number): D1PreparedStatement[] {
  const json = JSON.stringify(lines.map((l) => ({ id: ulid(), v: l.variantId, q: l.quantity })));
  return [
    d1.prepare('DELETE FROM inventory_reservations WHERE checkout_id = ?').bind(checkoutId),
    d1
      .prepare(
        `INSERT INTO inventory_reservations (id, variant_id, checkout_id, quantity, expires_at)
         SELECT json_extract(m.value, '$.id'), v.id, ?2, json_extract(m.value, '$.q'), ?3
           FROM json_each(?1) m JOIN variants v ON v.id = json_extract(m.value, '$.v')
          WHERE v.inventory_tracked = 1 AND v.inventory_policy = 'deny'`,
      )
      .bind(json, checkoutId, expiresAt),
  ];
}
