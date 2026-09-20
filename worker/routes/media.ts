import { Hono } from 'hono';
import { imagesBinding, mediaBucket } from '../lib/bindings';
import { snapWidth, sniffImage } from '../lib/images';
import { getKvMedia } from '../lib/media-store';
import { errorFields, log } from '../lib/log';
import { parseRange } from '../lib/range';
import type { AppEnv, Ctx } from '../types';

export const media = new Hono<AppEnv>();

const KEY = /^(products|imports-media|brand)\/[a-z0-9/_-]+\.(jpg|jpeg|png|webp|avif|gif|mp4|pdf)$/i;
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
 *
 * With no Images binding there is nothing here to resize with either — but
 * the place these came from can do it. Where the source URL already carries a
 * `width`, the width the page asked for is put in its place, so a phone is
 * sent a phone-sized photograph instead of a two-thousand-pixel one. A source
 * that says nothing about width is fetched as it is.
 */
async function proxySource(env: Env, key: string, want?: number): Promise<Response | null> {
  const url = await sourceUrl(env, key);
  if (!url) return null;
  let asked = url;
  if (want) {
    const u = new URL(url);
    if (u.searchParams.has('width')) {
      u.searchParams.set('width', String(snapWidth(want)));
      asked = u.toString();
    }
  }
  const res = await fetch(asked, { headers: { 'user-agent': 'fdm-media-proxy' }, cf: { cacheEverything: true } });
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
  if (!bucket) {
    /* No R2: the shop keeps what it was given in KV, and what it imported
       stays at the URL it came from. Either way the catalogue has pictures. */
    const kept = await getKvMedia(c.env, key).catch(() => null);
    if (kept) return new Response(kept.bytes, { headers: headers(kept.contentType) });
    const asked = Number(c.req.query('w'));
    const width = Number.isFinite(asked) && asked > 0 ? asked : undefined;
    return (await proxySource(c.env, key, width).catch(() => null)) ?? c.text('Not found', 404);
  }

  let object = await bucket.get(key);
  if (!object && (await importOnce(c.env, key).catch(() => false))) object = await bucket.get(key);
  if (!object) return c.text('Not found', 404);

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';

  /* The film and the notebook are not images: nothing to resize, and a video
     has to answer Range requests or Safari will not play it. */
  if (type.startsWith('video/')) return ranged(c, bucket, key, object, type);
  if (type === 'application/pdf') {
    return new Response(object.body, { headers: { ...headers(type, object.httpEtag), 'content-disposition': 'inline' } });
  }

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

/** One R2 object, whole or by the range asked for — R2 slices it, so nothing is buffered here. */
async function ranged(c: Ctx, bucket: R2Bucket, key: string, object: R2ObjectBody, type: string): Promise<Response> {
  const size = object.size;
  const base = { ...headers(type, object.httpEtag), 'accept-ranges': 'bytes' };
  const header = c.req.header('range');
  if (!header) return new Response(object.body, { headers: base });

  const range = parseRange(header, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  if (!range) return new Response(object.body, { headers: base });

  const length = range.end - range.start + 1;
  const part = await bucket.get(key, { range: { offset: range.start, length } });
  if (!part?.body) return new Response(object.body, { headers: base });
  return new Response(part.body, {
    status: 206,
    headers: { ...base, 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'content-length': String(length) },
  });
}

const FILM = /^hero-(1080|720|480)\.mp4$/;

/**
 * GET /film/<cut>.mp4 — the hero film. Static assets answer a Range request
 * with the whole file, and Safari will not play a video served that way, so
 * the Worker serves the bytes: the whole file with a cache lifetime (Workers
 * Cache stores it and slices ranges from it), or just the range asked for.
 */
media.get('/film/:name', async (c) => {
  const name = c.req.param('name');
  if (!FILM.test(name)) return c.env.ASSETS.fetch(c.req.raw);

  // a bare URL: no Range or conditional headers reach the asset store
  const asset = await c.env.ASSETS.fetch(c.req.url);
  if (!asset.ok || !asset.body) return asset;

  const etag = asset.headers.get('etag');
  const base = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=86400',
    'x-content-type-options': 'nosniff',
    ...(etag ? { etag } : {}),
  };

  const header = c.req.header('range');
  if (!header) return new Response(asset.body, { headers: base });

  const bytes = await asset.arrayBuffer();
  const size = bytes.byteLength;
  const range = parseRange(header, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  if (!range) return new Response(bytes, { headers: base });
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    headers: { ...base, 'content-range': `bytes ${range.start}-${range.end}/${size}` },
  });
});
