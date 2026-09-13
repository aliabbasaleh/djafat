import { describe, expect, it, vi } from 'vitest';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

function prismaStub(input: {
  restaurant?: { status: string; city: { timezone: string } };
  hours?: Array<{
    restaurantId: string;
    weekday: number;
    opensMinutes: number;
    closesMinutes: number;
  }>;
  closures?: Array<{ restaurantId: string; startsAt: Date; endsAt: Date }>;
}) {
  return {
    restaurant: { findUniqueOrThrow: vi.fn().mockResolvedValue(input.restaurant) },
    restaurantHours: { findMany: vi.fn().mockResolvedValue(input.hours ?? []) },
    restaurantClosure: { findMany: vi.fn().mockResolvedValue(input.closures ?? []) },
  } as unknown as PrismaService;
}

describe('RestaurantAvailabilityService', () => {
  it('computeForRestaurant wires status/hours/closures/timezone into the pure function correctly', async () => {
    const now = new Date();
    const todayWeekday = now.getUTCDay(); // not timezone-exact, but good enough for an "always open" fixture below
    const prisma = prismaStub({
      restaurant: { status: 'active', city: { timezone: 'UTC' } },
      hours: [{ restaurantId: 'r1', weekday: todayWeekday, opensMinutes: 0, closesMinutes: 0 }], // open all day
    });
    const svc = new RestaurantAvailabilityService(prisma);
    expect(await svc.computeForRestaurant('r1')).toBe('OPEN');
  });

  it('computeForRestaurant returns PAUSED when the restaurant status is paused, regardless of hours', async () => {
    const prisma = prismaStub({
      restaurant: { status: 'paused', city: { timezone: 'UTC' } },
      hours: [],
    });
    const svc = new RestaurantAvailabilityService(prisma);
    expect(await svc.computeForRestaurant('r1')).toBe('PAUSED');
  });

  it("computeForRestaurants batches correctly and never mixes up two restaurants' hours (N+1 guard, docs/20 §52)", async () => {
    const prisma = prismaStub({
      hours: [
        { restaurantId: 'r1', weekday: 0, opensMinutes: 0, closesMinutes: 0 }, // r1: open all Sundays
        { restaurantId: 'r2', weekday: 1, opensMinutes: 0, closesMinutes: 0 }, // r2: open all Mondays only
      ],
    });
    const svc = new RestaurantAvailabilityService(prisma);
    const sunday = new Date('2026-09-13T12:00:00Z'); // a Sunday
    vi.useFakeTimers();
    vi.setSystemTime(sunday);
    try {
      const result = await svc.computeForRestaurants([
        { id: 'r1', status: 'active', timezone: 'UTC' },
        { id: 'r2', status: 'active', timezone: 'UTC' },
      ]);
      expect(result.get('r1')).toBe('OPEN');
      expect(result.get('r2')).toBe('CLOSED');
    } finally {
      vi.useRealTimers();
    }
    // Exactly ONE query for hours and ONE for closures, regardless of restaurant count — the N+1 guard.
    expect(prisma.restaurantHours.findMany as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(prisma.restaurantClosure.findMany as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('computeForRestaurants returns an empty map for an empty input without querying at all', async () => {
    const prisma = prismaStub({});
    const svc = new RestaurantAvailabilityService(prisma);
    const result = await svc.computeForRestaurants([]);
    expect(result.size).toBe(0);
    expect(prisma.restaurantHours.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
