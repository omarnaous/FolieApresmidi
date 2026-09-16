import type { DiscountType } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { allocate, applyBps, sum } from './math';

export interface Targets {
  productIds: string[];
  collectionIds: string[];
}

export interface DiscountRule {
  id: string;
  code: string;
  title: string;
  type: DiscountType;
  /** percentage / buy_x_get_y: bps · fixed_amount: minor units */
  value: number;
  appliesTo: 'all' | 'products' | 'collections';
  targets: Targets;
  minSubtotal: number | null;
  minQuantity: number | null;
  usageLimit: number | null;
  usageCount: number;
  usageLimitPerCustomer: number | null;
  buyX: { quantity: number; targets: Targets } | null;
  getY: { quantity: number; targets: Targets } | null;
  maxUsesPerOrder: number | null;
  startsAt: number;
  endsAt: number | null;
  status: 'active' | 'disabled';
}

export interface DiscountLine {
  id: string;
  productId: string;
  collectionIds: string[];
  quantity: number;
  unitPrice: number;
  requiresShipping: boolean;
}

export interface DiscountContext {
  now: number;
  currency: string;
  /** how many times this customer/email has already redeemed the code */
  customerUses: number;
}

export type DiscountResult =
  | {
      ok: true;
      /** line id → discount on that line (never more than the line total) */
      allocations: Record<string, number>;
      amount: number;
      freeShipping: boolean;
    }
  | { ok: false; reason: string };

/** Buy/get targets: no products and no collections means any product. */
const matches = (line: DiscountLine, targets: Targets): boolean =>
  (targets.productIds.length === 0 && targets.collectionIds.length === 0) ||
  targets.productIds.includes(line.productId) ||
  line.collectionIds.some((c) => targets.collectionIds.includes(c));

const lineTotal = (l: DiscountLine) => l.unitPrice * l.quantity;

function eligibleFor(rule: DiscountRule, line: DiscountLine): boolean {
  if (rule.appliesTo === 'all') return true;
  if (rule.appliesTo === 'products') return rule.targets.productIds.includes(line.productId);
  return line.collectionIds.some((c) => rule.targets.collectionIds.includes(c));
}

/**
 * Decide whether a code applies to these lines, and by how much. Pure: the
 * caller supplies the rule, the lines at their server-side prices, and how many
 * times this customer has used the code. Usage limits are enforced again,
 * atomically, when the order is written.
 */
export function evaluateDiscount(rule: DiscountRule, lines: DiscountLine[], ctx: DiscountContext): DiscountResult {
  if (rule.status !== 'active') return { ok: false, reason: 'This code is no longer available' };
  if (ctx.now < rule.startsAt) return { ok: false, reason: 'This code is not active yet' };
  if (rule.endsAt !== null && ctx.now >= rule.endsAt) return { ok: false, reason: 'This code has expired' };
  if (rule.usageLimit !== null && rule.usageCount >= rule.usageLimit) {
    return { ok: false, reason: 'This code is no longer available' };
  }
  if (rule.usageLimitPerCustomer !== null && ctx.customerUses >= rule.usageLimitPerCustomer) {
    return { ok: false, reason: 'You have already used this code' };
  }
  if (lines.length === 0) return { ok: false, reason: 'Your bag is empty' };

  const subtotal = sum(lines.map(lineTotal));
  const scoped = rule.type === 'percentage' || rule.type === 'fixed_amount';
  const eligible = scoped ? lines.filter((l) => eligibleFor(rule, l)) : lines;
  if (eligible.length === 0) return { ok: false, reason: 'This code does not apply to the items in your bag' };

  const eligibleSubtotal = sum(eligible.map(lineTotal));
  const eligibleQty = sum(eligible.map((l) => l.quantity));

  if (rule.minSubtotal !== null && (scoped ? eligibleSubtotal : subtotal) < rule.minSubtotal) {
    return { ok: false, reason: `Spend ${formatMoney(rule.minSubtotal, ctx.currency)} to use this code` };
  }
  if (rule.minQuantity !== null && eligibleQty < rule.minQuantity) {
    return { ok: false, reason: `Add ${rule.minQuantity - eligibleQty} more item${rule.minQuantity - eligibleQty === 1 ? '' : 's'} to use this code` };
  }

  switch (rule.type) {
    case 'percentage': {
      const bps = Math.min(10_000, Math.max(0, rule.value));
      const allocations: Record<string, number> = {};
      for (const l of eligible) allocations[l.id] = applyBps(lineTotal(l), bps);
      return done(allocations, false);
    }

    case 'fixed_amount': {
      const amount = Math.min(rule.value, eligibleSubtotal);
      const parts = allocate(amount, eligible.map(lineTotal));
      const allocations: Record<string, number> = {};
      eligible.forEach((l, i) => { allocations[l.id] = parts[i] ?? 0; });
      return done(allocations, false);
    }

    case 'free_shipping': {
      if (!lines.some((l) => l.requiresShipping)) {
        return { ok: false, reason: 'Nothing in your bag needs shipping' };
      }
      return { ok: true, allocations: {}, amount: 0, freeShipping: true };
    }

    case 'buy_x_get_y':
      return buyXGetY(rule, lines);
  }
}

function done(allocations: Record<string, number>, freeShipping: boolean): DiscountResult {
  const amount = sum(Object.values(allocations));
  if (amount <= 0 && !freeShipping) return { ok: false, reason: 'This code does not apply to the items in your bag' };
  return { ok: true, allocations, amount, freeShipping };
}

/**
 * Buy X get Y: each "set" needs X qualifying units bought and gives Y
 * qualifying units at `value` bps off (10000 = free). The most expensive units
 * count as the purchase and the cheapest as the reward — what a shopper
 * expects, and never more generous than intended. A unit is used once.
 */
function buyXGetY(rule: DiscountRule, lines: DiscountLine[]): DiscountResult {
  if (!rule.buyX || !rule.getY) return { ok: false, reason: 'This code is misconfigured' };
  const { buyX, getY } = rule;

  type Unit = { key: string; lineId: string; price: number; buy: boolean; get: boolean };
  const units: Unit[] = [];
  for (const l of lines) {
    const buy = matches(l, buyX.targets);
    const get = matches(l, getY.targets);
    if (!buy && !get) continue;
    for (let i = 0; i < Math.min(l.quantity, 999); i += 1) {
      units.push({ key: `${l.id}#${i}`, lineId: l.id, price: l.unitPrice, buy, get });
    }
  }

  const used = new Set<string>();
  const allocations: Record<string, number> = {};
  const maxSets = rule.maxUsesPerOrder ?? Number.MAX_SAFE_INTEGER;
  const bps = Math.min(10_000, Math.max(0, rule.value));
  let sets = 0;

  while (sets < maxSets) {
    // reserve the cheapest rewards first so they are not consumed as purchases
    const rewards = units.filter((u) => u.get && !used.has(u.key)).sort((a, b) => a.price - b.price).slice(0, getY.quantity);
    if (rewards.length < getY.quantity) break;
    const rewardKeys = new Set(rewards.map((u) => u.key));
    const purchases = units
      .filter((u) => u.buy && !used.has(u.key) && !rewardKeys.has(u.key))
      .sort((a, b) => b.price - a.price)
      .slice(0, buyX.quantity);
    if (purchases.length < buyX.quantity) break;

    for (const u of [...purchases, ...rewards]) used.add(u.key);
    for (const r of rewards) allocations[r.lineId] = (allocations[r.lineId] ?? 0) + applyBps(r.price, bps);
    sets += 1;
  }

  if (sets === 0) {
    const need = buyX.quantity + getY.quantity;
    return { ok: false, reason: `Add ${need} qualifying item${need === 1 ? '' : 's'} to get this offer` };
  }
  return done(allocations, false);
}
