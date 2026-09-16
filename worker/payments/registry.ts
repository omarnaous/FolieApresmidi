import type { PaymentMethodDTO } from '../../shared/api';
import { cashOnDelivery } from './cod';
import type { PaymentProvider } from './provider';

/** Every provider the store can offer. Add a gateway here (and only here). */
const providers: PaymentProvider[] = [cashOnDelivery];

export const enabledProviders = (env: Env): PaymentProvider[] => providers.filter((p) => p.isEnabled(env));

export const getProvider = (env: Env, id: string): PaymentProvider | null =>
  enabledProviders(env).find((p) => p.id === id) ?? null;

/** Display name for a provider id, enabled or not (old orders keep their label). */
export const providerName = (id: string): string => providers.find((p) => p.id === id)?.name ?? id;

/** Any registered provider, enabled or not — refunds must work after a gateway is switched off. */
export const anyProvider = (id: string): PaymentProvider | null => providers.find((p) => p.id === id) ?? null;

export const paymentMethods = (env: Env): PaymentMethodDTO[] =>
  enabledProviders(env).map((p) => ({ id: p.id, name: p.name, description: p.description }));

/** Test seam: integration tests register a fake webhook-driven gateway. */
export function registerProvider(provider: PaymentProvider): () => void {
  providers.push(provider);
  return () => {
    const i = providers.indexOf(provider);
    if (i >= 0) providers.splice(i, 1);
  };
}
