import { describe, expect, it, vi } from 'vitest';
import { CourierEarningsService } from './courier-earnings.service';

// FEAT-014 — docs/features/FEAT-014-courier-earnings-payouts (SPEC-014-01).

const NOW = new Date('2026-11-11T09:00:00Z'); // Wednesday 10:00 in N'Djamena

const deliveries = [
  {
    id: 'd1',
    orderId: 'o1',
    courierId: 'c1',
    status: 'delivered',
    deliveredAt: new Date('2026-11-11T08:00:00Z'),
    courierFeeMinor: 1_000n,
  }, // today
  {
    id: 'd2',
    orderId: 'o2',
    courierId: 'c1',
    status: 'delivered',
    deliveredAt: new Date('2026-11-09T12:00:00Z'),
    courierFeeMinor: 1_500n,
  }, // Monday
  {
    id: 'd3',
    orderId: 'o3',
    courierId: 'c1',
    status: 'delivered',
    deliveredAt: new Date('2026-11-07T12:00:00Z'),
    courierFeeMinor: 1_000n,
  }, // last week
  {
    id: 'd4',
    orderId: 'o4',
    courierId: 'c2',
    status: 'delivered',
    deliveredAt: new Date('2026-11-11T08:00:00Z'),
    courierFeeMinor: 9_000n,
  }, // another courier
];

function harness() {
  const prisma = {
    delivery: {
      aggregate: vi.fn(
        async ({ where }: { where: { courierId: string; deliveredAt: { gte: Date } } }) => {
          const hit = deliveries.filter(
            (d) =>
              d.courierId === where.courierId &&
              d.status === 'delivered' &&
              d.deliveredAt >= where.deliveredAt.gte,
          );
          return {
            _sum: { courierFeeMinor: hit.reduce((s, d) => s + d.courierFeeMinor, 0n) },
            _count: { _all: hit.length },
          };
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { courierId: string } }) =>
        deliveries
          .filter((d) => d.courierId === where.courierId)
          .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime()),
      ),
    },
  };
  const ledgerRead = {
    getCourierAvailable: vi.fn(async () => 12_000n),
    getCashHeld: vi.fn(async () => 8_500n),
  };
  const orders = {
    getDeliveryContext: vi.fn(async () => ({
      restaurantName: 'Chez Fatimé',
      dropoffAddress: 'Klemat, Rue 42, Près du rond-point Kondolé',
      totalMinor: 999_999n, // must never reach the courier
    })),
  };
  return new CourierEarningsService(prisma as never, ledgerRead as never, orders as never);
}

describe('SPEC-014-01 — what the courier earned', () => {
  it('SPEC-014-01-SC03 — today and this week count only their period; each course shows its fee, never an order amount', async () => {
    const r = await harness().getEarnings('c1', NOW);
    expect(r.today).toEqual({ amount: { minor: '1000', currency: 'XAF' }, count: 1 });
    expect(r.week).toMatchObject({
      amount: { minor: '2500', currency: 'XAF' },
      count: 2,
      since: '2026-11-08T23:00:00.000Z',
    });
    expect(r.items.map((i) => [i.deliveryId, i.fee.minor, i.quartier])).toEqual([
      ['d1', '1000', 'Klemat'],
      ['d2', '1500', 'Klemat'],
      ['d3', '1000', 'Klemat'],
    ]);
    expect(JSON.stringify(r)).not.toContain('999999');
    expect(r.balance).toEqual({
      available: { minor: '12000', currency: 'XAF' },
      cashHeld: { minor: '8500', currency: 'XAF' },
      net: { minor: '3500', currency: 'XAF' },
    });
  });
});
