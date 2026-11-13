import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PlatformService } from '../platform/platform.service';
import { CouriersService } from './couriers.service';

// FEAT-010 — docs/features/FEAT-010-courier-cash-control (SPEC-010-01).

describe('SPEC-010-01 — API dispatch excludes cash-blocked couriers', () => {
  // SPEC-010-01-SC04
  it('SPEC-010-01-SC04 — findEligibleCandidates filters cash_blocked_at IS NULL (API copy)', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const service = new CouriersService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      { getCourierLocationStaleSeconds: vi.fn(async () => 120) } as unknown as PlatformService,
    );
    await service.findEligibleCandidates({ lat: 12.1, lng: 15.0 }, 3000);
    const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('cash_blocked_at IS NULL');
  });

  it('setCashBlocked keeps the first blocking time and clears it when unblocked', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const service = new CouriersService(
      { $executeRaw: executeRaw } as unknown as PrismaService,
      {} as PlatformService,
    );
    await service.setCashBlocked('courier-L', true);
    await service.setCashBlocked('courier-L', false);
    const [blockSql, unblockSql] = executeRaw.mock.calls.map((c) =>
      (c[0] as TemplateStringsArray).join('?'),
    );
    expect(blockSql).toContain('COALESCE(cash_blocked_at, now())');
    expect(unblockSql).toContain('cash_blocked_at = NULL');
  });
});
