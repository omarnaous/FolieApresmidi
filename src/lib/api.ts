/**
 * Talking to the Worker.
 *
 * Every call is same-origin with cookies. Writes carry the CSRF token the
 * Worker hands out in a readable cookie (double-submit); if the cookie is
 * missing or stale the first write fetches a fresh one and retries once.
 * Failures throw ApiError with the server's code, message and per-field
 * messages, so forms can show them where they belong.
 */
import type { ApiErrorBody, ErrorCode } from '../../shared/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK';
  readonly fields: Record<string, string>;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody['error'] | { code: 'NETWORK'; message: string }) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = 'fields' in body && body.fields ? body.fields : {};
    this.details = 'details' in body ? body.details : undefined;
    this.requestId = 'requestId' in body ? body.requestId : undefined;
  }
}

const TIMEOUT = 20_000;
const CSRF_COOKIES = ['__Host-fdm_csrf', 'fdm_csrf'];

function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k && CSRF_COOKIES.includes(k)) return decodeURIComponent(v.join('='));
  }
  return null;
}

let csrfRefresh: Promise<void> | null = null;
function refreshCsrf(path: string): Promise<void> {
  const url = path.startsWith('/api/admin') ? '/api/admin/auth/session' : '/api/auth/session';
  csrfRefresh ??= fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    .then(() => undefined, () => undefined)
    .finally(() => { csrfRefresh = null; });
  return csrfRefresh;
}

export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;

  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  if (method !== 'GET') {
    if (!readCsrf()) await refreshCsrf(path);
    const token = readCsrf();
    if (token) headers['x-csrf-token'] = token;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  opts.signal?.addEventListener('abort', () => ctl.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(`${path}${qs(opts.query)}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Could not reach the store. Check your connection and try again.' });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    if (res.ok) return (await res.text()) as T;
    throw new ApiError(res.status, { code: 'INTERNAL', message: 'Something went wrong on our side.' });
  }

  const data = await res.json();
  if (res.ok) return data as T;

  const err = (data as ApiErrorBody).error ?? { code: 'INTERNAL', message: 'Something went wrong on our side.' };
  if (err.code === 'CSRF_FAILED' && !retried) {
    await refreshCsrf(path);
    return api<T>(path, opts, true);
  }
  throw new ApiError(res.status, err);
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Map ApiError.fields ("shippingAddress.city") onto a flat form. */
export const fieldError = (err: unknown, field: string): string | undefined =>
  err instanceof ApiError ? err.fields[field] : undefined;
