/**
 * Non-secret platform constants. Operational values that must be tunable at
 * runtime live in the `platform_settings` DB table (decisions A2–A9); this file
 * only holds truly static defaults and the launch-market seed identifiers.
 */

export const LAUNCH_MARKET = {
  countryIso: 'TD',
  countryName: 'Tchad',
  currency: 'XAF',
  defaultLocale: 'fr',
  timezone: 'Africa/Ndjamena',
  dialCode: '+235',
  citySlug: 'ndjamena',
  cityName: "N'Djamena",
} as const;

/** Default `platform_settings` values seeded at Bloc 0 (see docs/06 §6.14). */
export const PLATFORM_SETTINGS_DEFAULTS = {
  unpaid_order_ttl_seconds: 900, // A4
  offer_timeout_seconds: 30,
  courier_cash_float_cap_minor: 200_000, // B3
  psp_fee_policy: 'absorb', // A2
  funds_release_policy: { trigger: 'delivered', delay_hours: 0, reserve_percent: 0 }, // A3
  courier_compensation_policy: { type: 'delivery_fee' }, // A5
  otp_channels: ['sms'], // A9
} as const;

export const API_VERSION_PREFIX = 'v1';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const CORRELATION_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';
