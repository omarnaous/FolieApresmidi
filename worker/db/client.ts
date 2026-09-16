import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type DB = ReturnType<typeof createDb>;
export { schema };

/** JSON columns: parse defensively, never throw on a bad row. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
