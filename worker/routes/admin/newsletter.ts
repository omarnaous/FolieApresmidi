import { Hono } from 'hono';
import { NewsletterSendInput, SubscriberListQuery, WelcomeCodeInput, type NewsletterSendDTO } from '../../../shared/api';
import { newsletterLetter } from '../../email/templates';
import { sendEmail } from '../../email/send';
import { invalid } from '../../lib/errors';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { mediaById } from '../../services/media';
import { newsletterDTO, unsubscribeToken } from '../../services/newsletter';
import { getSettings } from '../../services/settings';
import type { AppEnv } from '../../types';

/**
 * How many go out in one request. A Worker may make fifty subrequests on the
 * free plan, and each email is one of them — so the admin sends a batch,
 * is handed a cursor, and comes back for the next. Slower than firing the
 * lot at once, and the only way it finishes rather than dying halfway.
 */
const BATCH = 40;

/**
 * The list of addresses the site has gathered, the code whoever joins is
 * shown for joining, and the letters the house writes to it.
 *
 * Joining still sends nothing: the code is handed over on the page, at the
 * moment the address is given. A letter goes out only when the owner writes
 * one and presses send.
 */
export const adminNewsletter = new Hono<AppEnv>();

adminNewsletter.get('/newsletter', staffOnly('settings:write'), query(SubscriberListQuery), async (c) => {
  const s = await getSettings(c.get('db'));
  return c.json(await newsletterDTO(c.env.DB, c.req.valid('query'), s.newsletterWelcomeCode, s.currency));
});

adminNewsletter.put('/newsletter/code', staffOnly('settings:write'), json(WelcomeCodeInput), async (c) => {
  const { code } = c.req.valid('json');
  if (code) {
    const known = await c.env.DB.prepare('SELECT code FROM discounts WHERE code = ?').bind(code).first();
    if (!known) throw invalid({ code: 'There is no discount with that code' });
  }
  await c.env.DB.prepare('UPDATE store_settings SET newsletter_welcome_code = ?, updated_at = ? WHERE id = 1').bind(code, Date.now()).run();
  await audit(c, 'newsletter.code', 'settings', null, code ? `New subscribers are shown ${code}` : 'New subscribers are shown no code');

  const s = await getSettings(c.get('db'));
  return c.json(await newsletterDTO(c.env.DB, { show: 'subscribed', limit: 200 }, s.newsletterWelcomeCode, s.currency));
});

/**
 * Write to the list. One batch per request, newest addresses last, so the
 * order a letter arrives in is the order people joined.
 *
 * `testTo` sends a single copy to one address and touches nobody else — for
 * reading the thing before five hundred people do.
 */
adminNewsletter.post('/newsletter/send', staffOnly('settings:write'), json(NewsletterSendInput), async (c) => {
  const { subject, body, cursor, testTo, attachmentMediaId } = c.req.valid('json');
  const settings = await getSettings(c.get('db'));
  const brand = { name: settings.name, url: c.env.APP_URL, contactEmail: settings.contactEmail };

  /* Brevo fetches the file rather than being handed it, so the link has to
     be one the outside world can reach — the media path on the shop's own
     domain, which is public. */
  let attachment: { url: string; name: string } | null = null;
  if (attachmentMediaId) {
    const file = await mediaById(c.get('db'), attachmentMediaId);
    if (!file) throw invalid({ attachmentMediaId: 'That file is no longer there' });
    attachment = { url: `${c.env.APP_URL}${file.url}`, name: file.alt || 'attachment.pdf' };
  }
  const letterFor = async (email: string) =>
    newsletterLetter(brand, subject, body, `${c.env.APP_URL}/unsubscribe/${encodeURIComponent(await unsubscribeToken(email, c.env.COOKIE_SECRET))}`);

  if (testTo) {
    // strict: whoever pressed the button is waiting, so a refusal reaches them
    await sendEmail(c.env, testTo, await letterFor(testTo), `newsletter-test:${Date.now()}`, { strict: true, attachment });
    return c.json<NewsletterSendDTO>({ sent: 1, failed: 0, nextCursor: null, total: 1 });
  }

  const counted = await c.env.DB.prepare(`SELECT count(*) AS n FROM subscribers WHERE status = 'subscribed'`).first<{ n: number }>();
  const total = counted?.n ?? 0;

  const after = cursor ?? '';
  const { results } = await c.env.DB
    .prepare(`SELECT email FROM subscribers WHERE status = 'subscribed' AND email > ? ORDER BY email LIMIT ?`)
    .bind(after, BATCH + 1)
    .all<{ email: string }>();
  const page = results.slice(0, BATCH);

  let sent = 0;
  let failed = 0;
  for (const { email } of page) {
    try {
      await sendEmail(c.env, email, await letterFor(email), `newsletter:${subject}:${email}`, { attachment });
      sent += 1;
    } catch {
      // one refused address must not stop the rest of the batch
      failed += 1;
    }
  }

  const last = page.at(-1)?.email ?? null;
  const nextCursor = results.length > BATCH && last ? last : null;
  await audit(c, 'newsletter.send', 'settings', null, `Wrote to ${sent} of ${total}${failed ? `, ${failed} refused` : ''}: ${subject}`);
  return c.json<NewsletterSendDTO>({ sent, failed, nextCursor, total });
});
