import { Hono } from 'hono';
import type { CollectionDTO, ProductDTO } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { escapeHtml } from '../email/templates';
import { cacheTagHeader, TAGS } from '../lib/cache';
import { COOKIES, writeCookie } from '../lib/cookies';
import { sign, unsign } from '../lib/crypto';
import { collectionDTO, listProducts, productByHandle } from '../services/catalog';
import { emailFromToken, unsubscribe } from '../services/newsletter';
import { getSettings, type StoreSettings } from '../services/settings';
import type { AppEnv, Ctx } from '../types';
import { schema } from '../db/client';
import { and, eq } from 'drizzle-orm';

export const seo = new Hono<AppEnv>();

/** CSP for HTML documents: only our own scripts; styles/fonts from Google Fonts. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const pageHeaders = (tags: string[], status = 200) => ({
  'content-type': 'text/html; charset=utf-8',
  // browsers always revalidate the document; the edge keeps it a few minutes
  'cache-control': status === 200 ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' : 'no-store',
  'content-security-policy': PAGE_CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  ...cacheTagHeader(TAGS.catalog, ...tags),
});

/** JSON inside <script> must never be able to close the tag. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

interface Head {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  type: 'website' | 'product';
  jsonLd: unknown[];
  initial: Record<string, unknown> | null;
  noindex?: boolean;
  snapshot: string;
}

async function renderShell(c: Ctx, head: Head, status: number, tags: string[]): Promise<Response> {
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
  const tagsHtml = [
    `<link rel="canonical" href="${escapeHtml(head.canonical)}">`,
    `<meta property="og:type" content="${head.type}">`,
    `<meta property="og:title" content="${escapeHtml(head.title)}">`,
    `<meta property="og:description" content="${escapeHtml(head.description)}">`,
    `<meta property="og:url" content="${escapeHtml(head.canonical)}">`,
    head.image ? `<meta property="og:image" content="${escapeHtml(head.image)}">` : '',
    `<meta name="twitter:card" content="${head.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(head.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(head.description)}">`,
    head.image ? `<meta name="twitter:image" content="${escapeHtml(head.image)}">` : '',
    head.noindex ? '<meta name="robots" content="noindex">' : '',
    ...head.jsonLd.map((j) => `<script type="application/ld+json">${safeJson(j)}</script>`),
    head.initial ? `<script type="application/json" id="fdm-initial">${safeJson(head.initial)}</script>` : '',
    '<style>.prerender{max-width:640px;margin:0 auto;padding:96px 24px;font-family:"Instrument Serif",serif}.prerender img{max-width:100%;height:auto}</style>',
  ].join('');

  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(head.title) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute('content', head.description) })
    .on('head', { element: (el) => void el.append(tagsHtml, { html: true }) })
    .on('#root', { element: (el) => void el.setInnerContent(head.snapshot, { html: true }) })
    .transform(shell);

  return new Response(rewritten.body, { status, headers: pageHeaders(tags, status) });
}

const absolute = (c: Ctx, path: string) => `${c.env.APP_URL.replace(/\/$/, '')}${path}`;

function productJsonLd(c: Ctx, p: ProductDTO, s: StoreSettings) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.title,
      description: p.description || undefined,
      image: p.images.map((m) => absolute(c, `${m.url}?w=1400`)),
      sku: p.variants[0]?.sku ?? undefined,
      brand: { '@type': 'Brand', name: p.vendor || s.name },
      category: p.productType || undefined,
      offers: p.variants.map((v) => ({
        '@type': 'Offer',
        url: absolute(c, `/products/${p.handle}`),
        priceCurrency: s.currency,
        price: (v.price / 100).toFixed(2),
        availability: v.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        sku: v.sku ?? undefined,
        name: v.title || undefined,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: s.name, item: absolute(c, '/') },
        ...(p.collections[0] ? [{ '@type': 'ListItem', position: 2, name: p.collections[0].title, item: absolute(c, `/collections/${p.collections[0].handle}`) }] : []),
        { '@type': 'ListItem', position: p.collections[0] ? 3 : 2, name: p.title, item: absolute(c, `/products/${p.handle}`) },
      ],
    },
  ];
}

seo.get('/products/:handle', async (c) => {
  const db = c.get('db');
  const [product, settings] = await Promise.all([productByHandle(db, c.req.param('handle')), getSettings(db)]);
  if (!product) {
    return renderShell(c, { title: `Not found — ${settings.name}`, description: '', canonical: absolute(c, '/'), image: null, type: 'website', jsonLd: [], initial: null, noindex: true, snapshot: '' }, 404, []);
  }
  const title = `${product.seo.title} — ${settings.name}`;
  const image = product.images[0] ? absolute(c, `${product.images[0].url}?w=1400`) : null;
  const snapshot = `<main class="prerender"><p>${escapeHtml(product.productType)}</p><h1>${escapeHtml(product.title)}</h1><p>${escapeHtml(formatMoney(product.price, settings.currency))}</p>${
    product.images[0] ? `<img src="${escapeHtml(`${product.images[0].url}?w=960`)}" alt="${escapeHtml(product.images[0].alt || product.title)}">` : ''
  }<div>${product.descriptionHtml}</div></main>`;
  return renderShell(
    c,
    { title, description: product.seo.description, canonical: absolute(c, `/products/${product.handle}`), image, type: 'product', jsonLd: productJsonLd(c, product, settings), initial: { product }, snapshot },
    200,
    [TAGS.product(product.id)],
  );
});

seo.get('/collections/:handle', async (c) => {
  const db = c.get('db');
  const settings = await getSettings(db);
  const handle = c.req.param('handle');
  const row =
    handle === 'all'
      ? null
      : await db.select().from(schema.collections).where(and(eq(schema.collections.handle, handle), eq(schema.collections.published, true))).get();
  if (handle !== 'all' && !row) {
    return renderShell(c, { title: `Not found — ${settings.name}`, description: '', canonical: absolute(c, '/'), image: null, type: 'website', jsonLd: [], initial: null, noindex: true, snapshot: '' }, 404, []);
  }
  const collection: CollectionDTO | null = row ? await collectionDTO(db, row) : null;
  const list = await listProducts(db, { collection: row?.handle, options: [], sort: 'featured', offset: 0, limit: 24 });
  const name = collection?.title ?? 'All pieces';
  const canonical = absolute(c, `/collections/${handle}`);
  const snapshot = `<main class="prerender"><h1>${escapeHtml(name)}</h1>${collection?.descriptionHtml ?? ''}<ul>${list.items
    .map((p) => `<li><a href="/products/${escapeHtml(p.handle)}">${escapeHtml(p.title)}</a> — ${escapeHtml(formatMoney(p.price, settings.currency))}</li>`)
    .join('')}</ul></main>`;
  return renderShell(
    c,
    {
      title: `${collection?.seo.title ?? name} — ${settings.name}`,
      description: collection?.seo.description || `${name} from ${settings.name}.`,
      canonical,
      image: list.items[0]?.images[0] ? absolute(c, `${list.items[0].images[0].url}?w=1400`) : null,
      type: 'website',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name,
          url: canonical,
          mainEntity: {
            '@type': 'ItemList',
            itemListElement: list.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: absolute(c, `/products/${p.handle}`), name: p.title })),
          },
        },
      ],
      initial: collection ? { collection } : null,
      snapshot,
    },
    200,
    [TAGS.collections, TAGS.products, ...(row ? [TAGS.collection(row.id)] : [])],
  );
});

seo.get('/pages/:handle', async (c) => {
  const db = c.get('db');
  const settings = await getSettings(db);
  const page = await db.select().from(schema.pages).where(and(eq(schema.pages.handle, c.req.param('handle')), eq(schema.pages.published, true))).get();
  if (!page) {
    return renderShell(c, { title: `Not found — ${settings.name}`, description: '', canonical: absolute(c, '/'), image: null, type: 'website', jsonLd: [], initial: null, noindex: true, snapshot: '' }, 404, []);
  }
  return renderShell(
    c,
    {
      title: `${page.seoTitle || page.title} — ${settings.name}`,
      description: page.seoDescription || '',
      canonical: absolute(c, `/pages/${page.handle}`),
      image: null,
      type: 'website',
      jsonLd: [],
      initial: null,
      snapshot: `<main class="prerender"><h1>${escapeHtml(page.title)}</h1>${page.bodyHtml}</main>`,
    },
    200,
    [`page:${page.id}`],
  );
});

/**
 * The shop's own front page, written for a reader who is not a browser.
 *
 * Everything else here is a page about one thing — a piece, a collection.
 * This is the house itself, so it carries the two things a search engine
 * wants for a shop: who the business is, and how its search works. The
 * address comes off APP_URL, so the same code is right on every domain.
 */
seo.get('/', async (c) => {
  const s = await getSettings(c.get('db'));
  const url = absolute(c, '/');
  const title = `${s.name} — Épicée. Libre.`;
  const description =
    'Luxury prêt-à-porter, designed and produced in limited quantities in Lebanon. Ready-to-wear, jewellery and accessories from Follies d\'Après-Midi, Beirut.';
  const image = absolute(c, '/film/hero-end.jpg');
  const instagram = s.instagram ? `https://instagram.com/${s.instagram.replace(/^@/, '')}` : null;

  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${url}#organization`,
    name: s.name,
    url,
    logo: absolute(c, '/brand/icon-512.png'),
    image,
    description,
    email: s.contactEmail || undefined,
    telephone: s.contactPhone || undefined,
    address: { '@type': 'PostalAddress', addressLocality: 'Beirut', addressCountry: 'LB' },
    sameAs: instagram ? [instagram] : undefined,
  };

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${url}#website`,
    name: s.name,
    url,
    publisher: { '@id': `${url}#organization` },
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${url}search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };

  /* What a crawler reads before the shop has run a line of JavaScript. */
  const snapshot = `<main class="prerender"><h1>${escapeHtml(s.name)}</h1>
<p>${escapeHtml(description)}</p>
<p><a href="/collections/all">The boutique</a></p></main>`;

  return renderShell(
    c,
    { title, description, canonical: url, image, type: 'website', jsonLd: [organization, website], initial: null, snapshot },
    200,
    [],
  );
});

seo.get('/sitemap.xml', async (c) => {
  const d1 = c.env.DB;
  const base = c.env.APP_URL.replace(/\/$/, '');
  const [products, collections, pages] = await d1.batch<{ handle: string; updated_at: number }>([
    d1.prepare(`SELECT handle, updated_at FROM products WHERE status = 'active' ORDER BY position LIMIT 45000`),
    d1.prepare('SELECT handle, updated_at FROM collections WHERE published = 1'),
    d1.prepare('SELECT handle, updated_at FROM pages WHERE published = 1'),
  ]);
  const url = (loc: string, at?: number) => `<url><loc>${escapeHtml(`${base}${loc}`)}</loc>${at ? `<lastmod>${new Date(at).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
    url('/'),
    ...(collections?.results ?? []).map((r) => url(`/collections/${r.handle}`, r.updated_at)),
    ...(products?.results ?? []).map((r) => url(`/products/${r.handle}`, r.updated_at)),
    ...(pages?.results ?? []).map((r) => url(`/pages/${r.handle}`, r.updated_at)),
  ].join('')}</urlset>`;
  return c.body(xml, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600, s-maxage=3600',
    ...cacheTagHeader(TAGS.catalog, TAGS.products, TAGS.collections),
  });
});

seo.get('/robots.txt', (c) => {
  const production = c.env.APP_ENV === 'production';
  const body = production
    ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nDisallow: /unsubscribe/\nDisallow: /orders/\nDisallow: /cart\n\nSitemap: ${c.env.APP_URL.replace(/\/$/, '')}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
  return c.body(body, 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

/**
 * The one-click way off the list, from the foot of every newsletter. One
 * page, no sign-in, no confirmation step — the link itself is the consent,
 * and the address inside it is signed so it cannot be edited.
 */
seo.get('/unsubscribe/:token', async (c) => {
  const email = await emailFromToken(decodeURIComponent(c.req.param('token')), c.env.COOKIE_SECRET);
  const done = email ? await unsubscribe(c.env.DB, email) : false;
  const settings = await getSettings(c.get('db'));
  const title = done ? 'You are off the list.' : 'That link has expired.';
  const line = done
    ? `No more letters to ${escapeHtml(email!)}. Nothing else changes — your orders are untouched.`
    : 'Write to us and we will take you off by hand.';
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)} — ${escapeHtml(settings.name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2ede6;color:#0c0b0a;
font-family:Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;text-align:center;padding:24px}
h1{font-family:'Instrument Serif','Times New Roman',serif;font-size:38px;font-weight:400;margin:0 0 14px}
p{margin:0 0 26px;color:rgba(12,11,10,.8);line-height:1.6;max-width:44ch}
a{color:#0c0b0a;font-size:11px;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;border-bottom:1px solid currentColor;padding-bottom:3px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${line}</p>
${settings.contactEmail && !done ? `<p><a href="mailto:${escapeHtml(settings.contactEmail)}">${escapeHtml(settings.contactEmail)}</a></p>` : ''}
<a href="/">Back to the boutique</a></main></body></html>`;
  return c.body(body, done ? 200 : 404, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': PAGE_CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
});

/** Abandoned-cart links: restore the bag on this device, then open it. */
seo.get('/cart/recover/:token', async (c) => {
  const value = await unsign(decodeURIComponent(c.req.param('token')), c.env.COOKIE_SECRET);
  const cartId = value?.startsWith('r.') ? value.slice(2) : null;
  // a cart from when the store had accounts cannot be restored to a guest
  const cart = cartId
    ? await c.env.DB.prepare(`SELECT id FROM carts WHERE id = ? AND status = 'active' AND customer_id IS NULL`).bind(cartId).first<{ id: string }>()
    : null;
  if (!cart) return c.redirect('/', 302);
  writeCookie(c, COOKIES.cart, await sign(cart.id, c.env.COOKIE_SECRET), { maxAge: 60 * 60 * 24 * 60 });
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  return c.redirect('/cart', 302);
});
