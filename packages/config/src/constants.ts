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
  /** Digits of a national number ("66 12 34 56"), used to normalise phone input — FEAT-005. */
  nationalNumberLength: 8,
  citySlug: 'ndjamena',
  cityName: "N'Djamena",
} as const;

/** Default `platform_settings` values seeded at Bloc 0 (see docs/06 §6.14). */
export const PLATFORM_SETTINGS_DEFAULTS = {
  unpaid_order_ttl_seconds: 900, // A4
  offer_timeout_seconds: 30,
  // ORD-02: a placed order its restaurant has not confirmed after this long is
  // cancelled and refunded (PAY-04). 15 min like the unpaid-order TTL (A4);
  // a default for DJAFAT to confirm, tunable in platform_settings.
  order_confirmation_timeout_seconds: 900,
  courier_cash_float_cap_minor: 200_000, // B3
  psp_fee_policy: 'absorb', // A2
  funds_release_policy: { trigger: 'delivered', delay_hours: 0, reserve_percent: 0 }, // A3
  courier_compensation_policy: { type: 'delivery_fee' }, // A5
  otp_channels: ['sms'], // A9
  // Bloc 1 — Identity & Access (docs/19 §7–§8, docs/05 §5.4).
  otp_ttl_seconds: 300, // 5 min
  otp_max_attempts: 5, // per challenge
  otp_rate_limit_per_phone: { limit: 3, window_seconds: 600 }, // 3 / 10 min / numéro
  otp_rate_limit_per_ip: { limit: 30, window_seconds: 3600 }, // 30 / h / IP
  phone_lock_threshold: 10, // failed OTP verifications before a durable lock
  phone_lock_duration_seconds: 900, // 15 min
  // Step-up TOTP verification (docs/31 §5.2) — the second factor now gates
  // privilege escalation (`grantRole`/`revokeRole`), so its brute-force cost
  // matters: TOTP accepts a ±1-step window, i.e. 3 valid codes out of 10^6 at
  // any instant. At 5 / 5 min that is ~231 days of sustained attempts for one
  // expected hit, while still leaving a human room for typos and clock drift.
  mfa_verify_rate_limit_per_user: { limit: 5, window_seconds: 300 },
  // Bloc 4 — Cart + Core Order (docs/22 §5).
  cart_max_item_quantity: 99, // per line item; the wire-level Zod schema also caps at 99 as a hard ceiling
  // Bloc 6 — Delivery / Dispatch Core (docs/25 §6, §11, §43).
  dispatch_initial_radius_m: 3000, // docs/09 A.2 — 3 km first pass
  dispatch_max_radius_m: 8000,
  dispatch_radius_expansion_step_m: 2000,
  dispatch_max_waves: 3, // after this many radius expansions with no acceptance -> ops alert, stays searching_courier
  courier_location_stale_seconds: 120, // docs/09 A.2 — 2 min; older = not a dispatch candidate
  courier_cash_ceiling_minor: 30_000, // FEAT-010 — XAF a courier may hold before being blocked from new offers
  courier_payout_min_minor: 2_000, // FEAT-014 — smallest on-demand withdrawal, XAF
  cod_cap_t1_minor: 10_000, // FEAT-015 — most a new customer may pay in cash at the door, XAF
  cod_cap_t2_minor: 25_000, // FEAT-015
  cod_cap_t3_minor: 60_000, // FEAT-015
} as const;

export const API_VERSION_PREFIX = 'v1';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const CORRELATION_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';
