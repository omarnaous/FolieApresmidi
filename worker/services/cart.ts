import type { CartDTO, CartLineDTO } from '../../shared/api';
import { evaluateDiscount } from '../domain/discounts';
import { sum } from '../domain/math';
import { COOKIES, readCookie, writeCookie } from '../lib/cookies';
import { sign, unsign } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { Ctx } from '../types';
import { discountByCode, redemptionsBy, toRule } from './discount-rules';
import { sellable, stockFor } from './inventory';
import { variantDetails, type VariantDetail } from './lines';
import { mediaByIds } from './media';
import { getSettings } from './settings';

const CART_COOKIE_TTL = 60 * 60 * 24 * 60;
const MAX_LINE_QTY = 99;
const MAX_LINES = 100;

export interface CartRow {
  id: string;
  customer_id: string | null;
  email: string | null;
  discount_code: string | null;
  status: 'active' | 'merged' | 'converted';
  updated_at: number;
}

async function setCartCookie(c: Ctx, cartId: string) {
  writeCookie(c, COOKIES.cart, await sign(cartId, c.env.COOKIE_SECRET), { maxAge: CART_COOKIE_TTL });
}

/**
 * The shopper's active cart, from the signed cookie. Every shopper is a
 * guest; a cart left from when the store had accounts is never handed out.
 */
export async function findCart(c: Ctx): Promise<CartRow | null> {
  const d1 = c.env.DB;
  const id = await unsign(readCookie(c, COOKIES.cart), c.env.COOKIE_SECRET);
  if (!id) return null;
  const row = await d1.prepare(`SELECT * FROM carts WHERE id = ?`).bind(id).first<CartRow>();
  return row && row.status === 'active' && !row.customer_id ? row : null;
}

export async function findOrCreateCart(c: Ctx): Promise<CartRow> {
  const existing = await findCart(c);
  if (existing) {
    await setCartCookie(c, existing.id);
    return existing;
  }
  const now = Date.now();
  const row: CartRow = { id: ulid(now), customer_id: null, email: null, discount_code: null, status: 'active', updated_at: now };
  await c.env.DB.prepare(`INSERT INTO carts (id, customer_id, email, discount_code, status, created_at, updated_at) VALUES (?, NULL, NULL, NULL, 'active', ?, ?)`)
    .bind(row.id, now, now)
    .run();
  await setCartCookie(c, row.id);
  return row;
}

async function ensureSellable(c: Ctx, detail: VariantDetail | undefined, quantity: number) {
  if (!detail || detail.productStatus !== 'active') throw new AppError('NOT_FOUND', 'That piece is no longer available');
  const stock = await stockFor(c.env.DB, [detail.variantId], Date.now());
  const s = stock.get(detail.variantId);
  const n = s ? sellable(s) : 0;
  if (n !== null && n < quantity) {
    throw new AppError('OUT_OF_STOCK', n === 0 ? 'That size is sold out' : `Only ${n} left in that size`, {
      details: { lines: [{ variantId: detail.variantId, available: n }] },
    });
  }
}

export async function addLine(c: Ctx, variantId: string, quantity: number): Promise<CartRow> {
  const d1 = c.env.DB;
  const detail = (await variantDetails(d1, [variantId])).get(variantId);
  const cart = await findOrCreateCart(c);
  const existing = await d1.prepare(`SELECT quantity FROM cart_lines WHERE cart_id = ? AND variant_id = ?`).bind(cart.id, variantId).first<{ quantity: number }>();
  const next = Math.min(MAX_LINE_QTY, (existing?.quantity ?? 0) + quantity);
  await ensureSellable(c, detail, next);
  if (!existing) {
    const count = await d1.prepare(`SELECT COUNT(*) AS n FROM cart_lines WHERE cart_id = ?`).bind(cart.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_LINES) throw new AppError('BAD_REQUEST', 'Your bag is full');
  }
  const now = Date.now();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO cart_lines (id, cart_id, variant_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
      )
      .bind(ulid(now), cart.id, variantId, next, now, now),
    d1.prepare(`UPDATE carts SET updated_at = ?, reminder_sent_at = NULL WHERE id = ?`).bind(now, cart.id),
  ]);
  return cart;
}

export async function updateLine(c: Ctx, lineId: string, quantity: number): Promise<CartRow> {
  const d1 = c.env.DB;
  const cart = await findCart(c);
  if (!cart) throw notFound('Your bag is empty');
  const line = await d1.prepare(`SELECT variant_id FROM cart_lines WHERE id = ? AND cart_id = ?`).bind(lineId, cart.id).first<{ variant_id: string }>();
  if (!line) throw notFound('That item is no longer in your bag');
  const now = Date.now();
  if (quantity === 0) {
    await d1.batch([
      d1.prepare(`DELETE FROM cart_lines WHERE id = ?`).bind(lineId),
      d1.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).bind(now, cart.id),
    ]);
    return cart;
  }
  const detail = (await variantDetails(d1, [line.variant_id])).get(line.variant_id);
  await ensureSellable(c, detail, quantity);
  await d1.batch([
    d1.prepare(`UPDATE cart_lines SET quantity = ?, updated_at = ? WHERE id = ?`).bind(Math.min(MAX_LINE_QTY, quantity), now, lineId),
    d1.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).bind(now, cart.id),
  ]);
  return cart;
}

export async function setDiscount(c: Ctx, code: string | null): Promise<CartRow | null> {
  const d1 = c.env.DB;
  if (code) {
    const found = await discountByCode(d1, code);
    if (!found) throw new AppError('DISCOUNT_INVALID', 'That code does not exist', { fields: { code: 'That code does not exist' } });
  }
  const cart = code ? await findOrCreateCart(c) : await findCart(c);
  if (!cart) return null;
  const next = code ? code.trim().toUpperCase() : null;
  await d1.prepare(`UPDATE carts SET discount_code = ?, updated_at = ? WHERE id = ?`).bind(next, Date.now(), cart.id).run();
  return { ...cart, discount_code: next };
}

/**
 * The shopper's bag, priced. Pass the cart a write just resolved: a cart
 * created in this request is only in the response cookie, not the request's.
 */
export async function cartDTO(c: Ctx, known?: CartRow | null): Promise<CartDTO> {
  const d1 = c.env.DB;
  const db = c.get('db');
  const settings = await getSettings(db);
  const cart = known === undefined ? await findCart(c) : known;
  const empty: CartDTO = {
    id: cart?.id ?? null,
    currency: settings.currency,
    lines: [],
    itemCount: 0,
    subtotal: 0,
    discountCode: cart?.discount_code ?? null,
    discountAmount: 0,
    discountError: null,
    warnings: [],
  };
  if (!cart) return empty;

  const { results: rows } = await d1
    .prepare(`SELECT id, variant_id, quantity FROM cart_lines WHERE cart_id = ? ORDER BY created_at`)
    .bind(cart.id)
    .all<{ id: string; variant_id: string; quantity: number }>();
  if (rows.length === 0) return empty;

  const now = Date.now();
  const details = await variantDetails(d1, rows.map((r) => r.variant_id));
  const stock = await stockFor(d1, rows.map((r) => r.variant_id), now);
  const media = await mediaByIds(db, [...details.values()].map((d) => d.mediaId ?? ''));

  const lines: CartLineDTO[] = [];
  const warnings: CartDTO['warnings'] = [];
  for (const r of rows) {
    const d = details.get(r.variant_id);
    if (!d) {
      warnings.push({ lineId: r.id, code: 'unavailable', available: 0 });
      continue;
    }
    const s = stock.get(r.variant_id);
    const n = s ? sellable(s) : 0;
    const active = d.productStatus === 'active';
    const available = active && (n === null || n >= r.quantity);
    if (!active || n === 0) warnings.push({ lineId: r.id, code: 'unavailable', available: 0 });
    else if (n !== null && n < r.quantity) warnings.push({ lineId: r.id, code: 'insufficient_stock', available: n });
    lines.push({
      id: r.id,
      variantId: d.variantId,
      productId: d.productId,
      productHandle: d.handle,
      productTitle: d.productTitle,
      variantTitle: d.variantTitle,
      options: d.options,
      image: d.mediaId ? media.get(d.mediaId) ?? null : null,
      quantity: r.quantity,
      unitPrice: d.price,
      compareAtPrice: d.compareAtPrice,
      lineTotal: d.price * r.quantity,
      available,
      maxQuantity: n === null ? MAX_LINE_QTY : Math.min(MAX_LINE_QTY, n),
    });
  }

  let discountAmount = 0;
  let discountError: string | null = null;
  if (cart.discount_code) {
    const rule = await discountByCode(d1, cart.discount_code);
    if (!rule) discountError = 'That code does not exist';
    else {
      const uses = await redemptionsBy(d1, rule.id, cart.email, null);
      const result = evaluateDiscount(
        toRule(rule),
        lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          collectionIds: details.get(l.variantId)?.collectionIds ?? [],
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          requiresShipping: details.get(l.variantId)?.requiresShipping ?? true,
        })),
        { now, currency: settings.currency, customerUses: uses },
      );
      if (result.ok) discountAmount = result.amount;
      else discountError = result.reason;
    }
  }

  return {
    id: cart.id,
    currency: settings.currency,
    lines,
    itemCount: sum(lines.map((l) => l.quantity)),
    subtotal: sum(lines.map((l) => l.lineTotal)),
    discountCode: cart.discount_code,
    discountAmount,
    discountError,
    warnings,
  };
}
