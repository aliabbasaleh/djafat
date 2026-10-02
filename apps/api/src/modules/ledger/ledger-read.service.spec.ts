import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerReadService } from './ledger-read.service';

interface WalletRow {
  ownerType: string;
  ownerId: string;
  currency: string;
  pendingMinor: bigint;
  availableMinor: bigint;
}

interface EntryRow {
  accountId: string;
  direction: 'debit' | 'credit';
  amountMinor: bigint;
}

interface AccountRow {
  id: string;
  code: string;
  type: string;
  currency: string;
  ownerId: string | null;
}

function buildService() {
  const wallets: WalletRow[] = [];
  const accounts: AccountRow[] = [];
  const entries: EntryRow[] = [];

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  const db = {
    walletBalanceRow: {
      findMany: vi.fn((args: { where: { ownerType: string; ownerId: string } }) =>
        Promise.resolve(
          wallets.filter(
            (w) => w.ownerType === args.where.ownerType && w.ownerId === args.where.ownerId,
          ),
        ),
      ),
    },
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = rawText(strings);
      if (text.includes('FROM wallet_balances') && text.includes('GROUP BY currency')) {
        const [ownerType] = values as [string];
        const matches = wallets.filter((w) => w.ownerType === ownerType);
        const byCurrency = new Map<string, { pending_minor: bigint; available_minor: bigint }>();
        for (const w of matches) {
          const acc = byCurrency.get(w.currency) ?? { pending_minor: 0n, available_minor: 0n };
          acc.pending_minor += w.pendingMinor;
          acc.available_minor += w.availableMinor;
          byCurrency.set(w.currency, acc);
        }
        return Promise.resolve(
          [...byCurrency.entries()].map(([currency, v]) => ({ currency, ...v })),
        );
      }
      if (text.includes('FROM ledger_accounts')) {
        const globalAccounts = accounts.filter((a) => a.ownerId === null);
        const result = globalAccounts.map((a) => {
          const own = entries.filter((e) => e.accountId === a.id);
          const balanceMinor = own.reduce(
            (sum, e) => sum + (e.direction === 'debit' ? e.amountMinor : -e.amountMinor),
            0n,
          );
          return { code: a.code, type: a.type, currency: a.currency, balance_minor: balanceMinor };
        });
        return Promise.resolve(result.sort((a, b) => a.code.localeCompare(b.code)));
      }
      throw new Error(`Unhandled $queryRaw in ledger-read fake: ${text}`);
    }),
  };

  return {
    service: new LedgerReadService(db as unknown as PrismaService),
    wallets,
    accounts,
    entries,
  };
}

describe('LedgerReadService (Bloc 9, docs/30 §ledger-read) — read-only, never writes ledger_*/wallet_*', () => {
  it('getOwnerBalances reads the wallet projection directly — no computation', async () => {
    const { service, wallets } = buildService();
    wallets.push({
      ownerType: 'restaurant',
      ownerId: 'r1',
      currency: 'XAF',
      pendingMinor: 3600n,
      availableMinor: 1200n,
    });

    const result = await service.getOwnerBalances('restaurant', 'r1');
    expect(result).toEqual([
      {
        currency: 'XAF',
        pending: { minor: '3600', currency: 'XAF' },
        available: { minor: '1200', currency: 'XAF' },
      },
    ]);
  });

  it('getOwnerBalances scopes strictly to the given owner — never leaks another restaurant’s balance', async () => {
    const { service, wallets } = buildService();
    wallets.push(
      {
        ownerType: 'restaurant',
        ownerId: 'r1',
        currency: 'XAF',
        pendingMinor: 100n,
        availableMinor: 0n,
      },
      {
        ownerType: 'restaurant',
        ownerId: 'r2',
        currency: 'XAF',
        pendingMinor: 999n,
        availableMinor: 0n,
      },
    );

    const result = await service.getOwnerBalances('restaurant', 'r1');
    expect(result).toHaveLength(1);
    expect(result[0]!.pending.minor).toBe('100');
  });

  it('getOwnerBalanceTotals sums across every restaurant in a currency', async () => {
    const { service, wallets } = buildService();
    wallets.push(
      {
        ownerType: 'restaurant',
        ownerId: 'r1',
        currency: 'XAF',
        pendingMinor: 100n,
        availableMinor: 50n,
      },
      {
        ownerType: 'restaurant',
        ownerId: 'r2',
        currency: 'XAF',
        pendingMinor: 200n,
        availableMinor: 75n,
      },
      {
        ownerType: 'courier',
        ownerId: 'c1',
        currency: 'XAF',
        pendingMinor: 9999n,
        availableMinor: 0n,
      },
    );

    const result = await service.getOwnerBalanceTotals('restaurant');
    expect(result).toEqual([
      {
        currency: 'XAF',
        totalPending: { minor: '300', currency: 'XAF' },
        totalAvailable: { minor: '125', currency: 'XAF' },
      },
    ]);
  });

  it('getGlobalAccountBalances applies the correct natural-balance sign per account type', async () => {
    const { service, accounts, entries } = buildService();
    // DJAFAT_BANK is an ASSET — a debit increases it.
    accounts.push({
      id: 'acc-bank',
      code: 'DJAFAT_BANK',
      type: 'asset',
      currency: 'XAF',
      ownerId: null,
    });
    entries.push({ accountId: 'acc-bank', direction: 'debit', amountMinor: 10_000n });
    entries.push({ accountId: 'acc-bank', direction: 'credit', amountMinor: 2_000n });
    // DJAFAT_REVENUE is REVENUE — a credit increases it.
    accounts.push({
      id: 'acc-rev',
      code: 'DJAFAT_REVENUE',
      type: 'revenue',
      currency: 'XAF',
      ownerId: null,
    });
    entries.push({ accountId: 'acc-rev', direction: 'credit', amountMinor: 2_400n });

    const result = await service.getGlobalAccountBalances();
    expect(result).toEqual(
      expect.arrayContaining([
        { code: 'DJAFAT_BANK', currency: 'XAF', balance: { minor: '8000', currency: 'XAF' } },
        { code: 'DJAFAT_REVENUE', currency: 'XAF', balance: { minor: '2400', currency: 'XAF' } },
      ]),
    );
  });

  it('getGlobalAccountBalances never includes an owned (restaurant/courier) account', async () => {
    const { service, accounts } = buildService();
    accounts.push({
      id: 'acc-owned',
      code: 'RESTAURANT_PAYABLE',
      type: 'liability',
      currency: 'XAF',
      ownerId: 'r1',
    });

    const result = await service.getGlobalAccountBalances();
    expect(result.some((r) => r.code === 'RESTAURANT_PAYABLE')).toBe(false);
  });
});
