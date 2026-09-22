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
 * Not cached anywhere. The shop is asked afresh on every request, by the
 * browser and by the edge alike.
 *
 * It used to be held at the edge for five minutes and purged by tag on every
 * write. That is faster and cheaper, but a direct change to the database —
 * which is how this shop is often changed — purges nothing, so the site went
 * on serving what it had until the five minutes were up. Correct beats quick
 * at this size: a shop selling a few dozen pieces a day is nowhere near the
 * volume where the edge cache earns its confusion.
 */
export const PUBLIC_CACHE = 'no-store';

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
