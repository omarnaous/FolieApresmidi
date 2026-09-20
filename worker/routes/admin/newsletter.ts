import { Hono } from 'hono';
import { SubscriberListQuery, WelcomeCodeInput } from '../../../shared/api';
import { invalid } from '../../lib/errors';
import { json, query } from '../../lib/validate';
import { staffOnly } from '../../middleware/session';
import { audit } from '../../services/audit';
import { newsletterDTO } from '../../services/newsletter';
import { getSettings } from '../../services/settings';
import type { AppEnv } from '../../types';

/**
 * The list of addresses the site has gathered, and the code whoever joins is
 * shown for joining. Nothing is sent from here — the code is handed over on
 * the page, at the moment the address is given.
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
