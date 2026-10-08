import { errorFields, log } from './log';

/**
 * Workers Cache tags. Public catalog responses carry `Cache-Tag`; every write
 * that changes what they show purges the matching tags, globally.
 *
 *   catalog          everything below (settings, menus, pages)
 *   products         any product listing, search, sitemap
 *   product:<id>     one product's page, JSON and availability-derived flags
 *   collections      collection listings
 */
export const TAGS = {
  catalog: 'catalog',
  products: 'products',
  collections: 'collections',
  product: (id: string) => `product:${id}`,
  collection: (id: string) => `collection:${id}`,
};

export const cacheTagHeader = (...tags: string[]) => ({ 'cache-tag': [...new Set(tags)].join(',') });

/**
 * Held at the edge for a minute, then asked afresh.
 *
 * The storefront is read-mostly and the same few URLs are asked for over and
 * over; without a cache every one runs its D1 queries again, and D1's free
 * tier counts rows read (five million a day). A short window answers the great
 * majority from `caches.default` — see `edgeRead` in worker/middleware/core.ts
 * — and touches the database not at all.
 *
 * The window is deliberately short: an admin edit (or a direct change to the
 * database, which purges nothing) shows within a minute, with no tag purge to
 * depend on. `stale-while-revalidate` lets the edge serve the old answer for a
 * breath while it fetches the new one.
 */
export const PUBLIC_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';

/** The part of an execution context background work needs (Hono's and the runtime's both fit). */
export interface BackgroundCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Purge after the response is sent. A failed purge is logged, never fatal. */
export function purge(ctx: BackgroundCtx | undefined, tags: string[]): void {
  if (!ctx || tags.length === 0) return;
  const cache = (ctx as BackgroundCtx & { cache?: { purge(o: { tags: string[] }): Promise<unknown> } }).cache;
  if (!cache) return;
  const unique = [...new Set(tags)];
  ctx.waitUntil(
    (async () => {
      for (let i = 0; i < unique.length; i += 100) {
        try {
          await cache.purge({ tags: unique.slice(i, i + 100) });
        } catch (err) {
          log.warn('cache_purge_failed', { tags: unique.slice(i, i + 100), ...errorFields(err) });
        }
      }
    })(),
  );
}

export const purgeProducts = (ctx: BackgroundCtx | undefined, productIds: string[]) =>
  purge(ctx, [TAGS.products, TAGS.collections, ...productIds.map(TAGS.product)]);
