import { Hono } from 'hono';
import type { SessionDTO } from '../../shared/api';
import { ensureCsrfToken } from '../middleware/csrf';
import type { AppEnv } from '../types';

/**
 * The storefront has no accounts: shoppers check out as guests, and only
 * staff sign in, under /api/admin. The one session read left hands the
 * browser its CSRF token for the cart and checkout writes.
 */
export const session = new Hono<AppEnv>();

session.get('/auth/session', (c) => c.json<SessionDTO>({ csrfToken: ensureCsrfToken(c) }));
