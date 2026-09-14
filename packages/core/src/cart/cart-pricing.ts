import type { Money } from '@djafat/types';
import { addMoney, mulMoneyByInt, sumMoney } from '../money/money.js';

/**
 * "Given a line's live unit price, quantity, and live option deltas, what is
 * the line total?" (docs/22 §6, §8) — pure, no I/O, deterministic. The
 * CALLER is responsible for sourcing `unitPrice`/`optionDeltas` FRESH from
 * PostgreSQL on every quote — this function never trusts (and never even
 * sees) anything the client sent, it only does the arithmetic on values the
 * server already resolved as authoritative.
 */

export interface CartLineOptionInput {
  readonly priceDelta: Money;
}

export interface CartLineInput {
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly options: readonly CartLineOptionInput[];
}

export interface CartLineResult {
  /** The product's own price, before options — server-fresh, never the cart's stored snapshot. */
  readonly unitPrice: Money;
  /** Sum of the selected options' price deltas, per unit (may be negative). */
  readonly optionsTotal: Money;
  /** `unitPrice + optionsTotal` — what one unit of this line actually costs. */
  readonly effectiveUnitPrice: Money;
  readonly quantity: number;
  /** `effectiveUnitPrice * quantity`. */
  readonly lineTotal: Money;
}

export function computeCartLine(input: CartLineInput): CartLineResult {
  const { unitPrice, quantity, options } = input;
  const optionsTotal = sumMoney(
    options.map((o) => o.priceDelta),
    unitPrice.currency,
  );
  const effectiveUnitPrice = addMoney(unitPrice, optionsTotal);
  const lineTotal = mulMoneyByInt(effectiveUnitPrice, quantity);
  return { unitPrice, optionsTotal, effectiveUnitPrice, quantity, lineTotal };
}

export interface CartSubtotalResult {
  readonly lines: readonly CartLineResult[];
  readonly subtotal: Money;
}

/** Computes every line, then sums them into the cart's subtotal (pre delivery-fee/commission). */
export function computeCartSubtotal(
  lines: readonly CartLineInput[],
  currency: string,
): CartSubtotalResult {
  const computed = lines.map(computeCartLine);
  const subtotal = sumMoney(
    computed.map((l) => l.lineTotal),
    currency,
  );
  return { lines: computed, subtotal };
}
