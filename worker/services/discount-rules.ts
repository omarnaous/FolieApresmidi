import type { DiscountDTO } from '../../shared/api';
import type { schema } from '../db/client';
import type { DiscountRule, Targets } from '../domain/discounts';

type DiscountRow = typeof schema.discounts.$inferSelect;
interface TargetRow {
  discount_id: string;
  target_type: 'product' | 'collection';
  target_id: string;
  role: 'applies' | 'buy' | 'get';
}

const targetsFor = (rows: TargetRow[], role: TargetRow['role']): Targets => ({
  productIds: rows.filter((t) => t.role === role && t.target_type === 'product').map((t) => t.target_id),
  collectionIds: rows.filter((t) => t.role === role && t.target_type === 'collection').map((t) => t.target_id),
});

interface RawDiscount {
  id: string;
  code: string;
  title: string;
  type: DiscountRow['type'];
  value: number;
  applies_to: DiscountRow['appliesTo'];
  min_subtotal_amount: number | null;
  min_quantity: number | null;
  usage_limit: number | null;
  usage_limit_per_customer: number | null;
  usage_count: number;
  buy_quantity: number | null;
  get_quantity: number | null;
  max_uses_per_order: number | null;
  starts_at: number;
  ends_at: number | null;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
}

export function toDiscountDTO(d: RawDiscount, targets: TargetRow[]): DiscountDTO {
  return {
    id: d.id,
    code: d.code,
    title: d.title,
    type: d.type,
    value: d.value,
    appliesTo: d.applies_to,
    targets: targetsFor(targets, 'applies'),
    minSubtotal: d.min_subtotal_amount,
    minQuantity: d.min_quantity,
    usageLimit: d.usage_limit,
    usageLimitPerCustomer: d.usage_limit_per_customer,
    usageCount: d.usage_count,
    buyX: d.type === 'buy_x_get_y' && d.buy_quantity ? { quantity: d.buy_quantity, targets: targetsFor(targets, 'buy') } : null,
    getY: d.type === 'buy_x_get_y' && d.get_quantity ? { quantity: d.get_quantity, targets: targetsFor(targets, 'get') } : null,
    maxUsesPerOrder: d.max_uses_per_order,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export const toRule = (dto: DiscountDTO): DiscountRule => ({
  id: dto.id,
  code: dto.code,
  title: dto.title,
  type: dto.type,
  value: dto.value,
  appliesTo: dto.appliesTo,
  targets: dto.targets,
  minSubtotal: dto.minSubtotal,
  minQuantity: dto.minQuantity,
  usageLimit: dto.usageLimit,
  usageCount: dto.usageCount,
  usageLimitPerCustomer: dto.usageLimitPerCustomer,
  buyX: dto.buyX,
  getY: dto.getY,
  maxUsesPerOrder: dto.maxUsesPerOrder,
  startsAt: dto.startsAt,
  endsAt: dto.endsAt,
  status: dto.status,
});

export async function discountDTOs(d1: D1Database, where: string, params: unknown[]): Promise<DiscountDTO[]> {
  const { results } = await d1.prepare(`SELECT * FROM discounts ${where}`).bind(...params).all<RawDiscount>();
  if (results.length === 0) return [];
  const targets: TargetRow[] = [];
  for (let i = 0; i < results.length; i += 80) {
    const part = results.slice(i, i + 80).map((d) => d.id);
    const res = await d1
      .prepare(`SELECT * FROM discount_targets WHERE discount_id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<TargetRow>();
    targets.push(...res.results);
  }
  return results.map((d) => toDiscountDTO(d, targets.filter((t) => t.discount_id === d.id)));
}

export async function discountByCode(d1: D1Database, code: string): Promise<DiscountDTO | null> {
  const [d] = await discountDTOs(d1, 'WHERE code = ?', [code.trim().toUpperCase()]);
  return d ?? null;
}

/** Past redemptions by this shopper (matched by email or account). */
export async function redemptionsBy(d1: D1Database, discountId: string, email: string | null, customerId: string | null): Promise<number> {
  if (!email && !customerId) return 0;
  const row = await d1
    .prepare(`SELECT COUNT(*) AS n FROM discount_redemptions WHERE discount_id = ? AND (email = ? OR (customer_id IS NOT NULL AND customer_id = ?))`)
    .bind(discountId, email ?? '', customerId ?? '')
    .first<{ n: number }>();
  return row?.n ?? 0;
}
