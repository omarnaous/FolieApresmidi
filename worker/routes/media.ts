import { Hono } from 'hono';
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
async function importOnce(env: Env, key: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT source_url FROM media WHERE r2_key = ?').bind(key).first<{ source_url: string | null }>();
  if (!row?.source_url || !/^https:\/\//i.test(row.source_url)) return false;
  const res = await fetch(row.source_url, { headers: { 'user-agent': 'fdm-media-import' } });
  if (!res.ok) return false;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) return false;
  const kind = sniffImage(bytes);
  if (!kind) return false;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: kind.mime, cacheControl: IMMUTABLE } });
  await env.DB.prepare('UPDATE media SET bytes = ?, mime = ? WHERE r2_key = ?').bind(bytes.byteLength, kind.mime, key).run();
  return true;
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

  let object = await c.env.MEDIA.get(key);
  if (!object && (await importOnce(c.env, key).catch(() => false))) object = await c.env.MEDIA.get(key);
  if (!object) return c.text('Not found', 404);

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const w = Number(c.req.query('w'));
  if (!w || !Number.isFinite(w) || type === 'image/gif') {
    return new Response(object.body, { headers: headers(type, object.httpEtag) });
  }

  const width = snapWidth(w);
  try {
    const result = await c.env.IMAGES.input(object.body).transform({ width, fit: 'scale-down' }).output({ format: 'image/webp', quality: 82 });
    const res = result.response();
    return new Response(res.body, { headers: headers('image/webp') });
  } catch (err) {
    // the Images binding can be unavailable locally — fall back to the original
    log.warn('image_transform_failed', { key, width, ...errorFields(err) });
    const original = await c.env.MEDIA.get(key);
    if (!original) return c.text('Not found', 404);
    return new Response(original.body, { headers: { ...headers(type, original.httpEtag), 'cache-control': 'public, max-age=300' } });
  }
});
