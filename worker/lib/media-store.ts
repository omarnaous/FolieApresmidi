import { mediaBucket } from './bindings';
import { AppError } from './errors';

/**
 * Where an uploaded file is kept.
 *
 * R2 is the right home for it and the one a paid shop uses. But R2 asks for a
 * card even on its free tier, and a shop that cannot accept a photograph is
 * not much of a shop — so where there is no bucket, KV takes the file
 * instead. KV is already bound in every environment (it holds the sessions),
 * its free tier is a gigabyte, and a picture is exactly the kind of thing it
 * serves well: written once, read from the edge, never changed.
 *
 * What KV cannot do is hold something large. A value stops at 25 MB, and
 * without R2 there is no Range either, so a film cannot stream out of it.
 * Photographs fit with room to spare; anything that does not is refused in
 * words rather than failing on upload.
 */

/** KV's own ceiling. Kept a little under it so metadata cannot tip a file over. */
export const KV_MAX_BYTES = 24 * 1024 * 1024;
const PREFIX = 'media:';

export const canStoreMedia = (env: Env): boolean => !!mediaBucket(env) || !!env.KV;

/** True when files are kept in KV — the admin says so, and refuses films. */
export const isKvMediaStore = (env: Env): boolean => !mediaBucket(env) && !!env.KV;

export async function putMedia(env: Env, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const bucket = mediaBucket(env);
  if (bucket) {
    await bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
    return;
  }
  if (!env.KV) throw new AppError('BAD_REQUEST', 'There is nowhere to keep files in this environment.');
  if (bytes.byteLength > KV_MAX_BYTES) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      `This shop keeps files in KV, which stops at ${Math.floor(KV_MAX_BYTES / 1024 / 1024)} MB. Turn on R2 for anything larger.`,
    );
  }
  // the type travels with the bytes; KV has no notion of a content type
  await env.KV.put(`${PREFIX}${key}`, bytes, { metadata: { contentType } });
}

export async function getKvMedia(env: Env, key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!env.KV) return null;
  const { value, metadata } = await env.KV.getWithMetadata<{ contentType?: string }>(`${PREFIX}${key}`, 'arrayBuffer');
  if (!value) return null;
  return { bytes: value, contentType: metadata?.contentType ?? 'application/octet-stream' };
}

/** The bytes back as text — for the CSV an import reads. */
export async function getMediaText(env: Env, key: string): Promise<string | null> {
  const bucket = mediaBucket(env);
  if (bucket) {
    const object = await bucket.get(key);
    return object ? object.text() : null;
  }
  const kept = await getKvMedia(env, key);
  return kept ? new TextDecoder().decode(kept.bytes) : null;
}

export async function deleteMedia(env: Env, key: string): Promise<void> {
  const bucket = mediaBucket(env);
  if (bucket) await bucket.delete(key);
  else await env.KV?.delete(`${PREFIX}${key}`);
}
