import { Hono } from 'hono';
import type { z } from 'zod';
import { ShippingRateInput, ShippingZoneInput, TaxRateInput, TaxSettingsInput, type ShippingRateDTO, type ShippingZoneDTO, type TaxRateDTO, type TaxSettingsDTO } from '../../../shared/api';
import { purge, TAGS } from '../../lib/cache';
import { invalid, notFound } from '../../lib/errors';
import { ulid } from '../../lib/ids';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { shippingZones, taxRules } from '../../services/checkout';
import { getSettings } from '../../services/settings';
import type { AppEnv, Ctx } from '../../types';

/** Shipping zones & rates, and tax rates. */
export const adminShipping = new Hono<AppEnv>();

const refreshStore = (c: Ctx) => purge(c.executionCtx, [TAGS.catalog]);

const rateDTO = (r: { id: string; name: string; type: ShippingRateDTO['type']; amount: number; minValue: number | null; maxValue: number | null; deliveryEstimate: string | null; active: boolean }): ShippingRateDTO => ({
  id: r.id,
  name: r.name,
  type: r.type,
  amount: r.amount,
  minValue: r.minValue,
  maxValue: r.maxValue,
  deliveryEstimate: r.deliveryEstimate,
  active: r.active,
});

async function zones(d1: D1Database): Promise<ShippingZoneDTO[]> {
  return (await shippingZones(d1)).map((z) => ({ id: z.id, name: z.name, regions: z.regions, rates: z.rates.map(rateDTO) }));
}

const isRegionClash = (err: unknown) => String(err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : err).includes('shipping_zone_regions');

adminShipping.get('/shipping/zones', staffOnly('shipping:write'), async (c) => c.json({ items: await zones(c.env.DB) }));

function regionStatements(d1: D1Database, zoneId: string, regions: z.output<typeof ShippingZoneInput>['regions']) {
  const unique = [...new Map(regions.map((r) => [`${r.countryCode}|${(r.regionCode ?? '').toLowerCase()}`, r])).values()];
  return [
    d1.prepare('DELETE FROM shipping_zone_regions WHERE zone_id = ?').bind(zoneId),
    ...unique.map((r) => d1.prepare('INSERT INTO shipping_zone_regions (id, zone_id, country_code, region_code) VALUES (?, ?, ?, ?)').bind(ulid(), zoneId, r.countryCode, r.regionCode)),
  ];
}

adminShipping.post('/shipping/zones', staffOnly('shipping:write'), json(ShippingZoneInput), async (c) => {
  const input = c.req.valid('json');
  const d1 = c.env.DB;
  const now = Date.now();
  const id = ulid(now);
  try {
    await d1.batch([d1.prepare('INSERT INTO shipping_zones (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(id, input.name, now, now), ...regionStatements(d1, id, input.regions)]);
  } catch (err) {
    if (isRegionClash(err)) throw invalid({ regions: 'One of these countries or regions already belongs to another zone' });
    throw err;
  }
  refreshStore(c);
  await audit(c, 'shipping.zone_created', 'shipping_zone', id, `Created shipping zone "${input.name}"`);
  return c.json((await zones(d1)).find((z) => z.id === id), 201);
});

adminShipping.put('/shipping/zones/:id', staffOnly('shipping:write'), json(ShippingZoneInput), async (c) => {
  const input = c.req.valid('json');
  const d1 = c.env.DB;
  const id = c.req.param('id');
  if (!(await d1.prepare('SELECT id FROM shipping_zones WHERE id = ?').bind(id).first())) throw notFound('Zone not found');
  try {
    await d1.batch([d1.prepare('UPDATE shipping_zones SET name = ?, updated_at = ? WHERE id = ?').bind(input.name, Date.now(), id), ...regionStatements(d1, id, input.regions)]);
  } catch (err) {
    if (isRegionClash(err)) throw invalid({ regions: 'One of these countries or regions already belongs to another zone' });
    throw err;
  }
  refreshStore(c);
  await audit(c, 'shipping.zone_updated', 'shipping_zone', id, `Updated shipping zone "${input.name}"`);
  return c.json((await zones(d1)).find((z) => z.id === id));
});

adminShipping.delete('/shipping/zones/:id', staffOnly('shipping:write'), async (c) => {
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const row = await d1.prepare('SELECT name FROM shipping_zones WHERE id = ?').bind(id).first<{ name: string }>();
  if (!row) throw notFound('Zone not found');
  await d1.batch([
    d1.prepare('DELETE FROM shipping_rates WHERE zone_id = ?').bind(id),
    d1.prepare('DELETE FROM shipping_zone_regions WHERE zone_id = ?').bind(id),
    d1.prepare('DELETE FROM shipping_zones WHERE id = ?').bind(id),
  ]);
  refreshStore(c);
  await audit(c, 'shipping.zone_deleted', 'shipping_zone', id, `Deleted shipping zone "${row.name}"`);
  return c.body(null, 204);
});

type RateIn = z.output<typeof ShippingRateInput>;
const rateValues = (r: RateIn) => [r.name, r.type, r.amount, r.type === 'flat' ? null : r.minValue, r.type === 'flat' ? null : r.maxValue, r.deliveryEstimate, r.active ? 1 : 0];

async function rateById(d1: D1Database, id: string): Promise<ShippingRateDTO | null> {
  for (const z of await zones(d1)) {
    const r = z.rates.find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}

adminShipping.post('/shipping/zones/:id/rates', staffOnly('shipping:write'), json(ShippingRateInput), async (c) => {
  const d1 = c.env.DB;
  const zoneId = c.req.param('id');
  if (!(await d1.prepare('SELECT id FROM shipping_zones WHERE id = ?').bind(zoneId).first())) throw notFound('Zone not found');
  const r = c.req.valid('json');
  const now = Date.now();
  const id = ulid(now);
  await d1
    .prepare(
      `INSERT INTO shipping_rates (id, zone_id, name, type, amount, min_value, max_value, delivery_estimate, active, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM shipping_rates WHERE zone_id = ?), ?, ?)`,
    )
    .bind(id, zoneId, ...rateValues(r), zoneId, now, now)
    .run();
  refreshStore(c);
  await audit(c, 'shipping.rate_created', 'shipping_rate', id, `Created rate "${r.name}"`);
  return c.json(await rateById(d1, id), 201);
});

adminShipping.put('/shipping/rates/:id', staffOnly('shipping:write'), json(ShippingRateInput), async (c) => {
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const r = c.req.valid('json');
  const res = await d1
    .prepare('UPDATE shipping_rates SET name = ?, type = ?, amount = ?, min_value = ?, max_value = ?, delivery_estimate = ?, active = ?, updated_at = ? WHERE id = ?')
    .bind(...rateValues(r), Date.now(), id)
    .run();
  if (!res.meta.changes) throw notFound('Rate not found');
  refreshStore(c);
  await audit(c, 'shipping.rate_updated', 'shipping_rate', id, `Updated rate "${r.name}"`);
  return c.json(await rateById(d1, id));
});

adminShipping.delete('/shipping/rates/:id', staffOnly('shipping:write'), async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM shipping_rates WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw notFound('Rate not found');
  refreshStore(c);
  await audit(c, 'shipping.rate_deleted', 'shipping_rate', id, 'Deleted a shipping rate');
  return c.body(null, 204);
});

/* ─────────── taxes ─────────── */

async function taxSettings(c: Ctx): Promise<TaxSettingsDTO> {
  const s = await getSettings(c.get('db'));
  const rates: TaxRateDTO[] = (await taxRules(c.env.DB))
    .map(({ id, countryCode, regionCode, name, rateBps, appliesToShipping, active }) => ({ id, countryCode, regionCode, name, rateBps, appliesToShipping, active }))
    .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || (a.regionCode ?? '').localeCompare(b.regionCode ?? '') || a.name.localeCompare(b.name));
  return { pricesIncludeTax: s.pricesIncludeTax, rates };
}

const isTaxClash = (err: unknown) => String(err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : err).includes('tax_rates');

adminShipping.get('/taxes', staffOnly('taxes:write'), async (c) => c.json(await taxSettings(c)));

adminShipping.put('/taxes', staffOnly('taxes:write'), json(TaxSettingsInput), async (c) => {
  const { pricesIncludeTax } = c.req.valid('json');
  await c.env.DB.prepare('UPDATE store_settings SET prices_include_tax = ?, updated_at = ? WHERE id = 1').bind(pricesIncludeTax ? 1 : 0, Date.now()).run();
  refreshStore(c);
  await audit(c, 'taxes.updated', 'settings', null, `Prices ${pricesIncludeTax ? 'include' : 'exclude'} tax`);
  return c.json(await taxSettings(c));
});

type TaxIn = z.output<typeof TaxRateInput>;
const taxValues = (t: TaxIn) => [t.countryCode, t.regionCode, t.name, t.rateBps, t.appliesToShipping ? 1 : 0, t.active ? 1 : 0];

adminShipping.post('/taxes/rates', staffOnly('taxes:write'), json(TaxRateInput), async (c) => {
  const t = c.req.valid('json');
  const now = Date.now();
  const id = ulid(now);
  try {
    await c.env.DB.prepare('INSERT INTO tax_rates (id, country_code, region_code, name, rate_bps, applies_to_shipping, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ...taxValues(t), now, now)
      .run();
  } catch (err) {
    if (isTaxClash(err)) throw invalid({ name: 'A rate with this name already exists for that country/region' });
    throw err;
  }
  await audit(c, 'taxes.rate_created', 'tax_rate', id, `Created tax rate ${t.name} (${t.countryCode})`);
  return c.json((await taxSettings(c)).rates.find((r) => r.id === id), 201);
});

adminShipping.put('/taxes/rates/:id', staffOnly('taxes:write'), json(TaxRateInput), async (c) => {
  const t = c.req.valid('json');
  const id = c.req.param('id');
  try {
    const res = await c.env.DB.prepare('UPDATE tax_rates SET country_code = ?, region_code = ?, name = ?, rate_bps = ?, applies_to_shipping = ?, active = ?, updated_at = ? WHERE id = ?')
      .bind(...taxValues(t), Date.now(), id)
      .run();
    if (!res.meta.changes) throw notFound('Tax rate not found');
  } catch (err) {
    if (isTaxClash(err)) throw invalid({ name: 'A rate with this name already exists for that country/region' });
    throw err;
  }
  await audit(c, 'taxes.rate_updated', 'tax_rate', id, `Updated tax rate ${t.name} (${t.countryCode})`);
  return c.json((await taxSettings(c)).rates.find((r) => r.id === id));
});

adminShipping.delete('/taxes/rates/:id', staffOnly('taxes:write'), async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM tax_rates WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw notFound('Tax rate not found');
  await audit(c, 'taxes.rate_deleted', 'tax_rate', id, 'Deleted a tax rate');
  return c.body(null, 204);
});
