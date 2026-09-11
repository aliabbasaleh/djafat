import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
    return this.doPost(input);
  }

  /**
   * Same as `postEntryGroup`, but joins an ONGOING Prisma transaction owned by
   * the caller so the ledger write commits atomically with the caller's own
   * changes (docs/18 §5 — e.g. `payments` marking a payment succeeded).
   * Not part of `LedgerPort` on purpose: `Prisma.TransactionClient` is a
   * Nest/Prisma-specific type and `@djafat/types` stays platform-agnostic.
   * Only same-process, DAG-allowed callers (`payments`, `deliveries`) inject
   * `LedgerService` directly to reach this method.
   */
  async postEntryGroupTx(
    tx: Prisma.TransactionClient,
    input: PostEntryGroupInput,
  ): Promise<PostedEntryGroup> {
    return this.doPost(input, tx);
  }

  private async doPost(
    input: PostEntryGroupInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PostedEntryGroup> {
    const validated = validateEntryGroup(input); // throws LedgerError if unbalanced
    const { id, replayed } = await this.repo.persistEntryGroup(
      validated,
      {
        ...(input.refs?.orderId !== undefined ? { orderId: input.refs.orderId } : {}),
        ...(input.refs?.paymentId !== undefined ? { paymentId: input.refs.paymentId } : {}),
      },
      tx,
    );
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
