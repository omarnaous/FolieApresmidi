/**
 * D1 schema (Drizzle). `npm run db:generate` turns changes here into a
 * numbered SQL migration under migrations/; wrangler applies them.
 *
 * Conventions: TEXT ULID ids · INTEGER unix-ms timestamps · INTEGER money in
 * minor units · INTEGER 0/1 booleans · *_json TEXT. Invariants that must hold
 * under concurrency (stock never negative, discount usage never over its
 * limit) are CHECK constraints, so a D1 batch that would break them rolls
 * back as a whole.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull();
const updatedAt = () => integer('updated_at').notNull();
const bool = (name: string) => integer(name, { mode: 'boolean' });

/* ─────────────────────────── store ─────────────────────────── */

export const storeSettings = sqliteTable(
  'store_settings',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('USD'),
    pricesIncludeTax: bool('prices_include_tax').notNull().default(true),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    instagram: text('instagram'),
    address: text('address'),
    logoMediaId: text('logo_media_id'),
    menuJson: text('menu_json').notNull().default('[]'),
    featuredCollectionHandle: text('featured_collection_handle'),
    lookbookCollectionHandle: text('lookbook_collection_handle'),
    editorialCollectionHandle: text('editorial_collection_handle'),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    checkoutHoldMinutes: integer('checkout_hold_minutes').notNull().default(15),
    abandonedCartEmails: bool('abandoned_cart_emails').notNull().default(true),
    orderNotificationEmail: text('order_notification_email'),
    updatedAt: updatedAt(),
  },
  (t) => [check('store_settings_singleton', sql`${t.id} = 1`)],
);

export const pages = sqliteTable(
  'pages',
  {
    id: id(),
    handle: text('handle').notNull().unique(),
    kind: text('kind', { enum: ['policy', 'page'] }).notNull().default('page'),
    title: text('title').notNull(),
    bodyHtml: text('body_html').notNull().default(''),
    published: bool('published').notNull().default(true),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('pages_kind', sql`${t.kind} in ('policy','page')`)],
);

export const media = sqliteTable('media', {
  id: id(),
  r2Key: text('r2_key').notNull().unique(),
  /** Original location for imported images; copied into R2 on first request. */
  sourceUrl: text('source_url'),
  mime: text('mime').notNull(),
  bytes: integer('bytes'),
  width: integer('width'),
  height: integer('height'),
  alt: text('alt').notNull().default(''),
  createdBy: text('created_by'),
  createdAt: createdAt(),
});

/* ─────────────────────────── catalog ─────────────────────────── */

export const products = sqliteTable(
  'products',
  {
    id: id(),
    handle: text('handle').notNull().unique(),
    title: text('title').notNull(),
    descriptionHtml: text('description_html').notNull().default(''),
    descriptionText: text('description_text').notNull().default(''),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull().default('draft'),
    productType: text('product_type').notNull().default(''),
    vendor: text('vendor'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    /** featured sort position; lower first */
    position: integer('position').notNull().default(0),
    publishedAt: integer('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('products_status', sql`${t.status} in ('draft','active','archived')`),
    index('products_status_position').on(t.status, t.position),
    index('products_type').on(t.productType),
  ],
);

export const productOptions = sqliteTable(
  'product_options',
  {
    id: id(),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('product_options_position').on(t.productId, t.position)],
);

export const productOptionValues = sqliteTable(
  'product_option_values',
  {
    id: id(),
    optionId: text('option_id').notNull().references(() => productOptions.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    position: integer('position').notNull(),
    swatch: text('swatch'),
  },
  (t) => [uniqueIndex('product_option_values_value').on(t.optionId, t.value)],
);

export const variants = sqliteTable(
  'variants',
  {
    id: id(),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').unique(),
    title: text('title').notNull(),
    option1: text('option1'),
    option2: text('option2'),
    option3: text('option3'),
    priceAmount: integer('price_amount').notNull(),
    compareAtAmount: integer('compare_at_amount'),
    costAmount: integer('cost_amount'),
    weightGrams: integer('weight_grams').notNull().default(0),
    requiresShipping: bool('requires_shipping').notNull().default(true),
    taxable: bool('taxable').notNull().default(true),
    inventoryTracked: bool('inventory_tracked').notNull().default(true),
    inventoryPolicy: text('inventory_policy', { enum: ['deny', 'continue'] }).notNull().default('deny'),
    inventoryOnHand: integer('inventory_on_hand').notNull().default(0),
    mediaId: text('media_id'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('variants_price', sql`${t.priceAmount} >= 0`),
    check('variants_policy', sql`${t.inventoryPolicy} in ('deny','continue')`),
    // the oversell guard: a decrement past zero aborts the whole batch
    check(
      'variants_stock',
      sql`${t.inventoryOnHand} >= 0 OR ${t.inventoryPolicy} = 'continue' OR ${t.inventoryTracked} = 0`,
    ),
    index('variants_product').on(t.productId, t.position),
  ],
);

export const productMedia = sqliteTable(
  'product_media',
  {
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.mediaId] }), index('product_media_position').on(t.productId, t.position)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: id(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('tags_name_lower').on(sql`lower(${t.name})`)],
);

export const productTags = sqliteTable(
  'product_tags',
  {
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] }), index('product_tags_tag').on(t.tagId)],
);

export const collections = sqliteTable(
  'collections',
  {
    id: id(),
    handle: text('handle').notNull().unique(),
    title: text('title').notNull(),
    descriptionHtml: text('description_html').notNull().default(''),
    type: text('type', { enum: ['manual', 'smart'] }).notNull(),
    rulesJson: text('rules_json').notNull().default('{"match":"all","conditions":[]}'),
    sort: text('sort').notNull().default('manual'),
    imageMediaId: text('image_media_id'),
    published: bool('published').notNull().default(true),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('collections_type', sql`${t.type} in ('manual','smart')`)],
);

/** Manual membership, and smart membership materialized on save. */
export const collectionProducts = sqliteTable(
  'collection_products',
  {
    collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index('collection_products_product').on(t.productId),
    index('collection_products_position').on(t.collectionId, t.position),
  ],
);

export const inventoryReservations = sqliteTable(
  'inventory_reservations',
  {
    id: id(),
    variantId: text('variant_id').notNull().references(() => variants.id, { onDelete: 'cascade' }),
    checkoutId: text('checkout_id').notNull(),
    quantity: integer('quantity').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('inventory_reservations_variant').on(t.variantId, t.expiresAt),
    index('inventory_reservations_checkout').on(t.checkoutId),
  ],
);

export const inventoryAdjustments = sqliteTable(
  'inventory_adjustments',
  {
    id: id(),
    variantId: text('variant_id').notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    orderId: text('order_id'),
    staffId: text('staff_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('inventory_adjustments_variant').on(t.variantId, t.createdAt)],
);

/* ─────────────────────────── customers & staff ─────────────────────────── */

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    email: text('email').notNull().unique(),
    /** null for guests who have ordered but never registered */
    passwordHash: text('password_hash'),
    name: text('name').notNull().default(''),
    phone: text('phone'),
    emailVerifiedAt: integer('email_verified_at'),
    acceptsMarketing: bool('accepts_marketing').notNull().default(false),
    sessionEpoch: integer('session_epoch').notNull().default(0),
    note: text('note'),
    ordersCount: integer('orders_count').notNull().default(0),
    totalSpentAmount: integer('total_spent_amount').notNull().default(0),
    lastOrderAt: integer('last_order_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('customers_created').on(t.createdAt), index('customers_spent').on(t.totalSpentAmount)],
);

export const customerAddresses = sqliteTable(
  'customer_addresses',
  {
    id: id(),
    customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2').notNull().default(''),
    city: text('city').notNull(),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull(),
    notes: text('notes'),
    isDefault: bool('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('customer_addresses_customer').on(t.customerId)],
);

export const staffUsers = sqliteTable(
  'staff_users',
  {
    id: id(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'staff'] }).notNull(),
    permissionsJson: text('permissions_json').notNull().default('[]'),
    status: text('status', { enum: ['invited', 'active', 'disabled'] }).notNull().default('invited'),
    sessionEpoch: integer('session_epoch').notNull().default(0),
    lastLoginAt: integer('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('staff_role', sql`${t.role} in ('owner','admin','staff')`),
    check('staff_status', sql`${t.status} in ('invited','active','disabled')`),
  ],
);

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    id: id(),
    subjectType: text('subject_type', { enum: ['customer', 'staff'] }).notNull(),
    subjectId: text('subject_id').notNull(),
    purpose: text('purpose', { enum: ['verify_email', 'reset_password', 'staff_invite'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_subject').on(t.subjectType, t.subjectId, t.purpose, t.createdAt)],
);

export const wishlistItems = sqliteTable(
  'wishlist_items',
  {
    id: id(),
    customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('wishlist_items_unique').on(t.customerId, t.productId)],
);

export const subscribers = sqliteTable('subscribers', {
  email: text('email').primaryKey(),
  customerId: text('customer_id'),
  source: text('source').notNull(),
  status: text('status', { enum: ['subscribed', 'unsubscribed'] }).notNull().default('subscribed'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ─────────────────────────── cart & checkout ─────────────────────────── */

export const carts = sqliteTable(
  'carts',
  {
    id: id(),
    customerId: text('customer_id'),
    email: text('email'),
    discountCode: text('discount_code'),
    status: text('status', { enum: ['active', 'merged', 'converted'] }).notNull().default('active'),
    convertedOrderId: text('converted_order_id'),
    reminderSentAt: integer('reminder_sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('carts_customer').on(t.customerId, t.status), index('carts_status_updated').on(t.status, t.updatedAt)],
);

export const cartLines = sqliteTable(
  'cart_lines',
  {
    id: id(),
    cartId: text('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('cart_lines_quantity', sql`${t.quantity} between 1 and 99`),
    uniqueIndex('cart_lines_variant').on(t.cartId, t.variantId),
  ],
);

export const checkouts = sqliteTable(
  'checkouts',
  {
    id: id(),
    cartId: text('cart_id').notNull(),
    customerId: text('customer_id'),
    email: text('email'),
    phone: text('phone'),
    acceptsMarketing: bool('accepts_marketing').notNull().default(false),
    shippingAddressJson: text('shipping_address_json'),
    shippingRateId: text('shipping_rate_id'),
    discountCode: text('discount_code'),
    note: text('note'),
    /** [{ variantId, quantity }] frozen when the checkout starts */
    linesJson: text('lines_json').notNull(),
    pricingJson: text('pricing_json'),
    totalAmount: integer('total_amount').notNull().default(0),
    currency: text('currency').notNull(),
    provider: text('provider'),
    providerRef: text('provider_ref'),
    status: text('status', { enum: ['open', 'completed', 'expired'] }).notNull().default('open'),
    expiresAt: integer('expires_at').notNull(),
    orderId: text('order_id'),
    /** raw confirmation token, kept so a refresh of the confirmation step still works */
    orderToken: text('order_token'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('checkouts_status', sql`${t.status} in ('open','completed','expired')`),
    index('checkouts_cart').on(t.cartId),
    index('checkouts_status_expires').on(t.status, t.expiresAt),
  ],
);

/* ─────────────────────────── orders ─────────────────────────── */

export const orderCounters = sqliteTable(
  'order_counters',
  {
    id: integer('id').primaryKey(),
    nextNumber: integer('next_number').notNull(),
  },
  (t) => [check('order_counters_singleton', sql`${t.id} = 1`)],
);

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    number: integer('number').notNull().unique(),
    /** one order per checkout — the double-submit guard */
    checkoutId: text('checkout_id').unique(),
    customerId: text('customer_id'),
    email: text('email').notNull(),
    phone: text('phone'),
    status: text('status', {
      enum: ['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded'],
    }).notNull(),
    paymentStatus: text('payment_status', { enum: ['unpaid', 'paid', 'partially_refunded', 'refunded'] }).notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    currency: text('currency').notNull(),
    subtotalAmount: integer('subtotal_amount').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    shippingAmount: integer('shipping_amount').notNull().default(0),
    shippingDiscountAmount: integer('shipping_discount_amount').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    refundedAmount: integer('refunded_amount').notNull().default(0),
    pricesIncludeTax: bool('prices_include_tax').notNull(),
    pricingJson: text('pricing_json').notNull(),
    shippingAddressJson: text('shipping_address_json'),
    shippingMethod: text('shipping_method'),
    discountCodesJson: text('discount_codes_json').notNull().default('[]'),
    note: text('note'),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at'),
    placedAt: integer('placed_at').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'orders_status',
      sql`${t.status} in ('pending','paid','fulfilled','shipped','delivered','cancelled','refunded')`,
    ),
    check('orders_payment_status', sql`${t.paymentStatus} in ('unpaid','paid','partially_refunded','refunded')`),
    check('orders_refund_cap', sql`${t.refundedAmount} >= 0 AND ${t.refundedAmount} <= ${t.totalAmount}`),
    index('orders_status_placed').on(t.status, t.placedAt),
    index('orders_customer_placed').on(t.customerId, t.placedAt),
    index('orders_email').on(t.email),
    index('orders_placed').on(t.placedAt),
  ],
);

export const orderLines = sqliteTable(
  'order_lines',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id'),
    variantId: text('variant_id'),
    productHandle: text('product_handle'),
    title: text('title').notNull(),
    variantTitle: text('variant_title').notNull().default(''),
    sku: text('sku'),
    mediaId: text('media_id'),
    quantity: integer('quantity').notNull(),
    unitPriceAmount: integer('unit_price_amount').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    requiresShipping: bool('requires_shipping').notNull().default(true),
    inventoryTracked: bool('inventory_tracked').notNull().default(true),
    fulfilledQuantity: integer('fulfilled_quantity').notNull().default(0),
    refundedQuantity: integer('refunded_quantity').notNull().default(0),
    restockedQuantity: integer('restocked_quantity').notNull().default(0),
  },
  (t) => [
    check('order_lines_refunded', sql`${t.refundedQuantity} >= 0 AND ${t.refundedQuantity} <= ${t.quantity}`),
    check('order_lines_restocked', sql`${t.restockedQuantity} >= 0 AND ${t.restockedQuantity} <= ${t.quantity}`),
    index('order_lines_order').on(t.orderId),
    index('order_lines_product').on(t.productId),
  ],
);

export const orderTaxLines = sqliteTable(
  'order_tax_lines',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    orderLineId: text('order_line_id'),
    name: text('name').notNull(),
    rateBps: integer('rate_bps').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [index('order_tax_lines_order').on(t.orderId)],
);

/** Append-only audit trail (enforced by triggers in the search migration). */
export const orderEvents = sqliteTable(
  'order_events',
  {
    id: id(),
    orderId: text('order_id').notNull(),
    type: text('type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorType: text('actor_type', { enum: ['system', 'customer', 'staff', 'webhook'] }).notNull(),
    actorId: text('actor_id'),
    message: text('message').notNull(),
    dataJson: text('data_json'),
    customerVisible: bool('customer_visible').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order').on(t.orderId, t.createdAt)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    orderId: text('order_id'),
    checkoutId: text('checkout_id'),
    provider: text('provider').notNull(),
    kind: text('kind', { enum: ['sale', 'refund'] }).notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] }).notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    providerRef: text('provider_ref'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payments_order').on(t.orderId)],
);

export const refunds = sqliteTable(
  'refunds',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason'),
    restock: bool('restock').notNull().default(false),
    linesJson: text('lines_json').notNull().default('[]'),
    providerRef: text('provider_ref'),
    status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
    staffId: text('staff_id'),
    createdAt: createdAt(),
  },
  (t) => [index('refunds_order').on(t.orderId)],
);

export const fulfillments = sqliteTable(
  'fulfillments',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['fulfilled', 'shipped', 'delivered', 'cancelled'] }).notNull(),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    shippedAt: integer('shipped_at'),
    deliveredAt: integer('delivered_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('fulfillments_order').on(t.orderId)],
);

export const fulfillmentLines = sqliteTable(
  'fulfillment_lines',
  {
    fulfillmentId: text('fulfillment_id').notNull().references(() => fulfillments.id, { onDelete: 'cascade' }),
    orderLineId: text('order_line_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fulfillmentId, t.orderLineId] })],
);

/** Idempotency ledger for payment-provider webhooks. */
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] }), index('webhook_events_received').on(t.receivedAt)],
);

/* ─────────────────────────── discounts ─────────────────────────── */

export const discounts = sqliteTable(
  'discounts',
  {
    id: id(),
    code: text('code').notNull().unique(),
    title: text('title').notNull().default(''),
    type: text('type', { enum: ['percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y'] }).notNull(),
    value: integer('value').notNull().default(0),
    appliesTo: text('applies_to', { enum: ['all', 'products', 'collections'] }).notNull().default('all'),
    minSubtotalAmount: integer('min_subtotal_amount'),
    minQuantity: integer('min_quantity'),
    usageLimit: integer('usage_limit'),
    usageLimitPerCustomer: integer('usage_limit_per_customer'),
    usageCount: integer('usage_count').notNull().default(0),
    buyQuantity: integer('buy_quantity'),
    getQuantity: integer('get_quantity'),
    maxUsesPerOrder: integer('max_uses_per_order'),
    startsAt: integer('starts_at').notNull(),
    endsAt: integer('ends_at'),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('discounts_type', sql`${t.type} in ('percentage','fixed_amount','free_shipping','buy_x_get_y')`),
    // the over-redemption guard: an increment past the limit aborts the batch
    check('discounts_usage', sql`${t.usageLimit} IS NULL OR ${t.usageCount} <= ${t.usageLimit}`),
  ],
);

export const discountTargets = sqliteTable(
  'discount_targets',
  {
    discountId: text('discount_id').notNull().references(() => discounts.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['product', 'collection'] }).notNull(),
    targetId: text('target_id').notNull(),
    role: text('role', { enum: ['applies', 'buy', 'get'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.discountId, t.targetType, t.targetId, t.role] })],
);

export const discountRedemptions = sqliteTable(
  'discount_redemptions',
  {
    id: id(),
    discountId: text('discount_id').notNull(),
    orderId: text('order_id').notNull(),
    customerId: text('customer_id'),
    email: text('email').notNull(),
    amount: integer('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('discount_redemptions_order').on(t.discountId, t.orderId),
    index('discount_redemptions_email').on(t.discountId, t.email),
  ],
);

/* ─────────────────────────── shipping & tax ─────────────────────────── */

export const shippingZones = sqliteTable('shipping_zones', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const shippingZoneRegions = sqliteTable(
  'shipping_zone_regions',
  {
    id: id(),
    zoneId: text('zone_id').notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    regionCode: text('region_code'),
  },
  // A country (or country + region) belongs to exactly one zone. That unique
  // index is an expression over coalesce(region_code, ''), which drizzle-kit
  // cannot emit correctly, so it lives in migrations/0001.
  (t) => [index('shipping_zone_regions_zone').on(t.zoneId)],
);

export const shippingRates = sqliteTable(
  'shipping_rates',
  {
    id: id(),
    zoneId: text('zone_id').notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: ['flat', 'weight', 'price'] }).notNull(),
    amount: integer('amount').notNull(),
    minValue: integer('min_value'),
    maxValue: integer('max_value'),
    deliveryEstimate: text('delivery_estimate'),
    active: bool('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('shipping_rates_type', sql`${t.type} in ('flat','weight','price')`), index('shipping_rates_zone').on(t.zoneId)],
);

export const taxRates = sqliteTable(
  'tax_rates',
  {
    id: id(),
    countryCode: text('country_code').notNull(),
    regionCode: text('region_code'),
    name: text('name').notNull(),
    rateBps: integer('rate_bps').notNull(),
    appliesToShipping: bool('applies_to_shipping').notNull().default(false),
    active: bool('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // unique (country, coalesce(region, ''), name) lives in migrations/0001 — see shipping_zone_regions
  (t) => [check('tax_rates_bps', sql`${t.rateBps} between 0 and 10000`), index('tax_rates_country').on(t.countryCode)],
);

/* ─────────────────────────── operations ─────────────────────────── */

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    staffId: text('staff_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    diffJson: text('diff_json'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created').on(t.createdAt), index('audit_log_entity').on(t.entityType, t.entityId)],
);

export const csvImports = sqliteTable('csv_imports', {
  id: id(),
  staffId: text('staff_id'),
  r2Key: text('r2_key').notNull(),
  status: text('status', { enum: ['queued', 'processing', 'completed', 'failed'] }).notNull(),
  summaryJson: text('summary_json'),
  errorsJson: text('errors_json').notNull().default('[]'),
  createdAt: createdAt(),
  finishedAt: integer('finished_at'),
});
