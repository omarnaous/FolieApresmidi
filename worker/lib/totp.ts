/**
 * Time-based one-time passwords (RFC 6238), and the codes you keep for the
 * day the phone is lost.
 *
 * A TOTP is HMAC-SHA1 over the number of 30-second steps since the epoch,
 * truncated to six digits. The shared secret is what the authenticator app
 * stores; the server keeps the same secret and, at sign-in, checks that the
 * six digits it is handed match the ones it computes for the current step —
 * allowing one step either side, so a clock a little fast or slow still works.
 *
 * Nothing here needs a library: Web Crypto has HMAC-SHA1, and the rest is
 * arithmetic. The secret never leaves the server except once, as a QR code,
 * at the moment 2FA is turned on.
 */

const enc = new TextEncoder();

/* ── base32, the alphabet authenticator apps speak ──────────────────────── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new secret: 20 random bytes, as base32 — the size RFC 4226 recommends. */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(secret: string): Uint8Array {
  const clean = secret.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue; // ignore anything that is not base32
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ── the code for one 30-second step ────────────────────────────────────── */

async function hotp(secret: string, counter: number): Promise<string> {
  // the counter as 8 big-endian bytes
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));

  // dynamic truncation (RFC 4226 §5.3)
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

const STEP = 30; // seconds

/**
 * True when `code` is right for now, allowing one step either side so a
 * slightly wrong clock still lets someone in. The comparison runs over every
 * candidate — never short-circuiting on the first miss — so how long it takes
 * says nothing about which step matched.
 */
export async function verifyTotp(secret: string, code: string, at: number = Date.now()): Promise<boolean> {
  const cleaned = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const step = Math.floor(at / 1000 / STEP);
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    const candidate = await hotp(secret, step + drift);
    if (safeDigits(candidate, cleaned)) ok = true;
  }
  return ok;
}

/** Constant-time compare of two six-digit strings. */
function safeDigits(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The line an authenticator app reads from a QR code. The label is what the
 * user sees in the app; the issuer groups the house's entries together.
 */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(STEP) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ── backup codes ───────────────────────────────────────────────────────── */

/**
 * Ten codes to keep somewhere safe, each usable once, for when the phone is
 * gone. They are shown once and stored only as hashes, so a look at the
 * database yields nothing that can be used to sign in.
 */
export function newBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const n = crypto.getRandomValues(new Uint32Array(2));
    // 10 digits, grouped, e.g. 48213-90675
    const digits = (BigInt(n[0]!) * 4294967296n + BigInt(n[1]!)).toString().padStart(10, '0').slice(-10);
    codes.push(`${digits.slice(0, 5)}-${digits.slice(5)}`);
  }
  return codes;
}

async function hashCode(code: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(code.replace(/[\s-]/g, '')));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashBackupCodes(codes: string[], pepper: string): Promise<string[]> {
  return Promise.all(codes.map((c) => hashCode(c, pepper)));
}

/**
 * If `code` is one of the stored backup codes, return the list with that one
 * spent (removed); otherwise null. The caller writes the shortened list back,
 * so a backup code works exactly once.
 */
export async function spendBackupCode(code: string, hashed: string[], pepper: string): Promise<string[] | null> {
  const target = await hashCode(code, pepper);
  let found = -1;
  // walk the whole list so timing does not reveal a near-match
  for (let i = 0; i < hashed.length; i += 1) {
    if (safeHex(hashed[i]!, target)) found = i;
  }
  if (found === -1) return null;
  return hashed.filter((_, i) => i !== found);
}

function safeHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
