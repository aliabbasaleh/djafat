import { Injectable } from '@nestjs/common';
import type { ValidatedEntryGroup } from '@djafat/core';
import type { WalletBalance } from '@djafat/types';
import { money } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * The ONLY code allowed to write `ledger_*` / `wallet_*` (enforced by the SQL
 * grant `djafat_ledger` and by `eslint-plugin-boundaries` — docs/08 §8.9).
 *
 * All writes are raw SQL inside one transaction: the entry group, its immutable
 * entries, and the wallet-balance projection are committed atomically.
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a validated, balanced group. Idempotent on
   * `ledger_entry_groups.idempotency_key`: a replay is a no-op and returns the
   * existing group id.
   */
  async persistEntryGroup(
    group: ValidatedEntryGroup,
    refs: { orderId?: string; paymentId?: string } = {},
  ): Promise<{ id: string; replayed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ledger_entry_groups WHERE idempotency_key = ${group.idempotencyKey}
      `;
      if (existing[0]) return { id: existing[0].id, replayed: true };

      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO ledger_entry_groups (kind, idempotency_key, currency, order_id, payment_id, memo, created_by)
        VALUES (${group.kind}, ${group.idempotencyKey}, ${group.currency},
                ${refs.orderId ?? null}::uuid, ${refs.paymentId ?? null}::uuid, ${null}, ${group.createdBy})
        RETURNING id
      `;
      const groupId = inserted[0]!.id;

      for (const e of group.entries) {
        await tx.$executeRaw`
          INSERT INTO ledger_entries (entry_group, account_id, direction, amount_minor, currency, memo)
          SELECT ${groupId}::uuid, la.id, ${e.direction}, ${e.amount.minor}, ${e.amount.currency}, ${e.memo ?? null}
          FROM ledger_accounts la
          WHERE la.currency = ${e.amount.currency}
            AND (${e.accountRef} = la.code
                 OR ${e.accountRef} = la.code || ':' || COALESCE(la.owner_id::text, ''))
          LIMIT 1
        `;
      }
      return { id: groupId, replayed: false };
    });
  }

  async getWalletBalance(
    ownerType: 'restaurant' | 'courier',
    ownerId: string,
    currency: string,
  ): Promise<WalletBalance> {
    const rows = await this.prisma.$queryRaw<
      Array<{ pending_minor: bigint; available_minor: bigint }>
    >`
      SELECT pending_minor, available_minor FROM wallet_balances
      WHERE owner_type = ${ownerType} AND owner_id = ${ownerId}::uuid AND currency = ${currency}
    `;
    const row = rows[0] ?? { pending_minor: 0n, available_minor: 0n };
    return {
      ownerType,
      ownerId,
      currency,
      pending: money(row.pending_minor, currency),
      available: money(row.available_minor, currency),
    };
  }
}
