import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney, toMajorString } from '../../shared/money';
import { burnPasswordCheck, hashPassword, safeEqual, sign, unsign, verifyPassword } from '../../worker/lib/crypto';
import { csvLine, csvRecords, parseCsv } from '../../worker/lib/csv';
import { sniffImage } from '../../worker/lib/images';
import { allocate, divRound } from '../../worker/domain/math';
import { allowedTransitions, canTransition } from '../../worker/domain/order-state';
import { eligibleRates, zoneFor, type RateRule, type ZoneRule } from '../../worker/domain/shipping';
import { taxRatesFor, type TaxRule } from '../../worker/domain/tax';
import { ftsQuery } from '../../worker/services/catalog';
import { ruleSql } from '../../worker/services/collections';

describe('integer money', () => {
  it('rounds half up and allocates exactly', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(0, 7)).toBe(0);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
    const big = allocate(999_999_999_999, [300_000_000_001, 699_999_999_998]);
    expect(big[0]! + big[1]!).toBe(999_999_999_999);
  });

  it('parses and formats without floats', () => {
    expect(parseMoney('145')).toBe(14_500);
    expect(parseMoney('145.5')).toBe(14_550);
    expect(parseMoney('1,450.05')).toBe(145_005);
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('15000', 'LBP')).toBe(15_000);
    expect(toMajorString(14_550)).toBe('145.50');
    expect(formatMoney(14_500)).toBe('$145');
    expect(formatMoney(14_550)).toBe('$145.50');
  });
});

describe('shipping zones and rates', () => {
  const r = (id: string, type: RateRule['type'], amount: number, minValue: number | null, maxValue: number | null): RateRule => ({ id, name: id, type, amount, minValue, maxValue, deliveryEstimate: null, active: true, position: 0 });
  const zones: ZoneRule[] = [
    { id: 'lb', name: 'Lebanon', regions: [{ countryCode: 'LB', regionCode: null }], rates: [] },
    { id: 'beirut', name: 'Beirut', regions: [{ countryCode: 'LB', regionCode: 'Beirut' }], rates: [] },
  ];

  it('prefers a region match over the whole country', () => {
    expect(zoneFor(zones, 'lb', 'beirut')?.id).toBe('beirut');
    expect(zoneFor(zones, 'LB', 'Tripoli')?.id).toBe('lb');
    expect(zoneFor(zones, 'FR', null)).toBeNull();
  });

  it('uses [min, max) ranges so boundaries match exactly one rate', () => {
    const rates = [r('under', 'price', 500, 0, 10_000), r('over', 'price', 0, 10_000, null), r('heavy', 'weight', 900, 2000, null)];
    expect(eligibleRates(rates, { subtotalAfterDiscounts: 9_999, weightGrams: 0 }).map((x) => x.id)).toEqual(['under']);
    expect(eligibleRates(rates, { subtotalAfterDiscounts: 10_000, weightGrams: 2000 }).map((x) => x.id)).toEqual(['over', 'heavy']);
  });
});

describe('tax rates', () => {
  const t = (id: string, regionCode: string | null, name: string, rateBps: number): TaxRule => ({ id, countryCode: 'CA', regionCode, name, rateBps, appliesToShipping: false, active: true });
  it('a region rate replaces the country rate of the same name and adds to others', () => {
    const rates = [t('gst', null, 'GST', 500), t('qc-gst', 'QC', 'GST', 500), t('qst', 'QC', 'QST', 998), t('on-hst', 'ON', 'HST', 1300)];
    expect(taxRatesFor(rates, 'CA', 'qc').map((x) => x.id)).toEqual(['qc-gst', 'qst']);
    expect(taxRatesFor(rates, 'CA', 'BC').map((x) => x.id)).toEqual(['gst']);
  });
});

describe('order lifecycle', () => {
  it('allows cash-on-delivery orders to ship unpaid and be paid later', () => {
    expect(canTransition({ status: 'pending', paymentStatus: 'unpaid' }, 'fulfilled')).toBe(true);
    expect(canTransition({ status: 'delivered', paymentStatus: 'unpaid' }, 'paid')).toBe(true);
    expect(canTransition({ status: 'delivered', paymentStatus: 'paid' }, 'paid')).toBe(false);
  });

  it('never goes backwards or cancels a shipped parcel', () => {
    expect(canTransition({ status: 'shipped', paymentStatus: 'paid' }, 'cancelled')).toBe(false);
    expect(canTransition({ status: 'fulfilled', paymentStatus: 'paid' }, 'pending')).toBe(false);
    expect(allowedTransitions({ status: 'cancelled', paymentStatus: 'unpaid' })).toEqual([]);
  });
});

describe('crypto', () => {
  it('hashes and verifies passwords with a pepper', async () => {
    const hash = await hashPassword('correct horse battery', 'pepper', 1000);
    expect(hash).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect((await verifyPassword('correct horse battery', hash, 'pepper', 1000)).ok).toBe(true);
    expect((await verifyPassword('wrong horse battery', hash, 'pepper', 1000)).ok).toBe(false);
    expect((await verifyPassword('correct horse battery', hash, 'other-pepper', 1000)).ok).toBe(false);
    expect((await verifyPassword('correct horse battery', hash, 'pepper', 2000)).needsRehash).toBe(true);
    await expect(burnPasswordCheck('x', 'pepper', 1000)).resolves.toBeUndefined();
  });

  it('signed values cannot be altered', async () => {
    const signed = await sign('cart_123', 'secret');
    expect(await unsign(signed, 'secret')).toBe('cart_123');
    expect(await unsign(signed.replace('cart_123', 'cart_124'), 'secret')).toBeNull();
    expect(await unsign(signed, 'other')).toBeNull();
    expect(await safeEqual('a', 'a')).toBe(true);
    expect(await safeEqual('a', 'ab')).toBe(false);
  });
});

describe('csv', () => {
  it('handles quotes, commas and newlines inside fields', () => {
    expect(parseCsv('a,b\r\n"x, ""y""","line1\nline2"\n')).toEqual([['a', 'b'], ['x, "y"', 'line1\nline2']]);
    expect(csvRecords('Handle,Title\nh1,T1\n')).toEqual([{ Handle: 'h1', Title: 'T1' }]);
  });

  it('neutralises spreadsheet formulas on export', () => {
    expect(csvLine(['=HYPERLINK("x")', '-12.5', '@cmd'])).toBe(`"'=HYPERLINK(""x"")",-12.5,'@cmd\r\n`);
  });
});

describe('input hardening', () => {
  it('turns shopper text into a safe FTS query', () => {
    expect(ftsQuery('Étagère "top" OR *')).toBe('"étagère"* "top"* "or"*');
    expect(ftsQuery('  ""  ')).toBeNull();
  });

  it('binds every smart-collection value', () => {
    const { sql, params } = ruleSql({ match: 'all', conditions: [{ field: 'title', op: 'contains', value: "50%'; DROP TABLE products;--" }] });
    expect(sql).not.toContain('DROP');
    expect(params[0]).toBe("%50\\%'; drop table products;--%");
    expect(ruleSql({ match: 'all', conditions: [] }).sql).toBe('0');
  });

  it('identifies images by their bytes, not their name', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });
});
