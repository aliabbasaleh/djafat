import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Money, PaymentProvider, ProviderCapabilities } from '@djafat/types';
import { compareMoney } from '@djafat/core';
import { PAYMENT_PROVIDER } from './payments.tokens';

export interface ResolvedProvider {
  readonly code: string;
  readonly capabilities: ProviderCapabilities;
}

/**
 * Data-driven provider registry (docs/08 §8.2, AD-03). The rest of the platform
 * only ever asks this registry for a `PaymentProvider` by code — there is no
 * `switch (provider)` / `if (provider === 'airtel')` anywhere.
 *
 * A provider is only usable once (a) its class is registered here AND (b) a
 * `payment_provider_configs` row enables it for the request context. This
 * registry covers (a); `platform` covers (b).
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byCode: ReadonlyMap<string, PaymentProvider>;

  constructor(@Inject(PAYMENT_PROVIDER) providers: PaymentProvider[]) {
    const map = new Map<string, PaymentProvider>();
    for (const p of providers) {
      if (map.has(p.code)) {
        throw new Error(`Duplicate payment provider registered: ${p.code}`);
      }
      map.set(p.code, p);
    }
    this.byCode = map;
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): PaymentProvider {
    const provider = this.byCode.get(code);
    if (!provider) {
      throw new NotFoundException({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Payment provider "${code}" is not registered.`,
      });
    }
    return provider;
  }

  list(): ResolvedProvider[] {
    return [...this.byCode.values()].map((p) => ({
      code: p.code,
      capabilities: p.getCapabilities(),
    }));
  }

  /** Whether a provider can handle an amount (currency + min/max bounds). */
  supportsAmount(code: string, amount: Money): boolean {
    const caps = this.get(code).getCapabilities();
    if (!caps.currencies.includes(amount.currency)) return false;
    if (caps.minAmount && compareMoney(amount, caps.minAmount) < 0) return false;
    if (caps.maxAmount && compareMoney(amount, caps.maxAmount) > 0) return false;
    return true;
  }
}
