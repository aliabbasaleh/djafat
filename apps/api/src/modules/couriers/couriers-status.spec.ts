import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PlatformService } from '../platform/platform.service';
import { CouriersService } from './couriers.service';

// Found by the full customer-journey run (docs/pipeline/customer-journey-2026-11-07.md):
// a courier holding an offer (status `busy`) who taps "online" again — or whose
// app re-sends it on resume — was switched back to `online`. The pending offer
// could then no longer be accepted (409 COURIER_NOT_ELIGIBLE): the order was lost.

function build(current: { status: string; activeDeliveryId: string | null }) {
  const row = {
    userId: 'courier-L',
    status: current.status,
    activeDeliveryId: current.activeDeliveryId,
    vehicleType: null,
    lastLocationAt: null,
    cashBlockedAt: null,
  };
  const prisma = {
    $executeRaw: vi.fn(async () => 1),
    // FEAT-022: no application — a courier created by the team (SPEC-022-06 R5).
    courierApplication: { findUnique: vi.fn(async () => null) },
    courier: {
      upsert: vi.fn(async () => row),
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => row),
      // Conditional, like the SQL: never overwrites a busy or suspended courier,
      // even if dispatch claims them between the read and the write.
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { status: { notIn: string[] } };
          data: { status: string };
        }) => {
          if (where.status.notIn.includes(row.status)) return { count: 0 };
          row.status = data.status;
          return { count: 1 };
        },
      ),
    },
  } as unknown as PrismaService;
  return { service: new CouriersService(prisma, {} as PlatformService), row };
}

describe('CouriersService.setStatus — a busy courier stays busy', () => {
  it('"online" while busy (offer pending or delivery in progress) changes nothing', async () => {
    const pendingOffer = build({ status: 'busy', activeDeliveryId: 'del-1' });
    const dto = await pendingOffer.service.setStatus('courier-L', 'online');
    expect(dto.status).toBe('busy');
    expect(pendingOffer.row.status).toBe('busy');
  });

  it('offline -> online still works', async () => {
    const idle = build({ status: 'offline', activeDeliveryId: null });
    const dto = await idle.service.setStatus('courier-L', 'online');
    expect(dto.status).toBe('online');
  });
});
