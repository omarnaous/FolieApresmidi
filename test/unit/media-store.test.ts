import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { canStoreMedia, deleteMedia, getKvMedia, getMediaText, isKvMediaStore, putMedia } from '../../worker/lib/media-store';

/**
 * A shop with no R2 bucket — the free plan, where R2 asks for a card. Files
 * go to KV instead. If this fails, such a shop cannot accept a photograph,
 * which is the whole reason the fallback exists.
 */

/** The test environment has a bucket; this is the same environment without one. */
const free = { ...env, MEDIA: undefined } as unknown as Env;

/** The smallest valid PNG: one transparent pixel. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('keeping files without a bucket', () => {
  it('knows it can still keep them, and that it is KV doing it', () => {
    expect(canStoreMedia(free)).toBe(true);
    expect(isKvMediaStore(free)).toBe(true);
    // with a bucket, R2 takes them and KV is not involved
    expect(isKvMediaStore(env)).toBe(false);
  });

  it('writes a picture and reads the same bytes back, with its type', async () => {
    const key = 'products/2026/one-pixel.png';
    await putMedia(free, key, PIXEL, 'image/png');
    const back = await getKvMedia(free, key);
    expect(back).not.toBeNull();
    expect(new Uint8Array(back!.bytes)).toEqual(PIXEL);
    expect(back!.contentType).toBe('image/png');
  });

  it('reads a CSV back as text, so an import still runs', async () => {
    const key = 'imports/2026/catalogue.csv';
    await putMedia(free, key, new TextEncoder().encode('Handle,Title\nrobe,Robe\n'), 'text/csv');
    expect(await getMediaText(free, key)).toBe('Handle,Title\nrobe,Robe\n');
  });

  it('forgets a picture when it is deleted', async () => {
    const key = 'products/2026/gone.png';
    await putMedia(free, key, PIXEL, 'image/png');
    await deleteMedia(free, key);
    expect(await getKvMedia(free, key)).toBeNull();
  });

  it('refuses a file too large for KV, and says why', async () => {
    const huge = new Uint8Array(25 * 1024 * 1024);
    await expect(putMedia(free, 'products/2026/huge.png', huge, 'image/png')).rejects.toThrow(/KV, which stops at 24 MB/);
  });

  it('answers nothing for a key nobody wrote', async () => {
    expect(await getKvMedia(free, 'products/2026/never-existed.png')).toBeNull();
    expect(await getMediaText(free, 'products/2026/never-existed.csv')).toBeNull();
  });
});
