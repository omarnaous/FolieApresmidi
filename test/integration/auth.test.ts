import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionDTO } from '../../shared/api';
import { runJob } from '../../worker/jobs/queue';
import { listDevMail } from '../../worker/email/send';
import { Shopper } from '../helpers';

const email = () => `user${Math.random().toString(36).slice(2, 9)}@example.com`;

describe('storefront sessions', () => {
  it('hands out a CSRF token and nothing else', async () => {
    const s = new Shopper();
    const res = await s.json<SessionDTO>('GET', '/api/auth/session');
    expect(res.status).toBe(200);
    expect(Object.keys(res.data)).toEqual(['csrfToken']);
    expect(res.data.csrfToken).toBe(s.jar.get('fdm_csrf'));
  });

  it('has no way to sign up or sign in — only staff sign in, in the admin', async () => {
    const s = new Shopper();
    const body = { email: email(), password: 'a long password', name: 'Nour', token: 'x'.repeat(40) };
    for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email']) {
      expect((await s.json('POST', path, body)).status, path).toBe(404);
    }
    for (const path of ['/api/account', '/api/account/orders', '/api/account/addresses', '/api/account/wishlist']) {
      expect((await s.json('GET', path)).status, path).toBe(404);
    }
    expect([...s.jar.keys()]).toEqual(['fdm_csrf']);
  });

  it('blocks writes without the CSRF token or from another origin', async () => {
    const s = new Shopper();
    await s.request('GET', '/api/auth/session');
    const line = { variantId: 'none', quantity: 1 };
    const noToken = await s.json('POST', '/api/cart/lines', line, { 'x-csrf-token': '' });
    expect(noToken.status).toBe(403);
    expect(noToken.data.error.code).toBe('CSRF_FAILED');
    const foreign = await s.json('POST', '/api/cart/lines', line, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('renders and records transactional email', async () => {
    await runJob(env, { type: 'email.password_reset', to: 'reader@example.com', name: 'Reader', url: 'http://localhost/admin/reset?token=abc' }, 'msg-1');
    const mail = (await listDevMail(env)) as { to: string; subject: string; html: string }[];
    const sent = mail.find((m) => m.to === 'reader@example.com');
    expect(sent?.subject).toContain('Reset your password');
    expect(sent?.html).toContain('http://localhost/admin/reset?token=abc');
  });
});
