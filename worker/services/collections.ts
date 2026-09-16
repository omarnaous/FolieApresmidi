import type { CollectionRuleField, CollectionRuleOp } from '../../shared/api';
import { parseJson } from '../db/client';
import { chunk } from './media';

export interface RuleSet {
  match: 'all' | 'any';
  conditions: { field: CollectionRuleField; op: CollectionRuleOp; value: string }[];
}

const AVAILABLE_VARIANT = `EXISTS (SELECT 1 FROM variants av WHERE av.product_id = p.id
  AND (av.inventory_tracked = 0 OR av.inventory_policy = 'continue' OR av.inventory_on_hand > 0))`;

const likeEscape = (s: string) => s.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Smart-collection rules → a SQL predicate over `products p`. Every value is
 * bound, never interpolated. An empty rule set matches nothing (a smart
 * collection with no conditions is a mistake, not "everything").
 */
export function ruleSql(rules: RuleSet): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];

  for (const c of rules.conditions) {
    const text = (column: string) => {
      if (c.op === 'contains') {
        params.push(`%${likeEscape(c.value)}%`);
        return `lower(${column}) LIKE ? ESCAPE '\\'`;
      }
      params.push(c.value);
      return c.op === 'neq' ? `lower(coalesce(${column}, '')) != lower(?)` : `lower(coalesce(${column}, '')) = lower(?)`;
    };

    switch (c.field) {
      case 'tag': {
        params.push(c.value);
        const exists = `EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id AND lower(t.name) = lower(?))`;
        parts.push(c.op === 'neq' ? `NOT ${exists}` : exists);
        break;
      }
      case 'product_type':
        parts.push(text('p.product_type'));
        break;
      case 'vendor':
        parts.push(text('p.vendor'));
        break;
      case 'title':
        parts.push(text('p.title'));
        break;
      case 'price': {
        const cents = Number.parseInt(c.value, 10);
        if (!Number.isFinite(cents)) {
          parts.push('0');
          break;
        }
        params.push(cents);
        parts.push(`(SELECT MIN(pv.price_amount) FROM variants pv WHERE pv.product_id = p.id) ${c.op === 'lt' ? '<' : '>'} ?`);
        break;
      }
      case 'in_stock':
        parts.push(c.value === 'false' ? `NOT ${AVAILABLE_VARIANT}` : AVAILABLE_VARIANT);
        break;
    }
  }

  if (parts.length === 0) return { sql: '0', params: [] };
  return { sql: `(${parts.join(rules.match === 'any' ? ' OR ' : ' AND ')})`, params };
}

export const parseRules = (json: string): RuleSet => parseJson<RuleSet>(json, { match: 'all', conditions: [] });

/** Recompute one smart collection's membership (or, with productIds, only those products). */
export async function rematerialize(d1: D1Database, collectionId: string, productIds?: string[]): Promise<void> {
  const row = await d1.prepare(`SELECT type, rules_json FROM collections WHERE id = ?`).bind(collectionId).first<{ type: string; rules_json: string }>();
  if (!row || row.type !== 'smart') return;
  const { sql, params } = ruleSql(parseRules(row.rules_json));

  if (!productIds) {
    await d1.batch([
      d1.prepare('DELETE FROM collection_products WHERE collection_id = ?').bind(collectionId),
      d1
        .prepare(`INSERT INTO collection_products (collection_id, product_id, position) SELECT ?, p.id, p.position FROM products p WHERE ${sql}`)
        .bind(collectionId, ...params),
    ]);
    return;
  }

  for (const ids of chunk(productIds, Math.max(1, 90 - params.length))) {
    const marks = ids.map(() => '?').join(',');
    await d1.batch([
      d1.prepare(`DELETE FROM collection_products WHERE collection_id = ? AND product_id IN (${marks})`).bind(collectionId, ...ids),
      d1
        .prepare(
          `INSERT INTO collection_products (collection_id, product_id, position)
           SELECT ?, p.id, p.position FROM products p WHERE p.id IN (${marks}) AND ${sql}`,
        )
        .bind(collectionId, ...ids, ...params),
    ]);
  }
}

/** After products change: re-evaluate every smart collection for those products. */
export async function rematerializeForProducts(d1: D1Database, productIds: string[]): Promise<void> {
  const { results } = await d1.prepare(`SELECT id FROM collections WHERE type = 'smart'`).all<{ id: string }>();
  for (const c of results) await rematerialize(d1, c.id, productIds);
}
