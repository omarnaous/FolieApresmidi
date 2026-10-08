import type { ErrorHandler, NotFoundHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiErrorBody } from '../../shared/api';
import { createDb } from '../db/client';
import { AppError } from '../lib/errors';
import { ulid } from '../lib/ids';
import { errorFields, log } from '../lib/log';
import type { AppEnv } from '../types';

/** Request id, database handle, and the staff principal reset for this request. */
export const context = createMiddleware<AppEnv>(async (c, next) => {
  c.set('requestId', c.req.header('cf-ray') ?? ulid());
  c.set('db', createDb(c.env.DB));
  c.set('staff', null);
  await next();
  c.header('x-request-id', c.get('requestId'));
});

/** API responses are private unless a route opts in to public caching. */
export const noStoreByDefault = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'private, no-store');
});

/**
 * A read-through at the edge for the public catalogue.
 *
 * The storefront asks for the same few URLs again and again; without this each
 * one runs its D1 queries afresh, and D1's free tier counts rows read. The
 * first request for a URL runs the queries and its answer is kept in
 * `caches.default`; the rest, while the answer's own `s-maxage` lasts, are
 * served from the edge and touch the database not at all.
 *
 * It sits outermost, so on a miss it keeps the finished response — security
 * headers and all — and on a hit returns exactly that, before the handler or
 * the database are reached. Only a GET that comes back 200, carries `s-maxage`
 * and sets no cookie is kept: a cart, a checkout or an admin reply is private,
 * uncached (no `s-maxage`), and so can never be served to the wrong person.
 */
export const edgeRead = createMiddleware<AppEnv>(async (c, next) => {
  // local dev and the tests want the answer fresh, not a minute stale
  if (c.req.method !== 'GET' || c.env.APP_ENV === 'development') return next();
  const cache = caches.default;
  const key = new Request(c.req.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;

  await next();

  const cc = c.res.headers.get('cache-control') ?? '';
  if (c.res.status === 200 && cc.includes('s-maxage=') && !c.res.headers.has('set-cookie')) {
    c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
  }
});

/** Headers for JSON and binary API responses (HTML pages set their own CSP). */
export const apiSecurityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  crossOriginResourcePolicy: 'same-origin',
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=63072000; includeSubDomains',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
});

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? null;
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    if (err.status >= 500) log.error('app_error', { requestId, code: err.code, path: c.req.path, ...errorFields(err) });
    return c.json(body, err.status as 400, { 'cache-control': 'private, no-store' });
  }

  // malformed JSON bodies and the like surface as Hono HTTP exceptions
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    return c.json<ApiErrorBody>({ error: { code, message: err.message || 'Bad request', ...(requestId ? { requestId } : {}) } }, status as 400);
  }

  log.error('unhandled_error', { requestId, method: c.req.method, path: c.req.path, ...errorFields(err) });
  return c.json<ApiErrorBody>(
    { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', ...(requestId ? { requestId } : {}) } },
    500,
    { 'cache-control': 'private, no-store' },
  );
};

export const apiNotFound: NotFoundHandler<AppEnv> = (c) =>
  c.json<ApiErrorBody>({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: c.get('requestId') } }, 404);
