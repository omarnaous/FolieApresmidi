import { Hono } from 'hono';
import { PageInput, SettingsInput, type AdminPageDTO } from '../../../shared/api';
import { purge, TAGS } from '../../lib/cache';
import { invalid, notFound } from '../../lib/errors';
import { slugify, ulid } from '../../lib/ids';
import { sanitizeHtml } from '../../lib/sanitize';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { getSettings, settingsDTO } from '../../services/settings';
import type { AppEnv } from '../../types';

/** Store settings and content/policy pages. */
export const adminSettings = new Hono<AppEnv>();

adminSettings.get('/settings', staffOnly('settings:write'), async (c) => {
  const db = c.get('db');
  return c.json(await settingsDTO(db, await getSettings(db)));
});

adminSettings.put('/settings', staffOnly('settings:write'), json(SettingsInput), async (c) => {
  const s = c.req.valid('json');
  const d1 = c.env.DB;
  if (s.logoMediaId && !(await d1.prepare('SELECT id FROM media WHERE id = ?').bind(s.logoMediaId).first())) {
    throw invalid({ logoMediaId: 'That image no longer exists' });
  }
  const handles = [s.featuredCollectionHandle, s.lookbookCollectionHandle, s.editorialCollectionHandle, ...s.menu.map((m) => m.collectionHandle)].filter((h): h is string => !!h);
  if (handles.length) {
    const { results } = await d1.prepare(`SELECT handle FROM collections WHERE handle IN (${handles.map(() => '?').join(',')})`).bind(...handles).all<{ handle: string }>();
    const known = new Set(results.map((r) => r.handle));
    const missing = handles.find((h) => !known.has(h));
    if (missing) throw invalid({ menu: `There is no collection with the handle "${missing}"` });
  }
  await d1
    .prepare(
      `UPDATE store_settings SET name = ?, currency = ?, contact_email = ?, contact_phone = ?, instagram = ?, address = ?, logo_media_id = ?, menu_json = ?,
              featured_collection_handle = ?, lookbook_collection_handle = ?, editorial_collection_handle = ?, low_stock_threshold = ?,
              checkout_hold_minutes = ?, abandoned_cart_emails = ?, order_notification_email = ?, updated_at = ?
        WHERE id = 1`,
    )
    .bind(
      s.name, s.currency, s.contactEmail, s.contactPhone, s.instagram, s.address, s.logoMediaId, JSON.stringify(s.menu),
      s.featuredCollectionHandle, s.lookbookCollectionHandle, s.editorialCollectionHandle, s.lowStockThreshold,
      s.checkoutHoldMinutes, s.abandonedCartEmails ? 1 : 0, s.orderNotificationEmail, Date.now(),
    )
    .run();
  purge(c.executionCtx, [TAGS.catalog, TAGS.products, TAGS.collections]);
  await audit(c, 'settings.updated', 'settings', null, 'Updated store settings');
  const db = c.get('db');
  return c.json(await settingsDTO(db, await getSettings(db)));
});

/* ─────────── pages ─────────── */

const pageDTO = (r: Record<string, unknown>): AdminPageDTO => ({
  id: r.id as string,
  handle: r.handle as string,
  title: r.title as string,
  kind: r.kind as AdminPageDTO['kind'],
  bodyHtml: r.body_html as string,
  published: !!r.published,
  seoTitle: (r.seo_title as string | null) ?? null,
  seoDescription: (r.seo_description as string | null) ?? null,
  updatedAt: r.updated_at as number,
});

async function pageHandle(d1: D1Database, wanted: string, id: string, explicit: boolean) {
  const base = slugify(wanted);
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await d1.prepare('SELECT id FROM pages WHERE handle = ? AND id != ?').bind(candidate, id).first())) return candidate;
    if (explicit) throw invalid({ handle: 'Another page already uses this handle' });
  }
  return `${base}-${id.slice(-6).toLowerCase()}`;
}

adminSettings.get('/pages', staffOnly('pages:write'), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM pages ORDER BY kind, title COLLATE NOCASE').all<Record<string, unknown>>();
  return c.json({ items: results.map(pageDTO) });
});

adminSettings.post('/pages', staffOnly('pages:write'), json(PageInput), async (c) => {
  const p = c.req.valid('json');
  const d1 = c.env.DB;
  const now = Date.now();
  const id = ulid(now);
  const handle = await pageHandle(d1, p.handle ?? p.title, id, !!p.handle);
  await d1
    .prepare('INSERT INTO pages (id, handle, kind, title, body_html, published, seo_title, seo_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, handle, p.kind, p.title, await sanitizeHtml(p.bodyHtml), p.published ? 1 : 0, p.seoTitle, p.seoDescription, now, now)
    .run();
  purge(c.executionCtx, [TAGS.catalog]);
  await audit(c, 'page.created', 'page', id, `Created page "${p.title}"`);
  return c.json(pageDTO((await d1.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Record<string, unknown>>())!), 201);
});

adminSettings.get('/pages/:id', staffOnly('pages:write'), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) throw notFound('Page not found');
  return c.json(pageDTO(row));
});

adminSettings.put('/pages/:id', staffOnly('pages:write'), json(PageInput), async (c) => {
  const p = c.req.valid('json');
  const d1 = c.env.DB;
  const id = c.req.param('id');
  const row = await d1.prepare('SELECT handle FROM pages WHERE id = ?').bind(id).first<{ handle: string }>();
  if (!row) throw notFound('Page not found');
  const handle = await pageHandle(d1, p.handle ?? row.handle, id, !!p.handle && p.handle !== row.handle);
  await d1
    .prepare('UPDATE pages SET handle = ?, kind = ?, title = ?, body_html = ?, published = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?')
    .bind(handle, p.kind, p.title, await sanitizeHtml(p.bodyHtml), p.published ? 1 : 0, p.seoTitle, p.seoDescription, Date.now(), id)
    .run();
  purge(c.executionCtx, [TAGS.catalog, `page:${id}`]);
  await audit(c, 'page.updated', 'page', id, `Updated page "${p.title}"`);
  return c.json(pageDTO((await d1.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Record<string, unknown>>())!));
});

adminSettings.delete('/pages/:id', staffOnly('pages:write'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT title FROM pages WHERE id = ?').bind(id).first<{ title: string }>();
  if (!row) throw notFound('Page not found');
  await c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
  purge(c.executionCtx, [TAGS.catalog, `page:${id}`]);
  await audit(c, 'page.deleted', 'page', id, `Deleted page "${row.title}"`);
  return c.body(null, 204);
});
