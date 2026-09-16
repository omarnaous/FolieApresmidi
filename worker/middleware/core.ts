import type { ErrorHandler, NotFoundHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiErrorBody } from '../../shared/api';
import { createDb } from '../db/client';
import { AppError } from '../lib/errors';
import { ulid } from '../lib/ids';
import { errorFields, log } from '../lib/log';
import type { AppEnv } from '../types';

/** Request id, database handle, and principals reset for this request. */
export const context = createMiddleware<AppEnv>(async (c, next) => {
  c.set('requestId', c.req.header('cf-ray') ?? ulid());
  c.set('db', createDb(c.env.DB));
  c.set('customer', null);
  c.set('staff', null);
  await next();
  c.header('x-request-id', c.get('requestId'));
});

/** API responses are private unless a route opts in to public caching. */
export const noStoreByDefault = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'private, no-store');
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
