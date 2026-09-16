import { errorFields, log } from '../lib/log';
import type { Email } from './templates';

const DEV_MAIL_PREFIX = 'devmail:';

/**
 * Deliver one email. With a RESEND_API_KEY it goes to Resend (idempotent per
 * message key, so a retried queue message cannot send twice); without one —
 * local development — it is logged and kept in KV for GET /api/dev/mail.
 * Throws on a retryable failure so the queue retries it.
 */
export async function sendEmail(env: Env, to: string, email: Email, idempotencyKey: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    log.info('email_dev', { to, subject: email.subject });
    await env.KV.put(
      `${DEV_MAIL_PREFIX}${Date.now()}:${idempotencyKey}`,
      JSON.stringify({ to, subject: email.subject, html: email.html, text: email.text, at: Date.now() }),
      { expirationTtl: 60 * 60 * 24 },
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: email.subject, html: email.html, text: email.text }),
  });

  if (res.ok) return;
  const detail = (await res.text()).slice(0, 500);
  // 4xx other than rate limiting will not get better on retry
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    log.error('email_rejected', { to, status: res.status, detail });
    return;
  }
  const err = new Error(`Resend ${res.status}: ${detail}`);
  log.warn('email_retry', { to, status: res.status, ...errorFields(err) });
  throw err;
}

export async function listDevMail(env: Env): Promise<unknown[]> {
  const { keys } = await env.KV.list({ prefix: DEV_MAIL_PREFIX, limit: 50 });
  const items = await Promise.all(keys.map((k) => env.KV.get(k.name, 'json')));
  return items.filter(Boolean).reverse();
}
