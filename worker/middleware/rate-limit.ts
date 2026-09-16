import { createMiddleware } from 'hono/factory';
import { AppError } from '../lib/errors';
import type { AppEnv, Ctx } from '../types';

type Limiter = 'RL_AUTH' | 'RL_CHECKOUT' | 'RL_API';

export const clientIp = (c: Ctx): string =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

/**
 * Workers Rate Limiting: per-location, eventually consistent counters. Good
 * for blunting bursts (credential stuffing, checkout hammering); anything
 * that must be exact is also checked against D1 by the route itself.
 */
export async function limit(c: Ctx, limiter: Limiter, key: string): Promise<void> {
  const binding = c.env[limiter] as RateLimit | undefined;
  if (!binding) return;
  const { success } = await binding.limit({ key: `${limiter}:${key}` });
  if (!success) throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a minute and try again.');
}

export const rateLimit = (limiter: Limiter, keyOf: (c: Ctx) => string = clientIp) =>
  createMiddleware<AppEnv>(async (c, next) => {
    await limit(c, limiter, keyOf(c));
    await next();
  });
