/**
 * Everything security-sensitive goes through Web Crypto: random tokens,
 * hashing, HMAC signatures and password hashing. Comparisons of secrets are
 * constant-time (hash both sides to a fixed length, then timingSafeEqual).
 */

const enc = new TextEncoder();

export function toB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 256 bits of randomness, URL-safe. */
export function randomToken(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
}

/** Constant-time string equality that does not leak length. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** `value.signature` — for cookies and links the server must be able to trust later. */
export async function sign(value: string, secret: string): Promise<string> {
  return `${value}.${toB64url(await hmacSha256(secret, value))}`;
}

export async function unsign(signed: string | undefined | null, secret: string): Promise<string | null> {
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const expected = await sign(value, secret);
  return (await safeEqual(expected, signed)) ? value : null;
}

/* ─────────────────────────── passwords ─────────────────────────── */

/**
 * PBKDF2-SHA256 over HMAC(pepper, password), with a per-password salt.
 *
 * Workers caps PBKDF2 at 100,000 iterations, below OWASP's 600k guidance for
 * PBKDF2-SHA256; the server-side pepper is what makes a stolen database
 * useless on its own. The stored string carries algorithm and iteration count,
 * so hashes can be upgraded transparently on the next successful login.
 *
 *   pbkdf2-sha256$100000$<salt>$<hash>
 */
const ALGO = 'pbkdf2-sha256';
export const MAX_ITERATIONS = 100_000;

async function derive(password: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const peppered = await hmacSha256(pepper, password.normalize('NFKC'));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string, iterations = MAX_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, pepper, salt, iterations);
  return `${ALGO}$${iterations}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
  targetIterations = MAX_ITERATIONS,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const [algo, iter, saltB64, hashB64] = stored.split('$');
  const iterations = Number(iter);
  if (algo !== ALGO || !Number.isInteger(iterations) || iterations < 1 || !saltB64 || !hashB64) {
    return { ok: false, needsRehash: false };
  }
  const expected = fromB64url(hashB64);
  const actual = await derive(password, pepper, fromB64url(saltB64), Math.min(iterations, MAX_ITERATIONS));
  const ok = actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && iterations !== targetIterations };
}

/**
 * Run a full hash when the account does not exist, so "no such email" and
 * "wrong password" take the same time and cannot be told apart.
 */
export async function burnPasswordCheck(password: string, pepper: string, iterations: number): Promise<void> {
  await derive(password, pepper, new Uint8Array(16), iterations);
}
