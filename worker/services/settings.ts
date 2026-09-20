import { eq } from 'drizzle-orm';
import type { MenuItemDTO, OrderEmailDTO, SettingsDTO, SizeChartDTO } from '../../shared/api';
import { parseJson, schema, type DB } from '../db/client';
import { mediaById } from './media';

export type SettingsRow = typeof schema.storeSettings.$inferSelect;

export interface StoreSettings extends Omit<SettingsRow, 'menuJson'> {
  menu: MenuItemDTO[];
}

const DEFAULTS: SettingsRow = {
  id: 1,
  name: 'Store',
  currency: 'USD',
  pricesIncludeTax: true,
  contactEmail: null,
  contactPhone: null,
  instagram: null,
  address: null,
  logoMediaId: null,
  menuJson: '[]',
  homeJson: '{}',
  sizeChartJson: '{}',
  orderEmailJson: '{}',
  newsletterWelcomeCode: null,
  featuredCollectionHandle: null,
  lookbookCollectionHandle: null,
  editorialCollectionHandle: null,
  lowStockThreshold: 3,
  checkoutHoldMinutes: 15,
  // the shop writes to a shopper once, to confirm the order they placed;
  // the reminder is here to be switched on, not to be on by default
  abandonedCartEmails: false,
  orderNotificationEmail: null,
  updatedAt: 0,
};

/**
 * Until the owner fills it in: the sizes the store sells and the measurements
 * worth listing, with no numbers invented for the garments. A chart with no
 * numbers in it is not shown on a product.
 */
const SIZE_CHART_DEFAULT: SizeChartDTO = {
  heading: 'Size chart',
  intro: 'Garment measurements, laid flat, in centimetres.',
  columns: ['Bust', 'Waist', 'Hip', 'Length'],
  rows: ['Small', 'Medium', 'Large'].map((size) => ({ size, values: ['', '', '', ''] })),
  note: null,
};

/** What the confirmation says until the owner writes their own. */
export const ORDER_EMAIL_DEFAULT: OrderEmailDTO = {
  subject: 'Order {{order}} confirmed — thank you',
  intro: 'We have your order {{order}}, {{name}}. It is being put together by hand; we will write again when it is on its way.',
  signoff: 'Anything at all, simply reply to this email.',
};

/** The stored words, field by field, so a store that has written none still sends. */
export function readOrderEmail(stored: string): OrderEmailDTO {
  const raw = parseJson<Partial<OrderEmailDTO>>(stored, {});
  return {
    subject: raw.subject?.trim() || ORDER_EMAIL_DEFAULT.subject,
    intro: raw.intro?.trim() || ORDER_EMAIL_DEFAULT.intro,
    signoff: raw.signoff === undefined ? ORDER_EMAIL_DEFAULT.signoff : raw.signoff,
  };
}

const cell = (v: unknown) => (typeof v === 'string' ? v : '');

/** The stored chart, falling back field by field, so an older store still reads. */
export function readSizeChart(stored: string): SizeChartDTO {
  const raw = parseJson<Partial<SizeChartDTO>>(stored, {});
  const columns = Array.isArray(raw.columns) ? raw.columns.map(cell) : SIZE_CHART_DEFAULT.columns;
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map((r) => ({ size: cell(r?.size), values: columns.map((_, i) => cell(r?.values?.[i])) }))
    : SIZE_CHART_DEFAULT.rows;
  return {
    heading: raw.heading || SIZE_CHART_DEFAULT.heading,
    intro: raw.intro ?? SIZE_CHART_DEFAULT.intro,
    columns,
    rows,
    note: raw.note ?? null,
  };
}

export async function getSettings(db: DB): Promise<StoreSettings> {
  const row = (await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 1)).get()) ?? DEFAULTS;
  const { menuJson, ...rest } = row;
  return { ...rest, menu: parseJson<MenuItemDTO[]>(menuJson, []) };
}

export async function settingsDTO(db: DB, s: StoreSettings): Promise<SettingsDTO> {
  return {
    name: s.name,
    currency: s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    instagram: s.instagram,
    address: s.address,
    logo: s.logoMediaId ? await mediaById(db, s.logoMediaId) : null,
    menu: s.menu,
    featuredCollectionHandle: s.featuredCollectionHandle,
    lookbookCollectionHandle: s.lookbookCollectionHandle,
    editorialCollectionHandle: s.editorialCollectionHandle,
    lowStockThreshold: s.lowStockThreshold,
    checkoutHoldMinutes: s.checkoutHoldMinutes,
    abandonedCartEmails: s.abandonedCartEmails,
    orderNotificationEmail: s.orderNotificationEmail,
    sizeChart: readSizeChart(s.sizeChartJson),
    orderEmail: readOrderEmail(s.orderEmailJson),
    updatedAt: s.updatedAt,
  };
}
