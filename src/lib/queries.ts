/**
 * Server state, one hook per read and one per write, all over the contract
 * in shared/api.ts. Components never call fetch themselves.
 */
import { useCallback } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AvailabilityDTO,
  CartDTO,
  CollectionDTO,
  CustomerDTO,
  OrderDTO,
  OrderSummaryDTO,
  Page,
  PageDTO,
  ProductDTO,
  ProductListDTO,
  ProductSort,
  SavedAddressDTO,
  SearchSuggestDTO,
  SessionDTO,
  StoreDTO,
} from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { del, get, patch, post } from './api';

/* ── keys ───────────────────────────────────────────────── */

export type ProductQuery = {
  collection?: string;
  q?: string;
  option?: string[];
  available?: '1';
  sort?: ProductSort;
  limit?: number;
};

export const qk = {
  store: ['store'] as const,
  productList: (q: ProductQuery) => ['products', 'list', q] as const,
  products: (q: ProductQuery) => ['products', 'infinite', q] as const,
  product: (handle: string) => ['product', handle] as const,
  availability: (handle: string) => ['availability', handle] as const,
  related: (handle: string) => ['related', handle] as const,
  collection: (handle: string) => ['collection', handle] as const,
  suggest: (q: string) => ['suggest', q] as const,
  page: (handle: string) => ['page', handle] as const,
  order: (token: string) => ['order', token] as const,
  session: ['session'] as const,
  cart: ['cart'] as const,
  account: ['account'] as const,
  accountOrders: ['account', 'orders'] as const,
  accountOrder: (number: string) => ['account', 'order', number] as const,
  addresses: ['account', 'addresses'] as const,
  wishlist: ['account', 'wishlist'] as const,
};

/** The home grid's request. The preloader asks for the same one, so it warms the grid rather than racing it. */
export const homeGridQuery = (collection: string | null | undefined): ProductQuery => ({
  collection: collection ?? undefined,
  limit: 10,
});

/* ── store & catalog ────────────────────────────────────── */

export const useStore = () =>
  useQuery({
    queryKey: qk.store,
    queryFn: ({ signal }) => get<StoreDTO>('/api/store', undefined, signal),
    staleTime: 10 * 60_000,
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

/** Live stock. Never cached, re-read on focus and every 30s while the product page is open. */
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
    refetchInterval: open ? 30_000 : false,
  });

export const useRelated = (handle: string | null | undefined) =>
  useQuery({
    queryKey: qk.related(handle ?? ''),
    queryFn: ({ signal }) =>
      get<{ items: ProductDTO[] }>(`/api/products/${encodeURIComponent(handle ?? '')}/related`, undefined, signal),
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

/* ── session & auth ─────────────────────────────────────── */

export const useSession = () =>
  useQuery({
    queryKey: qk.session,
    queryFn: ({ signal }) => get<SessionDTO>('/api/auth/session', undefined, signal),
    staleTime: 5 * 60_000,
  });

/**
 * Who is signed in changed: the cart may have merged, and nothing read for
 * the previous customer may be shown to the next one. Account reads are
 * dropped rather than refetched — they only mount for a signed-in customer,
 * and fetch afresh when they do.
 */
function afterSessionChange(client: QueryClient) {
  void client.invalidateQueries({ queryKey: qk.cart });
  client.removeQueries({ queryKey: qk.account });
}

function useSessionMutation<I>(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => post<SessionDTO>(path, input),
    onSuccess: (session) => {
      client.setQueryData(qk.session, session);
      afterSessionChange(client);
    },
  });
}

export const useLogin = () => useSessionMutation<{ email: string; password: string }>('/api/auth/login');
export const useRegister = () =>
  useSessionMutation<{ email: string; password: string; name: string; acceptsMarketing: boolean }>('/api/auth/register');
export const useResetPassword = () => useSessionMutation<{ token: string; password: string }>('/api/auth/reset-password');
export const useVerifyEmail = () => useSessionMutation<{ token: string }>('/api/auth/verify-email');

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => post<void>('/api/auth/logout'),
    onSuccess: () => {
      client.setQueryData<SessionDTO>(qk.session, (s) => (s ? { ...s, customer: null } : s));
      // a fresh read hands back a CSRF token for the anonymous session
      void client.invalidateQueries({ queryKey: qk.session });
      afterSessionChange(client);
    },
  });
}

export const useForgotPassword = () =>
  useMutation({ mutationFn: (input: { email: string }) => post<void>('/api/auth/forgot-password', input) });

export const useResendVerification = () =>
  useMutation({ mutationFn: () => post<void>('/api/auth/resend-verification') });

/* ── account ────────────────────────────────────────────── */

export function useUpdateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; phone?: string | null; acceptsMarketing?: boolean }) =>
      patch<CustomerDTO>('/api/account', input),
    onSuccess: (customer) => {
      client.setQueryData<SessionDTO>(qk.session, (s) => (s ? { ...s, customer } : s));
    },
  });
}

export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => post<void>('/api/account/password', input),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.session }),
  });
}

export const useAccountOrders = ({ enabled = true } = {}) =>
  useInfiniteQuery({
    queryKey: qk.accountOrders,
    queryFn: ({ pageParam, signal }) =>
      get<Page<OrderSummaryDTO>>('/api/account/orders', { cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

export const useAccountOrder = (number: string | null | undefined) =>
  useQuery({
    queryKey: qk.accountOrder(number ?? ''),
    queryFn: ({ signal }) => get<OrderDTO>(`/api/account/orders/${encodeURIComponent(number ?? '')}`, undefined, signal),
    enabled: !!number,
  });

export const useAddresses = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: qk.addresses,
    queryFn: ({ signal }) => get<{ items: SavedAddressDTO[] }>('/api/account/addresses', undefined, signal),
    enabled,
  });

export type SavedAddressBody = Omit<SavedAddressDTO, 'id'>;

export function useSaveAddress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SavedAddressBody }) =>
      id
        ? patch<SavedAddressDTO>(`/api/account/addresses/${encodeURIComponent(id)}`, input)
        : post<SavedAddressDTO>('/api/account/addresses', input),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.addresses }),
  });
}

export function useDeleteAddress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/api/account/addresses/${encodeURIComponent(id)}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.addresses }),
  });
}

export const useWishlist = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: qk.wishlist,
    queryFn: ({ signal }) => get<{ items: ProductDTO[] }>('/api/account/wishlist', undefined, signal),
    enabled,
  });

/** Save or unsave a piece; the list updates at once and settles against the server. */
export function useWishlistToggle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ product, saved }: { product: ProductDTO; saved: boolean }) =>
      saved
        ? del<void>(`/api/account/wishlist/${encodeURIComponent(product.id)}`)
        : post<void>('/api/account/wishlist', { productId: product.id }),
    onMutate: async ({ product, saved }) => {
      await client.cancelQueries({ queryKey: qk.wishlist });
      const before = client.getQueryData<{ items: ProductDTO[] }>(qk.wishlist);
      if (before) {
        client.setQueryData(qk.wishlist, {
          items: saved ? before.items.filter((p) => p.id !== product.id) : [product, ...before.items],
        });
      }
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.before) client.setQueryData(qk.wishlist, ctx.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.wishlist }),
  });
}
