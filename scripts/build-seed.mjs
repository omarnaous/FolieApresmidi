#!/usr/bin/env node
/**
 * Build the seed SQL.
 *
 *   node scripts/build-seed.mjs        (npm run db:seed runs this, then applies it locally)
 *
 * seed/catalog.sql  the real catalogue — the 54 pieces pulled from the Shopify
 *                   store (scripts/seed-data/shopify-products.js): products,
 *                   size/colour options, variants, images, collections, the
 *                   exchange policy, a Lebanon shipping zone and store settings.
 *                   Safe for any environment; re-running never overwrites edits.
 *
 * seed/dev.sql      local-only demo data: an owner and a customer account with
 *                   known passwords, discount codes and a month of orders so the
 *                   dashboard has something to show. Never apply it remotely.
 *
 * Images are not copied here: each media row keeps the store's CDN URL and the
 * Worker moves it into R2 the first time it is requested.
 */
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PRODUCTS, CATEGORIES, DROP } from './seed-data/shopify-products.js';

const root = new URL('../', import.meta.url);
const NOW = Date.now();
const DAY = 86_400_000;

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`);
const row = (...values) => `(${values.map(q).join(', ')})`;
/** Deterministic ids: re-running the seed hits the same rows. */
const id = (...parts) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 26).toUpperCase();
const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Swatches for the colour names the store uses. */
const SWATCH = { Brown: '#6b4a34', Green: '#7d8a6a', Blue: '#8fa3bd', Red: '#a52a1e', White: '#f4f1ea', Black: '#1a1a1a' };

/** Hand-picked on the old site (src/data/assets.js). */
const LOOKBOOK = ['mini-robe-rouge', 'stole-my-dads-blazer', 'overall', 'bomber-jacket', 'jupe-etagere', 'bralette-triangle'];
const EDITORIAL = ['zebre', 'bouquet', 'l-heure-defendue'];

/* ═════════════════════════ catalog.sql ═════════════════════════ */

const sql = [];
const add = (s) => sql.push(s.trim().endsWith(';') ? s : `${s};`);

// ── products
PRODUCTS.forEach((p, position) => {
  const pid = id('product', p.id);
  const created = NOW - position * 60_000; // keep the store's order for "newest"
  const html = p.note ? `<p>${escapeHtml(p.note)}</p>` : '';
  add(`INSERT OR IGNORE INTO products (id, handle, title, description_html, description_text, status, product_type, vendor, seo_title, seo_description, position, published_at, created_at, updated_at)
VALUES ${row(pid, p.id, p.name, html, p.note || '', 'active', p.line, null, null, null, position, created, created, NOW)}`);

  const hasSizes = !(p.sizes.length === 1 && p.sizes[0] === 'One size');
  const options = [];
  if (hasSizes) options.push({ name: 'Size', values: p.sizes, pick: (v) => v.size });
  if (p.colours.length) options.push({ name: 'Colour', values: p.colours, pick: (v) => v.colour });

  options.forEach((o, i) => {
    const oid = id('option', p.id, o.name);
    add(`INSERT OR IGNORE INTO product_options (id, product_id, name, position) VALUES ${row(oid, pid, o.name, i)}`);
    o.values.forEach((value, j) =>
      add(`INSERT OR IGNORE INTO product_option_values (id, option_id, value, position, swatch) VALUES ${row(id('value', p.id, o.name, value), oid, value, j, o.name === 'Colour' ? SWATCH[value] ?? null : null)}`),
    );
  });

  p.variants.forEach((v, i) => {
    const opts = options.map((o) => o.pick(v) ?? null);
    const title = opts.filter(Boolean).join(' / ') || 'Default';
    // the store publishes availability, not counts: sample stock of 6 where it sells, 0 where it is sold out
    add(`INSERT OR IGNORE INTO variants (id, product_id, sku, title, option1, option2, option3, price_amount, compare_at_amount, cost_amount, weight_grams, requires_shipping, taxable, inventory_tracked, inventory_policy, inventory_on_hand, media_id, position, created_at, updated_at)
VALUES ${row(id('variant', String(v.id)), pid, null, title, opts[0] ?? null, opts[1] ?? null, null, Math.round(v.price * 100), null, null, 0, true, true, true, 'deny', v.available ? 6 : 0, null, i, created, NOW)}`);
  });

  p.images.forEach((src, i) => {
    const url = src.split('?')[0];
    const ext = (/\.(jpe?g|png|webp)$/i.exec(url)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
    const mid = id('media', p.id, String(i));
    add(`INSERT OR IGNORE INTO media (id, r2_key, source_url, mime, bytes, width, height, alt, created_by, created_at)
VALUES ${row(mid, `products/seed/${p.id}-${i}.${ext}`, `${url}?width=2000`, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', null, null, null, i === 0 ? p.name : `${p.name} — view ${i + 1}`, null, created)}`);
    add(`INSERT OR IGNORE INTO product_media (product_id, media_id, position) VALUES ${row(pid, mid, i)}`);
  });

  for (const tag of [p.line, ...p.colours]) {
    add(`INSERT OR IGNORE INTO tags (id, name) VALUES ${row(id('tag', tag.toLowerCase()), tag)}`);
    add(`INSERT OR IGNORE INTO product_tags (product_id, tag_id) SELECT ${q(pid)}, id FROM tags WHERE lower(name) = lower(${q(tag)})`);
  }
});

// ── collections
const collection = (handle, title, type, rules, description = '') => {
  const cid = id('collection', handle);
  add(`INSERT OR IGNORE INTO collections (id, handle, title, description_html, type, rules_json, sort, image_media_id, published, seo_title, seo_description, created_at, updated_at)
VALUES ${row(cid, handle, title, description, type, JSON.stringify(rules), type === 'manual' ? 'manual' : 'manual', null, true, null, null, NOW, NOW)}`);
  return cid;
};
const manual = (handle, title, handles) => {
  const cid = collection(handle, title, 'manual', { match: 'all', conditions: [] });
  handles.forEach((h, i) => add(`INSERT OR IGNORE INTO collection_products (collection_id, product_id, position) VALUES ${row(cid, id('product', h), i)}`));
};
const smart = (handle, title, types) => {
  const rules = { match: 'any', conditions: types.map((t) => ({ field: 'product_type', op: 'eq', value: t })) };
  const cid = collection(handle, title, 'smart', rules);
  add(`INSERT OR IGNORE INTO collection_products (collection_id, product_id, position)
SELECT ${q(cid)}, p.id, p.position FROM products p WHERE p.product_type IN (${types.map(q).join(', ')})`);
};

manual('echappee-4-a-7', DROP, PRODUCTS.filter((p) => p.drop).map((p) => p.id));
manual('lookbook', 'The lookbook', LOOKBOOK);
manual('editorial', 'Limited edition', EDITORIAL);

const menu = [];
for (const c of CATEGORIES) {
  if (!c.lines) {
    menu.push({ label: c.label, collectionHandle: null });
    continue;
  }
  const handle = slug(c.label);
  smart(handle, c.label, c.lines);
  menu.push({ label: c.label, collectionHandle: handle });
}
for (const line of ['Necklaces', 'Earrings', 'Bracelets']) smart(slug(line), line, [line]);

// ── search index
add(`DELETE FROM products_fts`);
add(`INSERT INTO products_fts (product_id, title, body, tags, options, skus)
SELECT p.id, p.title, p.description_text,
       trim(p.product_type || ' ' || coalesce(p.vendor, '') || ' ' || coalesce((SELECT group_concat(t.name, ' ') FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id), '')),
       coalesce((SELECT group_concat(pov.value, ' ') FROM product_option_values pov JOIN product_options o ON o.id = pov.option_id WHERE o.product_id = p.id), ''),
       coalesce((SELECT group_concat(v.sku, ' ') FROM variants v WHERE v.product_id = p.id AND v.sku IS NOT NULL), '')
  FROM products p`);

// ── store settings (only while still at the migration's defaults)
add(`UPDATE store_settings SET name = ${q("Follies d'Après-Midi")}, currency = 'USD', prices_include_tax = 1,
  contact_email = 'folliesdapresmidi@gmail.com', instagram = 'folliesdapresmidi', address = 'Beirut, Lebanon',
  menu_json = ${q(JSON.stringify(menu))}, featured_collection_handle = 'echappee-4-a-7', lookbook_collection_handle = 'lookbook',
  editorial_collection_handle = 'editorial', low_stock_threshold = 3, checkout_hold_minutes = 15, abandoned_cart_emails = 1, updated_at = ${NOW}
WHERE id = 1 AND updated_at = 0`);

// ── exchange policy (the store's published terms, as the old site quoted them)
add(`INSERT OR IGNORE INTO pages (id, handle, kind, title, body_html, published, seo_title, seo_description, created_at, updated_at)
VALUES ${row(
  id('page', 'exchange-policy'),
  'exchange-policy',
  'policy',
  'Exchange policy',
  '<p>Exchanges within 24 hours of receiving, for a defect or a wrong item or size.</p><p>Pieces must be unworn, unwashed, with tags attached.</p><p>No refunds — exchange only.</p>',
  true,
  null,
  'Exchanges within 24 hours for a defect or a wrong item or size. No refunds — exchange only.',
  NOW,
  NOW,
)}`);

// ── delivery: one zone for Lebanon. The fee is a placeholder — set the real one in Admin → Shipping.
const zone = id('zone', 'lebanon');
add(`INSERT OR IGNORE INTO shipping_zones (id, name, created_at, updated_at) VALUES ${row(zone, 'Lebanon', NOW, NOW)}`);
add(`INSERT OR IGNORE INTO shipping_zone_regions (id, zone_id, country_code, region_code) VALUES ${row(id('region', 'lb'), zone, 'LB', null)}`);
add(`INSERT OR IGNORE INTO shipping_rates (id, zone_id, name, type, amount, min_value, max_value, delivery_estimate, active, position, created_at, updated_at)
VALUES ${row(id('rate', 'lebanon-standard'), zone, 'Delivery in Lebanon', 'flat', 0, null, null, 'We call to confirm before it ships', true, 1, NOW, NOW)}`);

// ── tax: prices already include tax; a VAT rate is prepared but off until the store confirms it
add(`INSERT OR IGNORE INTO tax_rates (id, country_code, region_code, name, rate_bps, applies_to_shipping, active, created_at, updated_at)
VALUES ${row(id('tax', 'lb-vat'), 'LB', null, 'VAT', 1100, false, false, NOW, NOW)}`);

/* ═════════════════════════ dev.sql ═════════════════════════ */

async function readDevVars() {
  try {
    const text = await readFile(new URL('.dev.vars', root), 'utf8');
    return Object.fromEntries(text.split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  } catch {
    return {};
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Same scheme as worker/lib/crypto.ts: PBKDF2-SHA256(HMAC-SHA256(pepper, password)). */
async function hashPassword(password, pepper, iterations = 100_000) {
  const subtle = webcrypto.subtle;
  const hmacKey = await subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = new Uint8Array(await subtle.sign('HMAC', hmacKey, new TextEncoder().encode(password.normalize('NFKC'))));
  const key = await subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const salt = randomBytes(16);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

const DEV_OWNER = { email: 'owner@fdm.test', password: 'fdm-owner-local-2026' };
const DEV_CUSTOMER = { email: 'customer@fdm.test', password: 'fdm-customer-local-2026' };

async function buildDev() {
  const vars = await readDevVars();
  const out = [];
  const put = (s) => out.push(s.trim().endsWith(';') ? s : `${s};`);
  if (!vars.PASSWORD_PEPPER) {
    console.warn('! .dev.vars has no PASSWORD_PEPPER — dev accounts are skipped (copy .dev.vars.example first)');
  } else {
    const iterations = Number(vars.PASSWORD_ITERATIONS) || 100_000;
    put(`INSERT OR IGNORE INTO staff_users (id, email, password_hash, name, role, permissions_json, status, session_epoch, last_login_at, created_at, updated_at)
VALUES ${row(id('staff', DEV_OWNER.email), DEV_OWNER.email, await hashPassword(DEV_OWNER.password, vars.PASSWORD_PEPPER, iterations), 'Local Owner', 'owner', '[]', 'active', 0, null, NOW, NOW)}`);
    put(`INSERT OR IGNORE INTO customers (id, email, password_hash, name, phone, email_verified_at, accepts_marketing, session_epoch, note, orders_count, total_spent_amount, last_order_at, created_at, updated_at)
VALUES ${row(id('customer', DEV_CUSTOMER.email), DEV_CUSTOMER.email, await hashPassword(DEV_CUSTOMER.password, vars.PASSWORD_PEPPER, iterations), 'Lina Haddad', '+961 3 000 000', NOW, true, 0, null, 0, 0, null, NOW - 40 * DAY, NOW)}`);
    put(`INSERT OR IGNORE INTO customer_addresses (id, customer_id, name, phone, line1, line2, city, region, postal_code, country_code, notes, is_default, created_at, updated_at)
VALUES ${row(id('address', DEV_CUSTOMER.email), id('customer', DEV_CUSTOMER.email), 'Lina Haddad', '+961 3 000 000', 'Mar Mikhael, Armenia St.', 'Building 12, 3rd floor', 'Beirut', null, null, 'LB', null, true, NOW, NOW)}`);
  }

  // discount codes to try at checkout
  const discount = (code, title, type, value, extra = {}) =>
    put(`INSERT OR IGNORE INTO discounts (id, code, title, type, value, applies_to, min_subtotal_amount, min_quantity, usage_limit, usage_limit_per_customer, usage_count, buy_quantity, get_quantity, max_uses_per_order, starts_at, ends_at, status, created_at, updated_at)
VALUES ${row(id('discount', code), code, title, type, value, extra.appliesTo ?? 'all', extra.minSubtotal ?? null, null, extra.usageLimit ?? null, extra.perCustomer ?? null, 0, extra.buy ?? null, extra.get ?? null, extra.maxUses ?? null, NOW - DAY, null, 'active', NOW, NOW)}`);
  discount('WELCOME10', '10% off your first order', 'percentage', 1000, { perCustomer: 1 });
  discount('TWENTYOFF', '$20 off orders over $150', 'fixed_amount', 2000, { minSubtotal: 15000 });
  discount('FREESHIP', 'Free delivery', 'free_shipping', 0);
  discount('JEWELLERY3FOR2', 'Buy 2 jewellery pieces, the third is free', 'buy_x_get_y', 10000, { buy: 2, get: 1, maxUses: 1 });
  for (const role of ['buy', 'get']) {
    put(`INSERT OR IGNORE INTO discount_targets (discount_id, target_type, target_id, role) VALUES ${row(id('discount', 'JEWELLERY3FOR2'), 'collection', id('collection', 'jewellery'), role)}`);
  }

  // a month of orders across every status, so the dashboard and order list have data
  const statuses = ['delivered', 'delivered', 'shipped', 'fulfilled', 'paid', 'pending', 'pending', 'cancelled', 'delivered', 'shipped', 'pending', 'delivered'];
  const customerId = id('customer', DEV_CUSTOMER.email);
  let spent = 0;
  statuses.forEach((status, i) => {
    const product = PRODUCTS[(i * 7) % PRODUCTS.length];
    const variant = product.variants.find((v) => v.available) ?? product.variants[0];
    const qty = 1 + (i % 2);
    const unit = Math.round(variant.price * 100);
    const total = unit * qty;
    const placed = NOW - (29 - i * 2.4) * DAY;
    const oid = id('order', String(i));
    const paid = ['paid', 'delivered'].includes(status) || (status === 'shipped' && i % 2 === 0);
    const address = { name: 'Lina Haddad', phone: '+961 3 000 000', line1: 'Mar Mikhael, Armenia St.', line2: 'Building 12, 3rd floor', city: 'Beirut', region: null, postalCode: null, countryCode: 'LB', notes: null };
    const pricing = { currency: 'USD', subtotal: total, discountTotal: 0, discounts: [], shipping: 0, shippingDiscount: 0, taxTotal: 0, taxLines: [], pricesIncludeTax: true, total };
    if (status !== 'cancelled') spent += total;
    put(`INSERT OR IGNORE INTO orders (id, number, checkout_id, customer_id, email, phone, status, payment_status, provider, provider_ref, currency, subtotal_amount, discount_amount, shipping_amount, shipping_discount_amount, tax_amount, total_amount, refunded_amount, prices_include_tax, pricing_json, shipping_address_json, shipping_method, discount_codes_json, note, access_token_hash, user_agent, cancel_reason, cancelled_at, placed_at, updated_at)
VALUES ${row(oid, 1001 + i, null, customerId, DEV_CUSTOMER.email, '+961 3 000 000', status, paid ? 'paid' : 'unpaid', 'cod', `cod_seed_${i}`, 'USD', total, 0, 0, 0, 0, total, 0, true, JSON.stringify(pricing), JSON.stringify(address), 'Delivery in Lebanon', '[]', null, createHash('sha256').update(`seed-order-${i}-${randomBytes(8).toString('hex')}`).digest('hex'), 'seed', status === 'cancelled' ? 'Customer changed their mind' : null, status === 'cancelled' ? placed + DAY : null, Math.round(placed), NOW)}`);
    put(`INSERT OR IGNORE INTO order_lines (id, order_id, product_id, variant_id, product_handle, title, variant_title, sku, media_id, quantity, unit_price_amount, discount_amount, tax_amount, total_amount, requires_shipping, inventory_tracked, fulfilled_quantity, refunded_quantity, restocked_quantity)
VALUES ${row(id('order-line', String(i)), oid, id('product', product.id), id('variant', String(variant.id)), product.id, product.name, [variant.size === 'One size' ? null : variant.size, variant.colour].filter(Boolean).join(' / '), null, id('media', product.id, '0'), qty, unit, 0, 0, total, true, true, ['fulfilled', 'shipped', 'delivered'].includes(status) ? qty : 0, 0, status === 'cancelled' ? qty : 0)}`);
    put(`INSERT OR IGNORE INTO order_events (id, order_id, type, from_status, to_status, actor_type, actor_id, message, data_json, customer_visible, created_at)
VALUES ${row(id('event', String(i), 'placed'), oid, 'order_placed', null, 'pending', 'customer', customerId, 'Order placed — we will call to confirm', null, true, Math.round(placed))}`);
    if (status !== 'pending') {
      put(`INSERT OR IGNORE INTO order_events (id, order_id, type, from_status, to_status, actor_type, actor_id, message, data_json, customer_visible, created_at)
VALUES ${row(id('event', String(i), status), oid, 'status_changed', 'pending', status, 'system', null, `Seeded as ${status}`, null, true, Math.round(placed + DAY / 2))}`);
    }
    put(`INSERT OR IGNORE INTO payments (id, order_id, checkout_id, provider, kind, status, amount, currency, provider_ref, error_code, created_at, updated_at)
VALUES ${row(id('payment', String(i)), oid, null, 'cod', 'sale', paid ? 'succeeded' : status === 'cancelled' ? 'failed' : 'pending', total, 'USD', `cod_seed_${i}`, null, Math.round(placed), NOW)}`);
    if (['fulfilled', 'shipped', 'delivered'].includes(status)) {
      put(`INSERT OR IGNORE INTO fulfillments (id, order_id, status, carrier, tracking_number, tracking_url, shipped_at, delivered_at, created_at, updated_at)
VALUES ${row(id('fulfillment', String(i)), oid, status, status === 'fulfilled' ? null : 'Courier', status === 'fulfilled' ? null : `LB${100200 + i}`, null, status === 'fulfilled' ? null : Math.round(placed + DAY), status === 'delivered' ? Math.round(placed + 2 * DAY) : null, Math.round(placed + DAY / 2), NOW)}`);
    }
  });
  put(`UPDATE customers SET orders_count = ${statuses.length}, total_spent_amount = ${spent}, last_order_at = ${NOW - DAY} WHERE id = ${q(customerId)}`);
  put(`UPDATE order_counters SET next_number = max(next_number, ${1001 + statuses.length}) WHERE id = 1`);
  return out;
}

await mkdir(new URL('seed/', root), { recursive: true });
await writeFile(new URL('seed/catalog.sql', root), `-- GENERATED by scripts/build-seed.mjs — do not edit\n${sql.join('\n')}\n`);
const dev = await buildDev();
await writeFile(new URL('seed/dev.sql', root), `-- GENERATED by scripts/build-seed.mjs — LOCAL DEVELOPMENT ONLY\n${dev.join('\n')}\n`);

console.log(`seed/catalog.sql — ${PRODUCTS.length} products, ${PRODUCTS.reduce((n, p) => n + p.variants.length, 0)} variants, ${PRODUCTS.reduce((n, p) => n + p.images.length, 0)} images`);
console.log(`seed/dev.sql     — local owner ${DEV_OWNER.email} / ${DEV_OWNER.password}`);
console.log(`                   local customer ${DEV_CUSTOMER.email} / ${DEV_CUSTOMER.password}`);
console.log('                   codes WELCOME10, TWENTYOFF, FREESHIP, JEWELLERY3FOR2');
