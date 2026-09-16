import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionDTO } from '../../shared/api';
import { runJob } from '../../worker/jobs/queue';
import { listDevMail } from '../../worker/email/send';
import { issueToken } from '../../worker/services/tokens';
import { Shopper } from '../helpers';

const email = () => `user${Math.random().toString(36).slice(2, 9)}@example.com`;

describe('customer accounts', () => {
  it('registers, signs out and signs back in', async () => {
    const s = new Shopper();
    const address = email();
    const reg = await s.json<SessionDTO>('POST', '/api/auth/register', { email: address, password: 'a long password', name: 'Nour' });
    expect(reg.status).toBe(201);
    expect(reg.data.customer?.email).toBe(address);
    expect(s.jar.has('fdm_s')).toBe(true);

    expect((await s.json('GET', '/api/account')).status).toBe(200);
    expect((await s.json('POST', '/api/auth/logout')).status).toBe(204);
    expect((await s.json('GET', '/api/account')).status).toBe(401);

    const wrong = await s.json('POST', '/api/auth/login', { email: address, password: 'not the password' });
    expect(wrong.status).toBe(401);
    const unknown = await s.json('POST', '/api/auth/login', { email: email(), password: 'not the password' });
    expect(unknown.data.error.message).toBe(wrong.data.error.message);

    const ok = await s.json<SessionDTO>('POST', '/api/auth/login', { email: address, password: 'a long password' });
    expect(ok.status).toBe(200);
  });

  it('refuses duplicate accounts and weak passwords', async () => {
    const address = email();
    await new Shopper().json('POST', '/api/auth/register', { email: address, password: 'a long password', name: 'A' });
    const dup = await new Shopper().json('POST', '/api/auth/register', { email: address, password: 'a long password', name: 'B' });
    expect(dup.status).toBe(422);
    const weak = await new Shopper().json('POST', '/api/auth/register', { email: email(), password: 'short', name: 'C' });
    expect(weak.status).toBe(422);
    expect(weak.data.error.fields.password).toBeTruthy();
  });

  it('blocks writes without the CSRF token or from another origin', async () => {
    const s = new Shopper();
    await s.request('GET', '/api/auth/session');
    const noToken = await s.json('POST', '/api/auth/login', { email: email(), password: 'x' }, { 'x-csrf-token': '' });
    expect(noToken.status).toBe(403);
    expect(noToken.data.error.code).toBe('CSRF_FAILED');
    const foreign = await s.json('POST', '/api/auth/login', { email: email(), password: 'x' }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('resets a password with a single-use link and signs out other devices', async () => {
    const address = email();
    const phone = new Shopper();
    const laptop = new Shopper();
    const reg = await phone.json<SessionDTO>('POST', '/api/auth/register', { email: address, password: 'first password', name: 'Rami' });
    await laptop.json('POST', '/api/auth/login', { email: address, password: 'first password' });

    const token = await issueToken(env.DB, 'customer', reg.data.customer!.id, 'reset_password');
    const reset = await new Shopper().json<SessionDTO>('POST', '/api/auth/reset-password', { token, password: 'second password' });
    expect(reset.status).toBe(200);

    expect((await laptop.json('GET', '/api/account')).status).toBe(401);
    expect((await new Shopper().json('POST', '/api/auth/login', { email: address, password: 'first password' })).status).toBe(401);
    expect((await new Shopper().json('POST', '/api/auth/login', { email: address, password: 'second password' })).status).toBe(200);
    expect((await new Shopper().json('POST', '/api/auth/reset-password', { token, password: 'third password' })).status).toBe(400);
  });

  it('shows order history only after the email is verified', async () => {
    const s = new Shopper();
    const reg = await s.json<SessionDTO>('POST', '/api/auth/register', { email: email(), password: 'a long password', name: 'Maya' });
    expect((await s.json('GET', '/api/account/orders')).status).toBe(403);
    const token = await issueToken(env.DB, 'customer', reg.data.customer!.id, 'verify_email');
    const verified = await s.json<SessionDTO>('POST', '/api/auth/verify-email', { token });
    expect(verified.data.customer?.emailVerified).toBe(true);
    expect((await s.json('GET', '/api/account/orders')).status).toBe(200);
  });

  it('renders and records transactional email', async () => {
    await runJob(env, { type: 'email.password_reset', to: 'reader@example.com', name: 'Reader', url: 'http://localhost/account/reset?token=abc' }, 'msg-1');
    const mail = (await listDevMail(env)) as { to: string; subject: string; html: string }[];
    const sent = mail.find((m) => m.to === 'reader@example.com');
    expect(sent?.subject).toContain('Reset your password');
    expect(sent?.html).toContain('http://localhost/account/reset?token=abc');
  });

  it('manages addresses and a wishlist', async () => {
    const s = new Shopper();
    await s.json('POST', '/api/auth/register', { email: email(), password: 'a long password', name: 'Dana' });
    const created = await s.json('POST', '/api/account/addresses', { name: 'Dana', phone: '+961 70 000 000', line1: 'Hamra St', city: 'Beirut', countryCode: 'LB' });
    expect(created.status).toBe(201);
    expect(created.data.isDefault).toBe(true);
    const list = await s.json('GET', '/api/account/addresses');
    expect(list.data.items).toHaveLength(1);
    expect((await s.json('DELETE', `/api/account/addresses/${created.data.id}`)).status).toBe(204);
    expect((await s.json('POST', '/api/account/wishlist', { productId: 'does-not-exist' })).status).toBe(404);
  });
});
