import type { SavedAddressDTO } from '../../shared/api';

export interface CustomerRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  phone: string | null;
  email_verified_at: number | null;
  accepts_marketing: number;
  session_epoch: number;
  note: string | null;
  orders_count: number;
  total_spent_amount: number;
  last_order_at: number | null;
  created_at: number;
  updated_at: number;
}

export const customerById = (d1: D1Database, id: string) => d1.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<CustomerRow>();

export const addressDTO = (a: Record<string, unknown>): SavedAddressDTO => ({
  id: a.id as string,
  name: a.name as string,
  phone: a.phone as string,
  line1: a.line1 as string,
  line2: a.line2 as string,
  city: a.city as string,
  region: (a.region as string | null) ?? null,
  postalCode: (a.postal_code as string | null) ?? null,
  countryCode: a.country_code as string,
  notes: (a.notes as string | null) ?? null,
  isDefault: !!a.is_default,
});

export const passwordIterations = (env: Env): number => {
  const n = Number(env.PASSWORD_ITERATIONS);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100_000) : 100_000;
};
