/**
 * Canonical money representation for the whole platform.
 *
 * `minor` is an integer amount expressed in the currency's minor unit
 * (ISO 4217 exponent — XAF = 0, EUR = 2, ...). It is a `bigint` to preserve
 * precision beyond 2^53. `currency` is an ISO 4217 alpha-3 uppercase code.
 *
 * One `Money` value carries exactly one currency. There is NO FX engine
 * (decision AD-01 / D2). See docs/15 §3 (AD-01).
 */
export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}

/**
 * Wire form of `Money`. `minor` is serialised as a STRING so JSON transport
 * never loses precision (a JSON number would). See docs/07 §7.1.
 */
export interface MoneyJson {
  readonly minor: string;
  readonly currency: string;
}

/** Rounding strategy for rate-based operations (commission, tax, ...). */
export type RoundingMode = 'half-even' | 'half-up' | 'half-down' | 'floor' | 'ceil' | 'trunc';
