import type { AdminNewsletterDTO, SubscriberDTO } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { sign, unsign } from '../lib/crypto';

/**
 * The list. Addresses the site gathers, and the one-click way off it.
 *
 * Nothing is sent to this list: the only email a shopper gets from the shop
 * is the confirmation of an order they placed. The addresses are kept for
 * the day the house decides to write, and the way out is honoured the
 * moment it is used.
 */

interface SubscriberRow {
  email: string;
  status: 'subscribed' | 'unsubscribed';
  source: string | null;
  created_at: number;
}

const subscriberDTO = (r: SubscriberRow): SubscriberDTO => ({
  email: r.email,
  status: r.status,
  source: r.source ?? 'newsletter',
  createdAt: r.created_at,
});

/**
 * What a discount code is worth, in the words the page prints: "15% off your
 * first order". A code limited to one use each is a first-order offer;
 * anything else is simply money off. An unknown, switched-off or expired
 * code is worth nothing, so nothing is shown and nothing is promised.
 */
export async function offerPhrase(d1: D1Database, code: string | null, currency: string): Promise<string | null> {
  if (!code) return null;
  const row = await d1
    .prepare(`SELECT type, value, usage_limit_per_customer AS per, status, ends_at FROM discounts WHERE code = ?`)
    .bind(code)
    .first<{ type: string; value: number; per: number | null; status: string; ends_at: number | null }>();
  if (!row || row.status !== 'active' || (row.ends_at !== null && row.ends_at < Date.now())) return null;

  // "15% off your first order", but "free delivery on your first order"
  const first = row.per === 1 ? ' your first order' : '';
  if (row.type === 'percentage') {
    // basis points: 1500 → 15%
    const pct = Number((row.value / 100).toFixed(2));
    return `${pct}% off${first}`;
  }
  if (row.type === 'fixed_amount') return `${formatMoney(row.value, currency)} off${first}`;
  if (row.type === 'free_shipping') return `free delivery${first ? ` on${first}` : ''}`;
  return null;
}

/** One-click unsubscribe links: the address, signed, so the link cannot be guessed or edited. */
export const unsubscribeToken = (email: string, secret: string) => sign(`u.${email}`, secret);

export async function emailFromToken(token: string, secret: string): Promise<string | null> {
  const value = await unsign(token, secret);
  return value?.startsWith('u.') ? value.slice(2) : null;
}

export async function unsubscribe(d1: D1Database, email: string): Promise<boolean> {
  const res = await d1
    .prepare(`UPDATE subscribers SET status = 'unsubscribed', updated_at = ? WHERE email = ?`)
    .bind(Date.now(), email)
    .run();
  return !!res.meta.changes;
}

/**
 * The list for the admin: both counts, and a page of addresses newest first.
 * The cursor is the last address's creation time and email, so a page never
 * repeats or skips one that arrived while it was being read.
 */
export async function newsletterDTO(
  d1: D1Database,
  query: { q?: string; show: 'all' | 'subscribed' | 'unsubscribed'; cursor?: string; limit: number },
  welcomeCode: string | null,
  currency: string,
): Promise<AdminNewsletterDTO> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.show !== 'all') {
    where.push('status = ?');
    params.push(query.show);
  }
  if (query.q) {
    where.push('email LIKE ?');
    params.push(`%${query.q.toLowerCase()}%`);
  }
  const [at, after] = (query.cursor ?? '').split('|');
  if (at) {
    where.push('(created_at < ? OR (created_at = ? AND email > ?))');
    params.push(Number(at), Number(at), after ?? '');
  }

  const counts = await d1.prepare(`SELECT status, count(*) AS n FROM subscribers GROUP BY status`).all<{ status: string; n: number }>();
  const by = new Map(counts.results.map((r) => [r.status, r.n]));

  const { results } = await d1
    .prepare(`SELECT email, status, source, created_at FROM subscribers ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, email LIMIT ?`)
    .bind(...params, query.limit + 1)
    .all<SubscriberRow>();

  const page = results.slice(0, query.limit);
  const last = page.at(-1);
  const offer = await offerPhrase(d1, welcomeCode, currency);
  return {
    subscribers: { subscribed: by.get('subscribed') ?? 0, unsubscribed: by.get('unsubscribed') ?? 0 },
    items: page.map(subscriberDTO),
    nextCursor: results.length > query.limit && last ? `${last.created_at}|${last.email}` : null,
    welcome: welcomeCode ? { code: welcomeCode, offer, active: offer !== null } : null,
  };
}
