import { createMiddleware } from 'hono/factory';
import { COOKIES, readCookie, writeCookie } from '../lib/cookies';
import { safeEqual, randomToken } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { AppEnv, Ctx } from '../types';

/**
 * Two independent CSRF defences for every state-changing request:
 *  1. Origin (or Sec-Fetch-Site) must be this site — stops cross-site forms and fetches.
 *  2. Double-submit token: the `x-csrf-token` header must equal the readable
 *     `fdm_csrf` cookie, which another origin can neither read nor set.
 * Session cookies are also SameSite (Lax for shoppers, Strict for staff).
 * Payment webhooks are exempt: they authenticate by signature instead.
 */

const CSRF_TTL = 60 * 60 * 24 * 30;

export function allowedOrigins(c: Ctx): string[] {
  const list = String(c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  list.push(new URL(c.env.APP_URL).origin, new URL(c.req.url).origin);
  return list;
}

export function ensureCsrfToken(c: Ctx): string {
  const existing = readCookie(c, COOKIES.csrf);
  if (existing && /^[\w-]{20,100}$/.test(existing)) return existing;
  const token = randomToken(24);
  writeCookie(c, COOKIES.csrf, token, { maxAge: CSRF_TTL, httpOnly: false, sameSite: 'Lax' });
  return token;
}

export const csrf = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (c.req.path.startsWith('/api/webhooks/')) return next();

  const origin = c.req.header('origin');
  const site = c.req.header('sec-fetch-site');
  if (origin) {
    if (!allowedOrigins(c).includes(origin)) throw new AppError('CSRF_FAILED', 'This request came from somewhere else and was blocked.');
  } else if (site && site !== 'same-origin' && site !== 'none') {
    throw new AppError('CSRF_FAILED', 'This request came from somewhere else and was blocked.');
  }

  const cookie = readCookie(c, COOKIES.csrf);
  const header = c.req.header('x-csrf-token');
  if (!cookie || !header || !(await safeEqual(cookie, header))) {
    throw new AppError('CSRF_FAILED', 'Your session expired. Please try again.');
  }
  await next();
});
