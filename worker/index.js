/**
 * ─────────────────────────────────────────────────────────────
 *  FDM — the whole backend
 * ─────────────────────────────────────────────────────────────
 *  Cloudflare Worker with static assets: the same origin serves the
 *  built site and the API, so there is no CORS and no second domain.
 *
 *    POST /api/order      place an order        -> orders
 *    POST /api/subscribe  newsletter sign-up    -> subscribers
 *    GET  /api/orders     read them back        (needs ADMIN_KEY)
 *
 *  Prices are never taken from the client. The browser sends product
 *  ids and quantities; the Worker prices them from its own copy of the
 *  catalogue, so a tampered request cannot buy a $185 coat for $1.
 */

import { PRICES } from './catalogue.js';

const MAX_BODY = 16 * 1024; // an order is small; anything larger is noise
const MAX_QTY = 9;
const MAX_LINES = 40;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

const bad = (message, status = 400) => json({ ok: false, error: message }, status);

/** Read a JSON body, refusing anything oversized or malformed. */
async function readJson(request) {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The same rules the form enforces, applied again here. The client check is
 * for the person filling it in; this one is the one that counts.
 */
function checkCustomer(body) {
  const c = {
    name: str(body.name, 120),
    phone: str(body.phone, 40),
    email: str(body.email, 160),
    city: str(body.city, 80),
    area: str(body.area, 200),
    building: str(body.building, 200),
    notes: str(body.notes, 500),
  };
  const bad = {};
  for (const k of ['name', 'phone', 'email', 'city', 'area', 'building']) {
    if (!c[k]) bad[k] = 'Required';
  }
  if (!bad.email && !EMAIL.test(c.email)) bad.email = 'Invalid email';
  if (!bad.phone && c.phone.replace(/\D/g, '').length < 7) bad.phone = 'Invalid phone';
  return { customer: c, bad };
}

/** Price the basket from the Worker's own catalogue, never from the client. */
function priceBasket(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'Your bag is empty' };
  }
  if (rawItems.length > MAX_LINES) return { error: 'Too many items' };

  const items = [];
  let total = 0;
  for (const raw of rawItems) {
    const id = str(raw?.id, 120);
    const price = PRICES[id];
    if (price === undefined) return { error: `Unknown item: ${id || '(none)'}` };
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { error: `Bad quantity for ${id}` };
    }
    const line = price * qty;
    total += line;
    items.push({
      id,
      qty,
      size: str(raw?.size, 60) || 'One size',
      colour: str(raw?.colour, 60) || null,
      unit_cents: price,
      line_cents: line,
    });
  }
  return { items, total };
}

const orderId = () => {
  const d = new Date();
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `FDM-${ymd}-${rand}`;
};

async function placeOrder(request, env) {
  const body = await readJson(request);
  if (!body) return bad('Could not read that request');

  const payment = str(body.payment, 20);
  if (payment !== 'whish' && payment !== 'cod') return bad('Choose how you want to pay');

  const { customer, bad: problems } = checkCustomer(body);
  if (Object.keys(problems).length) return json({ ok: false, fields: problems }, 422);

  const priced = priceBasket(body.items);
  if (priced.error) return bad(priced.error);

  const id = orderId();
  await env.DB.prepare(
    `INSERT INTO orders
       (id, status, payment, total_cents, name, phone, email, city, area, building, notes, items, user_agent)
     VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    payment,
    priced.total,
    customer.name,
    customer.phone,
    customer.email,
    customer.city,
    customer.area,
    customer.building,
    customer.notes || null,
    JSON.stringify(priced.items),
    str(request.headers.get('user-agent'), 300) || null,
  ).run();

  // the sign-up is a side effect of ordering, and must never fail the order
  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, source) VALUES (?, 'order')
         ON CONFLICT(email) DO NOTHING`,
    ).bind(customer.email).run();
  } catch { /* already on the list */ }

  return json({ ok: true, id, total_cents: priced.total, payment });
}

async function subscribe(request, env) {
  const body = await readJson(request);
  if (!body) return bad('Could not read that request');
  const email = str(body.email, 160);
  if (!EMAIL.test(email)) return json({ ok: false, fields: { email: 'Invalid email' } }, 422);

  await env.DB.prepare(
    `INSERT INTO subscribers (email, source) VALUES (?, 'newsletter')
       ON CONFLICT(email) DO NOTHING`,
  ).bind(email).run();

  return json({ ok: true });
}

/** Read orders back. Constant-time-ish compare so the key cannot be probed. */
function authed(request, env) {
  const key = env.ADMIN_KEY;
  if (!key) return false;
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i += 1) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

async function listOrders(request, env) {
  if (!authed(request, env)) return bad('Not allowed', 401);
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 50, 200);
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, payment, total_cents, name, phone, email,
            city, area, building, notes, items
       FROM orders ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return json({
    ok: true,
    orders: results.map((o) => ({ ...o, items: JSON.parse(o.items) })),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const { pathname } = url;
      const method = request.method.toUpperCase();

      try {
        if (pathname === '/api/order' && method === 'POST') return await placeOrder(request, env);
        if (pathname === '/api/subscribe' && method === 'POST') return await subscribe(request, env);
        if (pathname === '/api/orders' && method === 'GET') return await listOrders(request, env);
        if (pathname === '/api/health') return json({ ok: true });
      } catch (err) {
        // never leak a stack to the page; the order is what matters
        console.error('api', pathname, err?.message);
        return bad('Something went wrong on our side', 500);
      }
      return bad('Not found', 404);
    }

    // everything else is the built site
    return env.ASSETS.fetch(request);
  },
};
