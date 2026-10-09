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
 * tier counts rows read (five million a day). Workers Caching (`cache.enabled`
 * in wrangler.jsonc) sits in front of the Worker and answers the great
 * majority from this window without running it at all; every admin write
 * purges the tags it touched, so the change shows at once.
 *
 * Do not add a second cache inside the Worker (`caches.default`): purge() only
 * reaches Workers Caching, so an inner copy would hand back the old answer
 * after every save. The window is short so that a direct change to the
 * database, which purges nothing, still shows within a minute.
 */
export const PUBLIC_CACHE = 'public, max-age=0, must-revalidate';

/**
 * Cache headers for a public response, split by audience. Browsers get
 * `max-age=0, must-revalidate`: they ask every time and never show a stale
 * copy (a `stale-while-revalidate` they could see let one page load after a
 * save show the old answer). Cloudflare's own cache reads only
 * `Cloudflare-CDN-Cache-Control` and keeps the answer `edgeSeconds`, purged by
 * tag on every admin write.
 */
export const publicCacheHeaders = (edgeSeconds = 60) => ({
  'cache-control': PUBLIC_CACHE,
  'cloudflare-cdn-cache-control': `max-age=${edgeSeconds}`,
});

/** The part of an execution context background work needs (Hono's and the runtime's both fit). */
export interface BackgroundCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Purge after the response is sent. A failed purge is logged, never fatal. */
export function purge(ctx: BackgroundCtx | undefined, tags: string[]): void {
  if (!ctx || tags.length === 0) return;
  const cache = (ctx as BackgroundCtx & { cache?: { purge(o: { tags: string[] }): Promise<unknown> } }).cache;
  if (!cache) {
    // Workers Caching is off here, so there is nothing to purge — but say so,
    // so a page that stays stale after a save is never a mystery
    log.warn('cache_purge_unavailable', { tags });
    return;
  }
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
