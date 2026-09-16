import { Hono } from 'hono';
import { imagesBinding, mediaBucket } from '../lib/bindings';
import { snapWidth, sniffImage } from '../lib/images';
import { errorFields, log } from '../lib/log';
import type { AppEnv } from '../types';

export const media = new Hono<AppEnv>();

const KEY = /^(products|imports-media|brand)\/[a-z0-9/_-]+\.(jpg|jpeg|png|webp|avif|gif)$/i;
const IMMUTABLE = 'public, max-age=31536000, immutable';

const headers = (contentType: string, etag?: string) => ({
  'content-type': contentType,
  'cache-control': IMMUTABLE,
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'",
  // email clients and social previews load these from other origins
  'cross-origin-resource-policy': 'cross-origin',
  ...(etag ? { etag } : {}),
});

/** Imported images live at their original URL until first requested, then in R2. */
async function sourceUrl(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT source_url FROM media WHERE r2_key = ?').bind(key).first<{ source_url: string | null }>();
  return row?.source_url && /^https:\/\//i.test(row.source_url) ? row.source_url : null;
}

async function importOnce(env: Env, key: string): Promise<boolean> {
  const bucket = mediaBucket(env);
  const url = bucket ? await sourceUrl(env, key) : null;
  if (!url) return false;
  const res = await fetch(url, { headers: { 'user-agent': 'fdm-media-import' } });
  if (!res.ok) return false;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) return false;
  const kind = sniffImage(bytes);
  if (!kind) return false;
  await bucket!.put(key, bytes, { httpMetadata: { contentType: kind.mime, cacheControl: IMMUTABLE } });
  await env.DB.prepare('UPDATE media SET bytes = ?, mime = ? WHERE r2_key = ?').bind(bytes.byteLength, kind.mime, key).run();
  return true;
}

/**
 * No R2 to cache into (the free-plan preview environment): serve the image
 * straight from where it was imported from, so the catalog still has pictures.
 */
async function proxySource(env: Env, key: string): Promise<Response | null> {
  const url = await sourceUrl(env, key);
  if (!url) return null;
  const res = await fetch(url, { headers: { 'user-agent': 'fdm-media-proxy' }, cf: { cacheEverything: true } });
  if (!res.ok) return null;
  return new Response(res.body, { headers: headers(res.headers.get('content-type') ?? 'image/jpeg') });
}

/**
 * GET /media/<key>[?w=640] — originals from R2; `w` returns a WebP resized by
 * the Images binding (widths snap to a fixed set). Keys are unique per upload,
 * so every response is immutable and Workers Cache serves repeats.
 */
media.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice('/media/'.length));
  // anything that is not an R2 key (e.g. the brand frames in public/media/ig) is a static file
  if (!KEY.test(key) || key.includes('..')) return c.env.ASSETS.fetch(c.req.raw);

  const bucket = mediaBucket(c.env);
  if (!bucket) return (await proxySource(c.env, key).catch(() => null)) ?? c.text('Not found', 404);

  let object = await bucket.get(key);
  if (!object && (await importOnce(c.env, key).catch(() => false))) object = await bucket.get(key);
  if (!object) return c.text('Not found', 404);

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const w = Number(c.req.query('w'));
  if (!w || !Number.isFinite(w) || type === 'image/gif') {
    return new Response(object.body, { headers: headers(type, object.httpEtag) });
  }

  const width = snapWidth(w);
  const images = imagesBinding(c.env);
  try {
    if (!images) throw new Error('no IMAGES binding');
    const result = await images.input(object.body).transform({ width, fit: 'scale-down' }).output({ format: 'image/webp', quality: 82 });
    const res = result.response();
    return new Response(res.body, { headers: headers('image/webp') });
  } catch (err) {
    // the Images binding can be unavailable locally — fall back to the original
    log.warn('image_transform_failed', { key, width, ...errorFields(err) });
    const original = await bucket.get(key);
    if (!original) return c.text('Not found', 404);
    return new Response(original.body, { headers: { ...headers(type, original.httpEtag), 'cache-control': 'public, max-age=300' } });
  }
});
