import type { PaymentProvider } from '@djafat/types';

/** Multi-provider injection token. Every concrete provider is `provide`d here. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type PaymentProviderList = PaymentProvider[];
