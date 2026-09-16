/**
 * One QueryClient for the whole app, storefront and admin alike.
 *
 * Catalog reads are fresh for 30s and never refetch on focus — stock is the
 * one thing that has to be live, and /availability opts back in on its own.
 * A 4xx is an answer, not a hiccup, so only network and server failures are
 * retried, and only once.
 */
import { QueryClient } from '@tanstack/react-query';
import type { CollectionDTO, ProductDTO } from '../../shared/api';
import { ApiError } from './api';
import { qk } from './queries';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
          return count < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

/**
 * The Worker renders product and collection pages with their data inlined as
 * `<script type="application/json" id="fdm-initial">`. Seeding the cache from
 * it means the overlay opens on the same content the server painted, with no
 * second request.
 */
export function seedInitialData(client: QueryClient): void {
  const el = document.getElementById('fdm-initial');
  if (!el?.textContent) return;
  try {
    const data = JSON.parse(el.textContent) as { product?: ProductDTO; collection?: CollectionDTO };
    if (data.product?.handle) client.setQueryData(qk.product(data.product.handle), data.product);
    if (data.collection?.handle) client.setQueryData(qk.collection(data.collection.handle), data.collection);
  } catch {
    /* a malformed payload only costs a fetch */
  }
}
