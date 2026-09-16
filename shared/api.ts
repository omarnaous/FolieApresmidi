/**
 * ─────────────────────────────────────────────────────────────
 *  FDM API CONTRACT
 * ─────────────────────────────────────────────────────────────
 *  The single source of truth shared by the Worker (worker/) and the
 *  browser (src/). Input schemas are Zod — the Worker validates every
 *  request with them, and forms can reuse them. Response shapes are
 *  plain TypeScript types.
 *
 *  Conventions
 *    Money        integer minor units (cents). Never floats.
 *    Timestamps   unix milliseconds.
 *    Rates        basis points (11% = 1100).
 *    Errors       non-2xx → ApiErrorBody.
 *    Lists        Page<T> with an opaque `nextCursor`.
 *    Writes       need the `x-csrf-token` header (src/lib/api.ts does it).
 */
import { z } from 'zod';

/* ═══════════════════════ enums ═══════════════════════ */

export const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'partially_refunded', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STAFF_ROLES = ['owner', 'admin', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'dashboard:read',
  'products:read', 'products:write',
  'orders:read', 'orders:write', 'orders:refund',
  'customers:read', 'customers:write',
  'discounts:read', 'discounts:write',
  'shipping:write', 'taxes:write',
  'settings:write', 'pages:write',
  'staff:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const SHIPPING_RATE_TYPES = ['flat', 'weight', 'price'] as const;
export type ShippingRateType = (typeof SHIPPING_RATE_TYPES)[number];

export const COLLECTION_RULE_FIELDS = ['tag', 'product_type', 'vendor', 'title', 'price', 'in_stock'] as const;
export type CollectionRuleField = (typeof COLLECTION_RULE_FIELDS)[number];
export const COLLECTION_RULE_OPS = ['eq', 'neq', 'contains', 'lt', 'gt'] as const;
export type CollectionRuleOp = (typeof COLLECTION_RULE_OPS)[number];

export const COLLECTION_SORTS = ['manual', 'best_selling', 'price_asc', 'price_desc', 'created_desc', 'title_asc'] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export const PRODUCT_SORTS = ['featured', 'relevance', 'price_asc', 'price_desc', 'title_asc', 'created_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const INVENTORY_POLICIES = ['deny', 'continue'] as const;
export type InventoryPolicy = (typeof INVENTORY_POLICIES)[number];

export type Money = number;
export type Timestamp = number;

/* ═══════════════════════ errors & paging ═══════════════════════ */

export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CSRF_FAILED'
  | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'OUT_OF_STOCK' | 'CHECKOUT_EXPIRED'
  | 'DISCOUNT_INVALID' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** field path → human message, for form errors (VALIDATION_FAILED) */
    fields?: Record<string, string>;
    /** e.g. OUT_OF_STOCK → { lines: [{ variantId, available }] } */
    details?: unknown;
    requestId?: string;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/* ═══════════════════════ shared field schemas ═══════════════════════ */

const trimLower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export const zId = z.string().min(1).max(64);
export const zEmail = z.preprocess(trimLower, z.email({ message: 'Enter a valid email' }).max(254));
export const zPassword = z.string().min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters');
export const zName = z.string().trim().min(1, 'Required').max(120);
export const zPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+\d\s().-]*$/, 'Use digits, spaces and + only')
  .refine((v) => v.replace(/\D/g, '').length >= 7, 'That does not look like a phone number');
export const zMoney = z.number().int('Must be a whole number of cents').min(0).max(1_000_000_000);
export const zCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
export const zHandle = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes');
export const zBps = z.number().int().min(0).max(10_000);
export const zTimestamp = z.number().int().min(0);

export const AddressInput = z.object({
  name: zName,
  phone: zPhone,
  line1: z.string().trim().min(1, 'Required').max(200),
  line2: z.string().trim().max(200).default(''),
  city: z.string().trim().min(1, 'Required').max(80),
  region: z.string().trim().max(80).nullish().transform((v) => v || null),
  postalCode: z.string().trim().max(20).nullish().transform((v) => v || null),
  countryCode: zCountry,
  notes: z.string().trim().max(500).nullish().transform((v) => v || null),
});
export type AddressInput = z.infer<typeof AddressInput>;

export interface AddressDTO {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  notes: string | null;
}

/* ═══════════════════════ media ═══════════════════════ */

export interface MediaDTO {
  id: string;
  /** Same-origin path, e.g. `/media/products/01H…/01J….jpg`. Append `?w=640` for a resized copy. */
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Widths the image pipeline serves; other values round up to the next one. */
export const IMAGE_WIDTHS = [320, 640, 960, 1400, 2000] as const;
export const imageSrc = (m: Pick<MediaDTO, 'url'>, width?: number) => (width ? `${m.url}?w=${width}` : m.url);

/* ═══════════════════════ storefront: store & catalog ═══════════════════════ */

export interface PaymentMethodDTO {
  id: string; // 'cod'
  name: string;
  description: string;
}

export interface MenuItemDTO {
  label: string;
  /** null = "All" */
  collectionHandle: string | null;
}

/** GET /api/store */
export interface StoreDTO {
  name: string;
  currency: string;
  pricesIncludeTax: boolean;
  contact: { email: string | null; phone: string | null; instagram: string | null };
  logo: MediaDTO | null;
  /** Category chips, in order. */
  menu: MenuItemDTO[];
  featuredCollectionHandle: string | null;
  lookbookCollectionHandle: string | null;
  editorialCollectionHandle: string | null;
  policies: { handle: string; title: string }[];
  paymentMethods: PaymentMethodDTO[];
  /** Countries that have a shipping zone (checkout country select). */
  shipsTo: { code: string; name: string }[];
  lowStockThreshold: number;
}

export interface ProductOptionDTO {
  name: string; // "Size", "Colour"
  values: { value: string; swatch: string | null }[];
}

export interface VariantDTO {
  id: string;
  sku: string | null;
  title: string; // "Small / Red"
  /** Aligned with product.options: options[i] is the value for product.options[i]. */
  options: string[];
  price: Money;
  compareAtPrice: Money | null;
  /** From the catalog cache — use /availability for live stock. */
  available: boolean;
  imageId: string | null;
}

export interface ProductDTO {
  id: string;
  handle: string;
  title: string;
  /** Plain text (for cards, search, meta). */
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string | null;
  tags: string[];
  price: Money;
  compareAtPrice: Money | null;
  priceRange: { min: Money; max: Money };
  images: MediaDTO[];
  options: ProductOptionDTO[];
  variants: VariantDTO[];
  available: boolean;
  collections: { handle: string; title: string }[];
  seo: { title: string; description: string };
  createdAt: Timestamp;
}

/** GET /api/products/:handle/availability — never cached. */
export interface AvailabilityDTO {
  productId: string;
  variants: { id: string; available: boolean; lowStock: boolean; quantity: number | null }[];
}

export interface CollectionDTO {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  image: MediaDTO | null;
  productsCount: number;
  seo: { title: string; description: string };
}

/** GET /api/products — query params */
export const ProductListQuery = z.object({
  collection: zHandle.optional(),
  q: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(60).optional(),
  type: z.string().trim().max(60).optional(),
  /** repeatable: option=Size:Small&option=Colour:Red */
  option: z.union([z.string(), z.array(z.string())]).optional(),
  min: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(0).optional(),
  available: z.enum(['1', 'true', '0', 'false']).optional(),
  sort: z.enum(PRODUCT_SORTS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});
export type ProductListQuery = z.input<typeof ProductListQuery>;

export interface ProductListDTO extends Page<ProductDTO> {
  facets: {
    options: { name: string; values: { value: string; count: number }[] }[];
    productTypes: { value: string; count: number }[];
    price: { min: Money; max: Money } | null;
  };
}

/** GET /api/search/suggest?q= */
export interface SearchSuggestDTO {
  products: { handle: string; title: string; price: Money; image: MediaDTO | null }[];
  collections: { handle: string; title: string }[];
}

export interface PageDTO {
  id: string;
  handle: string;
  title: string;
  kind: 'policy' | 'page';
  bodyHtml: string;
  seo: { title: string; description: string };
  updatedAt: Timestamp;
}

export const SubscribeInput = z.object({ email: zEmail });

/* ═══════════════════════ cart ═══════════════════════ */

export interface CartLineDTO {
  id: string;
  variantId: string;
  productId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  options: { name: string; value: string }[];
  image: MediaDTO | null;
  quantity: number;
  unitPrice: Money;
  compareAtPrice: Money | null;
  lineTotal: Money;
  /** false when the variant is gone, archived or out of stock */
  available: boolean;
  /** max purchasable right now (null = no limit) */
  maxQuantity: number | null;
}

export interface CartDTO {
  id: string | null;
  currency: string;
  lines: CartLineDTO[];
  itemCount: number;
  subtotal: Money;
  discountCode: string | null;
  /** Estimated discount on the current lines (shipping discounts appear at checkout). */
  discountAmount: Money;
  /** Why the entered code does not apply, if it does not. */
  discountError: string | null;
  warnings: { lineId: string; code: 'insufficient_stock' | 'unavailable'; available: number }[];
}

export const CartAddLineInput = z.object({ variantId: zId, quantity: z.number().int().min(1).max(99).default(1) });
export const CartUpdateLineInput = z.object({ quantity: z.number().int().min(0).max(99) });
export const ApplyDiscountInput = z.object({ code: z.string().trim().min(1).max(64) });

/* ═══════════════════════ checkout & orders ═══════════════════════ */

export interface ShippingRateOptionDTO {
  id: string;
  name: string;
  amount: Money;
  deliveryEstimate: string | null;
}

/**
 * total = subtotal − discountTotal + (shipping − shippingDiscount) + (pricesIncludeTax ? 0 : taxTotal)
 */
export interface PricingDTO {
  currency: string;
  subtotal: Money;
  /** product (line) discounts only */
  discountTotal: Money;
  /** line discounts by code; a free-shipping code appears as shippingDiscount instead */
  discounts: { code: string; title: string; amount: Money }[];
  /** full shipping price; null until a shipping rate is chosen */
  shipping: Money | null;
  /** taken off shipping by a free-shipping code */
  shippingDiscount: Money;
  taxTotal: Money;
  taxLines: { name: string; rateBps: number; amount: Money }[];
  pricesIncludeTax: boolean;
  total: Money;
}

export interface CheckoutLineDTO {
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  image: MediaDTO | null;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  discount: Money;
}

export interface CheckoutDTO {
  id: string;
  status: 'open' | 'completed' | 'expired';
  email: string | null;
  phone: string | null;
  acceptsMarketing: boolean;
  shippingAddress: AddressDTO | null;
  requiresShipping: boolean;
  shippingRates: ShippingRateOptionDTO[];
  shippingRateId: string | null;
  discountCode: string | null;
  discountError: string | null;
  note: string | null;
  lines: CheckoutLineDTO[];
  pricing: PricingDTO;
  paymentMethods: PaymentMethodDTO[];
  expiresAt: Timestamp;
  /** Blocking problems, e.g. a line that went out of stock. */
  problems: { code: 'OUT_OF_STOCK' | 'UNAVAILABLE'; variantId: string; available: number; message: string }[];
  /** set once completed */
  orderToken: string | null;
}

export const CheckoutUpdateInput = z.object({
  email: zEmail.optional(),
  phone: zPhone.optional(),
  acceptsMarketing: z.boolean().optional(),
  shippingAddress: AddressInput.optional(),
  shippingRateId: zId.nullable().optional(),
  discountCode: z.string().trim().max(64).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CheckoutUpdateInput = z.input<typeof CheckoutUpdateInput>;

export const CheckoutCompleteInput = z.object({ paymentMethod: z.string().min(1).max(40) });

export interface FulfillmentDTO {
  id: string;
  status: 'fulfilled' | 'shipped' | 'delivered' | 'cancelled';
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  createdAt: Timestamp;
  shippedAt: Timestamp | null;
  deliveredAt: Timestamp | null;
}

export interface OrderLineDTO {
  id: string;
  productId: string | null;
  productHandle: string | null;
  variantId: string | null;
  title: string;
  variantTitle: string;
  sku: string | null;
  image: MediaDTO | null;
  quantity: number;
  unitPrice: Money;
  discount: Money;
  tax: Money;
  total: Money;
  fulfilledQuantity: number;
  refundedQuantity: number;
}

export interface OrderSummaryDTO {
  id: string;
  number: number;
  /** "#1001" */
  name: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: Timestamp;
  total: Money;
  currency: string;
  itemCount: number;
}

export interface OrderDTO extends OrderSummaryDTO {
  email: string;
  phone: string | null;
  lines: OrderLineDTO[];
  pricing: PricingDTO & { refunded: Money };
  shippingAddress: AddressDTO | null;
  shippingMethod: string | null;
  paymentMethod: { id: string; name: string };
  note: string | null;
  fulfillments: FulfillmentDTO[];
  /** customer-facing timeline */
  timeline: { at: Timestamp; status: OrderStatus | null; message: string }[];
  cancelledAt: Timestamp | null;
}

/* ═══════════════════════ auth & account ═══════════════════════ */

export interface CustomerDTO {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
  acceptsMarketing: boolean;
  createdAt: Timestamp;
}

/** GET /api/auth/session — also (re)sets the CSRF cookie. */
export interface SessionDTO {
  customer: CustomerDTO | null;
  csrfToken: string;
}

export const RegisterInput = z.object({
  email: zEmail,
  password: zPassword,
  name: zName,
  acceptsMarketing: z.boolean().default(false),
});
export const LoginInput = z.object({ email: zEmail, password: z.string().min(1, 'Required').max(128) });
export const ForgotPasswordInput = z.object({ email: zEmail });
export const ResetPasswordInput = z.object({ token: z.string().min(20).max(200), password: zPassword });
export const VerifyEmailInput = z.object({ token: z.string().min(20).max(200) });
export const UpdateAccountInput = z.object({
  name: zName.optional(),
  phone: zPhone.nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
});
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: zPassword });

export interface SavedAddressDTO extends AddressDTO {
  id: string;
  isDefault: boolean;
}
export const SavedAddressInput = AddressInput.extend({ isDefault: z.boolean().default(false) });

export const WishlistAddInput = z.object({ productId: zId });

/* ═══════════════════════ admin: auth & staff ═══════════════════════ */

export interface StaffDTO {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  /** effective permissions (owner/admin get all) */
  permissions: Permission[];
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
}

/** GET /api/admin/auth/session */
export interface AdminSessionDTO {
  staff: StaffDTO | null;
  /** true when no staff account exists yet → show the owner setup screen */
  setupRequired: boolean;
  csrfToken: string;
}

export const AdminLoginInput = LoginInput;
export const AdminSetupInput = z.object({
  setupToken: z.string().min(1).max(200),
  email: zEmail,
  name: zName,
  password: zPassword,
});
export const AcceptInviteInput = z.object({ token: z.string().min(20).max(200), name: zName, password: zPassword });
export const StaffInviteInput = z.object({
  email: zEmail,
  name: zName,
  role: z.enum(['admin', 'staff']),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});
export const StaffUpdateInput = z.object({
  name: zName.optional(),
  role: z.enum(['admin', 'staff']).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
/** POST /api/admin/staff/invite → StaffInviteResultDTO */
export interface StaffInviteResultDTO {
  staff: StaffDTO;
  /** Only returned in development (email transport = log). */
  inviteUrl: string | null;
}

/* ═══════════════════════ admin: dashboard ═══════════════════════ */

/** GET /api/admin/dashboard?from=<ms>&to=<ms> */
export interface DashboardDTO {
  currency: string;
  range: { from: Timestamp; to: Timestamp };
  revenue: Money;
  orders: number;
  averageOrderValue: Money;
  itemsSold: number;
  newCustomers: number;
  /** same metrics for the previous period of equal length */
  previous: { revenue: Money; orders: number; averageOrderValue: Money; itemsSold: number; newCustomers: number };
  /** `YYYY-MM-DD` (UTC); ranges over 120 days are bucketed by month and dated the 1st */
  series: { date: string; revenue: Money; orders: number }[];
  topProducts: { productId: string | null; title: string; quantity: number; revenue: Money; image: MediaDTO | null }[];
  statusCounts: Record<OrderStatus, number>;
  lowStock: { variantId: string; productId: string; productTitle: string; variantTitle: string; onHand: number }[];
  recentOrders: AdminOrderListItemDTO[];
}

/* ═══════════════════════ admin: products & media ═══════════════════════ */

export interface AdminProductListItemDTO {
  id: string;
  handle: string;
  title: string;
  status: ProductStatus;
  productType: string;
  image: MediaDTO | null;
  variantsCount: number;
  inventoryTotal: number;
  priceMin: Money;
  priceMax: Money;
  updatedAt: Timestamp;
}

export const AdminProductListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  collectionId: zId.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AdminVariantInput = z.object({
  id: zId.optional(),
  sku: z.string().trim().max(64).nullish().transform((v) => v || null),
  options: z.array(z.string().trim().min(1).max(80)).max(3),
  price: zMoney,
  compareAtPrice: zMoney.nullable().default(null),
  costPrice: zMoney.nullable().default(null),
  weightGrams: z.number().int().min(0).max(1_000_000).default(0),
  requiresShipping: z.boolean().default(true),
  taxable: z.boolean().default(true),
  inventoryTracked: z.boolean().default(true),
  inventoryPolicy: z.enum(INVENTORY_POLICIES).default('deny'),
  /** Absolute on-hand quantity. The server records the difference as an adjustment. */
  inventoryOnHand: z.number().int().min(0).max(1_000_000).default(0),
  /**
   * The on-hand quantity the editor loaded. When sent, only the change the
   * editor made (inventoryOnHand − inventoryBaseline) is applied, so sales that
   * happened while the form was open are not overwritten.
   */
  inventoryBaseline: z.number().int().min(0).max(1_000_000).nullable().optional(),
  imageId: zId.nullable().default(null),
});

export const AdminProductInput = z
  .object({
    title: z.string().trim().min(1, 'Required').max(200),
    handle: zHandle.optional(),
    descriptionHtml: z.string().max(100_000).default(''),
    status: z.enum(PRODUCT_STATUSES).default('draft'),
    productType: z.string().trim().max(80).default(''),
    vendor: z.string().trim().max(80).nullish().transform((v) => v || null),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    seoTitle: z.string().trim().max(200).nullish().transform((v) => v || null),
    seoDescription: z.string().trim().max(320).nullish().transform((v) => v || null),
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(40),
          values: z.array(z.object({ value: z.string().trim().min(1).max(80), swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish() })).min(1).max(100),
        }),
      )
      .max(3)
      .default([]),
    variants: z.array(AdminVariantInput).min(1, 'Add at least one variant').max(250),
    /** ordered media ids */
    mediaIds: z.array(zId).max(50).default([]),
    /** manual collections this product belongs to */
    collectionIds: z.array(zId).max(100).default([]),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.variants.forEach((v, i) => {
      if (v.options.length !== p.options.length) {
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'options'], message: 'Pick a value for every option' });
      }
      const key = v.options.join(' ');
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'options'], message: 'Duplicate variant' });
      seen.add(key);
      if (v.compareAtPrice !== null && v.compareAtPrice <= v.price) {
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'compareAtPrice'], message: 'Must be higher than the price' });
      }
    });
  });
export type AdminProductInput = z.input<typeof AdminProductInput>;

export interface AdminVariantDTO {
  id: string;
  sku: string | null;
  title: string;
  options: string[];
  price: Money;
  compareAtPrice: Money | null;
  costPrice: Money | null;
  weightGrams: number;
  requiresShipping: boolean;
  taxable: boolean;
  inventoryTracked: boolean;
  inventoryPolicy: InventoryPolicy;
  inventoryOnHand: number;
  /** held by open checkouts */
  inventoryReserved: number;
  imageId: string | null;
}

export interface AdminProductDTO {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  status: ProductStatus;
  productType: string;
  vendor: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  options: ProductOptionDTO[];
  variants: AdminVariantDTO[];
  media: MediaDTO[];
  collections: { id: string; title: string; type: 'manual' | 'smart' }[];
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const BulkProductActionInput = z.object({
  ids: z.array(zId).min(1).max(500),
  action: z.enum(['activate', 'draft', 'archive', 'delete']),
});

export const InventoryAdjustInput = z.object({
  mode: z.enum(['set', 'adjust']),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  note: z.string().trim().max(300).optional(),
});

export interface InventoryAdjustmentDTO {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  orderId: string | null;
  staffName: string | null;
  createdAt: Timestamp;
}

export const MediaUpdateInput = z.object({ alt: z.string().trim().max(300) });

export interface CsvImportDTO {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  summary: { created: number; updated: number; skipped: number; rows: number } | null;
  errors: { row: number; message: string }[];
  createdAt: Timestamp;
  finishedAt: Timestamp | null;
}

/* ═══════════════════════ admin: collections ═══════════════════════ */

export const CollectionRuleInput = z.object({
  field: z.enum(COLLECTION_RULE_FIELDS),
  op: z.enum(COLLECTION_RULE_OPS),
  value: z.string().trim().min(1).max(120),
});

export const AdminCollectionInput = z.object({
  title: z.string().trim().min(1).max(200),
  handle: zHandle.optional(),
  descriptionHtml: z.string().max(50_000).default(''),
  type: z.enum(['manual', 'smart']),
  rules: z
    .object({ match: z.enum(['all', 'any']), conditions: z.array(CollectionRuleInput).max(20) })
    .default({ match: 'all', conditions: [] }),
  sort: z.enum(COLLECTION_SORTS).default('manual'),
  imageId: zId.nullable().default(null),
  published: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).nullish().transform((v) => v || null),
  seoDescription: z.string().trim().max(320).nullish().transform((v) => v || null),
});
export type AdminCollectionInput = z.input<typeof AdminCollectionInput>;

export interface AdminCollectionDTO {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  type: 'manual' | 'smart';
  rules: { match: 'all' | 'any'; conditions: { field: CollectionRuleField; op: CollectionRuleOp; value: string }[] };
  sort: CollectionSort;
  image: MediaDTO | null;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  productsCount: number;
  updatedAt: Timestamp;
}

/** PUT /api/admin/collections/:id/products (manual collections) */
export const CollectionProductsInput = z.object({ productIds: z.array(zId).max(5000) });

/* ═══════════════════════ admin: orders ═══════════════════════ */

export interface AdminOrderListItemDTO {
  id: string;
  number: number;
  name: string;
  placedAt: Timestamp;
  customer: { id: string; name: string; email: string } | null;
  email: string;
  total: Money;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  itemCount: number;
}

export const AdminOrderListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  customerId: zId.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface OrderEventDTO {
  id: string;
  type: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actor: { type: 'system' | 'customer' | 'staff' | 'webhook'; id: string | null; name: string | null };
  message: string;
  data: Record<string, unknown> | null;
  createdAt: Timestamp;
}

export interface RefundDTO {
  id: string;
  amount: Money;
  reason: string | null;
  restock: boolean;
  lines: { orderLineId: string; quantity: number }[];
  staffName: string | null;
  createdAt: Timestamp;
}

export interface AdminOrderDTO extends OrderDTO {
  customer: { id: string; name: string; email: string; ordersCount: number; totalSpent: Money } | null;
  events: OrderEventDTO[];
  refunds: RefundDTO[];
  allowedTransitions: OrderStatus[];
  refundableAmount: Money;
  userAgent: string | null;
}

/**
 * POST /api/admin/orders/:id/transition
 *   paid       → mark payment received (COD cash collected)
 *   fulfilled  → packed; creates a fulfillment
 *   shipped    → handed to courier; tracking optional; emails the customer when notify
 *   delivered  → optionally also marks COD paid (markPaid)
 *   cancelled  → restock and release; refused once shipped
 */
export const OrderTransitionInput = z.object({
  to: z.enum(['paid', 'fulfilled', 'shipped', 'delivered', 'cancelled']),
  reason: z.string().trim().max(500).optional(),
  tracking: z
    .object({
      carrier: z.string().trim().max(80).nullish(),
      number: z.string().trim().max(120).nullish(),
      url: z.url().max(500).nullish(),
    })
    .optional(),
  notifyCustomer: z.boolean().default(true),
  restock: z.boolean().default(true),
  markPaid: z.boolean().default(false),
});
export type OrderTransitionInput = z.input<typeof OrderTransitionInput>;

export const RefundInput = z.object({
  amount: zMoney.refine((v) => v > 0, 'Must be more than zero'),
  reason: z.string().trim().max(500).optional(),
  restock: z.boolean().default(false),
  lines: z.array(z.object({ orderLineId: zId, quantity: z.number().int().min(1) })).default([]),
  notifyCustomer: z.boolean().default(true),
});
export type RefundInput = z.input<typeof RefundInput>;

export const OrderNoteInput = z.object({ body: z.string().trim().min(1).max(2000) });

export const AdminOrderUpdateInput = z.object({
  email: zEmail.optional(),
  phone: zPhone.nullable().optional(),
  shippingAddress: AddressInput.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/* ═══════════════════════ admin: customers ═══════════════════════ */

export interface AdminCustomerListItemDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  ordersCount: number;
  totalSpent: Money;
  acceptsMarketing: boolean;
  hasAccount: boolean;
  createdAt: Timestamp;
  lastOrderAt: Timestamp | null;
}

export interface AdminCustomerDTO extends AdminCustomerListItemDTO {
  emailVerified: boolean;
  note: string | null;
  averageOrderValue: Money;
  addresses: SavedAddressDTO[];
  orders: AdminOrderListItemDTO[];
}

export const AdminCustomerListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['created_desc', 'spent_desc', 'orders_desc']).default('created_desc'),
});

export const AdminCustomerUpdateInput = z.object({
  name: zName.optional(),
  phone: zPhone.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
});

/* ═══════════════════════ admin: discounts ═══════════════════════ */

const zTargets = z.object({ productIds: z.array(zId).max(500).default([]), collectionIds: z.array(zId).max(100).default([]) });

export const AdminDiscountInput = z
  .object({
    code: z.string().trim().toUpperCase().min(2).max(64).regex(/^[A-Z0-9_-]+$/, 'Letters, digits, - and _'),
    title: z.string().trim().max(120).default(''),
    type: z.enum(DISCOUNT_TYPES),
    /** percentage & buy_x_get_y: basis points; fixed_amount: minor units; free_shipping: ignored */
    value: z.number().int().min(0).max(1_000_000_000).default(0),
    appliesTo: z.enum(['all', 'products', 'collections']).default('all'),
    targets: zTargets.default({ productIds: [], collectionIds: [] }),
    minSubtotal: zMoney.nullable().default(null),
    minQuantity: z.number().int().min(1).max(10_000).nullable().default(null),
    usageLimit: z.number().int().min(1).nullable().default(null),
    usageLimitPerCustomer: z.number().int().min(1).nullable().default(null),
    buyX: z.object({ quantity: z.number().int().min(1).max(100), targets: zTargets }).nullable().default(null),
    getY: z.object({ quantity: z.number().int().min(1).max(100), targets: zTargets }).nullable().default(null),
    /** buy_x_get_y: how many times it can apply in one order */
    maxUsesPerOrder: z.number().int().min(1).max(100).nullable().default(1),
    startsAt: zTimestamp,
    endsAt: zTimestamp.nullable().default(null),
    status: z.enum(['active', 'disabled']).default('active'),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'percentage' && (d.value < 1 || d.value > 10_000)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Between 0.01% and 100%' });
    }
    if (d.type === 'fixed_amount' && d.value < 1) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Must be more than zero' });
    if (d.type === 'buy_x_get_y') {
      if (!d.buyX) ctx.addIssue({ code: 'custom', path: ['buyX'], message: 'Required' });
      if (!d.getY) ctx.addIssue({ code: 'custom', path: ['getY'], message: 'Required' });
      if (d.value < 1 || d.value > 10_000) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Discount on the free item(s), 100% = free' });
    }
    if (d.endsAt !== null && d.endsAt <= d.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start' });
  });
export type AdminDiscountInput = z.input<typeof AdminDiscountInput>;

export interface DiscountDTO {
  id: string;
  code: string;
  title: string;
  type: DiscountType;
  value: number;
  appliesTo: 'all' | 'products' | 'collections';
  targets: { productIds: string[]; collectionIds: string[] };
  minSubtotal: Money | null;
  minQuantity: number | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  usageCount: number;
  buyX: { quantity: number; targets: { productIds: string[]; collectionIds: string[] } } | null;
  getY: { quantity: number; targets: { productIds: string[]; collectionIds: string[] } } | null;
  maxUsesPerOrder: number | null;
  startsAt: Timestamp;
  endsAt: Timestamp | null;
  status: 'active' | 'disabled';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ═══════════════════════ admin: shipping & taxes ═══════════════════════ */

export const ShippingRateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(SHIPPING_RATE_TYPES),
    amount: zMoney,
    /** weight: grams; price: minor units (order subtotal after discounts) */
    minValue: z.number().int().min(0).nullable().default(null),
    maxValue: z.number().int().min(0).nullable().default(null),
    deliveryEstimate: z.string().trim().max(120).nullish().transform((v) => v || null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.minValue === null || r.maxValue === null || r.maxValue > r.minValue, {
    path: ['maxValue'],
    message: 'Must be greater than the minimum',
  });

export interface ShippingRateDTO {
  id: string;
  name: string;
  type: ShippingRateType;
  amount: Money;
  minValue: number | null;
  maxValue: number | null;
  deliveryEstimate: string | null;
  active: boolean;
}

export const ShippingZoneInput = z.object({
  name: z.string().trim().min(1).max(80),
  regions: z
    .array(z.object({ countryCode: zCountry, regionCode: z.string().trim().max(80).nullish().transform((v) => v || null) }))
    .min(1, 'Add at least one country'),
});

export interface ShippingZoneDTO {
  id: string;
  name: string;
  regions: { countryCode: string; regionCode: string | null }[];
  rates: ShippingRateDTO[];
}

export const TaxRateInput = z.object({
  countryCode: zCountry,
  regionCode: z.string().trim().max(80).nullish().transform((v) => v || null),
  name: z.string().trim().min(1).max(60),
  rateBps: zBps,
  appliesToShipping: z.boolean().default(false),
  active: z.boolean().default(true),
});

export interface TaxRateDTO {
  id: string;
  countryCode: string;
  regionCode: string | null;
  name: string;
  rateBps: number;
  appliesToShipping: boolean;
  active: boolean;
}

/** GET /api/admin/taxes */
export interface TaxSettingsDTO {
  pricesIncludeTax: boolean;
  rates: TaxRateDTO[];
}
export const TaxSettingsInput = z.object({ pricesIncludeTax: z.boolean() });

/* ═══════════════════════ admin: settings, pages, audit ═══════════════════════ */

export interface SettingsDTO {
  name: string;
  currency: string;
  pricesIncludeTax: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  instagram: string | null;
  address: string | null;
  logo: MediaDTO | null;
  menu: MenuItemDTO[];
  featuredCollectionHandle: string | null;
  lookbookCollectionHandle: string | null;
  editorialCollectionHandle: string | null;
  lowStockThreshold: number;
  checkoutHoldMinutes: number;
  abandonedCartEmails: boolean;
  orderNotificationEmail: string | null;
  updatedAt: Timestamp;
}

export const SettingsInput = z.object({
  name: z.string().trim().min(1).max(120),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  contactEmail: zEmail.nullable(),
  contactPhone: z.string().trim().max(40).nullable(),
  instagram: z.string().trim().max(60).nullable(),
  address: z.string().trim().max(500).nullable(),
  logoMediaId: zId.nullable(),
  menu: z.array(z.object({ label: z.string().trim().min(1).max(40), collectionHandle: zHandle.nullable() })).max(20),
  featuredCollectionHandle: zHandle.nullable(),
  lookbookCollectionHandle: zHandle.nullable(),
  editorialCollectionHandle: zHandle.nullable(),
  lowStockThreshold: z.number().int().min(0).max(1000),
  checkoutHoldMinutes: z.number().int().min(0).max(120),
  abandonedCartEmails: z.boolean(),
  orderNotificationEmail: zEmail.nullable(),
});
export type SettingsInput = z.input<typeof SettingsInput>;

export const PageInput = z.object({
  title: z.string().trim().min(1).max(200),
  handle: zHandle.optional(),
  kind: z.enum(['policy', 'page']).default('page'),
  bodyHtml: z.string().max(200_000),
  published: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).nullish().transform((v) => v || null),
  seoDescription: z.string().trim().max(320).nullish().transform((v) => v || null),
});
export type PageInput = z.input<typeof PageInput>;

export interface AdminPageDTO {
  id: string;
  handle: string;
  title: string;
  kind: 'policy' | 'page';
  bodyHtml: string;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Timestamp;
}

export interface AuditEntryDTO {
  id: string;
  staff: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  ip: string | null;
  createdAt: Timestamp;
}

/* ═══════════════════════ route map ═══════════════════════
 *
 * Storefront (public)
 *   GET    /api/store                                  → StoreDTO
 *   GET    /api/products?…ProductListQuery             → ProductListDTO
 *   GET    /api/products/:handle                       → ProductDTO
 *   GET    /api/products/:handle/availability          → AvailabilityDTO
 *   GET    /api/products/:handle/related               → { items: ProductDTO[] }
 *   GET    /api/collections                            → { items: CollectionDTO[] }
 *   GET    /api/collections/:handle                    → CollectionDTO
 *   GET    /api/search/suggest?q=                      → SearchSuggestDTO
 *   GET    /api/pages/:handle                          → PageDTO
 *   POST   /api/subscribe            SubscribeInput    → 204
 *
 * Cart (guest cookie or customer)
 *   GET    /api/cart                                   → CartDTO
 *   POST   /api/cart/lines           CartAddLineInput  → CartDTO
 *   PATCH  /api/cart/lines/:id       CartUpdateLineInput → CartDTO   (quantity 0 removes)
 *   DELETE /api/cart/lines/:id                         → CartDTO
 *   POST   /api/cart/discount        ApplyDiscountInput → CartDTO
 *   DELETE /api/cart/discount                          → CartDTO
 *
 * Checkout
 *   POST   /api/checkout                               → CheckoutDTO   (from the current cart; holds stock)
 *   GET    /api/checkout/:id                           → CheckoutDTO
 *   PATCH  /api/checkout/:id         CheckoutUpdateInput → CheckoutDTO
 *   POST   /api/checkout/:id/complete CheckoutCompleteInput → { orderToken: string; order: OrderDTO }
 *   GET    /api/orders/:token                          → OrderDTO      (confirmation / guest status page)
 *
 * Auth & account
 *   GET    /api/auth/session                           → SessionDTO
 *   POST   /api/auth/register        RegisterInput     → SessionDTO
 *   POST   /api/auth/login           LoginInput        → SessionDTO
 *   POST   /api/auth/logout                            → 204
 *   POST   /api/auth/verify-email    VerifyEmailInput  → SessionDTO
 *   POST   /api/auth/resend-verification               → 204
 *   POST   /api/auth/forgot-password ForgotPasswordInput → 204
 *   POST   /api/auth/reset-password  ResetPasswordInput → SessionDTO
 *   GET    /api/account                                → CustomerDTO
 *   PATCH  /api/account              UpdateAccountInput → CustomerDTO
 *   POST   /api/account/password     ChangePasswordInput → 204
 *   GET    /api/account/orders?cursor                  → Page<OrderSummaryDTO>
 *   GET    /api/account/orders/:number                 → OrderDTO
 *   GET    /api/account/addresses                      → { items: SavedAddressDTO[] }
 *   POST   /api/account/addresses    SavedAddressInput → SavedAddressDTO
 *   PATCH  /api/account/addresses/:id SavedAddressInput → SavedAddressDTO
 *   DELETE /api/account/addresses/:id                  → 204
 *   GET    /api/account/wishlist                       → { items: ProductDTO[] }
 *   POST   /api/account/wishlist     WishlistAddInput  → 204
 *   DELETE /api/account/wishlist/:productId            → 204
 *
 * Admin (staff session; permission in brackets)
 *   GET    /api/admin/auth/session                     → AdminSessionDTO
 *   POST   /api/admin/auth/setup     AdminSetupInput   → AdminSessionDTO
 *   POST   /api/admin/auth/login     AdminLoginInput   → AdminSessionDTO
 *   POST   /api/admin/auth/logout                      → 204
 *   POST   /api/admin/auth/accept-invite AcceptInviteInput → AdminSessionDTO
 *   POST   /api/admin/auth/forgot-password ForgotPasswordInput → 204
 *   POST   /api/admin/auth/reset-password ResetPasswordInput → AdminSessionDTO
 *   GET    /api/admin/dashboard?from&to                → DashboardDTO             [dashboard:read]
 *   GET    /api/admin/products?…AdminProductListQuery  → Page<AdminProductListItemDTO> [products:read]
 *   POST   /api/admin/products       AdminProductInput → AdminProductDTO          [products:write]
 *   GET    /api/admin/products/:id                     → AdminProductDTO          [products:read]
 *   PUT    /api/admin/products/:id   AdminProductInput → AdminProductDTO          [products:write]
 *   DELETE /api/admin/products/:id                     → 204                      [products:write]
 *   POST   /api/admin/products/bulk  BulkProductActionInput → { updated: number } [products:write]
 *   GET    /api/admin/products/export.csv              → text/csv                 [products:read]
 *   POST   /api/admin/products/import  multipart "file" → CsvImportDTO            [products:write]
 *   GET    /api/admin/imports/:id                      → CsvImportDTO             [products:read]
 *   POST   /api/admin/variants/:id/inventory InventoryAdjustInput → AdminVariantDTO [products:write]
 *   GET    /api/admin/variants/:id/inventory           → { items: InventoryAdjustmentDTO[] } [products:read]
 *   GET    /api/admin/media?cursor                     → Page<MediaDTO>           [products:read]
 *   POST   /api/admin/media          multipart "files" (≤20, ≤10MB each) → { items: MediaDTO[] } [products:write]
 *   PATCH  /api/admin/media/:id      MediaUpdateInput  → MediaDTO                 [products:write]
 *   DELETE /api/admin/media/:id                        → 204                      [products:write]
 *   GET    /api/admin/collections                      → { items: AdminCollectionDTO[] } [products:read]
 *   POST   /api/admin/collections    AdminCollectionInput → AdminCollectionDTO    [products:write]
 *   GET    /api/admin/collections/:id                  → AdminCollectionDTO & { products: AdminProductListItemDTO[] }
 *   PUT    /api/admin/collections/:id AdminCollectionInput → AdminCollectionDTO   [products:write]
 *   PUT    /api/admin/collections/:id/products CollectionProductsInput → 204      [products:write]
 *   DELETE /api/admin/collections/:id                  → 204                      [products:write]
 *   GET    /api/admin/orders?…AdminOrderListQuery      → Page<AdminOrderListItemDTO> [orders:read]
 *   GET    /api/admin/orders/:id                       → AdminOrderDTO            [orders:read]
 *   PATCH  /api/admin/orders/:id     AdminOrderUpdateInput → AdminOrderDTO        [orders:write]
 *   POST   /api/admin/orders/:id/transition OrderTransitionInput → AdminOrderDTO  [orders:write]
 *   POST   /api/admin/orders/:id/refunds RefundInput   → AdminOrderDTO            [orders:refund]
 *   POST   /api/admin/orders/:id/notes OrderNoteInput  → AdminOrderDTO            [orders:write]
 *   GET    /api/admin/customers?…AdminCustomerListQuery → Page<AdminCustomerListItemDTO> [customers:read]
 *   GET    /api/admin/customers/:id                    → AdminCustomerDTO         [customers:read]
 *   PATCH  /api/admin/customers/:id  AdminCustomerUpdateInput → AdminCustomerDTO  [customers:write]
 *   GET    /api/admin/discounts                        → { items: DiscountDTO[] } [discounts:read]
 *   POST   /api/admin/discounts      AdminDiscountInput → DiscountDTO             [discounts:write]
 *   GET    /api/admin/discounts/:id                    → DiscountDTO              [discounts:read]
 *   PUT    /api/admin/discounts/:id  AdminDiscountInput → DiscountDTO             [discounts:write]
 *   DELETE /api/admin/discounts/:id                    → 204                      [discounts:write]
 *   GET    /api/admin/shipping/zones                   → { items: ShippingZoneDTO[] } [shipping:write]
 *   POST   /api/admin/shipping/zones ShippingZoneInput → ShippingZoneDTO          [shipping:write]
 *   PUT    /api/admin/shipping/zones/:id ShippingZoneInput → ShippingZoneDTO      [shipping:write]
 *   DELETE /api/admin/shipping/zones/:id               → 204                      [shipping:write]
 *   POST   /api/admin/shipping/zones/:id/rates ShippingRateInput → ShippingRateDTO [shipping:write]
 *   PUT    /api/admin/shipping/rates/:id ShippingRateInput → ShippingRateDTO      [shipping:write]
 *   DELETE /api/admin/shipping/rates/:id               → 204                      [shipping:write]
 *   GET    /api/admin/taxes                            → TaxSettingsDTO           [taxes:write]
 *   PUT    /api/admin/taxes          TaxSettingsInput  → TaxSettingsDTO           [taxes:write]
 *   POST   /api/admin/taxes/rates    TaxRateInput      → TaxRateDTO               [taxes:write]
 *   PUT    /api/admin/taxes/rates/:id TaxRateInput     → TaxRateDTO               [taxes:write]
 *   DELETE /api/admin/taxes/rates/:id                  → 204                      [taxes:write]
 *   GET    /api/admin/settings                         → SettingsDTO              [settings:write]
 *   PUT    /api/admin/settings       SettingsInput     → SettingsDTO              [settings:write]
 *   GET    /api/admin/pages                            → { items: AdminPageDTO[] } [pages:write]
 *   POST   /api/admin/pages          PageInput         → AdminPageDTO             [pages:write]
 *   GET    /api/admin/pages/:id                        → AdminPageDTO             [pages:write]
 *   PUT    /api/admin/pages/:id      PageInput         → AdminPageDTO             [pages:write]
 *   DELETE /api/admin/pages/:id                        → 204                      [pages:write]
 *   GET    /api/admin/staff                            → { items: StaffDTO[] }    [staff:manage]
 *   POST   /api/admin/staff/invite   StaffInviteInput  → StaffInviteResultDTO     [staff:manage]
 *   PATCH  /api/admin/staff/:id      StaffUpdateInput  → StaffDTO                 [staff:manage]
 *   DELETE /api/admin/staff/:id                        → 204                      [staff:manage]
 *   GET    /api/admin/audit?cursor                     → Page<AuditEntryDTO>      [staff:manage]
 *
 * Dev only (APP_ENV=development)
 *   GET    /api/dev/mail                               → { items: { to, subject, html, text, at }[] }
 */
