import type { MoneyJson } from '@djafat/types';

/**
 * Prisma maps `bigint` SQL columns to JS `bigint` — and `JSON.stringify`
 * THROWS on a bare `bigint`. Every response DTO must go through this (or
 * `@djafat/core`'s `moneyToJson`) before leaving a controller.
 */
export function toMoneyJson(minor: bigint, currency: string): MoneyJson {
  return { minor: minor.toString(), currency };
}
