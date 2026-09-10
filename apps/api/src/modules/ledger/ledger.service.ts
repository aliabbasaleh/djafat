import { Injectable, Logger } from '@nestjs/common';
import type {
  LedgerPort,
  PostEntryGroupInput,
  PostedEntryGroup,
  WalletBalance,
} from '@djafat/types';
import { validateEntryGroup } from '@djafat/core';
import { LedgerRepository } from './ledger.repository';

/**
 * The single writer of the general ledger (docs/15 AD-02).
 *
 * Every money movement in the platform goes through `postEntryGroup`:
 *   1. `@djafat/core` validates the group balances (Σdebit === Σcredit / currency)
 *   2. the repository persists the immutable group + entries + wallet projection
 *      atomically, idempotently on `idempotencyKey`.
 * No other module may touch `ledger_*` / `wallet_*`.
 */
@Injectable()
export class LedgerService implements LedgerPort {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly repo: LedgerRepository) {}

  async postEntryGroup(input: PostEntryGroupInput): Promise<PostedEntryGroup> {
    const validated = validateEntryGroup(input); // throws LedgerError if unbalanced
    const { id, replayed } = await this.repo.persistEntryGroup(validated, {
      ...(input.refs?.orderId !== undefined ? { orderId: input.refs.orderId } : {}),
      ...(input.refs?.paymentId !== undefined ? { paymentId: input.refs.paymentId } : {}),
    });
    if (replayed) {
      this.logger.debug(`postEntryGroup replay (idempotencyKey=${input.idempotencyKey})`);
    }
    return {
      id,
      kind: validated.kind,
      currency: validated.currency,
      postedAt: new Date().toISOString(),
    };
  }

  getWalletBalance(
    ownerType: 'restaurant' | 'courier',
    ownerId: string,
    currency: string,
  ): Promise<WalletBalance> {
    return this.repo.getWalletBalance(ownerType, ownerId, currency);
  }
}
