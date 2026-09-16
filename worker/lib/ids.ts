const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32.
 * Sortable by creation time, which keeps D1 inserts append-mostly and makes
 * `ORDER BY id` a free "newest first".
 */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 256 is a multiple of 32, so `b % 32` is uniform
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 32];
  return time + rand;
}

/** URL-safe handle from a title: "Étagère — Top" → "etagere-top". */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'item'
  );
}
