import { keepPreviousData, useInfiniteQuery, useQuery, type QueryKey } from '@tanstack/react-query';
import {
  formatMoney,
  get,
  type AdminCollectionDTO,
  type AdminCustomerDTO,
  type AdminOrderDTO,
  type AdminPageDTO,
  type AdminProductDTO,
  type AdminProductListItemDTO,
  type AdminSessionDTO,
  type CollectionDTO,
  type DashboardDTO,
  type DiscountDTO,
  type Page,
  type Query,
  type SettingsDTO,
  type ShippingZoneDTO,
  type StaffDTO,
  type StoreDTO,
  type TaxSettingsDTO,
} from './contract';

export const qk = {
  root: ['admin'] as const,
  session: ['admin', 'session'] as const,
  store: ['admin', 'store'] as const,
  publicCollections: ['admin', 'public-collections'] as const,
  dashboard: (from: number, to: number) => ['admin', 'dashboard', from, to] as const,
  orders: ['admin', 'orders'] as const,
  orderList: (q: Query) => ['admin', 'orders', 'list', q] as const,
  order: (id: string) => ['admin', 'orders', 'detail', id] as const,
  products: ['admin', 'products'] as const,
  productList: (q: Query) => ['admin', 'products', 'list', q] as const,
  product: (id: string) => ['admin', 'products', 'detail', id] as const,
  inventory: (variantId: string) => ['admin', 'products', 'inventory', variantId] as const,
  csvImport: (id: string) => ['admin', 'imports', id] as const,
  media: ['admin', 'media'] as const,
  collections: ['admin', 'collections'] as const,
  collection: (id: string) => ['admin', 'collections', 'detail', id] as const,
  customers: ['admin', 'customers'] as const,
  customerList: (q: Query) => ['admin', 'customers', 'list', q] as const,
  customer: (id: string) => ['admin', 'customers', 'detail', id] as const,
  discounts: ['admin', 'discounts'] as const,
  discount: (id: string) => ['admin', 'discounts', 'detail', id] as const,
  shipping: ['admin', 'shipping'] as const,
  taxes: ['admin', 'taxes'] as const,
  settings: ['admin', 'settings'] as const,
  pages: ['admin', 'pages'] as const,
  page: (id: string) => ['admin', 'pages', 'detail', id] as const,
  staff: ['admin', 'staff'] as const,
  audit: ['admin', 'audit'] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: qk.session,
    queryFn: ({ signal }) => get<AdminSessionDTO>('/api/admin/auth/session', undefined, signal),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

/** Public store info — used for the currency and name without extra permissions. */
export const useStore = () =>
  useQuery({
    queryKey: qk.store,
    queryFn: ({ signal }) => get<StoreDTO>('/api/store', undefined, signal),
    staleTime: 10 * 60_000,
  });

/** Store currency, or undefined while it loads (money inputs wait for it). */
export const useCurrency = (): string | undefined => useStore().data?.currency;

/** Display formatter in the store currency ("—" until the currency is known). */
export function useFormatMoney(): (cents: number) => string {
  const currency = useCurrency();
  return (cents) => (currency ? formatMoney(cents, currency) : '—');
}

/** Public collections (handle + title), for settings selects. */
export const usePublicCollections = () =>
  useQuery({
    queryKey: qk.publicCollections,
    queryFn: ({ signal }) => get<{ items: CollectionDTO[] }>('/api/collections', undefined, signal),
    staleTime: 60_000,
  });

/** Cursor-paged admin list with "Load more". */
export function usePaged<T>(key: QueryKey, path: string, query: Query, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => get<Page<T>>(path, { ...query, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useDashboard = (from: number, to: number) =>
  useQuery({
    queryKey: qk.dashboard(from, to),
    queryFn: ({ signal }) => get<DashboardDTO>('/api/admin/dashboard', { from, to }, signal),
    placeholderData: keepPreviousData,
  });

export const useOrder = (id: string) =>
  useQuery({ queryKey: qk.order(id), queryFn: ({ signal }) => get<AdminOrderDTO>(`/api/admin/orders/${id}`, undefined, signal) });

export const useProduct = (id: string | undefined) =>
  useQuery({
    queryKey: qk.product(id ?? ''),
    queryFn: ({ signal }) => get<AdminProductDTO>(`/api/admin/products/${id}`, undefined, signal),
    enabled: !!id,
  });

export const useCollections = () =>
  useQuery({
    queryKey: qk.collections,
    queryFn: ({ signal }) => get<{ items: AdminCollectionDTO[] }>('/api/admin/collections', undefined, signal),
    select: (d) => d.items,
  });

export type AdminCollectionDetail = AdminCollectionDTO & { products: AdminProductListItemDTO[] };

export const useCollection = (id: string | undefined) =>
  useQuery({
    queryKey: qk.collection(id ?? ''),
    queryFn: ({ signal }) => get<AdminCollectionDetail>(`/api/admin/collections/${id}`, undefined, signal),
    enabled: !!id,
  });

export const useCustomer = (id: string) =>
  useQuery({ queryKey: qk.customer(id), queryFn: ({ signal }) => get<AdminCustomerDTO>(`/api/admin/customers/${id}`, undefined, signal) });

export const useDiscounts = () =>
  useQuery({
    queryKey: qk.discounts,
    queryFn: ({ signal }) => get<{ items: DiscountDTO[] }>('/api/admin/discounts', undefined, signal),
    select: (d) => d.items,
  });

export const useDiscount = (id: string | undefined) =>
  useQuery({
    queryKey: qk.discount(id ?? ''),
    queryFn: ({ signal }) => get<DiscountDTO>(`/api/admin/discounts/${id}`, undefined, signal),
    enabled: !!id,
  });

export const useShippingZones = () =>
  useQuery({
    queryKey: qk.shipping,
    queryFn: ({ signal }) => get<{ items: ShippingZoneDTO[] }>('/api/admin/shipping/zones', undefined, signal),
    select: (d) => d.items,
  });

export const useTaxes = () =>
  useQuery({ queryKey: qk.taxes, queryFn: ({ signal }) => get<TaxSettingsDTO>('/api/admin/taxes', undefined, signal) });

export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: ({ signal }) => get<SettingsDTO>('/api/admin/settings', undefined, signal) });

export const usePages = () =>
  useQuery({
    queryKey: qk.pages,
    queryFn: ({ signal }) => get<{ items: AdminPageDTO[] }>('/api/admin/pages', undefined, signal),
    select: (d) => d.items,
  });

export const usePage = (id: string | undefined) =>
  useQuery({
    queryKey: qk.page(id ?? ''),
    queryFn: ({ signal }) => get<AdminPageDTO>(`/api/admin/pages/${id}`, undefined, signal),
    enabled: !!id,
  });

export const useStaffList = () =>
  useQuery({
    queryKey: qk.staff,
    queryFn: ({ signal }) => get<{ items: StaffDTO[] }>('/api/admin/staff', undefined, signal),
    select: (d) => d.items,
  });
