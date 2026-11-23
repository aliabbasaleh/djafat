import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { CourierOnboardingService } from './courier-onboarding.service';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-02).

describe('SPEC-022-02 — the courier created at sign-up', () => {
  // SPEC-022-02-SC01
  it('SPEC-022-02-SC01 — an offline courier (vehicle, neighbourhood, birth date) and an application to complete with the terms date', async () => {
    const couriers: unknown[] = [];
    const applications: unknown[] = [];
    const tx = {
      courier: { create: vi.fn(async ({ data }: { data: unknown }) => couriers.push(data)) },
      courierApplication: {
        create: vi.fn(async ({ data }: { data: unknown }) => applications.push(data)),
      },
    } as unknown as Prisma.TransactionClient;
    const termsAcceptedAt = new Date('2026-11-23T09:00:00Z');

    await new CourierOnboardingService().provisionCourier(tx, 'u-abakar', {
      vehicle: 'moto',
      neighbourhoodId: null,
      neighbourhoodOther: 'Gassi Est',
      birthDate: '2001-04-12',
      termsAcceptedAt,
    });

    expect(couriers).toEqual([
      {
        userId: 'u-abakar',
        status: 'offline',
        vehicleType: 'moto',
        neighbourhoodId: null,
        neighbourhoodOther: 'Gassi Est',
        birthDate: new Date('2001-04-12T00:00:00.000Z'),
      },
    ]);
    expect(applications).toEqual([{ courierUserId: 'u-abakar', termsAcceptedAt }]);
  });
});
