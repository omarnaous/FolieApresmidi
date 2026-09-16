import { eq } from 'drizzle-orm';
import type { MenuItemDTO, SettingsDTO } from '../../shared/api';
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
  featuredCollectionHandle: null,
  lookbookCollectionHandle: null,
  editorialCollectionHandle: null,
  lowStockThreshold: 3,
  checkoutHoldMinutes: 15,
  abandonedCartEmails: true,
  orderNotificationEmail: null,
  updatedAt: 0,
};

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
    updatedAt: s.updatedAt,
  };
}
