import { Hono } from 'hono';
import { HomeInput, PageInput, SettingsInput, type AdminPageDTO, type SiteFileDTO } from '../../../shared/api';
import { sendEmail } from '../../email/send';
import * as templates from '../../email/templates';
import { canStoreMedia, isKvMediaStore, putMedia } from '../../lib/media-store';
import { purge, TAGS } from '../../lib/cache';
import { AppError, invalid, notFound } from '../../lib/errors';
import { slugify, ulid } from '../../lib/ids';
import { MAX_SITE_FILE_BYTES, sniffSiteFile } from '../../lib/images';
import { mediaUrl } from '../../services/media';
import { sanitizeHtml } from '../../lib/sanitize';
import { json } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { adminHomeDTO, homeFromInput, readHome } from '../../services/home';
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
  const handles = [s.featuredCollectionHandle, s.lookbookCollectionHandle, s.editorialCollectionHandle].filter((h): h is string => !!h);
  if (handles.length) {
    const { results } = await d1.prepare(`SELECT handle FROM collections WHERE handle IN (${handles.map(() => '?').join(',')})`).bind(...handles).all<{ handle: string }>();
    const known = new Set(results.map((r) => r.handle));
    const missing = handles.find((h) => !known.has(h));
    if (missing) throw invalid({ featuredCollectionHandle: `There is no collection with the handle "${missing}"` });
  }
  await d1
    .prepare(
      `UPDATE store_settings SET name = ?, currency = ?, contact_email = ?, contact_phone = ?, instagram = ?, address = ?, logo_media_id = ?,
              featured_collection_handle = ?, lookbook_collection_handle = ?, editorial_collection_handle = ?, low_stock_threshold = ?,
              checkout_hold_minutes = ?, abandoned_cart_emails = ?, order_notification_email = ?, size_chart_json = ?,
              order_email_json = ?, updated_at = ?
        WHERE id = 1`,
    )
    .bind(
      s.name, s.currency, s.contactEmail, s.contactPhone, s.instagram, s.address, s.logoMediaId,
      s.featuredCollectionHandle, s.lookbookCollectionHandle, s.editorialCollectionHandle, s.lowStockThreshold,
      s.checkoutHoldMinutes, s.abandonedCartEmails ? 1 : 0, s.orderNotificationEmail, JSON.stringify(s.sizeChart),
      JSON.stringify(s.orderEmail), Date.now(),
    )
    .run();
  purge(c.executionCtx, [TAGS.catalog, TAGS.products, TAGS.collections]);
  await audit(c, 'settings.updated', 'settings', null, 'Updated store settings');
  const db = c.get('db');
  return c.json(await settingsDTO(db, await getSettings(db)));
});

/**
 * Proof that the shop can reach the address it tells about its orders.
 * Sent on this request rather than queued: whoever pressed the button is
 * waiting to see it land.
 */
adminSettings.post('/settings/order-email/test', staffOnly('settings:write'), async (c) => {
  const settings = await getSettings(c.get('db'));
  const to = settings.orderNotificationEmail;
  if (!to) throw invalid({ orderNotificationEmail: 'Save an address first, then send a test to it' });
  const brand = { name: settings.name, url: c.env.APP_URL, contactEmail: settings.contactEmail };
  // strict: whoever pressed the button is waiting, so a refusal reaches them
  await sendEmail(c.env, to, templates.orderEmailTest(brand, `${c.env.APP_URL}/admin/orders`), `order-email-test:${Date.now()}`, { strict: true });
  await audit(c, 'settings.order_email_test', 'settings', null, `Sent a test order email to ${to}`);
  return c.body(null, 204);
});

/* ─────────── home page ─────────── */

const homeRow = (d1: D1Database) =>
  d1.prepare('SELECT home_json, updated_at FROM store_settings WHERE id = 1').first<{ home_json: string; updated_at: number }>();

adminSettings.get('/home', staffOnly('settings:write'), async (c) => {
  const row = await homeRow(c.env.DB);
  return c.json(await adminHomeDTO(c.env.DB, readHome(row?.home_json), row?.updated_at ?? 0));
});

/**
 * The two files the site itself uses: the opening film (mp4) and the notebook
 * (pdf) the Limited edition section hands out. One file per request — a film
 * is large — stored beside the brand images and referenced by the home page.
 */
adminSettings.post('/site-files', staffOnly('settings:write'), async (c) => {
  const staff = c.get('staff')!;
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > MAX_SITE_FILE_BYTES + 5 * 1024 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 'That file is too large');

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw invalid({ file: 'Choose a file' });
  if (file.size > MAX_SITE_FILE_BYTES) throw invalid({ file: `${file.name} is larger than ${Math.round(MAX_SITE_FILE_BYTES / 1024 / 1024)} MB` });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffSiteFile(bytes);
  if (!kind) throw invalid({ file: `${file.name} is not an MP4 video or a PDF` });

  if (!canStoreMedia(c.env)) throw new AppError('BAD_REQUEST', 'There is nowhere to keep files in this environment.');
  /* A film is streamed, and streaming means answering for a slice of the file
     rather than all of it — which only R2 can do. Without it the house's own
     opening film plays, and that is said plainly rather than storing a video
     that would refuse to play on a phone. */
  if (kind.mime.startsWith('video/') && isKvMediaStore(c.env)) {
    throw invalid({ file: 'This shop keeps files in KV, which cannot stream video. The house film plays instead — turn on R2 to upload your own.' });
  }
  const now = Date.now();
  const id = ulid(now);
  const key = `brand/${new Date(now).getUTCFullYear()}/${id.toLowerCase()}.${kind.ext}`;
  await putMedia(c.env, key, bytes, kind.mime);
  const name = file.name.slice(0, 120) || `file.${kind.ext}`;
  await c.env.DB.prepare('INSERT INTO media (id, r2_key, source_url, mime, bytes, width, height, alt, created_by, created_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?)')
    .bind(id, key, kind.mime, bytes.byteLength, name, staff.id, now)
    .run();
  await audit(c, 'media.uploaded', 'media', id, `Uploaded ${name}`);

  const body: SiteFileDTO = { id, url: mediaUrl(key), mime: kind.mime, bytes: bytes.byteLength, name };
  return c.json(body, 201);
});

adminSettings.put('/home', staffOnly('settings:write'), json(HomeInput), async (c) => {
  const input = c.req.valid('json');
  const d1 = c.env.DB;
  const home = homeFromInput(input);

  const fields: Record<string, string> = {};
  const mediaIds = [
    ...new Set([
      ...home.floors.flatMap((f) => (f.imageMediaId ? [f.imageMediaId] : [])),
      ...(home.hero.videoMediaId ? [home.hero.videoMediaId] : []),
      ...(home.journal.notebookMediaId ? [home.journal.notebookMediaId] : []),
    ]),
  ];
  if (mediaIds.length) {
    const { results } = await d1.prepare(`SELECT id FROM media WHERE id IN (${mediaIds.map(() => '?').join(',')})`).bind(...mediaIds).all<{ id: string }>();
    const known = new Set(results.map((r) => r.id));
    home.floors.forEach((f, i) => {
      if (f.imageMediaId && !known.has(f.imageMediaId)) fields[`floors.${i}.imageMediaId`] = 'That image no longer exists';
    });
    if (home.hero.videoMediaId && !known.has(home.hero.videoMediaId)) fields['hero.videoMediaId'] = 'That video no longer exists — upload it again';
    if (home.journal.notebookMediaId && !known.has(home.journal.notebookMediaId)) fields['journal.notebookMediaId'] = 'That notebook no longer exists — upload it again';
  }
  const handles = [...new Set(home.floors.flatMap((f) => (f.collectionHandle ? [f.collectionHandle] : [])))];
  if (handles.length) {
    const { results } = await d1.prepare(`SELECT handle FROM collections WHERE handle IN (${handles.map(() => '?').join(',')})`).bind(...handles).all<{ handle: string }>();
    const known = new Set(results.map((r) => r.handle));
    home.floors.forEach((f, i) => {
      if (f.collectionHandle && !known.has(f.collectionHandle)) fields[`floors.${i}.collectionHandle`] = `There is no collection with the handle "${f.collectionHandle}"`;
    });
  }
  if (Object.keys(fields).length) throw invalid(fields);

  const now = Date.now();
  await d1.prepare('UPDATE store_settings SET home_json = ?, updated_at = ? WHERE id = 1').bind(JSON.stringify(home), now).run();
  purge(c.executionCtx, [TAGS.catalog, TAGS.collections]);
  await audit(c, 'home.updated', 'settings', null, 'Updated the home page');
  return c.json(await adminHomeDTO(d1, home, now));
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
