import type { PaymentProvider } from '@djafat/types';

/**
 * Which payment providers may exist in a given environment (FEAT-002,
 * docs/features/FEAT-002-mock-provider-production-lock). Pure: no I/O, the
 * environment is passed in. Driven by the capability each provider declares
 * (`sandboxOnly`), never by a provider code — README rule "no
 * `if (provider === …)`".
 */

/** In production, drop every provider that declares `sandboxOnly: true`. */
export function selectRegistrableProviders(
  providers: readonly PaymentProvider[],
  env: { readonly isProduction: boolean },
): PaymentProvider[] {
  if (!env.isProduction) return [...providers];
  return providers.filter((p) => p.getCapabilities().sandboxOnly !== true);
}

/** Codes of the providers that declare themselves sandbox-only. */
export function sandboxOnlyCodes(providers: readonly PaymentProvider[]): string[] {
  return providers.filter((p) => p.getCapabilities().sandboxOnly === true).map((p) => p.code);
}

export interface SeedPaymentProviderPlan {
  /** Whether the `payment_providers` row of `code` is written active. */
  isActive(code: string): boolean;
  /** Providers that get a launch-market `payment_provider_configs` row, in order. */
  readonly availabilityCodes: readonly string[];
  /** Value of the `mock_payment_provider` feature flag. */
  readonly mockPaymentFlagEnabled: boolean;
  /**
   * Providers whose EXISTING `payment_provider_configs` rows must be set
   * `enabled: false` — re-seeding a dev-seeded base in production (SPEC-002-02 R3).
   */
  readonly configsToDisable: readonly string[];
}

const LAUNCH_AVAILABILITY = ['cash', 'mock'] as const;

/** What the seed writes for payment providers in this environment. */
export function seedPaymentProviderPlan(input: {
  readonly isProduction: boolean;
  readonly sandboxCodes: readonly string[];
}): SeedPaymentProviderPlan {
  const blocked = new Set(input.isProduction ? input.sandboxCodes : []);
  return {
    isActive: (code) => !blocked.has(code),
    availabilityCodes: LAUNCH_AVAILABILITY.filter((code) => !blocked.has(code)),
    mockPaymentFlagEnabled: !input.isProduction,
    configsToDisable: [...blocked],
  };
}
