import { Hono } from 'hono';
import { ProductListQuery, SubscribeInput, type CollectionDTO, type MenuItemDTO, type PageDTO, type StoreDTO, type SubscribeResultDTO } from '../../shared/api';
import { cacheTagHeader, PUBLIC_CACHE, TAGS } from '../lib/cache';
import { notFound } from '../lib/errors';
import { json, query } from '../lib/validate';
import { clientIp, limit } from '../middleware/rate-limit';
import { paymentMethods } from '../payments/registry';
import { availability, collectionDTO, decodeCursor, listProducts, parseOptionFilters, productByHandle, shopTheLook, suggest } from '../services/catalog';
import { shipsTo } from '../services/checkout';
import { homeDTO, readHome } from '../services/home';
import { offerPhrase } from '../services/newsletter';
import { mediaById } from '../services/media';
import { getSettings, readSizeChart } from '../services/settings';
import type { AppEnv } from '../types';
import { schema } from '../db/client';
import { and, asc, eq } from 'drizzle-orm';

export const store = new Hono<AppEnv>();

const publicHeaders = (...tags: string[]) => ({ 'cache-control': PUBLIC_CACHE, ...cacheTagHeader(TAGS.catalog, ...tags) });

store.get('/store', async (c) => {
  const db = c.get('db');
  const s = await getSettings(db);
  const policies = await db
    .select({ handle: schema.pages.handle, title: schema.pages.title })
    .from(schema.pages)
    .where(and(eq(schema.pages.kind, 'policy'), eq(schema.pages.published, true)))
    .orderBy(asc(schema.pages.title))
    .all();

  /* The categories are the available collections, named after themselves and
     in the order the collections screen set; anything the owner has not
     ordered yet falls in alphabetically at the end. "All" always stands first. */
  const live = await db
    .select({ handle: schema.collections.handle, title: schema.collections.title })
    .from(schema.collections)
    .where(eq(schema.collections.published, true))
    .all();
  const order = new Map(s.menu.flatMap((m, i) => (m.collectionHandle ? [[m.collectionHandle, i] as const] : [])));
  const menu: MenuItemDTO[] = [
    { label: 'All', collectionHandle: null },
    ...live
      .sort((a, b) => (order.get(a.handle) ?? 999) - (order.get(b.handle) ?? 999) || a.title.localeCompare(b.title))
      .map((cl) => ({ label: cl.title, collectionHandle: cl.handle })),
  ];
  const body: StoreDTO = {
    name: s.name,
    currency: s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    contact: { email: s.contactEmail, phone: s.contactPhone, instagram: s.instagram },
    logo: s.logoMediaId ? await mediaById(db, s.logoMediaId) : null,
    menu,
    featuredCollectionHandle: s.featuredCollectionHandle,
    lookbookCollectionHandle: s.lookbookCollectionHandle,
    editorialCollectionHandle: s.editorialCollectionHandle,
    policies,
    paymentMethods: paymentMethods(c.env),
    shipsTo: await shipsTo(c.env.DB),
    lowStockThreshold: s.lowStockThreshold,
    home: await homeDTO(c.env.DB, readHome(s.homeJson)),
    sizeChart: readSizeChart(s.sizeChartJson),
    newsletterOffer: await offerPhrase(c.env.DB, s.newsletterWelcomeCode, s.currency),
  };
  return c.json(body, 200, publicHeaders(TAGS.collections));
});

store.get('/products', query(ProductListQuery), async (c) => {
  const q = c.req.valid('query');
  const result = await listProducts(c.get('db'), {
    collection: q.collection,
    q: q.q || undefined,
    tag: q.tag,
    type: q.type,
    options: parseOptionFilters(c.req.queries('option') ?? []),
    min: q.min,
    max: q.max,
    available: q.available === '1' || q.available === 'true',
    // absent means both: the catalogue lists everything the house sells
    accessory: q.accessory === undefined ? undefined : q.accessory === '1' || q.accessory === 'true',
    sort: q.sort ?? (q.q ? 'relevance' : 'featured'),
    offset: decodeCursor(q.cursor),
    limit: q.limit,
  });
  return c.json(result, 200, publicHeaders(TAGS.products, TAGS.collections));
});

store.get('/products/:handle', async (c) => {
  const product = await productByHandle(c.get('db'), c.req.param('handle'));
  if (!product) throw notFound('That piece is not in the boutique');
  return c.json(product, 200, publicHeaders(TAGS.product(product.id)));
});

store.get('/products/:handle/availability', async (c) => {
  const db = c.get('db');
  const product = await productByHandle(db, c.req.param('handle'));
  if (!product) throw notFound('That piece is not in the boutique');
  const settings = await getSettings(db);
  return c.json(await availability(db, product, settings.lowStockThreshold), 200, { 'cache-control': 'no-store' });
});

store.get('/products/:handle/look', async (c) => {
  const db = c.get('db');
  const product = await productByHandle(db, c.req.param('handle'));
  if (!product) throw notFound('That piece is not in the boutique');
  // tagged with every product: a paired piece changing changes this answer too
  return c.json(await shopTheLook(db, product), 200, publicHeaders(TAGS.products));
});

store.get('/collections', async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(schema.collections).where(eq(schema.collections.published, true)).orderBy(asc(schema.collections.title)).all();
  const items: CollectionDTO[] = [];
  for (const row of rows) items.push(await collectionDTO(db, row));
  return c.json({ items }, 200, publicHeaders(TAGS.collections));
});

store.get('/collections/:handle', async (c) => {
  const db = c.get('db');
  const row = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.handle, c.req.param('handle')), eq(schema.collections.published, true)))
    .get();
  if (!row) throw notFound('Collection not found');
  return c.json(await collectionDTO(db, row), 200, publicHeaders(TAGS.collections, TAGS.collection(row.id)));
});

store.get('/search/suggest', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  return c.json(await suggest(c.get('db'), q), 200, publicHeaders(TAGS.products, TAGS.collections));
});

store.get('/pages/:handle', async (c) => {
  const row = await c
    .get('db')
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.handle, c.req.param('handle')), eq(schema.pages.published, true)))
    .get();
  if (!row) throw notFound('Page not found');
  const body: PageDTO = {
    id: row.id,
    handle: row.handle,
    title: row.title,
    kind: row.kind,
    bodyHtml: row.bodyHtml,
    seo: { title: row.seoTitle || row.title, description: row.seoDescription || '' },
    updatedAt: row.updatedAt,
  };
  return c.json(body, 200, publicHeaders(`page:${row.id}`));
});

store.post('/subscribe', json(SubscribeInput), async (c) => {
  await limit(c, 'RL_AUTH', `subscribe:${clientIp(c)}`);
  const { email } = c.req.valid('json');
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO subscribers (email, customer_id, source, status, created_at, updated_at)
     VALUES (?, (SELECT id FROM customers WHERE email = ?), 'newsletter', 'subscribed', ?, ?)
     ON CONFLICT(email) DO UPDATE SET status = 'subscribed', updated_at = excluded.updated_at`,
  )
    .bind(email, email, now, now)
    .run();

  /* Nothing is emailed for joining, so what joining is worth is handed back
     here, to the page that asked for the address. A code the owner has not
     set — or has since switched off — is worth nothing and is not shown. */
  const s = await getSettings(c.get('db'));
  const offer = await offerPhrase(c.env.DB, s.newsletterWelcomeCode, s.currency);
  const body: SubscribeResultDTO = { code: offer ? s.newsletterWelcomeCode : null, offer };
  return c.json(body);
});
