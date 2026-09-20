import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Ctx } from '../types';

/**
 * On HTTPS every cookie gets the `__Host-` prefix, which browsers only accept
 * with Secure, Path=/ and no Domain — so it cannot be set or overwritten by a
 * sibling subdomain. Local http development uses the bare name.
 */
export const isSecure = (c: Ctx): boolean => new URL(c.req.url).protocol === 'https:';

const nameFor = (c: Ctx, base: string) => (isSecure(c) ? `__Host-${base}` : base);

export const COOKIES = {
  staffSession: 'fdm_admin',
  csrf: 'fdm_csrf',
  cart: 'fdm_cart',
} as const;

export function readCookie(c: Ctx, base: string): string | undefined {
  return getCookie(c, nameFor(c, base));
}

export function writeCookie(
  c: Ctx,
  base: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean; sameSite?: 'Strict' | 'Lax' },
): void {
  setCookie(c, nameFor(c, base), value, {
    path: '/',
    secure: isSecure(c),
    httpOnly: opts.httpOnly ?? true,
    sameSite: opts.sameSite ?? 'Lax',
    maxAge: opts.maxAge,
  });
}

export function clearCookie(c: Ctx, base: string): void {
  deleteCookie(c, nameFor(c, base), { path: '/', secure: isSecure(c) });
}
