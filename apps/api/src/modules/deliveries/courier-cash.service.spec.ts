import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { LedgerReadService } from '../ledger/ledger-read.service';
import type { PlatformService } from '../platform/platform.service';
import type { CouriersService } from '../couriers/couriers.service';
import { CourierCashService } from './courier-cash.service';

// FEAT-010 — docs/features/FEAT-010-courier-cash-control (SPEC-010-01, SPEC-010-03).

function build(opts: { held: bigint; courierOfOrder?: string | null; blockedAt?: Date | null }) {
  const getCashHeld = vi.fn(async () => opts.held);
  const setCashBlocked = vi.fn(async () => undefined);
  const prisma = {
    delivery: {
      findFirst: vi.fn(async () =>
        opts.courierOfOrder === null ? null : { courierId: opts.courierOfOrder ?? 'courier-L' },
      ),
    },
    courier: {
      findUnique: vi.fn(async () => ({
        userId: 'courier-L',
        cashBlockedAt: opts.blockedAt ?? null,
      })),
    },
  } as unknown as PrismaService;
  const service = new CourierCashService(
    prisma,
    { getCashHeld } as unknown as LedgerReadService,
    { getCourierCashCeilingMinor: vi.fn(async () => 30_000) } as unknown as PlatformService,
    { setCashBlocked } as unknown as CouriersService,
  );
  return { service, getCashHeld, setCashBlocked };
}

describe('SPEC-010-01 — re-evaluating a courier after cash moves', () => {
  // SPEC-010-01-SC02
  it('SPEC-010-01-SC02 — after payment.succeeded, the courier of that order is read from the ledger and blocked', async () => {
    const { service, getCashHeld, setCashBlocked } = build({ held: 31_000n });
    await service.onPaymentSucceeded({ orderId: 'ord-1', paymentId: 'pay-1' });
    expect(getCashHeld).toHaveBeenCalledWith('courier-L', 'XAF');
    expect(setCashBlocked).toHaveBeenCalledWith('courier-L', true);

    const noDelivery = build({ held: 31_000n, courierOfOrder: null });
    await noDelivery.service.onPaymentSucceeded({ orderId: 'ord-2', paymentId: 'pay-2' });
    expect(noDelivery.getCashHeld).not.toHaveBeenCalled();
    expect(noDelivery.setCashBlocked).not.toHaveBeenCalled();
  });

  // SPEC-010-01-SC03
  it('SPEC-010-01-SC03 — after a remittance below the ceiling, the courier is unblocked', async () => {
    const { service, setCashBlocked } = build({ held: 1_000n, blockedAt: new Date() });
    await service.onCashRemitted({ courierId: 'courier-L' });
    expect(setCashBlocked).toHaveBeenCalledWith('courier-L', false);
  });
});

describe('SPEC-010-03 — reading a courier’s cash', () => {
  // SPEC-010-03-SC01
  it('SPEC-010-03-SC01 — held, ceiling and blocked state', async () => {
    const { service } = build({ held: 31_000n, blockedAt: new Date('2026-11-07T10:00:00Z') });
    await expect(service.getCashStatus('courier-L')).resolves.toEqual({
      held: { minor: '31000', currency: 'XAF' },
      ceiling: { minor: '30000', currency: 'XAF' },
      blocked: true,
    });
  });
});
