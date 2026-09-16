import { describe, expect, it } from 'vitest';
import type { DiscountRule } from '../../worker/domain/discounts';
import { evaluateDiscount } from '../../worker/domain/discounts';
import { priceOrder, type PriceLine, type PricingInput } from '../../worker/domain/pricing';
import type { RateRule } from '../../worker/domain/shipping';
import type { TaxRule } from '../../worker/domain/tax';

const NOW = 1_800_000_000_000;

const line = (id: string, unitPrice: number, quantity: number, extra: Partial<PriceLine> = {}): PriceLine => ({
  id,
  variantId: id,
  productId: `p-${id}`,
  collectionIds: [],
  quantity,
  unitPrice,
  weightGrams: 500,
  requiresShipping: true,
  taxable: true,
  ...extra,
});

const rule = (over: Partial<DiscountRule>): DiscountRule => ({
  id: 'd1',
  code: 'CODE',
  title: 'Code',
  type: 'percentage',
  value: 1000,
  appliesTo: 'all',
  targets: { productIds: [], collectionIds: [] },
  minSubtotal: null,
  minQuantity: null,
  usageLimit: null,
  usageCount: 0,
  usageLimitPerCustomer: null,
  buyX: null,
  getY: null,
  maxUsesPerOrder: null,
  startsAt: NOW - 1000,
  endsAt: null,
  status: 'active',
  ...over,
});

const rate = (amount: number): RateRule => ({ id: 'r', name: 'Courier', type: 'flat', amount, minValue: null, maxValue: null, deliveryEstimate: null, active: true, position: 0 });
const tax = (name: string, rateBps: number, appliesToShipping = false): TaxRule => ({ id: name, countryCode: 'LB', regionCode: null, name, rateBps, appliesToShipping, active: true });

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  currency: 'USD',
  pricesIncludeTax: false,
  lines: [line('a', 10_000, 1, { collectionIds: ['c1'] }), line('b', 5_000, 2, { collectionIds: ['c2'] })],
  discount: null,
  discountCustomerUses: 0,
  shippingRate: null,
  taxRates: [],
  now: NOW,
  ...over,
});

describe('priceOrder', () => {
  it('sums lines in integer minor units', () => {
    const p = priceOrder(base());
    expect(p.subtotal).toBe(20_000);
    expect(p.total).toBe(20_000);
    expect(p.shipping).toBeNull();
  });

  it('applies a percentage discount per line', () => {
    const p = priceOrder(base({ discount: rule({ value: 1000 }) }));
    expect(p.lines.map((l) => l.discount)).toEqual([1000, 1000]);
    expect(p.discountTotal).toBe(2000);
    expect(p.discounts).toEqual([{ code: 'CODE', title: 'Code', amount: 2000 }]);
    expect(p.total).toBe(18_000);
  });

  it('spreads a fixed discount so the parts add up exactly', () => {
    const p = priceOrder(base({ discount: rule({ type: 'fixed_amount', value: 1001 }) }));
    expect(p.lines.reduce((n, l) => n + l.discount, 0)).toBe(1001);
    expect(p.total).toBe(20_000 - 1001);
  });

  it('never discounts more than the eligible lines are worth', () => {
    const p = priceOrder(base({ discount: rule({ type: 'fixed_amount', value: 50_000, appliesTo: 'collections', targets: { productIds: [], collectionIds: ['c2'] } }) }));
    expect(p.lines.map((l) => l.discount)).toEqual([0, 10_000]);
  });

  it('adds exclusive tax on the discounted amount', () => {
    const p = priceOrder(base({ taxRates: [tax('VAT', 1100)], discount: rule({ value: 1000 }) }));
    // (10000 − 1000) × 11% = 990, twice
    expect(p.taxTotal).toBe(1980);
    expect(p.total).toBe(18_000 + 1980);
  });

  it('extracts inclusive tax without changing the total', () => {
    const p = priceOrder(base({ pricesIncludeTax: true, taxRates: [tax('VAT', 1100)] }));
    // 10000 × 1100 / 11100 = 990.99 → 991 per line
    expect(p.taxTotal).toBe(1982);
    expect(p.total).toBe(20_000);
  });

  it('shares one extraction between several inclusive rates', () => {
    const one = priceOrder(base({ pricesIncludeTax: true, taxRates: [tax('VAT', 1100)] }));
    const two = priceOrder(base({ pricesIncludeTax: true, taxRates: [tax('State', 500), tax('City', 600)] }));
    expect(two.taxTotal).toBe(one.taxTotal);
    expect(two.taxLines.map((t) => t.amount).reduce((a, b) => a + b, 0)).toBe(one.taxTotal);
  });

  it('taxes shipping only when the rate says so', () => {
    const untaxed = priceOrder(base({ shippingRate: rate(700), taxRates: [tax('VAT', 1100)] }));
    const taxed = priceOrder(base({ shippingRate: rate(700), taxRates: [tax('VAT', 1100, true)] }));
    expect(taxed.taxTotal - untaxed.taxTotal).toBe(77);
    expect(taxed.total).toBe(20_000 + 700 + 2200 + 77);
  });

  it('free shipping removes the shipping charge and reports it separately', () => {
    const p = priceOrder(base({ shippingRate: rate(700), discount: rule({ type: 'free_shipping', value: 0 }) }));
    expect(p.shipping).toBe(700);
    expect(p.shippingDiscount).toBe(700);
    expect(p.discountTotal).toBe(0);
    expect(p.discounts).toEqual([]);
    expect(p.total).toBe(20_000);
  });

  it('charges nothing for shipping when nothing ships', () => {
    const p = priceOrder(base({ lines: [line('x', 1000, 1, { requiresShipping: false })] }));
    expect(p.requiresShipping).toBe(false);
    expect(p.shipping).toBe(0);
  });

  it('reports why a code does not apply instead of applying it', () => {
    const p = priceOrder(base({ discount: rule({ minSubtotal: 30_000 }) }));
    expect(p.discountTotal).toBe(0);
    expect(p.discountError).toBe('Spend $300 to use this code');
  });
});

describe('evaluateDiscount', () => {
  const lines = [
    { id: 'l1', productId: 'ring', collectionIds: ['jewellery'], quantity: 2, unitPrice: 3000, requiresShipping: true },
    { id: 'l2', productId: 'earring', collectionIds: ['jewellery'], quantity: 1, unitPrice: 2000, requiresShipping: true },
    { id: 'l3', productId: 'dress', collectionIds: ['dresses'], quantity: 1, unitPrice: 14_500, requiresShipping: true },
  ];
  const ctx = { now: NOW, currency: 'USD', customerUses: 0 };
  const jewellery = { productIds: [], collectionIds: ['jewellery'] };

  it('buy 2 get 1: the cheapest qualifying unit is the free one', () => {
    const r = evaluateDiscount(rule({ type: 'buy_x_get_y', value: 10_000, buyX: { quantity: 2, targets: jewellery }, getY: { quantity: 1, targets: jewellery }, maxUsesPerOrder: 5 }), lines, ctx);
    expect(r).toEqual({ ok: true, allocations: { l2: 2000 }, amount: 2000, freeShipping: false });
  });

  it('buy X get Y needs enough qualifying units', () => {
    const r = evaluateDiscount(rule({ type: 'buy_x_get_y', value: 10_000, buyX: { quantity: 3, targets: jewellery }, getY: { quantity: 1, targets: jewellery } }), lines, ctx);
    expect(r.ok).toBe(false);
  });

  it('respects start, end, status and limits', () => {
    expect(evaluateDiscount(rule({ startsAt: NOW + 1 }), lines, ctx)).toEqual({ ok: false, reason: 'This code is not active yet' });
    expect(evaluateDiscount(rule({ endsAt: NOW }), lines, ctx)).toEqual({ ok: false, reason: 'This code has expired' });
    expect(evaluateDiscount(rule({ status: 'disabled' }), lines, ctx).ok).toBe(false);
    expect(evaluateDiscount(rule({ usageLimit: 3, usageCount: 3 }), lines, ctx).ok).toBe(false);
    expect(evaluateDiscount(rule({ usageLimitPerCustomer: 1 }), lines, { ...ctx, customerUses: 1 })).toEqual({ ok: false, reason: 'You have already used this code' });
  });

  it('scopes to products or collections', () => {
    const r = evaluateDiscount(rule({ value: 1000, appliesTo: 'products', targets: { productIds: ['dress'], collectionIds: [] } }), lines, ctx);
    expect(r).toEqual({ ok: true, allocations: { l3: 1450 }, amount: 1450, freeShipping: false });
    expect(evaluateDiscount(rule({ appliesTo: 'collections', targets: { productIds: [], collectionIds: ['shoes'] } }), lines, ctx).ok).toBe(false);
  });

  it('minimum quantity counts eligible units', () => {
    const r = evaluateDiscount(rule({ minQuantity: 4, appliesTo: 'collections', targets: jewellery }), lines, ctx);
    expect(r).toEqual({ ok: false, reason: 'Add 1 more item to use this code' });
  });
});
