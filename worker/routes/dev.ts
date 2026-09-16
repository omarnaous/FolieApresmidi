import { Hono } from 'hono';
import { listDevMail } from '../email/send';
import { notFound } from '../lib/errors';
import type { AppEnv } from '../types';

/** Development-only helpers. Every route 404s outside APP_ENV=development. */
export const dev = new Hono<AppEnv>();

dev.use('/dev/*', async (c, next) => {
  if (c.env.APP_ENV !== 'development') throw notFound();
  await next();
});

/** Emails that would have been sent (no RESEND_API_KEY locally). Newest first. */
dev.get('/dev/mail', async (c) => c.json({ items: await listDevMail(c.env) }));
