import type { MoneyJson } from '@djafat/types';

/** FEAT-014: a payout to the courier's Airtel Money. */
export interface CourierPayout {
  readonly id: string;
  readonly kind: 'on_demand' | 'weekly';
  readonly status: 'requested' | 'sent' | 'cancelled';
  readonly feePayer: 'courier' | 'djafat';
  readonly requested: MoneyJson;
  readonly received: MoneyJson | null;
  readonly airtelFee: MoneyJson | null;
  readonly transactionRef: string | null;
  readonly requestedAt: string;
  readonly sentAt: string | null;
}
