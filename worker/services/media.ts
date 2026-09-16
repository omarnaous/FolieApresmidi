import { eq, inArray } from 'drizzle-orm';
import type { MediaDTO } from '../../shared/api';
import { schema, type DB } from '../db/client';

export type MediaRow = typeof schema.media.$inferSelect;

export const mediaUrl = (r2Key: string) => `/media/${r2Key}`;

export const toMediaDTO = (m: Pick<MediaRow, 'id' | 'r2Key' | 'alt' | 'width' | 'height'>): MediaDTO => ({
  id: m.id,
  url: mediaUrl(m.r2Key),
  alt: m.alt,
  width: m.width,
  height: m.height,
});

export async function mediaById(db: DB, id: string): Promise<MediaDTO | null> {
  const row = await db.select().from(schema.media).where(eq(schema.media.id, id)).get();
  return row ? toMediaDTO(row) : null;
}

/** D1 allows 100 bound parameters per statement; every IN (…) list goes through this. */
export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Same as mediaByIds, for code that only holds the raw D1 binding (jobs, batch services). */
export async function mediaByIdsRaw(d1: D1Database, ids: string[]): Promise<Map<string, MediaDTO>> {
  const map = new Map<string, MediaDTO>();
  for (const part of chunk([...new Set(ids.filter(Boolean))])) {
    const { results } = await d1
      .prepare(`SELECT id, r2_key, alt, width, height FROM media WHERE id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ id: string; r2_key: string; alt: string; width: number | null; height: number | null }>();
    for (const m of results) map.set(m.id, toMediaDTO({ id: m.id, r2Key: m.r2_key, alt: m.alt, width: m.width, height: m.height }));
  }
  return map;
}

export async function mediaByIds(db: DB, ids: string[]): Promise<Map<string, MediaDTO>> {
  const map = new Map<string, MediaDTO>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (const part of chunk(unique)) {
    const rows = await db.select().from(schema.media).where(inArray(schema.media.id, part)).all();
    for (const r of rows) map.set(r.id, toMediaDTO(r));
  }
  return map;
}
