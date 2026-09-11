import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ValidatedEntryGroup } from '@djafat/core';
import { LedgerError, money } from '@djafat/core';
import type { WalletBalance } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** Metadata needed to lazily provision a per-owner account on first use. */
const OWNED_ACCOUNT_META: Record<
  string,
  { type: 'asset' | 'liability'; ownerType: 'restaurant' | 'courier' }
> = {
  RESTAURANT_PAYABLE: { type: 'liability', ownerType: 'restaurant' },
  RESTAURANT_AVAILABLE: { type: 'liability', ownerType: 'restaurant' },
  COURIER_PAYABLE: { type: 'liability', ownerType: 'courier' },
  COURIER_AVAILABLE: { type: 'liability', ownerType: 'courier' },
  CASH_FLOAT: { type: 'asset', ownerType: 'courier' },
};

/** Which projection bucket a wallet-owning account code feeds, if any. */
function walletBucket(code: string): 'pending' | 'available' | null {
  if (code.endsWith('_PAYABLE')) return 'pending';
  if (code.endsWith('_AVAILABLE')) return 'available';
  return null;
}

/**
 * The ONLY code allowed to write `ledger_*` / `wallet_*` (enforced by the SQL
 * grant `djafat_ledger` and by `eslint-plugin-boundaries` — docs/08 §8.9).
 *
 * All writes for one entry group happen inside ONE transaction: resolving (or
 * lazily provisioning) each account, inserting the immutable entries, and
 * updating the `wallet_balances` projection. `SET LOCAL ROLE djafat_ledger`
 * scopes the actual writes to the restricted role (docs/17 D-03); `RESET
 * ROLE` restores the caller's privileges for anything it does afterwards in
 * the same transaction (e.g. `payments` writing its own outbox row).
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a validated, balanced group. Idempotent on
   * `ledger_entry_groups.idempotency_key`: a replay is a no-op and returns the
   * existing group id. Pass `externalTx` to join an ONGOING transaction owned
   * by another module (e.g. `payments` marking a payment succeeded) so the
   * whole operation commits or rolls back atomically — see docs/18 §5.
   */
  async persistEntryGroup(
    group: ValidatedEntryGroup,
    refs: { orderId?: string; paymentId?: string } = {},
    externalTx?: Tx,
  ): Promise<{ id: string; replayed: boolean }> {
    const run = (tx: Tx) => this.writeGroup(tx, group, refs);

    if (externalTx) {
      await externalTx.$executeRawUnsafe('SET LOCAL ROLE djafat_ledger');
      const result = await run(externalTx);
      await externalTx.$executeRawUnsafe('RESET ROLE');
      return result;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE djafat_ledger');
      const result = await run(tx);
      await tx.$executeRawUnsafe('RESET ROLE');
      return result;
    });
  }

  private async writeGroup(
    tx: Tx,
    group: ValidatedEntryGroup,
    refs: { orderId?: string; paymentId?: string },
  ): Promise<{ id: string; replayed: boolean }> {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ledger_entry_groups WHERE idempotency_key = ${group.idempotencyKey}
    `;
    if (existing[0]) return { id: existing[0].id, replayed: true };

    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ledger_entry_groups (kind, idempotency_key, currency, order_id, payment_id, created_by)
      VALUES (${group.kind}, ${group.idempotencyKey}, ${group.currency},
              ${refs.orderId ?? null}::uuid, ${refs.paymentId ?? null}::uuid, ${group.createdBy})
      RETURNING id
    `;
    const groupId = inserted[0]!.id;

    for (const e of group.entries) {
      const account = await this.resolveOrProvisionAccount(tx, e.accountRef, e.amount.currency);

      await tx.$executeRaw`
        INSERT INTO ledger_entries (entry_group, account_id, direction, amount_minor, currency, memo)
        VALUES (${groupId}::uuid, ${account.id}::uuid, ${e.direction}, ${e.amount.minor}, ${e.amount.currency}, ${e.memo ?? null})
      `;

      const bucket = walletBucket(account.code);
      if (bucket && account.ownerType && account.ownerId) {
        const sign = e.direction === 'credit' ? e.amount.minor : -e.amount.minor;
        const deltaPending = bucket === 'pending' ? sign : 0n;
        const deltaAvailable = bucket === 'available' ? sign : 0n;
        await tx.$executeRaw`
          INSERT INTO wallet_balances (owner_type, owner_id, currency, pending_minor, available_minor, updated_at)
          VALUES (${account.ownerType}, ${account.ownerId}::uuid, ${e.amount.currency}, ${deltaPending}, ${deltaAvailable}, now())
          ON CONFLICT (owner_type, owner_id, currency) DO UPDATE SET
            pending_minor   = wallet_balances.pending_minor + EXCLUDED.pending_minor,
            available_minor = wallet_balances.available_minor + EXCLUDED.available_minor,
            updated_at      = now()
        `;
      }
    }

    return { id: groupId, replayed: false };
  }

  /**
   * Resolve `"<CODE>"` (singleton) or `"<CODE>:<ownerId>"` (per-owner) to an
   * account row, creating the per-owner row on first use (docs/15 §4.1).
   */
  private async resolveOrProvisionAccount(
    tx: Tx,
    accountRef: string,
    currency: string,
  ): Promise<{ id: string; code: string; ownerType: string | null; ownerId: string | null }> {
    const found = await tx.$queryRaw<
      Array<{ id: string; code: string; owner_type: string | null; owner_id: string | null }>
    >`
      SELECT id, code, owner_type, owner_id FROM ledger_accounts
      WHERE currency = ${currency}
        AND (${accountRef} = code OR ${accountRef} = code || ':' || COALESCE(owner_id::text, ''))
      LIMIT 1
    `;
    if (found[0]) {
      return {
        id: found[0].id,
        code: found[0].code,
        ownerType: found[0].owner_type,
        ownerId: found[0].owner_id,
      };
    }

    const [code, ownerId] = accountRef.includes(':')
      ? accountRef.split(':', 2)
      : [accountRef, undefined];
    const meta = code ? OWNED_ACCOUNT_META[code] : undefined;
    if (!code || !ownerId || !meta) {
      throw new LedgerError(
        'EMPTY_ENTRY_GROUP',
        `Unknown ledger account "${accountRef}" (${currency}) and it cannot be auto-provisioned.`,
      );
    }

    const upserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ledger_accounts (code, type, owner_type, owner_id, currency)
      VALUES (${code}, ${meta.type}, ${meta.ownerType}, ${ownerId}::uuid, ${currency})
      ON CONFLICT (code, owner_type, owner_id, currency) DO UPDATE SET code = EXCLUDED.code
      RETURNING id
    `;
    return { id: upserted[0]!.id, code, ownerType: meta.ownerType, ownerId };
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

  /**
   * Sum of debits/credits per entry group (used by `ledger-assert`, and by
   * the integration test). Exposed read-only — no other module may call the
   * repository for anything else.
   */
  async assertAllGroupsBalanced(): Promise<
    Array<{ entryGroup: string; currency: string; debit: bigint; credit: bigint }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ entry_group: string; currency: string; debit: bigint; credit: bigint }>
    >`
      SELECT entry_group, currency,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)  AS debit,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0) AS credit
      FROM ledger_entries
      GROUP BY entry_group, currency
      HAVING COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)
           != COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)
    `;
    return rows.map((r) => ({
      entryGroup: r.entry_group,
      currency: r.currency,
      debit: r.debit,
      credit: r.credit,
    }));
  }
}
