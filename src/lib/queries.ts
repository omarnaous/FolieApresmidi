/**
 * Server state, one hook per read and one per write, all over the contract
 * in shared/api.ts. Components never call fetch themselves.
 */
import { useCallback } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvailabilityDTO,
  CartDTO,
  CollectionDTO,
  LookDTO,
  OrderDTO,
  PageDTO,
  ProductDTO,
  ProductListDTO,
  ProductSort,
  SearchSuggestDTO,
  StoreDTO,
} from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { get } from './api';
import { catalogVersion } from './sync';

/* ── keys ───────────────────────────────────────────────── */

export type ProductQuery = {
  collection?: string;
  q?: string;
  /** A category — the product type — within the collection or the search. */
  type?: string;
  option?: string[];
  available?: '1';
  sort?: ProductSort;
  limit?: number;
  /** '0' to skip the facet counts — the home rails, which do not show them. */
  facets?: '0';
};

export const qk = {
  store: ['store'] as const,
  productList: (q: ProductQuery) => ['products', 'list', q] as const,
  products: (q: ProductQuery) => ['products', 'infinite', q] as const,
  product: (handle: string) => ['product', handle] as const,
  availability: (handle: string) => ['availability', handle] as const,
  look: (handle: string) => ['look', handle] as const,
  collection: (handle: string) => ['collection', handle] as const,
  suggest: (q: string) => ['suggest', q] as const,
  page: (handle: string) => ['page', handle] as const,
  order: (token: string) => ['order', token] as const,
  cart: ['cart'] as const,
};

/** The home grid's request. The preloader asks for the same one, so it warms the grid rather than racing it. */
/**
 * A shelf on the home page: ten pieces, and which side of the house they
 * are from. `accessory` is left out for a shelf that wants both.
 */
export const homeGridQuery = (
  collection: string | null | undefined,
  accessory?: boolean,
): ProductQuery => ({
  collection: collection ?? undefined,
  ...(accessory === undefined ? {} : { accessory: accessory ? '1' : '0' }),
  limit: 10,
  facets: '0', // a rail shows pieces, not facet counts
});

/* ── store & catalog ────────────────────────────────────── */

/**
 * The shop itself: its name, menus, and everything the owner writes on the
 * website management screen. Held for a minute and read again when the tab
 * comes back into focus, so a change saved in the admin shows up on an open
 * page rather than only on the next visit.
 */
export const useStore = () =>
  useQuery({
    queryKey: qk.store,
    // after a save in an admin tab, past the edge's copy to the Worker itself
    queryFn: ({ signal }) => get<StoreDTO>(`/api/store${catalogVersion()}`, undefined, signal),
    staleTime: 60_000,
    // back on this tab: always ask again — the menu, the collections' order and
    // the home copy may have just been changed in the admin in another tab
    refetchOnWindowFocus: 'always',
  });

/** Formats minor units in the store's currency (USD until the store has loaded). */
export function useMoney(): (amount: number) => string {
  const currency = useStore().data?.currency ?? 'USD';
  return useCallback((amount: number) => formatMoney(amount, currency), [currency]);
}

/** One page of products — for the home sections, which never page. */
export const useProductList = (query: ProductQuery, { enabled = true } = {}) =>
  useQuery({
    queryKey: qk.productList(query),
    queryFn: ({ signal }) => get<ProductListDTO>('/api/products', query, signal),
    enabled,
    placeholderData: keepPreviousData,
  });

/**
 * Warm the cache for a product list before it is asked for — the home tabs
 * call this on hover and focus, so the pick itself is served from cache.
 */
export function usePrefetchProductList() {
  const client = useQueryClient();
  return useCallback(
    (query: ProductQuery) =>
      void client.prefetchQuery({
        queryKey: qk.productList(query),
        queryFn: ({ signal }) => get<ProductListDTO>('/api/products', query, signal),
        staleTime: 60_000,
      }),
    [client],
  );
}

export const useProducts = (query: ProductQuery, { enabled = true } = {}) =>
  useInfiniteQuery({
    queryKey: qk.products(query),
    queryFn: ({ pageParam, signal }) =>
      get<ProductListDTO>('/api/products', { ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    placeholderData: keepPreviousData,
  });

export const useProduct = (handle: string | null | undefined) =>
  useQuery({
    queryKey: qk.product(handle ?? ''),
    queryFn: ({ signal }) => get<ProductDTO>(`/api/products/${encodeURIComponent(handle ?? '')}`, undefined, signal),
    enabled: !!handle,
  });

/** Live stock. Never cached, re-read on focus and once a minute while the product page is open and in front. */
export const useAvailability = (handle: string | null | undefined, open: boolean) =>
  useQuery({
    queryKey: qk.availability(handle ?? ''),
    queryFn: ({ signal }) =>
      get<AvailabilityDTO>(`/api/products/${encodeURIComponent(handle ?? '')}/availability`, undefined, signal),
    enabled: !!handle && open,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // a minute is fresh enough for stock, and a backgrounded tab stops polling
    refetchInterval: open ? 60_000 : false,
    refetchIntervalInBackground: false,
  });

/** Shop the look under a product: the owner's pairing, or the store's suggestions. */
export const useLook = (handle: string | null | undefined) =>
  useQuery({
    queryKey: qk.look(handle ?? ''),
    queryFn: ({ signal }) => get<LookDTO>(`/api/products/${encodeURIComponent(handle ?? '')}/look`, undefined, signal),
    enabled: !!handle,
  });

export const useCollection = (handle: string | null | undefined) =>
  useQuery({
    queryKey: qk.collection(handle ?? ''),
    queryFn: ({ signal }) => get<CollectionDTO>(`/api/collections/${encodeURIComponent(handle ?? '')}`, undefined, signal),
    enabled: !!handle,
  });

export const useSuggest = (q: string) => {
  const term = q.trim();
  return useQuery({
    queryKey: qk.suggest(term),
    queryFn: ({ signal }) => get<SearchSuggestDTO>('/api/search/suggest', { q: term }, signal),
    enabled: term.length >= 2,
  });
};

export const usePage = (handle: string | null | undefined) =>
  useQuery({
    queryKey: qk.page(handle ?? ''),
    queryFn: ({ signal }) => get<PageDTO>(`/api/pages/${encodeURIComponent(handle ?? '')}`, undefined, signal),
    enabled: !!handle,
    staleTime: 5 * 60_000,
  });

export const useOrder = (token: string | null | undefined) =>
  useQuery({
    queryKey: qk.order(token ?? ''),
    queryFn: ({ signal }) => get<OrderDTO>(`/api/orders/${encodeURIComponent(token ?? '')}`, undefined, signal),
    enabled: !!token,
  });

/* ── cart ───────────────────────────────────────────────── */

/** The server cart. Writes go through the cart context (src/store/cart.jsx); this is the read both share. */
export const useCartQuery = () =>
  useQuery({
    queryKey: qk.cart,
    queryFn: ({ signal }) => get<CartDTO>('/api/cart', undefined, signal),
  });
